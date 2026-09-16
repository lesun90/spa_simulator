import * as THREE from "three";
import { theme } from "../../app/theme";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import type { ViewportSize } from "../../engine/Viewport";
import { BasePanel } from "../../features/hud/kit/BasePanel";
import { Button } from "../../features/hud/kit/Button";
import { computeShellLayout, type Rect, type ShellRects } from "../../features/hud/kit/layout";
import { Panel } from "../../features/hud/kit/Panel";
import { TextField } from "../../features/hud/kit/TextField";
import { sameSceneReference, type SceneChoice, type SceneReference } from "../domain/scene";
import { createAgentDraft, type AgentChoice, type AgentDraft, type AgentSnapshot, type PlacementPreview } from "../domain/agent";
import { frictionForMaterial } from "../domain/materialFriction";
import type { PlaybackState } from "../domain/playback";
import { HudText } from "./HudText";
import { SceneBrowserPanel } from "./SceneBrowserPanel";
import type { ScenarioSceneThumbnails } from "../rendering/ScenarioSceneThumbnails";
import { AgentBrowserTab } from "./AgentBrowserTab";
import { AgentInspectorPanel } from "./AgentInspectorPanel";

/** Vertical spacing between stacked material-friction rows in the scene inspector. */
const CONTROL_HEIGHT_STEP = 30;

interface ScenarioActions {
  rename(name: string): string;
  create(): Promise<void>;
  open(): Promise<void>;
  save(): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  reset(): void;
  materialFriction(): Readonly<Record<string, number>>;
  setMaterialFriction(material: string, value: number): void;
}

/** Reuses Scene Studio's shell geometry, panel chrome, tiles, buttons, and text renderer. */
export class ScenarioHudFeature {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private readonly browser: SceneBrowserPanel;
  private readonly agentBrowser: AgentBrowserTab;
  private readonly agentInspector: AgentInspectorPanel;
  private readonly scenesTab: Button;
  private readonly agentsTab: Button;
  private readonly left: BasePanel;
  private readonly right: BasePanel;
  private readonly useButton: Button;
  private readonly resetButton: Button;
  private readonly scenarioNameField: TextField;
  private readonly roadWidthField: TextField;
  /** Session-only road-width edits, keyed by scene reference key; unset scenes fall back to their authored metadata. */
  private readonly roadWidthOverrides = new Map<string, number>();
  private readonly materialFrictionLabels = new Map<string, HudText>();
  private readonly materialFrictionFields = new Map<string, TextField>();
  private readonly newButton: Button;
  private readonly openButton: Button;
  private readonly saveButton: Button;
  private readonly playButton: Button;
  private readonly pauseButton: Button;
  private readonly resetPlaybackButton: Button;
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
  private agentGeneration = 0;
  private population: readonly AgentSnapshot[] = [];
  private placementDraft: AgentDraft | null = null;
  private activeTab: "scenes" | "agents" = "scenes";
  private scenarioBusy = false;
  private scenarioName = "Untitled scenario";
  private playbackState: PlaybackState = "ready";
  private playbackBusy = false;

  constructor(
    size: ViewportSize,
    private readonly interaction: InteractionSystem,
    private readonly listScenes: () => Promise<readonly SceneChoice[]>,
    private readonly listAgents: () => Promise<readonly AgentChoice[]>,
    private readonly useScene: (reference: SceneReference) => Promise<void>,
    private readonly onPlacementArmed: (draft: AgentDraft | null) => void,
    private readonly onPlacementDropped: (draft: AgentDraft, x: number, y: number) => void,
    updateAgent: (id: string, draft: AgentDraft) => Promise<void>,
    duplicateAgent: (id: string) => Promise<void>,
    deleteAgent: (id: string) => Promise<void>,
    resetView: () => void,
    thumbnails: ScenarioSceneThumbnails,
    private readonly scenarioActions: ScenarioActions
  ) {
    this.layout = shell(size);
    this.camera = new THREE.OrthographicCamera(0, size.width, 0, size.height, 0.1, 100);
    this.camera.position.z = 10;
    const left = this.layout.leftPanel;
    const right = this.layout.inspectorPanel;
    this.left = new BasePanel(left, sideStyle("left"), interaction);
    this.right = new BasePanel(right, sideStyle("right"), interaction);
    this.right.root.visible = right.width > 0;
    this.browser = new SceneBrowserPanel(this.layout.assetBrowser, interaction, () => void this.refreshScenes(), (choice) => this.select(choice), () => this.invalidate(), thumbnails);
    this.agentBrowser = new AgentBrowserTab(this.layout.assetBrowser, interaction, () => void this.refreshAgents(), (choice) => this.selectAgentAsset(choice), () => this.invalidate(),
      (choice, phase, x, y) => this.dragAgent(choice, phase, x, y));
    this.agentInspector = new AgentInspectorPanel(left, interaction, (draft) => this.armPlacement(draft), updateAgent,
      async (id) => { await duplicateAgent(id); }, async (id) => { await deleteAgent(id); }, () => this.invalidate());
    this.scenesTab = new Button(this.sceneTabRect(), interaction, { label: "Scenes", onClick: () => this.showTab("scenes") });
    this.agentsTab = new Button(this.agentTabRect(), interaction, { label: "Agents", onClick: () => this.showTab("agents") });
    this.labels = {
      leftTitle: label(left, 18, 12, 12, "700", theme.text.css, "SCENE"),
      activeHeader: label(left, 18, 63, 10.5, "700", theme.textMutedStrong.css, "ACTIVE ENVIRONMENT"),
      active: label(left, 18, 89, 14, "600", theme.text.css, "Default green ground", 3),
      candidateHeader: label(left, 18, 156, 10.5, "700", theme.textMutedStrong.css, "SELECTED SCENE"),
      candidate: label(left, 18, 182, 13, "500", theme.text.css, "No scene selected", 3),
      status: label(left, 18, left.height - 120, 11.5, "500", theme.textMuted.css, "Select a scene from the browser.", 4),
      inspectorTitle: label(right, 18, 12, 14, "700", theme.text.css, "Scene Inspector"),
      detailName: label(right, 18, 64, 14, "600", theme.text.css, "No scene selected", 2),
      detailDescription: label(right, 18, 109, 12, "500", theme.textMuted.css, "Select a scene in the browser to inspect its metadata.", 3),
      detailMetadata: label(right, 18, 171, 11.5, "600", theme.text.css, "", 3),
      roadWidthLabel: label(right, 18, 222, 11.5, "600", theme.textMutedStrong.css, "Road width (m)"),
      detailKey: label(right, 18, 255, 11.5, "500", theme.textMuted.css, "", 2),
      detailVersion: label(right, 18, 287, 11.5, "500", theme.textMuted.css, ""),
      detailHash: label(right, 18, 313, 11.5, "500", theme.textMuted.css, "", 2),
      diagnostic: label(right, 18, 367, 11.5, "500", theme.diagnostic.css, "", 5),
      scenarioState: new HudText(scenarioStateFrame(this.layout), { size: 11, weight: "600", color: theme.textMutedStrong.css }),
      playbackState: new HudText(playbackStateFrame(this.layout), { size: 11, weight: "600", color: theme.textMutedStrong.css }),
      modalTitle: label(modalRect(size), 25, 28, 18, "700", theme.text.css, "Replace current scene?"),
      modalCandidate: label(modalRect(size), 25, 65, 14, "600", theme.text.css, "", 2),
      modalMessage: label(modalRect(size), 25, 112, 12.5, "500", theme.textMuted.css,
        "This replaces the current environment and removes 0 agents. Cancel keeps the current scene.", 4)
    };
    this.useButton = new Button(this.useRect(), interaction, { label: "Use Scene", onClick: () => this.requestUse() });
    this.resetButton = new Button(this.resetRect(), interaction, { icon: "refresh", onClick: resetView });
    this.scenarioNameField = new TextField(scenarioNameRect(this.layout), interaction, {
      placeholder: "Scenario name",
      onCommit: (value) => {
        try {
          this.scenarioName = this.scenarioActions.rename(value);
          this.scenarioNameField.setValue(this.scenarioName);
        } catch (error) {
          this.scenarioNameField.setValue(this.scenarioName);
          this.setScenarioStatus(message(error), true);
        }
      }
    }, "Untitled scenario");
    this.newButton = new Button(scenarioButtonRect(this.layout, 0), interaction, { label: "New", onClick: () => void this.runScenarioAction("Creating new scenario…", () => this.scenarioActions.create()) });
    this.openButton = new Button(scenarioButtonRect(this.layout, 1), interaction, { label: "Open", onClick: () => void this.runScenarioAction("Opening scenario…", () => this.scenarioActions.open()) });
    this.saveButton = new Button(scenarioButtonRect(this.layout, 2), interaction, { label: "Save", onClick: () => void this.runScenarioAction("Saving scenario…", () => this.scenarioActions.save()) });
    this.playButton = new Button(playbackButtonRect(this.layout, 0), interaction, { label: "Play", onClick: () => void this.runPlaybackAction(() => this.scenarioActions.play()) });
    this.pauseButton = new Button(playbackButtonRect(this.layout, 1), interaction, { label: "Pause", onClick: () => this.scenarioActions.pause() });
    this.resetPlaybackButton = new Button(playbackButtonRect(this.layout, 2), interaction, { label: "Reset", onClick: () => this.scenarioActions.reset() });
    const leftDivider = new Panel({ x: left.x, y: 40, width: left.width, height: 1 }, { fill: theme.borderSubtle.hex, radius: 0 });
    const rightDivider = new Panel({ x: right.x, y: 40, width: right.width, height: 1 }, { fill: theme.borderSubtle.hex, radius: 0 });
    this.roadWidthField = new TextField(this.roadWidthFieldRect(), interaction, {
      numeric: true,
      placeholder: "0",
      onCommit: (value) => this.commitRoadWidth(value)
    }, "0");
    this.left.root.add(leftDivider.root, ...Object.entries(this.labels).filter(([key]) => ["leftTitle", "activeHeader", "active", "candidateHeader", "candidate", "status"].includes(key)).map(([, value]) => value.root), this.useButton.root);
    this.right.root.add(rightDivider.root, ...Object.entries(this.labels).filter(([key]) => ["inspectorTitle", "detailName", "detailDescription", "detailMetadata", "roadWidthLabel", "detailKey", "detailVersion", "detailHash", "diagnostic"].includes(key)).map(([, value]) => value.root), this.roadWidthField.root);
    this.dividers = [leftDivider, rightDivider];

    this.backdrop = new Panel({ x: 0, y: 0, width: size.width, height: size.height }, { fill: 0x0d1520, fillOpacity: 0.55, radius: 0, z: 4.5 });
    this.modal = new Panel(modalRect(size), { fill: theme.panel.hex, border: theme.borderStrong.hex, borderWidth: 1, radius: theme.radius.lg, shadow: "lg", z: 5 });
    this.cancelButton = new Button(modalButtonRect(size, false), interaction, { label: "Cancel", onClick: () => this.cancel() });
    this.confirmButton = new Button(modalButtonRect(size, true), interaction, { label: "Switch Scene", onClick: () => this.confirm() });
    for (const root of [this.labels.modalTitle.root, this.labels.modalCandidate.root, this.labels.modalMessage.root, this.cancelButton.root, this.confirmButton.root]) root.position.z = 5.2;
    this.modalRoot.add(this.backdrop.root, this.modal.root, this.labels.modalTitle.root, this.labels.modalCandidate.root, this.labels.modalMessage.root, this.cancelButton.root, this.confirmButton.root);
    this.modalRoot.visible = false;
    this.unregisterBackdrop = interaction.register(this.backdrop.root, { onClick: () => this.cancel() });
    this.unregisterModal = interaction.register(this.modal.root, { onPointerDown: () => {} });
    this.scene.add(this.left.root, this.agentInspector.root, this.right.root, this.browser.root, this.agentBrowser.root, this.scenesTab.root, this.agentsTab.root,
      this.scenarioNameField.root, this.newButton.root, this.openButton.root, this.saveButton.root, this.labels.scenarioState.root, this.resetButton.root, this.modalRoot,
      this.playButton.root, this.pauseButton.root, this.resetPlaybackButton.root, this.labels.playbackState.root);
    this.showTab("scenes");
    this.update();
    this.setPlaybackState("ready");
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

  private roadWidthFieldRect(): Rect {
    const r = this.layout.inspectorPanel;
    const labelWidth = 100;
    return { x: r.x + 18 + labelWidth, y: r.y + 216, width: Math.max(r.width - 36 - labelWidth, 40), height: 26 };
  }

  private sceneTabRect(): Rect {
    const r = this.layout.assetBrowser;
    return r.width < 980 ? { x: r.x + 16, y: r.y + 57, width: 74, height: 30 } : { x: r.x + 430, y: r.y + 9, width: 78, height: 34 };
  }
  private agentTabRect(): Rect {
    const r = this.layout.assetBrowser;
    return r.width < 980 ? { x: r.x + 96, y: r.y + 57, width: 74, height: 30 } : { x: r.x + 514, y: r.y + 9, width: 78, height: 34 };
  }

  async refresh(): Promise<void> {
    await Promise.all([this.refreshScenes(), this.refreshAgents()]);
  }

  private async refreshScenes(): Promise<void> {
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
      this.labels.status.setText(`${choices.filter((choice) => choice.available).length} scene${choices.filter((choice) => choice.available).length === 1 ? "" : "s"} available.`);
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.labels.status.setText(message(error));
    } finally {
      if (!this.disposed && generation === this.generation) {
        this.browser.setRefreshing(false);
        this.update();
      }
    }
  }

  private async refreshAgents(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.agentGeneration;
    this.agentBrowser.setRefreshing(true);
    try {
      const choices = await this.listAgents();
      if (this.disposed || generation !== this.agentGeneration) return;
      this.agentBrowser.setChoices(choices);
    } catch (error) {
      if (!this.disposed && generation === this.agentGeneration) this.agentInspector.setStatus(message(error), true);
    } finally {
      if (!this.disposed && generation === this.agentGeneration) this.agentBrowser.setRefreshing(false);
    }
  }

  setActive(reference: SceneReference | null): void {
    if (this.disposed) return;
    this.active = reference;
    this.update();
  }

  setPopulation(agents: readonly AgentSnapshot[]): void {
    this.population = agents;
    this.agentInspector.setPopulation(agents);
    this.labels.modalMessage.setText(replacementMessage(agents.length));
    this.invalidate();
  }

  setScenarioState(name: string, dirty: boolean): void {
    this.scenarioName = name;
    this.scenarioNameField.setValue(name);
    this.labels.scenarioState.setText(dirty ? "Unsaved changes" : "Saved");
    this.labels.scenarioState.setStyle({ color: theme.textMutedStrong.css });
    this.invalidate();
  }

  setScenarioStatus(text: string, diagnostic = false): void {
    this.labels.scenarioState.setText(text);
    this.labels.scenarioState.setStyle({ color: diagnostic ? theme.diagnostic.css : theme.textMutedStrong.css });
    this.invalidate();
  }

  sceneReplaced(): void {
    this.cancelPlacement();
    this.agentBrowser.setSelected(null);
    this.agentInspector.clearSceneDrafts();
    this.invalidate();
  }

  selectExistingAgent(agent: AgentSnapshot | null): void {
    if (!agent) { this.clearAgentSelection(); return; }
    this.cancelPlacement();
    this.showTab("agents");
    this.agentBrowser.setSelected(agent.asset.id);
    this.agentInspector.selectExisting(agent);
  }

  clearAgentSelection(): void {
    this.agentBrowser.setSelected(null);
    this.agentInspector.clearSelection();
    this.invalidate();
  }

  setAgentStatus(messageText: string, diagnostic = false): void {
    this.agentInspector.setStatus(messageText, diagnostic);
  }

  getPlacementDraft(): AgentDraft | null { return this.placementDraft; }
  setPlacementPreview(preview: PlacementPreview | null): void {
    if (!this.placementDraft) return;
    this.agentInspector.setStatus(preview?.valid ? "Click to place this agent." : preview?.reason ?? "Move over a solid support surface.", !preview?.valid);
  }
  placementCompleted(messageText: string): void {
    this.placementDraft = null;
    this.onPlacementArmed(null);
    this.agentInspector.setStatus(messageText);
  }
  cancelPlacement(): void {
    if (!this.placementDraft) return;
    this.placementDraft = null;
    this.onPlacementArmed(null);
    this.agentInspector.setStatus("Placement canceled.");
  }

  /** Returns whether a cached HUD texture needs to be refreshed. */
  consumeRenderNeeded(): boolean {
    const renderNeeded = this.renderNeeded;
    this.renderNeeded = false;
    return renderNeeded;
  }

  updatePreviews(dt: number): void {
    if (this.activeTab === "scenes") this.browser.update(dt);
    else this.agentBrowser.update(dt);
    this.agentInspector.update(dt);
    this.scenarioNameField.update(dt);
    this.roadWidthField.update(dt);
    for (const field of this.materialFrictionFields.values()) field.update(dt);
  }

  invalidate(): void {
    this.renderNeeded = true;
  }

  private select(choice: SceneChoice): void {
    if (this.busy || this.pending) return;
    this.candidate = choice;
    this.labels.status.setText(choice.available ? choice.description || "Ready to load selected scene." : choice.diagnostics.join(" "));
    this.update();
  }

  private selectAgentAsset(choice: AgentChoice): void {
    if (this.busy || this.pending) return;
    this.agentBrowser.setSelected(choice.asset.id);
    this.agentInspector.selectNew(choice, this.activeRoadWidthMeters());
    this.invalidate();
  }

  private activeRoadWidthMeters(): number {
    const choice = this.choices.find((candidate) => sameSceneReference(candidate.reference, this.active));
    return choice ? this.roadWidthOverrides.get(choice.reference.key) ?? choice.roadWidthMeters ?? 0 : 0;
  }

  private candidateRoadWidthMeters(): number {
    if (!this.candidate) return 0;
    return this.roadWidthOverrides.get(this.candidate.reference.key) ?? this.candidate.roadWidthMeters ?? 0;
  }

  private commitRoadWidth(value: string): void {
    if (!this.candidate) return;
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= 0) this.roadWidthOverrides.set(this.candidate.reference.key, parsed);
    this.roadWidthField.setValue(String(this.candidateRoadWidthMeters()));
  }

  private syncMaterialFrictionRows(): void {
    const materials = this.candidate?.materials ?? [];
    for (const [material, field] of this.materialFrictionFields) if (!materials.includes(material)) {
      field.root.removeFromParent(); field.dispose(); this.materialFrictionFields.delete(material);
      const label = this.materialFrictionLabels.get(material);
      if (label) { label.root.removeFromParent(); label.dispose(); }
      this.materialFrictionLabels.delete(material);
    }
    materials.forEach((material, index) => {
      let field = this.materialFrictionFields.get(material);
      if (!field) {
        field = new TextField(this.materialFrictionFieldRect(index), this.interaction, {
          numeric: true, placeholder: "0.6", onCommit: (value) => this.commitMaterialFriction(material, value)
        }, "");
        this.materialFrictionFields.set(material, field);
        this.right.root.add(field.root);
      }
      field.setRect(this.materialFrictionFieldRect(index));
      field.setValue(String(frictionForMaterial(material, this.scenarioActions.materialFriction())));
      let label = this.materialFrictionLabels.get(material);
      if (!label) {
        label = new HudText(this.materialFrictionLabelRect(index), { size: 11.5, weight: "600", color: theme.textMutedStrong.css });
        label.setText(material);
        this.materialFrictionLabels.set(material, label);
        this.right.root.add(label.root);
      }
      label.setFrame(this.materialFrictionLabelRect(index));
    });
  }

  private materialFrictionRowCount(): number { return this.candidate?.materials?.length ?? 0; }

  private materialFrictionFieldRect(index: number): Rect {
    const field = this.roadWidthFieldRect();
    return { x: field.x, y: field.y + (index + 1) * (CONTROL_HEIGHT_STEP), width: field.width, height: 26 };
  }

  private materialFrictionLabelRect(index: number): Rect {
    const field = this.materialFrictionFieldRect(index);
    return { x: field.x - 100, y: field.y, width: 100, height: 26 };
  }

  private commitMaterialFriction(material: string, value: string): void {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) this.scenarioActions.setMaterialFriction(material, parsed);
    this.materialFrictionFields.get(material)?.setValue(String(frictionForMaterial(material, this.scenarioActions.materialFriction())));
  }

  /** Repositions the fixed-offset inspector labels that sit below the material-friction rows, whose
   * count varies with the currently-inspected scene's material list. */
  private positionDetailLabels(): void {
    const panel = this.layout.inspectorPanel;
    const shift = this.materialFrictionRowCount() * CONTROL_HEIGHT_STEP;
    for (const [name, y, maxLines] of [
      ["detailKey", 255 + shift, 3],
      ["detailVersion", 287 + shift, 3],
      ["detailHash", 313 + shift, 3],
      ["diagnostic", 367 + shift, 5]
    ] as const) {
      this.labels[name].setFrame({ x: panel.x + 18, y: panel.y + y, width: Math.max(panel.width - 36, 1), maxLines });
    }
  }

  private armPlacement(draft: AgentDraft): void {
    this.placementDraft = draft;
    this.agentInspector.setStatus("Move over the viewport and click a valid solid surface.");
    this.onPlacementArmed(draft);
  }

  private dragAgent(choice: AgentChoice, phase: "start" | "move" | "drop", x: number, y: number): void {
    if (phase === "start") this.armPlacement(this.agentInspector.currentPlacementDraft() ?? createAgentDraft(choice.asset, this.activeRoadWidthMeters()));
    if (phase === "drop" && this.placementDraft) {
      if (this.interaction.isPointerOverInteractiveLayer(x, y)) this.cancelPlacement();
      else this.onPlacementDropped(this.placementDraft, x, y);
    }
  }

  private showTab(tab: "scenes" | "agents"): void {
    this.activeTab = tab;
    this.browser.root.visible = tab === "scenes";
    this.agentBrowser.root.visible = tab === "agents";
    this.left.root.visible = tab === "scenes";
    this.agentInspector.root.visible = tab === "agents";
    this.scenesTab.setActive(tab === "scenes");
    this.agentsTab.setActive(tab === "agents");
    this.invalidate();
  }

  private requestUse(): void {
    if (!this.candidate?.available || this.busy || sameSceneReference(this.candidate.reference, this.active)) return;
    this.interaction.blurField();
    this.pending = this.candidate;
    this.labels.modalTitle.setText("Switch scene?");
    this.labels.modalCandidate.setText(`“${this.candidate.label}”`);
    this.labels.modalMessage.setText(replacementMessage(this.population.length));
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
    this.updateScenarioButtons();
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
      this.updateScenarioButtons();
      if (!this.disposed) this.update();
    }
  }

  private async runScenarioAction(progress: string, action: () => Promise<void>): Promise<void> {
    if (this.scenarioBusy) return;
    this.scenarioBusy = true;
    this.setScenarioStatus(progress);
    this.updateScenarioButtons();
    try { await action(); }
    catch (error) { if (!this.disposed) this.setScenarioStatus(message(error), true); }
    finally {
      this.scenarioBusy = false;
      if (!this.disposed) this.updateScenarioButtons();
    }
  }

  private updateScenarioButtons(): void {
    this.newButton.setDisabled(this.scenarioBusy || this.busy);
    this.openButton.setDisabled(this.scenarioBusy || this.busy);
    this.saveButton.setDisabled(this.scenarioBusy || this.busy);
  }

  setPlaybackState(state: PlaybackState, statusMessage?: string): void {
    this.playbackState = state;
    this.playbackBusy = state === "preparing";
    this.labels.playbackState.setText(statusMessage ? `${playbackLabel(state)} — ${statusMessage}` : playbackLabel(state));
    this.labels.playbackState.setStyle({ color: state === "error" ? theme.diagnostic.css : theme.textMutedStrong.css });
    this.updatePlaybackButtons();
    this.invalidate();
  }

  private async runPlaybackAction(action: () => Promise<void>): Promise<void> {
    if (this.playbackBusy) return;
    try { await action(); }
    catch (error) { if (!this.disposed) this.setPlaybackState(this.playbackState, message(error)); }
  }

  private updatePlaybackButtons(): void {
    this.playButton.setLabel(this.playbackState === "paused" ? "Resume" : "Play");
    this.playButton.setDisabled(this.playbackBusy || this.playbackState === "running" || this.playbackState === "preparing" || this.playbackState === "error");
    this.pauseButton.setDisabled(this.playbackState !== "running");
    this.resetPlaybackButton.setDisabled(this.playbackState === "ready");
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (this.interaction.handleKeyDown(event)) return;
    if (event.key === "Escape" && this.pending) this.cancel();
    else if (event.key === "Escape") this.cancelPlacement();
  }

  private update(): void {
    this.invalidate();
    this.browser.setSelected(this.candidate?.reference ?? null);
    this.labels.active.setText(this.active ? this.choices.find((choice) => choice.reference.key === this.active?.key)?.label ?? this.active.key : "Default green ground");
    this.labels.candidate.setText(this.candidate?.label ?? "No scene selected");
    this.useButton.setDisabled(this.busy || !this.candidate?.available || sameSceneReference(this.candidate.reference, this.active));
    this.labels.detailName.setText(this.candidate?.label ?? "No scene selected");
    this.labels.detailDescription.setText(this.candidate?.description ?? (this.candidate ? "" : "Select a scene in the browser to inspect its metadata."));
    this.labels.detailMetadata.setText(this.candidate ? sceneMetadata(this.candidate) : "");
    this.labels.roadWidthLabel.root.visible = Boolean(this.candidate);
    this.roadWidthField.root.visible = Boolean(this.candidate);
    this.roadWidthField.setValue(String(this.candidateRoadWidthMeters()));
    this.syncMaterialFrictionRows();
    this.positionDetailLabels();
    this.labels.detailKey.setText(this.candidate ? `Package: ${this.candidate.reference.key === "." ? "root" : this.candidate.reference.key}` : "");
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
    this.agentBrowser.setRect(this.layout.assetBrowser);
    this.agentInspector.setRect(this.layout.leftPanel);
    this.scenarioNameField.setRect(scenarioNameRect(this.layout));
    this.newButton.setRect(scenarioButtonRect(this.layout, 0));
    this.openButton.setRect(scenarioButtonRect(this.layout, 1));
    this.saveButton.setRect(scenarioButtonRect(this.layout, 2));
    this.playButton.setRect(playbackButtonRect(this.layout, 0));
    this.pauseButton.setRect(playbackButtonRect(this.layout, 1));
    this.resetPlaybackButton.setRect(playbackButtonRect(this.layout, 2));
    this.labels.scenarioState.setFrame(scenarioStateFrame(this.layout));
    this.labels.playbackState.setFrame(playbackStateFrame(this.layout));
    this.dividers[0].setRect({ x: 0, y: 40, width: this.layout.leftPanel.width, height: 1 });
    this.dividers[1].setRect({ x: this.layout.inspectorPanel.x, y: 40, width: this.layout.inspectorPanel.width, height: 1 });
    for (const [name, y, panel] of [
      ["leftTitle", 12, this.layout.leftPanel], ["activeHeader", 63, this.layout.leftPanel], ["active", 89, this.layout.leftPanel],
      ["candidateHeader", 156, this.layout.leftPanel], ["candidate", 182, this.layout.leftPanel],
      ["status", this.layout.leftPanel.height - 120, this.layout.leftPanel], ["inspectorTitle", 12, this.layout.inspectorPanel],
      ["detailName", 64, this.layout.inspectorPanel], ["detailDescription", 109, this.layout.inspectorPanel],
      ["detailMetadata", 171, this.layout.inspectorPanel], ["roadWidthLabel", 222, this.layout.inspectorPanel]
    ] as const) this.labels[name].setFrame({ x: panel.x + 18, y: panel.y + y, width: Math.max(panel.width - 36, 1), maxLines: name === "status" ? 4 : 3 });
    this.roadWidthField.setRect(this.roadWidthFieldRect());
    this.syncMaterialFrictionRows();
    this.positionDetailLabels();
    this.useButton.setRect(this.useRect());
    this.resetButton.setRect(this.resetRect());
    this.scenesTab.setRect(this.sceneTabRect());
    this.agentsTab.setRect(this.agentTabRect());
    this.backdrop.setRect({ x: 0, y: 0, width: size.width, height: size.height });
    this.modal.setRect(modalRect(size));
    this.labels.modalTitle.setFrame(frame(modalRect(size), 25, 28, 1));
    this.labels.modalCandidate.setFrame(frame(modalRect(size), 25, 65, 2));
    this.labels.modalMessage.setFrame(frame(modalRect(size), 25, 112, 4));
    this.cancelButton.setRect(modalButtonRect(size, false));
    this.confirmButton.setRect(modalButtonRect(size, true));
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    ++this.agentGeneration;
    this.unregisterBackdrop();
    this.unregisterModal();
    this.browser.dispose();
    this.agentBrowser.dispose();
    this.agentInspector.dispose();
    this.scenesTab.dispose();
    this.agentsTab.dispose();
    this.left.dispose();
    this.right.dispose();
    this.useButton.dispose();
    this.resetButton.dispose();
    this.scenarioNameField.dispose();
    this.roadWidthField.dispose();
    for (const field of this.materialFrictionFields.values()) { field.root.removeFromParent(); field.dispose(); }
    for (const label of this.materialFrictionLabels.values()) { label.root.removeFromParent(); label.dispose(); }
    this.newButton.dispose();
    this.openButton.dispose();
    this.saveButton.dispose();
    this.playButton.dispose();
    this.pauseButton.dispose();
    this.resetPlaybackButton.dispose();
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

function scenarioNameRect(layout: ShellRects): Rect {
  const viewport = layout.viewport;
  const compact = viewport.width < 520;
  return { x: viewport.x + 10, y: 10, width: compact ? Math.max(viewport.width - 64, 90) : Math.min(220, Math.max(viewport.width - 280, 120)), height: 34 };
}

function scenarioButtonRect(layout: ShellRects, index: number): Rect {
  const viewport = layout.viewport;
  const name = scenarioNameRect(layout);
  if (viewport.width < 520) {
    const width = Math.max(Math.floor((viewport.width - 32) / 3), 44);
    return { x: viewport.x + 10 + index * (width + 6), y: 50, width, height: 30 };
  }
  return { x: name.x + name.width + 8 + index * 68, y: 10, width: 62, height: 34 };
}

function playbackButtonRect(layout: ShellRects, index: number): Rect {
  const viewport = layout.viewport;
  if (viewport.width < 520) {
    const width = Math.max(Math.floor((viewport.width - 32) / 3), 44);
    return { x: viewport.x + 10 + index * (width + 6), y: 86, width, height: 30 };
  }
  return { x: viewport.x + 10 + index * 68, y: 50, width: 62, height: 34 };
}

function scenarioStateFrame(layout: ShellRects) {
  const viewport = layout.viewport;
  return { x: viewport.x + 12, y: viewport.width < 520 ? 122 : 88, width: Math.max(viewport.width - 24, 1), maxLines: 2 };
}

function playbackStateFrame(layout: ShellRects) {
  const viewport = layout.viewport;
  return { x: viewport.x + 12, y: viewport.width < 520 ? 140 : 105, width: Math.max(viewport.width - 24, 1), maxLines: 2 };
}

function playbackLabel(state: PlaybackState): string {
  switch (state) {
    case "ready": return "Ready";
    case "preparing": return "Preparing…";
    case "running": return "Running";
    case "paused": return "Paused";
    case "error": return "Playback error";
  }
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
  return { x: (size.width - width) / 2, y: (size.height - 256) / 2, width, height: 256 };
}

function modalButtonRect(size: ViewportSize, primary: boolean): Rect {
  const rect = modalRect(size);
  return { x: primary ? rect.x + rect.width - 160 : rect.x + rect.width - 266, y: rect.y + rect.height - 58, width: primary ? 136 : 96, height: 34 };
}

function message(error: unknown): string { return error instanceof Error ? error.message : "Scene request failed."; }
function sceneMetadata(choice: SceneChoice): string {
  return [
    choice.sceneSize === undefined ? null : `Scene size: ${choice.sceneSize} m`,
    choice.cellSize === undefined ? null : `Cell size: ${choice.cellSize} m`,
    choice.seed === undefined ? null : `Seed: ${choice.seed}`
  ].filter((value): value is string => value !== null).join("\n");
}
function replacementMessage(count: number): string {
  return `This replaces the current environment and removes ${count} agent${count === 1 ? "" : "s"}. Cancel keeps the current scene and agents.`;
}
