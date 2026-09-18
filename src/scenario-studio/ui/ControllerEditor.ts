import type { AgentSnapshot } from "../domain/agent";
import { DEFAULT_CONTROLLER_SOURCE, hashControllerSource, type ControllerScript } from "../domain/controller";
import type { ScenarioDocument } from "../domain/ScenarioDocument";
import type { ControllerDiagnostic, ControllerRuntime } from "../runtime/ManagedControllerClient";
import type { CommandStatusMessage } from "../runtime/messages";

/** Accessible DOM drawer for controller source, assignments, validation, and runtime status. */
export class ControllerEditor {
  private readonly trigger = element("button", "scenario-controller-trigger", "Controllers");
  private readonly drawer = element("section", "scenario-controller-drawer");
  private readonly select = document.createElement("select");
  private readonly name = document.createElement("input");
  private readonly source = document.createElement("textarea");
  private readonly assignments = element("div", "scenario-controller-assignments");
  private readonly status = element("div", "scenario-controller-status", "Create a controller or choose one to edit.");
  private readonly create = element("button", "", "New controller");
  private readonly save = element("button", "primary", "Validate & save");
  private readonly remove = element("button", "danger", "Delete");
  private selectedId: string | null = null;
  private draftDirty = false;
  private playbackReady = true;
  private disposed = false;

  constructor(private readonly host: HTMLElement, private readonly scenario: ScenarioDocument, private readonly runtime: ControllerRuntime, private readonly agents: () => readonly AgentSnapshot[], private readonly onDocumentChanged: () => void) {
    installStyles();
    this.trigger.type = "button";
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.addEventListener("click", () => this.setOpen(this.drawer.hidden));
    this.drawer.hidden = true;
    this.drawer.setAttribute("aria-label", "JavaScript controllers");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");

    const header = element("header", "scenario-controller-header");
    const title = element("div");
    title.append(element("h2", "", "JavaScript controllers"), element("p", "", "Author once, assign per agent, run with independent state."));
    const close = element("button", "icon", "Close");
    close.type = "button";
    close.addEventListener("click", () => this.setOpen(false));
    header.append(title, close);

    const chooser = element("div", "scenario-controller-chooser");
    const selectLabel = label("Controller", this.select);
    this.select.addEventListener("change", () => this.choose(this.select.value || null));
    this.create.type = "button";
    this.create.addEventListener("click", () => this.createDraft());
    chooser.append(selectLabel, this.create);

    this.name.type = "text";
    this.name.maxLength = 80;
    this.name.placeholder = "Controller name";
    this.name.addEventListener("input", () => this.markDraftDirty());
    this.source.spellcheck = false;
    this.source.setAttribute("aria-label", "Controller JavaScript source");
    this.source.addEventListener("input", () => this.markDraftDirty());

    this.save.type = "button";
    this.remove.type = "button";
    this.save.addEventListener("click", () => void this.commit());
    this.remove.addEventListener("click", () => this.deleteSelected());
    const actions = element("div", "scenario-controller-actions");
    actions.append(this.remove, this.save);

    this.drawer.append(header, chooser, label("Name", this.name), label("Source", this.source), element("h3", "", "Assigned agents"), this.assignments, this.status, actions);
    host.append(this.trigger, this.drawer);
    this.refresh();
  }

  get isDirty(): boolean { return this.draftDirty; }

  refresh(force = false): void {
    if (this.draftDirty && !force) return;
    const controllers = this.scenario.controllers;
    const previous = this.selectedId;
    this.select.replaceChildren(new Option("Choose a controller", ""), ...controllers.map((controller) => new Option(controller.name, controller.id)));
    const selected = previous && controllers.some((controller) => controller.id === previous) ? previous : controllers[0]?.id ?? null;
    this.load(selected);
  }

  setPlaybackReady(ready: boolean): void {
    this.playbackReady = ready;
    this.updateEnabled();
    if (!ready) this.setStatus("Controllers are inspectable during playback. Reset before editing.");
  }

  showDiagnostic(diagnostic: ControllerDiagnostic | CommandStatusMessage): void {
    if ("accepted" in diagnostic && diagnostic.accepted) return;
    const owner = "controllerId" in diagnostic ? diagnostic.controllerId : diagnostic.source;
    const agent = diagnostic.agentId ? ` · ${diagnostic.agentId}` : "";
    this.setStatus(`${owner}${agent}: ${diagnostic.message}`, "level" in diagnostic ? diagnostic.level === "error" : !diagnostic.accepted);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.trigger.remove();
    this.drawer.remove();
  }

  private setOpen(open: boolean): void {
    if (!open && this.draftDirty && !window.confirm("Discard unsaved controller edits?")) return;
    this.drawer.hidden = !open;
    this.trigger.setAttribute("aria-expanded", String(open));
    if (!open) { this.load(this.selectedId); this.trigger.focus(); }
    else this.name.focus();
  }

  private choose(id: string | null): void {
    if (this.draftDirty && !window.confirm("Discard unsaved controller edits?")) { this.select.value = this.selectedId ?? ""; return; }
    this.load(id);
  }

  private load(id: string | null): void {
    this.selectedId = id;
    const script = this.scenario.controllers.find((candidate) => candidate.id === id);
    this.select.value = script?.id ?? "";
    this.name.value = script?.name ?? "";
    this.source.value = script?.source ?? "";
    this.renderAssignments(script?.id ?? null);
    this.draftDirty = false;
    this.setStatus(script ? "Saved source and assignments are ready." : "Create a controller or choose one to edit.");
    this.updateEnabled();
  }

  private createDraft(): void {
    if (!this.playbackReady) return;
    if (this.draftDirty && !window.confirm("Discard unsaved controller edits?")) return;
    this.selectedId = null;
    this.select.value = "";
    this.name.value = "Constant throttle";
    this.source.value = DEFAULT_CONTROLLER_SOURCE;
    this.renderAssignments(null);
    this.draftDirty = true;
    this.setStatus("Choose at least one agent, then validate and save.");
    this.updateEnabled();
    this.name.focus();
  }

  private renderAssignments(controllerId: string | null): void {
    const assigned = new Set(this.scenario.controllerAssignments.find((item) => item.controllerId === controllerId)?.agentIds ?? []);
    this.assignments.replaceChildren();
    const agents = this.agents();
    if (!agents.length) { this.assignments.append(element("p", "empty", "Add an agent before assigning a controller.")); return; }
    for (const agent of agents) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = agent.id;
      input.checked = assigned.has(agent.id);
      input.addEventListener("change", () => this.markDraftDirty());
      const row = element("label", "scenario-controller-agent");
      row.append(input, element("span", "", agent.name), element("small", "", agent.asset.category));
      this.assignments.append(row);
    }
  }

  private assignedAgentIds(): string[] { return [...this.assignments.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((input) => input.value); }

  private async commit(): Promise<void> {
    if (!this.playbackReady) return;
    const name = this.name.value.trim();
    const source = this.source.value;
    const agentIds = this.assignedAgentIds();
    if (!name) { this.setStatus("Enter a controller name.", true); return; }
    if (!agentIds.length) { this.setStatus("Assign the controller to at least one agent.", true); return; }
    this.save.disabled = true;
    this.setStatus("Validating source…");
    try {
      await this.runtime.validate(source);
      const id = this.selectedId ?? createId();
      const script: ControllerScript = { id, name, source, contentHash: hashControllerSource(source) };
      this.scenario.saveController(script, agentIds);
      this.selectedId = id;
      this.draftDirty = false;
      this.refresh();
      this.select.value = id;
      this.setStatus("Controller source and assignments saved.");
      this.onDocumentChanged();
    } catch (error) { this.setStatus(error instanceof Error ? error.message : "Controller validation failed.", true); }
    finally { this.updateEnabled(); }
  }

  private deleteSelected(): void {
    if (!this.playbackReady || !this.selectedId) return;
    const script = this.scenario.controllers.find((item) => item.id === this.selectedId);
    if (!script || !window.confirm(`Delete controller “${script.name}”?`)) return;
    this.scenario.deleteController(script.id);
    this.selectedId = null;
    this.refresh();
    this.onDocumentChanged();
  }

  private markDraftDirty(): void { this.draftDirty = true; this.setStatus("Unsaved controller edits."); this.updateEnabled(); }
  private updateEnabled(): void {
    const editable = this.playbackReady;
    this.name.disabled = !editable;
    this.source.disabled = !editable;
    this.create.disabled = !editable;
    for (const input of this.assignments.querySelectorAll<HTMLInputElement>("input")) input.disabled = !editable;
    this.save.disabled = !editable || !this.source.value;
    this.remove.disabled = !editable || !this.selectedId;
  }
  private setStatus(message: string, error = false): void { this.status.textContent = message; this.status.dataset.state = error ? "error" : "info"; }
}

function createId(): string { return `controller-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36)}`; }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
function label(text: string, control: HTMLElement): HTMLLabelElement { const result = element("label", "scenario-controller-field"); result.append(element("span", "", text), control); return result; }

function installStyles(): void {
  if (document.getElementById("scenario-controller-styles")) return;
  const style = document.createElement("style");
  style.id = "scenario-controller-styles";
  style.textContent = `
    .scenario-controller-trigger{position:fixed;z-index:30;right:318px;top:58px;height:36px;padding:0 16px;border:1px solid #526274;border-radius:8px;background:#182330;color:#eef4f8;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.3);cursor:pointer}
    .scenario-controller-trigger:hover,.scenario-controller-trigger:focus-visible{background:#223244;border-color:#7d91a6;outline:2px solid #5db7de;outline-offset:2px}
    .scenario-controller-drawer{position:fixed;z-index:31;right:18px;top:104px;bottom:18px;width:min(520px,calc(100vw - 36px));box-sizing:border-box;overflow:auto;padding:20px;border:1px solid #526274;border-radius:12px;background:#111a24;color:#eef4f8;box-shadow:0 18px 54px rgba(0,0,0,.48);font:14px/1.45 Inter,system-ui,sans-serif;scrollbar-color:#63778b #111a24}
    .scenario-controller-drawer[hidden]{display:none}.scenario-controller-drawer ::selection{background:#246a88;color:#fff}
    .scenario-controller-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:20px}.scenario-controller-header h2{margin:0 0 5px;font-size:22px;letter-spacing:-.02em}.scenario-controller-header p{margin:0;color:#b7c5d2}.scenario-controller-header .icon{border:0;background:transparent;color:#b7c5d2;cursor:pointer;padding:7px}
    .scenario-controller-chooser{display:grid;grid-template-columns:1fr auto;align-items:end;gap:10px;margin-bottom:15px}.scenario-controller-drawer button,.scenario-controller-drawer select,.scenario-controller-drawer input,.scenario-controller-drawer textarea{font:inherit}.scenario-controller-drawer button{min-height:36px;padding:0 13px;border:1px solid #526274;border-radius:7px;background:#1b2937;color:#eef4f8;cursor:pointer}.scenario-controller-drawer button:hover:not(:disabled){background:#26394b}.scenario-controller-drawer button:focus-visible,.scenario-controller-drawer select:focus-visible,.scenario-controller-drawer input:focus-visible,.scenario-controller-drawer textarea:focus-visible{outline:2px solid #5db7de;outline-offset:2px}.scenario-controller-drawer button:disabled{opacity:.45;cursor:not-allowed}
    .scenario-controller-field{display:grid;gap:6px;margin-bottom:14px}.scenario-controller-field>span,.scenario-controller-drawer h3{font-size:12px;font-weight:700;color:#cbd7e1}.scenario-controller-drawer h3{margin:18px 0 8px}.scenario-controller-field input,.scenario-controller-field select,.scenario-controller-field textarea,.scenario-controller-chooser select{box-sizing:border-box;width:100%;border:1px solid #46596b;border-radius:7px;background:#0b131c;color:#f4f7f9;padding:9px 10px}.scenario-controller-field textarea{min-height:260px;resize:vertical;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2;caret-color:#73c6eb}
    .scenario-controller-assignments{display:grid;gap:6px;max-height:148px;overflow:auto}.scenario-controller-agent{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:8px 10px;border:1px solid #344656;border-radius:7px;background:#14202b}.scenario-controller-agent small{color:#9fb0bf}.scenario-controller-agent input{accent-color:#58b9df}.scenario-controller-assignments .empty{margin:0;color:#9fb0bf}
    .scenario-controller-status{min-height:42px;margin:16px 0 0;padding:10px 12px;border:1px solid #344656;border-radius:7px;background:#0d1720;color:#bfd0dc}.scenario-controller-status[data-state=error]{border-color:#a85b61;color:#ffd4d6;background:#28171c}.scenario-controller-actions{position:sticky;bottom:-20px;display:flex;justify-content:flex-end;gap:8px;margin-top:0;padding:12px 0 0;background:#111a24;box-shadow:0 -8px 14px rgba(17,26,36,.92)}.scenario-controller-actions .primary{background:#17658a;border-color:#3e9bc2}.scenario-controller-actions .danger{margin-right:auto;color:#ffced1;border-color:#75444a}
    @media(max-width:900px){.scenario-controller-trigger{right:10px;top:124px}}
    @media(max-width:640px){.scenario-controller-drawer{inset:96px 10px 10px;width:auto;padding:16px}.scenario-controller-chooser{grid-template-columns:1fr}.scenario-controller-field textarea{min-height:210px}.scenario-controller-actions{bottom:-16px}}
    @media(prefers-reduced-motion:no-preference){.scenario-controller-drawer{animation:controller-in .18s cubic-bezier(.2,.8,.2,1)}@keyframes controller-in{from{transform:translateX(16px);opacity:.7}to{transform:none;opacity:1}}}
  `;
  document.head.append(style);
}
