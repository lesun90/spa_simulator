import type { SceneChoice, SceneReference } from "../domain/scene";
import { sameSceneReference } from "../domain/scene";
import { SceneBrowserTab } from "./SceneBrowserTab";

export class ScenarioWorkspace {
  readonly root = document.createElement("div");
  readonly canvas = document.createElement("canvas");
  private readonly browser = new SceneBrowserTab((choice) => this.select(choice));
  private readonly activeName = document.createElement("span");
  private readonly status = document.createElement("span");
  private readonly action = document.createElement("button");
  private readonly confirmation = document.createElement("dialog");
  private readonly confirmText = document.createElement("p");
  private readonly refreshButton = document.createElement("button");
  private candidate: SceneChoice | null = null;
  private choices: readonly SceneChoice[] = [];
  private active: SceneReference | null = null;
  private busy = false;
  private confirmationGeneration = 0;

  constructor(private readonly onRefresh: () => Promise<readonly SceneChoice[]>, private readonly onUse: (reference: SceneReference) => Promise<void>) {
    this.root.className = "scenario-studio";
    this.canvas.className = "scenario-canvas";
    this.canvas.setAttribute("aria-label", "Scenario viewport. Drag to orbit and scroll to zoom.");
    const sidebar = document.createElement("aside");
    sidebar.className = "scenario-sidebar";
    const brand = document.createElement("div");
    brand.className = "scenario-brand";
    brand.innerHTML = '<span class="scenario-mark">S<span>·</span></span><span><strong>STEERLAB</strong><small>SCENARIO STUDIO</small></span>';
    const heading = document.createElement("div");
    heading.className = "scenario-heading";
    heading.innerHTML = '<span class="scenario-eyebrow">01 / ENVIRONMENT</span><h1>Choose a scene</h1><p>Browse published environments. Select one to preview its details, then load it into the viewport.</p>';
    const toolbar = document.createElement("div");
    toolbar.className = "scenario-browser-toolbar";
    const tab = document.createElement("span");
    tab.textContent = "SCENES";
    this.refreshButton.type = "button";
    this.refreshButton.textContent = "↻  Refresh";
    this.refreshButton.addEventListener("click", () => void this.refresh());
    toolbar.append(tab, this.refreshButton);
    const footer = document.createElement("div");
    footer.className = "scenario-footer";
    this.status.className = "scenario-status";
    this.status.setAttribute("role", "status");
    this.action.className = "scenario-action";
    this.action.type = "button";
    this.action.textContent = "Use Scene";
    this.action.addEventListener("click", () => void this.useCandidate());
    footer.append(this.status, this.action);
    sidebar.append(brand, heading, toolbar, this.browser.root, footer);
    const overlay = document.createElement("div");
    overlay.className = "scenario-viewport-header";
    overlay.innerHTML = '<div><span class="scenario-eyebrow">LIVE VIEWPORT</span><strong>Environment preview</strong></div>';
    this.activeName.className = "scenario-active-name";
    overlay.append(this.activeName);
    const hint = document.createElement("div");
    hint.className = "scenario-viewport-hint";
    hint.textContent = "DRAG TO ORBIT   ·   SCROLL TO ZOOM";
    const modalHeading = document.createElement("h2");
    modalHeading.textContent = "Replace current scene?";
    const modalActions = document.createElement("div");
    modalActions.className = "scenario-modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.confirmation.close("cancel"));
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = "Replace Scene";
    confirm.addEventListener("click", () => this.confirmation.close("replace"));
    modalActions.append(cancel, confirm);
    this.confirmation.append(modalHeading, this.confirmText, modalActions);
    this.root.append(this.canvas, sidebar, overlay, hint, this.confirmation);
    this.status.textContent = "Select a scene to begin.";
    this.update();
  }

  async refresh(): Promise<void> {
    this.refreshButton.disabled = true;
    this.status.textContent = "Refreshing scene catalog…";
    try {
      this.choices = await this.onRefresh();
      this.candidate = this.choices.find((item) => item.reference.key === this.candidate?.reference.key) ?? null;
      this.status.textContent = `${this.choices.filter((item) => item.available).length} scene${this.choices.length === 1 ? "" : "s"} available.`;
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : "Catalog refresh failed.";
    } finally {
      this.refreshButton.disabled = false;
      this.update();
    }
  }

  setActive(reference: SceneReference | null): void {
    this.active = reference;
    this.update();
  }

  private select(choice: SceneChoice): void {
    if (this.busy) return;
    this.candidate = choice;
    this.status.textContent = choice.reference.key === this.active?.key ? "Current scene selected." : "Ready to load selected scene.";
    this.update();
  }

  private async useCandidate(): Promise<void> {
    const candidate = this.candidate;
    if (!candidate || this.busy || sameSceneReference(candidate.reference, this.active)) return;
    {
      const generation = ++this.confirmationGeneration;
      this.confirmText.textContent = "This will replace the current environment and remove 0 agents. The current scene stays visible if loading fails.";
      this.confirmation.showModal();
      const confirmed = await new Promise<boolean>((resolve) => {
        this.confirmation.addEventListener("close", () => resolve(this.confirmation.returnValue === "replace"), { once: true });
      });
      if (!confirmed || generation !== this.confirmationGeneration || candidate !== this.candidate) return;
    }
    this.busy = true;
    this.status.textContent = `Loading ${candidate.label}…`;
    this.update();
    try {
      await this.onUse(candidate.reference);
      this.active = candidate.reference;
      this.status.textContent = `${candidate.label} loaded.`;
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : "Scene load failed.";
    } finally {
      this.busy = false;
      this.update();
    }
  }

  private update(): void {
    this.browser.render(this.choices, this.candidate, this.active?.key ?? null);
    this.action.disabled = this.busy || !this.candidate?.available || sameSceneReference(this.candidate.reference, this.active);
    this.activeName.textContent = this.active ? `ACTIVE  /  ${this.choices.find((item) => item.reference.key === this.active?.key)?.label ?? this.active.key}` : "DEFAULT  /  GREEN GROUND";
  }

  dispose(): void {
    ++this.confirmationGeneration;
    if (this.confirmation.open) this.confirmation.close("cancel");
    this.root.remove();
  }
}
