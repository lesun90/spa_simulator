import * as THREE from "three";
import { theme } from "../../app/theme";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import { BasePanel } from "../../features/hud/kit/BasePanel";
import { Button } from "../../features/hud/kit/Button";
import type { Rect } from "../../features/hud/kit/layout";
import { Panel } from "../../features/hud/kit/Panel";
import { TextField } from "../../features/hud/kit/TextField";
import { createAgentDraft, freezeDraft, validateAgentDraft, type AgentChoice, type AgentDraft, type AgentSnapshot } from "../domain/agent";
import { HudText } from "./HudText";

type Context = { kind: "new"; key: string } | { kind: "existing"; key: string } | null;

export class AgentInspectorPanel extends BasePanel {
  private readonly title: HudText;
  private readonly contextLabel: HudText;
  private readonly assetLabel: HudText;
  private readonly collisionLabel: HudText;
  private readonly eligibilityLabel: HudText;
  private readonly status: HudText;
  private readonly divider: Panel;
  private readonly fieldLabels: HudText[];
  private readonly fields: Record<"name" | "x" | "y" | "z" | "heading" | "mass" | "slope" | "clearance", TextField>;
  private readonly primary: Button;
  private readonly duplicate: Button;
  private readonly remove: Button;
  private readonly newDrafts = new Map<string, AgentDraft>();
  private readonly newAvailability = new Map<string, boolean>();
  private readonly existingDrafts = new Map<string, AgentDraft>();
  private readonly existing = new Map<string, AgentSnapshot>();
  private context: Context = null;
  private busy = false;

  constructor(
    rect: Rect,
    interaction: InteractionSystem,
    private readonly onBeginPlacement: (draft: AgentDraft) => void,
    private readonly onUpdate: (id: string, draft: AgentDraft) => Promise<void>,
    private readonly onDuplicate: (id: string) => Promise<void>,
    private readonly onDelete: (id: string) => Promise<void>,
    private readonly onVisualChange: () => void
  ) {
    super(rect, sideStyle(), interaction);
    this.title = text("Agent Inspector", 14, "700", theme.text.css);
    this.contextLabel = text("Select an agent asset or a placed agent.", 12, "600", theme.textMutedStrong.css);
    this.assetLabel = text("", 11.5, "500", theme.textMuted.css);
    this.collisionLabel = text("", 11, "500", theme.textMuted.css);
    this.eligibilityLabel = text("", 11, "500", theme.textMuted.css);
    this.status = text("", 11.5, "500", theme.diagnostic.css);
    this.divider = new Panel({ x: rect.x, y: 40, width: rect.width, height: 1 }, { fill: theme.borderSubtle.hex, radius: 0 });
    const names = ["Name", "Position X", "Position Y", "Position Z", "Heading °", "Mass kg", "Max slope °", "Clearance m"];
    this.fieldLabels = names.map((name) => text(name, 10.5, "600", theme.textMutedStrong.css));
    const keys = ["name", "x", "y", "z", "heading", "mass", "slope", "clearance"] as const;
    this.fields = Object.fromEntries(keys.map((key) => [key, new TextField({ x: 0, y: 0, width: 1, height: 30 }, interaction, { numeric: key !== "name" })])) as typeof this.fields;
    this.primary = new Button({ x: 0, y: 0, width: 1, height: 34 }, interaction, { label: "Add", onClick: () => this.primaryAction() });
    this.duplicate = new Button({ x: 0, y: 0, width: 1, height: 32 }, interaction, { label: "Duplicate", onClick: () => void this.execute(() => this.context?.kind === "existing" ? this.onDuplicate(this.context.key) : Promise.resolve()) });
    this.remove = new Button({ x: 0, y: 0, width: 1, height: 32 }, interaction, { label: "Delete", onClick: () => void this.execute(() => this.context?.kind === "existing" ? this.onDelete(this.context.key) : Promise.resolve()) });
    this.root.add(this.divider.root, this.title.root, this.contextLabel.root, this.assetLabel.root, ...this.fieldLabels.map((item) => item.root), ...Object.values(this.fields).map((item) => item.root), this.collisionLabel.root, this.eligibilityLabel.root, this.status.root, this.primary.root, this.duplicate.root, this.remove.root);
    this.layout();
    this.updateState();
  }

  selectNew(choice: AgentChoice): void {
    this.saveCurrentDraft();
    let draft = this.newDrafts.get(choice.asset.id);
    if (!draft) { draft = createAgentDraft(choice.asset); this.newDrafts.set(choice.asset.id, draft); }
    this.newAvailability.set(choice.asset.id, choice.available);
    this.context = { kind: "new", key: choice.asset.id };
    this.loadFields(draft);
    this.status.setText(choice.available ? "Configure defaults, then choose Add and click a solid surface." : choice.diagnostics.join(" "));
    this.updateState();
  }

  selectExisting(agent: AgentSnapshot): void {
    this.saveCurrentDraft();
    this.existing.set(agent.id, agent);
    if (!this.existingDrafts.has(agent.id)) this.existingDrafts.set(agent.id, freezeDraft(agent));
    this.context = { kind: "existing", key: agent.id };
    this.loadFields(this.existingDrafts.get(agent.id)!);
    this.status.setText("Edit values and Apply, or duplicate/delete this instance.");
    this.updateState();
  }

  setPopulation(agents: readonly AgentSnapshot[]): void {
    this.existing.clear();
    for (const agent of agents) this.existing.set(agent.id, agent);
    for (const id of this.existingDrafts.keys()) if (!this.existing.has(id)) this.existingDrafts.delete(id);
    if (this.context?.kind === "existing") {
      const current = this.existing.get(this.context.key);
      if (!current) { this.context = null; this.status.setText("The selected agent was removed."); this.clearFields(); }
      else {
        if (!this.existingDrafts.has(current.id)) this.existingDrafts.set(current.id, freezeDraft(current));
        this.loadFields(this.existingDrafts.get(current.id)!);
      }
    }
    this.updateState();
  }

  clearSceneDrafts(): void {
    this.newDrafts.clear();
    this.existingDrafts.clear();
    this.existing.clear();
    this.context = null;
    this.clearFields();
    this.setStatus("Select an agent asset or a placed agent.");
    this.updateState();
  }

  currentPlacementDraft(): AgentDraft | null {
    if (this.context?.kind !== "new") return null;
    return this.readFields();
  }

  setStatus(message: string, diagnostic = false): void {
    this.status.setStyle({ color: diagnostic ? theme.diagnostic.css : theme.textMuted.css });
    this.status.setText(message);
    this.onVisualChange();
  }

  update(dt: number): void { for (const field of Object.values(this.fields)) field.update(dt); }

  protected layout(): void {
    const x = this.rect.x + 18;
    const width = Math.max(this.rect.width - 36, 1);
    this.divider?.setRect({ x: this.rect.x, y: 40, width: this.rect.width, height: 1 });
    this.title?.setFrame({ x, y: this.rect.y + 12, width });
    this.contextLabel?.setFrame({ x, y: this.rect.y + 58, width, maxLines: 2 });
    this.assetLabel?.setFrame({ x, y: this.rect.y + 91, width, maxLines: 2 });
    const start = this.rect.y + 126;
    const row = 45;
    this.fieldLabels?.forEach((label, index) => label.setFrame({ x, y: start + index * row, width: 82 }));
    const keys = ["name", "x", "y", "z", "heading", "mass", "slope", "clearance"] as const;
    keys.forEach((key, index) => this.fields?.[key].setRect({ x: x + 88, y: start - 8 + index * row, width: Math.max(width - 88, 1), height: 30 }));
    const detailY = start + keys.length * row + 2;
    this.collisionLabel?.setFrame({ x, y: detailY, width, maxLines: 2 });
    this.eligibilityLabel?.setFrame({ x, y: detailY + 34, width, maxLines: 2 });
    this.status?.setFrame({ x, y: Math.max(detailY + 66, this.rect.y + this.rect.height - 132), width, maxLines: 3 });
    const buttonY = this.rect.y + this.rect.height - 50;
    this.primary?.setRect({ x, y: buttonY, width, height: 34 });
    this.duplicate?.setRect({ x, y: buttonY - 38, width: (width - 8) / 2, height: 32 });
    this.remove?.setRect({ x: x + (width - 8) / 2 + 8, y: buttonY - 38, width: (width - 8) / 2, height: 32 });
  }

  private primaryAction(): void {
    try {
      const draft = this.readFields();
      if (!draft) return;
      const valid = validateAgentDraft(draft);
      this.saveDraft(valid);
      if (this.context?.kind === "new") this.onBeginPlacement(valid);
      else if (this.context?.kind === "existing") void this.execute(() => this.onUpdate(this.context!.key, valid));
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "Agent settings are invalid.", true);
    }
  }

  private async execute(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.updateState();
    try { await action(); }
    catch (error) { this.setStatus(error instanceof Error ? error.message : "Agent operation failed.", true); }
    finally { this.busy = false; this.updateState(); }
  }

  private readFields(): AgentDraft | null {
    const base = this.currentDraft();
    if (!base) return null;
    const number = (key: keyof typeof this.fields) => Number(this.fields[key].getValue());
    return freezeDraft({
      ...base,
      name: this.fields.name.getValue(),
      pose: { position: { x: number("x"), y: number("y"), z: number("z") }, headingRadians: number("heading") * Math.PI / 180 },
      mass: number("mass"),
      placement: { maxSlopeDegrees: number("slope"), clearance: number("clearance") }
    });
  }

  private currentDraft(): AgentDraft | null {
    if (!this.context) return null;
    return this.context.kind === "new" ? this.newDrafts.get(this.context.key) ?? null : this.existingDrafts.get(this.context.key) ?? this.existing.get(this.context.key) ?? null;
  }

  private saveCurrentDraft(): void { const draft = this.readFields(); if (draft) this.saveDraft(draft); }
  private saveDraft(draft: AgentDraft): void {
    if (!this.context) return;
    (this.context.kind === "new" ? this.newDrafts : this.existingDrafts).set(this.context.key, draft);
  }
  private loadFields(draft: AgentDraft): void {
    this.fields.name.setValue(draft.name);
    this.fields.x.setValue(format(draft.pose.position.x)); this.fields.y.setValue(format(draft.pose.position.y)); this.fields.z.setValue(format(draft.pose.position.z));
    this.fields.heading.setValue(format(draft.pose.headingRadians * 180 / Math.PI)); this.fields.mass.setValue(format(draft.mass));
    this.fields.slope.setValue(format(draft.placement.maxSlopeDegrees)); this.fields.clearance.setValue(format(draft.placement.clearance));
  }
  private clearFields(): void { for (const field of Object.values(this.fields)) field.setValue(""); }
  private updateState(): void {
    const draft = this.currentDraft();
    const existing = this.context?.kind === "existing";
    this.contextLabel.setText(this.context ? existing ? "EXISTING AGENT" : "NEW AGENT" : "Select an agent asset or a placed agent.");
    this.assetLabel.setText(draft ? `${draft.asset.label} · ${draft.asset.id}` : "");
    this.collisionLabel.setText(draft ? `Collision box: ${format(draft.collision.halfExtents.x * 2)} × ${format(draft.collision.halfExtents.y * 2)} × ${format(draft.collision.halfExtents.z * 2)} m` : "");
    this.eligibilityLabel.setText(draft ? `Input eligible: ${draft.inputEligible ? "Yes" : "No"}` : "");
    this.primary.setLabel(existing ? "Apply Changes" : "Add");
    const available = this.context?.kind !== "new" || this.newAvailability.get(this.context.key) === true;
    this.primary.setDisabled(this.busy || !draft || !available);
    this.duplicate.setDisabled(this.busy || !existing);
    this.remove.setDisabled(this.busy || !existing);
    for (const field of Object.values(this.fields)) field.root.visible = Boolean(draft);
    for (const label of this.fieldLabels) label.root.visible = Boolean(draft);
    this.onVisualChange();
  }

  dispose(): void {
    this.title.dispose(); this.contextLabel.dispose(); this.assetLabel.dispose(); this.collisionLabel.dispose(); this.eligibilityLabel.dispose(); this.status.dispose(); this.divider.dispose();
    for (const label of this.fieldLabels) label.dispose(); for (const field of Object.values(this.fields)) field.dispose();
    this.primary.dispose(); this.duplicate.dispose(); this.remove.dispose(); super.dispose();
  }
}

function text(value: string, size: number, weight: string, color: string): HudText { const label = new HudText({ x: 0, y: 0, width: 1 }, { size, weight, color }); label.setText(value); return label; }
function format(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""); }
function sideStyle() { return { fill: theme.panel.hex, border: theme.borderStrong.hex, borderWidth: 1, radius: { topLeft: 0, topRight: theme.radius.lg, bottomLeft: 0, bottomRight: theme.radius.lg }, shadow: "lg" as const, z: -0.2 }; }
