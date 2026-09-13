import * as THREE from "three";
import { theme } from "../../app/theme";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import type { ViewportSize } from "../../engine/Viewport";
import { BasePanel } from "../../features/hud/kit/BasePanel";
import { Button } from "../../features/hud/kit/Button";
import { computeShellLayout, type Rect, type ShellRects } from "../../features/hud/kit/layout";
import { Panel } from "../../features/hud/kit/Panel";
import { sameSceneReference, type SceneChoice, type SceneReference } from "../domain/scene";
import { HudText } from "./HudText";
import { SceneBrowserPanel } from "./SceneBrowserPanel";
import type { ScenarioSceneThumbnails } from "../rendering/ScenarioSceneThumbnails";

/** Reuses Scene Studio's shell geometry, panel chrome, tiles, buttons, and text renderer. */
export class ScenarioHudFeature {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private readonly browser: SceneBrowserPanel;
  private readonly left: BasePanel;
  private readonly right: BasePanel;
  private readonly useButton: Button;
  private readonly resetButton: Button;
  private readonly backdrop: Panel;
  private readonly modal: Panel;
  private readonly cancelButton: Button;
  private readonly confirmButton: Button;
  private readonly modalRoot = new THREE.Group();
  private readonly labels: Record<string, HudText>;
  private readonly unregisterBackdrop: () => void;
  private readonly unregisterModal: () => void;
  private layout: ShellRects;
  private choices: readonly SceneChoice[] = [];
  private candidate: SceneChoice | null = null;
  private active: SceneReference | null = null;
  private pending: SceneChoice | null = null;
  private busy = false;
  private disposed = false;
  private renderNeeded = true;
  private generation = 0;

  constructor(
    size: ViewportSize,
    interaction: InteractionSystem,
    private readonly listScenes: () => Promise<readonly SceneChoice[]>,
    private readonly useScene: (reference: SceneReference) => Promise<void>,
    resetView: () => void,
    thumbnails: ScenarioSceneThumbnails
  ) {
    this.layout = shell(size);
    this.camera = new THREE.OrthographicCamera(0, size.width, 0, size.height, 0.1, 100);
    this.camera.position.z = 10;
    const left = this.layout.leftPanel;
    const right = this.layout.inspectorPanel;
    this.left = new BasePanel(left, sideStyle("left"), interaction);
    this.right = new BasePanel(right, sideStyle("right"), interaction);
    this.right.root.visible = right.width > 0;
    this.browser = new SceneBrowserPanel(this.layout.assetBrowser, interaction, () => void this.refresh(), (choice) => this.select(choice), () => this.invalidate(), thumbnails);
    this.labels = {
      leftTitle: label(left, 18, 12, 12, "700", theme.text.css, "SCENE"),
      activeHeader: label(left, 18, 63, 10.5, "700", theme.textMutedStrong.css, "ACTIVE ENVIRONMENT"),
      active: label(left, 18, 89, 14, "600", theme.text.css, "Default green ground", 3),
      candidateHeader: label(left, 18, 156, 10.5, "700", theme.textMutedStrong.css, "SELECTED SCENE"),
      candidate: label(left, 18, 182, 13, "500", theme.text.css, "No scene selected", 3),
      status: label(left, 18, left.height - 120, 11.5, "500", theme.textMuted.css, "Select a scene from the browser.", 4),
      inspectorTitle: label(right, 18, 12, 14, "700", theme.text.css, "Scene Inspector"),
      detailName: label(right, 18, 64, 14, "600", theme.text.css, "No scene selected", 2),
      detailKey: label(right, 18, 109, 12, "500", theme.textMuted.css, "Select a scene in the browser to inspect its package.", 3),
      detailVersion: label(right, 18, 181, 11.5, "500", theme.textMuted.css, ""),
      detailHash: label(right, 18, 207, 11.5, "500", theme.textMuted.css, "", 2),
      diagnostic: label(right, 18, 265, 11.5, "500", theme.diagnostic.css, "", 5),
      modalTitle: label(modalRect(size), 25, 28, 18, "700", theme.text.css, "Replace current scene?"),
      modalMessage: label(modalRect(size), 25, 76, 12.5, "500", theme.textMuted.css,
        "This replaces the current environment and removes 0 agents. Cancel keeps the current scene.", 3)
    };
    this.useButton = new Button(this.useRect(), interaction, { label: "Use Scene", onClick: () => this.requestUse() });
    this.resetButton = new Button(this.resetRect(), interaction, { icon: "refresh", onClick: resetView });
    const leftDivider = new Panel({ x: left.x, y: 40, width: left.width, height: 1 }, { fill: theme.borderSubtle.hex, radius: 0 });
    const rightDivider = new Panel({ x: right.x, y: 40, width: right.width, height: 1 }, { fill: theme.borderSubtle.hex, radius: 0 });
    this.left.root.add(leftDivider.root, ...Object.entries(this.labels).filter(([key]) => ["leftTitle", "activeHeader", "active", "candidateHeader", "candidate", "status"].includes(key)).map(([, value]) => value.root), this.useButton.root);
    this.right.root.add(rightDivider.root, ...Object.entries(this.labels).filter(([key]) => ["inspectorTitle", "detailName", "detailKey", "detailVersion", "detailHash", "diagnostic"].includes(key)).map(([, value]) => value.root));
    this.dividers = [leftDivider, rightDivider];

    this.backdrop = new Panel({ x: 0, y: 0, width: size.width, height: size.height }, { fill: 0x0d1520, fillOpacity: 0.55, radius: 0, z: 4.5 });
    this.modal = new Panel(modalRect(size), { fill: theme.panel.hex, border: theme.borderStrong.hex, borderWidth: 1, radius: theme.radius.lg, shadow: "lg", z: 5 });
    this.cancelButton = new Button(modalButtonRect(size, false), interaction, { label: "Cancel", onClick: () => this.cancel() });
    this.confirmButton = new Button(modalButtonRect(size, true), interaction, { label: "Replace Scene", onClick: () => this.confirm() });
    for (const root of [this.labels.modalTitle.root, this.labels.modalMessage.root, this.cancelButton.root, this.confirmButton.root]) root.position.z = 5.2;
    this.modalRoot.add(this.backdrop.root, this.modal.root, this.labels.modalTitle.root, this.labels.modalMessage.root, this.cancelButton.root, this.confirmButton.root);
    this.modalRoot.visible = false;
    this.unregisterBackdrop = interaction.register(this.backdrop.root, { onClick: () => this.cancel() });
    this.unregisterModal = interaction.register(this.modal.root, { onPointerDown: () => {} });
    this.scene.add(this.left.root, this.right.root, this.browser.root, this.resetButton.root, this.modalRoot);
    this.update();
  }

  private readonly dividers: Panel[];

  private useRect(): Rect {
    const r = this.layout.leftPanel;
    return { x: r.x + 16, y: r.y + r.height - 55, width: r.width - 32, height: 36 };
  }

  private resetRect(): Rect {
    const r = this.layout.viewport;
    return { x: r.x + r.width - 44, y: 10, width: 34, height: 34 };
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.browser.setRefreshing(true);
    this.labels.status.setText("Refreshing scenes…");
    try {
      const choices = await this.listScenes();
      if (this.disposed || generation !== this.generation) return;
      this.choices = choices;
      this.candidate = choices.find((choice) => choice.reference.key === this.candidate?.reference.key) ?? null;
      this.browser.setChoices(choices);
      this.labels.status.setText(`${choices.filter((choice) => choice.available).length} scene${choices.length === 1 ? "" : "s"} available.`);
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.labels.status.setText(message(error));
    } finally {
      if (!this.disposed && generation === this.generation) {
        this.browser.setRefreshing(false);
        this.update();
      }
    }
  }

  setActive(reference: SceneReference | null): void {
    if (this.disposed) return;
    this.active = reference;
    this.update();
  }

  /** Returns whether a cached HUD texture needs to be refreshed. */
  consumeRenderNeeded(): boolean {
    const renderNeeded = this.renderNeeded;
    this.renderNeeded = false;
    return renderNeeded;
  }

  updatePreviews(dt: number): void {
    this.browser.update(dt);
  }

  invalidate(): void {
    this.renderNeeded = true;
  }

  private select(choice: SceneChoice): void {
    if (this.busy || this.pending) return;
    this.candidate = choice;
    this.labels.status.setText(choice.available ? "Ready to load selected scene." : choice.diagnostics.join(" "));
    this.update();
  }

  private requestUse(): void {
    if (!this.candidate?.available || this.busy || sameSceneReference(this.candidate.reference, this.active)) return;
    this.pending = this.candidate;
    this.modalRoot.visible = true;
    this.invalidate();
  }

  private cancel(): void {
    this.pending = null;
    this.modalRoot.visible = false;
    this.invalidate();
  }

  private confirm(): void {
    const choice = this.pending;
    this.cancel();
    if (choice) void this.load(choice);
  }

  private async load(choice: SceneChoice): Promise<void> {
    this.busy = true;
    this.labels.status.setText(`Loading ${choice.label}…`);
    this.update();
    try {
      await this.useScene(choice.reference);
      if (this.disposed) return;
      this.active = choice.reference;
      this.labels.status.setText(`${choice.label} loaded.`);
    } catch (error) {
      if (!this.disposed) this.labels.status.setText(message(error));
    } finally {
      this.busy = false;
      if (!this.disposed) this.update();
    }
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.pending) this.cancel();
  }

  private update(): void {
    this.invalidate();
    this.browser.setSelected(this.candidate?.reference ?? null);
    this.labels.active.setText(this.active ? this.choices.find((choice) => choice.reference.key === this.active?.key)?.label ?? this.active.key : "Default green ground");
    this.labels.candidate.setText(this.candidate?.label ?? "No scene selected");
    this.useButton.setDisabled(this.busy || !this.candidate?.available || sameSceneReference(this.candidate.reference, this.active));
    this.labels.detailName.setText(this.candidate?.label ?? "No scene selected");
    this.labels.detailKey.setText(this.candidate ? `Package: ${this.candidate.reference.key === "." ? "root" : this.candidate.reference.key}` : "Select a scene in the browser to inspect its package.");
    this.labels.detailVersion.setText(this.candidate ? `Format version: ${this.candidate.reference.formatVersion}` : "");
    this.labels.detailHash.setText(this.candidate ? `Model SHA-256: ${this.candidate.reference.modelSha256.slice(0, 18)}…` : "");
    this.labels.diagnostic.setText(this.candidate?.available ? "" : this.candidate?.diagnostics.join(" ") ?? "");
  }

  resize(size: ViewportSize): void {
    this.invalidate();
    this.layout = shell(size);
    this.camera.right = size.width;
    this.camera.bottom = size.height;
    this.camera.updateProjectionMatrix();
    this.left.setRect(this.layout.leftPanel);
    this.right.setRect(this.layout.inspectorPanel);
    this.right.root.visible = this.layout.inspectorPanel.width > 0;
    this.browser.setRect(this.layout.assetBrowser);
    this.dividers[0].setRect({ x: 0, y: 40, width: this.layout.leftPanel.width, height: 1 });
    this.dividers[1].setRect({ x: this.layout.inspectorPanel.x, y: 40, width: this.layout.inspectorPanel.width, height: 1 });
    for (const [name, y, panel] of [
      ["leftTitle", 12, this.layout.leftPanel], ["activeHeader", 63, this.layout.leftPanel], ["active", 89, this.layout.leftPanel],
      ["candidateHeader", 156, this.layout.leftPanel], ["candidate", 182, this.layout.leftPanel],
      ["status", this.layout.leftPanel.height - 120, this.layout.leftPanel], ["inspectorTitle", 12, this.layout.inspectorPanel],
      ["detailName", 64, this.layout.inspectorPanel], ["detailKey", 109, this.layout.inspectorPanel],
      ["detailVersion", 181, this.layout.inspectorPanel], ["detailHash", 207, this.layout.inspectorPanel],
      ["diagnostic", 265, this.layout.inspectorPanel]
    ] as const) this.labels[name].setFrame({ x: panel.x + 18, y: panel.y + y, width: Math.max(panel.width - 36, 1), maxLines: name === "status" ? 4 : name === "diagnostic" ? 5 : 3 });
    this.useButton.setRect(this.useRect());
    this.resetButton.setRect(this.resetRect());
    this.backdrop.setRect({ x: 0, y: 0, width: size.width, height: size.height });
    this.modal.setRect(modalRect(size));
    this.labels.modalTitle.setFrame(frame(modalRect(size), 25, 28, 1));
    this.labels.modalMessage.setFrame(frame(modalRect(size), 25, 76, 3));
    this.cancelButton.setRect(modalButtonRect(size, false));
    this.confirmButton.setRect(modalButtonRect(size, true));
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    this.unregisterBackdrop();
    this.unregisterModal();
    this.browser.dispose();
    this.left.dispose();
    this.right.dispose();
    this.useButton.dispose();
    this.resetButton.dispose();
    this.backdrop.dispose();
    this.modal.dispose();
    this.cancelButton.dispose();
    this.confirmButton.dispose();
    for (const divider of this.dividers) divider.dispose();
    for (const label of Object.values(this.labels)) label.dispose();
  }
}

function shell(size: ViewportSize): ShellRects {
  return computeShellLayout(size.width, size.height, {
    assetBrowserHeight: size.width < 980 ? 150 : 190,
    leftPanelWidth: size.width < 640 ? Math.min(200, size.width * 0.5) : 280,
    inspectorPanelWidth: 300
  });
}

function sideStyle(side: "left" | "right") {
  return {
    fill: theme.panel.hex, border: theme.borderStrong.hex, borderWidth: 1,
    radius: side === "left"
      ? { topLeft: 0, topRight: theme.radius.lg, bottomLeft: 0, bottomRight: theme.radius.lg }
      : { topLeft: theme.radius.lg, topRight: 0, bottomLeft: theme.radius.lg, bottomRight: 0 },
    shadow: "lg" as const, z: -0.2
  };
}

function frame(rect: Rect, inset: number, y: number, maxLines = 1) {
  return { x: rect.x + inset, y: rect.y + y, width: Math.max(rect.width - inset * 2, 1), maxLines };
}

function label(rect: Rect, inset: number, y: number, size: number, weight: string, color: string, text: string, maxLines = 1): HudText {
  const item = new HudText(frame(rect, inset, y, maxLines), { size, weight, color });
  item.setText(text);
  return item;
}

function modalRect(size: ViewportSize): Rect {
  const width = Math.min(420, size.width - 28);
  return { x: (size.width - width) / 2, y: (size.height - 216) / 2, width, height: 216 };
}

function modalButtonRect(size: ViewportSize, primary: boolean): Rect {
  const rect = modalRect(size);
  return { x: primary ? rect.x + rect.width - 160 : rect.x + rect.width - 266, y: rect.y + rect.height - 58, width: primary ? 136 : 96, height: 34 };
}

function message(error: unknown): string { return error instanceof Error ? error.message : "Scene request failed."; }
