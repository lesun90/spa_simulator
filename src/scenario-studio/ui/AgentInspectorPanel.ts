import * as THREE from "three";
import { theme } from "../../app/theme";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import { BasePanel } from "../../features/hud/kit/BasePanel";
import { Button } from "../../features/hud/kit/Button";
import type { Rect } from "../../features/hud/kit/layout";
import { Panel } from "../../features/hud/kit/Panel";
import { ScrollRegion } from "../../features/hud/kit/ScrollRegion";
import { segmentButtonRect } from "../../features/hud/kit/segmentedControl";
import { TextField } from "../../features/hud/kit/TextField";
import { createAgentDraft, DEFAULT_VEHICLE_PHYSICS_MODEL, freezeDraft, scaledAgentCollision, validateAgentDraft, type AgentChoice, type AgentDraft, type AgentSnapshot, type VehiclePhysicsModel } from "../domain/agent";
import { HudText } from "./HudText";

type Context = { kind: "new"; key: string } | { kind: "existing"; key: string } | null;
type AgentFieldKey = "name" | "x" | "y" | "z" | "scale" | "heading" | "mass" | "slope" | "clearance";
type VehicleFieldKey = "maxEngineForceN" | "maxBrakeForceN" | "maxSteeringAngleDegrees" | "steeringSpeedDegreesPerSecond" | "suspensionStiffness" | "suspensionDamping" | "suspensionRestLength" | "suspensionMaxTravel" | "wheelFrictionSlip";

const FIELD_SPECS: ReadonlyArray<{ key: AgentFieldKey; label: string; help: string }> = [
  { key: "name", label: "Name", help: "The name used to identify this agent instance." },
  { key: "x", label: "Position X", help: "East-west position in scene meters." },
  { key: "y", label: "Position Y", help: "Vertical position in meters; placement seats it automatically." },
  { key: "z", label: "Position Z", help: "North-south position in scene meters." },
  { key: "scale", label: "Scale", help: "Uniform size multiplier for the model and collision bounds." },
  { key: "heading", label: "Heading °", help: "Rotation around the vertical axis, measured in degrees." },
  { key: "mass", label: "Mass kg", help: "Mass used when Play creates this agent's physics body." },
  { key: "slope", label: "Max slope °", help: "Steepest surface that may support this agent." },
  { key: "clearance", label: "Clearance m", help: "Vertical gap between the agent and its support." }
];

const VEHICLE_FIELD_SPECS: ReadonlyArray<{ key: VehicleFieldKey; label: string; help: string }> = [
  { key: "maxEngineForceN", label: "Engine force N", help: "Maximum forward drive force applied to the wheels." },
  { key: "maxBrakeForceN", label: "Brake force N", help: "Maximum braking force applied to the wheels." },
  { key: "maxSteeringAngleDegrees", label: "Steer angle °", help: "Maximum steering wheel lock angle." },
  { key: "steeringSpeedDegreesPerSecond", label: "Steer speed °/s", help: "How fast the front wheels sweep toward the target steering angle." },
  { key: "suspensionStiffness", label: "Suspension stiff.", help: "Suspension spring stiffness; higher resists compression more." },
  { key: "suspensionDamping", label: "Suspension damp.", help: "Suspension damping; higher settles bounce faster." },
  { key: "suspensionRestLength", label: "Suspension rest m", help: "Suspension length when the wheel is unloaded." },
  { key: "suspensionMaxTravel", label: "Suspension travel m", help: "Maximum suspension compression distance." },
  { key: "wheelFrictionSlip", label: "Tire grip", help: "Base tire traction, multiplied by the ground material's friction." }
];

export class AgentInspectorPanel extends BasePanel {
  private readonly title: HudText;
  private readonly contextLabel: HudText;
  private readonly assetLabel: HudText;
  private readonly collisionLabel: HudText;
  private readonly eligibilityLabel: HudText;
  private readonly status: HudText;
  private readonly divider: Panel;
  private readonly scroll: ScrollRegion;
  private readonly sectionLabels: HudText[];
  private readonly fieldLabels: HudText[];
  private readonly helpButtons: Button[];
  private readonly fields: Record<AgentFieldKey, TextField>;
  private readonly vehicleFieldLabels: HudText[];
  private readonly vehicleHelpButtons: Button[];
  private readonly vehicleFields: Record<VehicleFieldKey, TextField>;
  private readonly vehicleToggle: Button;
  private readonly physicsModelLabel: HudText;
  private readonly physicsModelRaycastButton: Button;
  private readonly physicsModelPhysicalButton: Button;
  private readonly primary: Button;
  private readonly duplicate: Button;
  private readonly remove: Button;
  private readonly newDrafts = new Map<string, AgentDraft>();
  private readonly newAvailability = new Map<string, boolean>();
  private readonly existingDrafts = new Map<string, AgentDraft>();
  private readonly existing = new Map<string, AgentSnapshot>();
  private context: Context = null;
  private busy = false;
  private vehicleTuningExpanded = false;

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
    this.scroll = new ScrollRegion({ x: rect.x, y: rect.y + 126, width: rect.width, height: 1 }, interaction, { axis: "vertical" });
    this.sectionLabels = ["Identity", "Transform", "Body & placement", "Vehicle tuning", "Suspension"].map((label) => text(label, 10.5, "700", theme.textMutedStrong.css));
    this.fieldLabels = FIELD_SPECS.map(({ label }) => text(label, 10.5, "600", theme.textMutedStrong.css));
    this.helpButtons = FIELD_SPECS.map(({ help }) => new Button({ x: 0, y: 0, width: 20, height: 20 }, interaction, {
      label: "?", fontSize: 11, paddingX: 0, onClick: () => this.setStatus(help)
    }));
    this.fields = Object.fromEntries(FIELD_SPECS.map(({ key }) => [key, new TextField({ x: 0, y: 0, width: 1, height: 30 }, interaction, { numeric: key !== "name" })])) as typeof this.fields;
    this.vehicleFieldLabels = VEHICLE_FIELD_SPECS.map(({ label }) => text(label, 10.5, "600", theme.textMutedStrong.css));
    this.vehicleHelpButtons = VEHICLE_FIELD_SPECS.map(({ help }) => new Button({ x: 0, y: 0, width: 20, height: 20 }, interaction, {
      label: "?", fontSize: 11, paddingX: 0, onClick: () => this.setStatus(help)
    }));
    this.vehicleFields = Object.fromEntries(VEHICLE_FIELD_SPECS.map(({ key }) => [key, new TextField({ x: 0, y: 0, width: 1, height: 30 }, interaction, { numeric: true })])) as typeof this.vehicleFields;
    this.vehicleToggle = new Button({ x: 0, y: 0, width: 1, height: 30 }, interaction, {
      label: "Show vehicle tuning", fontSize: 11.5, onClick: () => { this.vehicleTuningExpanded = !this.vehicleTuningExpanded; this.updateState(); }
    });
    this.physicsModelLabel = text("Physics model", 10.5, "700", theme.textMutedStrong.css);
    this.physicsModelRaycastButton = new Button({ x: 0, y: 0, width: 1, height: 30 }, interaction, {
      label: "Raycast", fontSize: 11.5, onClick: () => this.setVehiclePhysicsModel("raycast")
    });
    this.physicsModelPhysicalButton = new Button({ x: 0, y: 0, width: 1, height: 30 }, interaction, {
      label: "Physical", fontSize: 11.5, onClick: () => this.setVehiclePhysicsModel("physical")
    });
    this.primary = new Button({ x: 0, y: 0, width: 1, height: 34 }, interaction, { label: "Add", onClick: () => this.primaryAction() });
    this.duplicate = new Button({ x: 0, y: 0, width: 1, height: 32 }, interaction, { label: "Duplicate", onClick: () => void this.execute(() => this.context?.kind === "existing" ? this.onDuplicate(this.context.key) : Promise.resolve()) });
    this.remove = new Button({ x: 0, y: 0, width: 1, height: 32 }, interaction, { label: "Delete", onClick: () => void this.execute(() => this.context?.kind === "existing" ? this.onDelete(this.context.key) : Promise.resolve()) });
    this.scroll.content.add(
      this.physicsModelLabel.root, this.physicsModelRaycastButton.root, this.physicsModelPhysicalButton.root,
      ...this.sectionLabels.map((item) => item.root),
      ...this.fieldLabels.map((item) => item.root), ...this.helpButtons.map((item) => item.root), ...Object.values(this.fields).map((item) => item.root),
      ...this.vehicleFieldLabels.map((item) => item.root), ...this.vehicleHelpButtons.map((item) => item.root), ...Object.values(this.vehicleFields).map((item) => item.root),
      this.collisionLabel.root, this.eligibilityLabel.root
    );
    this.root.add(this.divider.root, this.title.root, this.contextLabel.root, this.assetLabel.root, this.vehicleToggle.root, this.scroll.root, this.status.root, this.primary.root, this.duplicate.root, this.remove.root);
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
    for (const agent of agents) {
      this.existing.set(agent.id, agent);
      this.existingDrafts.set(agent.id, freezeDraft(agent));
    }
    for (const id of this.existingDrafts.keys()) if (!this.existing.has(id)) this.existingDrafts.delete(id);
    if (this.context?.kind === "existing") {
      const current = this.existing.get(this.context.key);
      if (!current) { this.context = null; this.status.setText("The selected agent was removed."); this.clearFields(); }
      else {
        this.loadFields(current);
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

  clearSelection(): void {
    this.saveCurrentDraft();
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

  update(dt: number): void { for (const field of [...Object.values(this.fields), ...Object.values(this.vehicleFields)]) field.update(dt); }

  private visibleVehicleSpecs(): typeof VEHICLE_FIELD_SPECS {
    return this.currentDraft()?.vehicle && this.vehicleTuningExpanded ? VEHICLE_FIELD_SPECS : [];
  }

  protected layout(): void {
    const x = this.rect.x + 18;
    const width = Math.max(this.rect.width - 36, 1);
    this.divider?.setRect({ x: this.rect.x, y: 40, width: this.rect.width, height: 1 });
    this.title?.setFrame({ x, y: this.rect.y + 12, width });
    this.contextLabel?.setFrame({ x, y: this.rect.y + 58, width, maxLines: 2 });
    this.assetLabel?.setFrame({ x, y: this.rect.y + 88, width, maxLines: 2 });
    this.vehicleToggle?.setRect({ x, y: this.rect.y + 112, width, height: 30 });
    const scrollTop = this.rect.y + 150;
    const buttonY = this.rect.y + this.rect.height - 42;
    const statusY = buttonY - 96;
    this.scroll?.setRect({ x: this.rect.x + 8, y: scrollTop, width: Math.max(this.rect.width - 10, 1), height: Math.max(statusY - scrollTop - 8, 1) });
    const physicsModelVisible = Boolean(this.currentDraft()?.vehicle);
    if (physicsModelVisible) {
      this.physicsModelLabel?.setFrame({ x, y: scrollTop, width });
      const physicsModelRow: Rect = { x, y: scrollTop + 20, width, height: 30 };
      this.physicsModelRaycastButton?.setRect(segmentButtonRect(physicsModelRow, 0));
      this.physicsModelPhysicalButton?.setRect(segmentButtonRect(physicsModelRow, 1));
    }
    const start = scrollTop + 24 + (physicsModelVisible ? 58 : 0);
    const row = 38;
    const labelWidth = 90;
    const helpX = x + labelWidth + 4;
    const fieldX = helpX + 25;
    const fieldWidth = Math.max(width - (fieldX - x), 1);
    const sectionStarts = [start, start + row * 2 + 14, start + row * 7 + 28];
    this.sectionLabels[0]?.setFrame({ x, y: sectionStarts[0] - 24, width });
    this.sectionLabels[1]?.setFrame({ x, y: sectionStarts[1] - 24, width });
    this.sectionLabels[2]?.setFrame({ x, y: sectionStarts[2] - 24, width });
    const fieldY = [sectionStarts[0], sectionStarts[1], sectionStarts[1] + row, sectionStarts[1] + row * 2, sectionStarts[1] + row * 3, sectionStarts[1] + row * 4, sectionStarts[2], sectionStarts[2] + row, sectionStarts[2] + row * 2];
    this.fieldLabels?.forEach((label, index) => label.setFrame({ x, y: fieldY[index], width: labelWidth }));
    this.helpButtons?.forEach((button, index) => button.setRect({ x: helpX, y: fieldY[index] - 5, width: 20, height: 20 }));
    FIELD_SPECS.forEach(({ key }, index) => this.fields?.[key].setRect({ x: fieldX, y: fieldY[index] - 8, width: fieldWidth, height: 30 }));
    const vehicleSpecs = this.visibleVehicleSpecs();
    const vehicleStart = sectionStarts[2] + row * 3 + 38;
    this.sectionLabels[3]?.setFrame({ x, y: vehicleStart - 24, width });
    this.sectionLabels[4]?.setFrame({ x, y: vehicleStart + row * 4 - 24, width });
    this.vehicleFieldLabels?.forEach((label, index) => label.setFrame({ x, y: vehicleStart + index * row + (index >= 4 ? 14 : 0), width: labelWidth }));
    this.vehicleHelpButtons?.forEach((button, index) => button.setRect({ x: helpX, y: vehicleStart - 5 + index * row + (index >= 4 ? 14 : 0), width: 20, height: 20 }));
    VEHICLE_FIELD_SPECS.forEach(({ key }, index) => this.vehicleFields?.[key].setRect({ x: fieldX, y: vehicleStart - 8 + index * row + (index >= 4 ? 14 : 0), width: fieldWidth, height: 30 }));
    const detailY = vehicleSpecs.length ? vehicleStart + vehicleSpecs.length * row + 18 : sectionStarts[2] + row * 3 + 8;
    this.collisionLabel?.setFrame({ x, y: detailY, width, maxLines: 2 });
    this.eligibilityLabel?.setFrame({ x, y: detailY + 34, width, maxLines: 2 });
    this.scroll?.setContentSize(Math.max(detailY + 62 - scrollTop, 0));
    this.scroll?.applyClipping();
    this.status?.setFrame({ x, y: statusY, width, maxLines: 2 });
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
    const vehicleNumber = (key: VehicleFieldKey) => Number(this.vehicleFields[key].getValue());
    const vehicle = base.vehicle ? {
      maxEngineForceN: vehicleNumber("maxEngineForceN"),
      maxBrakeForceN: vehicleNumber("maxBrakeForceN"),
      maxSteeringAngleDegrees: vehicleNumber("maxSteeringAngleDegrees"),
      steeringSpeedDegreesPerSecond: vehicleNumber("steeringSpeedDegreesPerSecond"),
      suspensionStiffness: vehicleNumber("suspensionStiffness"),
      suspensionDamping: vehicleNumber("suspensionDamping"),
      suspensionRestLength: vehicleNumber("suspensionRestLength"),
      suspensionMaxTravel: vehicleNumber("suspensionMaxTravel"),
      wheelFrictionSlip: vehicleNumber("wheelFrictionSlip")
    } : null;
    return freezeDraft({
      ...base,
      name: this.fields.name.getValue(),
      pose: {
        position: { x: number("x"), y: number("y"), z: number("z") },
        headingRadians: number("heading") * Math.PI / 180,
        support: base.pose.support ?? null
      },
      scale: number("scale"),
      mass: number("mass"),
      placement: { maxSlopeDegrees: number("slope"), clearance: number("clearance") },
      vehicle
    });
  }

  private currentDraft(): AgentDraft | null {
    if (!this.context) return null;
    return this.context.kind === "new" ? this.newDrafts.get(this.context.key) ?? null : this.existingDrafts.get(this.context.key) ?? this.existing.get(this.context.key) ?? null;
  }

  private setVehiclePhysicsModel(model: VehiclePhysicsModel): void {
    const draft = this.currentDraft();
    if (!draft?.vehicle) return;
    this.saveDraft(freezeDraft({ ...draft, vehiclePhysicsModel: model }));
    this.updateState();
  }

  private saveCurrentDraft(): void { const draft = this.readFields(); if (draft) this.saveDraft(draft); }
  private saveDraft(draft: AgentDraft): void {
    if (!this.context) return;
    (this.context.kind === "new" ? this.newDrafts : this.existingDrafts).set(this.context.key, draft);
  }
  private loadFields(draft: AgentDraft): void {
    this.fields.name.setValue(draft.name);
    this.fields.x.setValue(format(draft.pose.position.x)); this.fields.y.setValue(format(draft.pose.position.y)); this.fields.z.setValue(format(draft.pose.position.z));
    this.fields.scale.setValue(format(draft.scale)); this.fields.heading.setValue(format(draft.pose.headingRadians * 180 / Math.PI)); this.fields.mass.setValue(format(draft.mass));
    this.fields.slope.setValue(format(draft.placement.maxSlopeDegrees)); this.fields.clearance.setValue(format(draft.placement.clearance));
    if (draft.vehicle) for (const { key } of VEHICLE_FIELD_SPECS) this.vehicleFields[key].setValue(format(draft.vehicle[key]));
    else for (const { key } of VEHICLE_FIELD_SPECS) this.vehicleFields[key].setValue("");
  }
  private clearFields(): void { for (const field of [...Object.values(this.fields), ...Object.values(this.vehicleFields)]) field.setValue(""); }
  private updateState(): void {
    const draft = this.currentDraft();
    const existing = this.context?.kind === "existing";
    const collision = draft ? scaledAgentCollision(draft) : null;
    this.contextLabel.setText(this.context ? existing ? "EXISTING AGENT" : "NEW AGENT" : "Select an agent asset or a placed agent.");
    this.assetLabel.setText(draft ? `${draft.asset.label} · ${draft.asset.id}` : "");
    this.collisionLabel.setText(collision ? `Collision box: ${format(collision.halfExtents.x * 2)} × ${format(collision.halfExtents.y * 2)} × ${format(collision.halfExtents.z * 2)} m` : "");
    this.eligibilityLabel.setText(draft ? `Input eligible: ${draft.inputEligible ? "Yes" : "No"}` : "");
    this.primary.setLabel(existing ? "Apply Changes" : "Add");
    this.vehicleToggle.setLabel(this.vehicleTuningExpanded ? "Hide vehicle tuning" : "Show vehicle tuning");
    const available = this.context?.kind !== "new" || this.newAvailability.get(this.context.key) === true;
    this.primary.setDisabled(this.busy || !draft || !available);
    this.duplicate.setDisabled(this.busy || !existing);
    this.remove.setDisabled(this.busy || !existing);
    for (const field of Object.values(this.fields)) field.root.visible = Boolean(draft);
    for (const label of this.fieldLabels) label.root.visible = Boolean(draft);
    for (const button of this.helpButtons) button.root.visible = Boolean(draft);
    for (const label of this.sectionLabels.slice(0, 3)) label.root.visible = Boolean(draft);
    this.vehicleToggle.root.visible = Boolean(draft?.vehicle);
    const physicsModelVisible = Boolean(draft?.vehicle);
    const physicsModel = draft?.vehiclePhysicsModel ?? DEFAULT_VEHICLE_PHYSICS_MODEL;
    this.physicsModelLabel.root.visible = physicsModelVisible;
    this.physicsModelRaycastButton.root.visible = physicsModelVisible;
    this.physicsModelPhysicalButton.root.visible = physicsModelVisible;
    this.physicsModelRaycastButton.setActive(physicsModel === "raycast");
    this.physicsModelPhysicalButton.setActive(physicsModel === "physical");
    const vehicleVisible = this.visibleVehicleSpecs().length > 0;
    for (const field of Object.values(this.vehicleFields)) field.root.visible = vehicleVisible;
    for (const label of this.vehicleFieldLabels) label.root.visible = vehicleVisible;
    for (const button of this.vehicleHelpButtons) button.root.visible = vehicleVisible;
    for (const label of this.sectionLabels.slice(3)) label.root.visible = vehicleVisible;
    this.layout();
    this.onVisualChange();
  }

  dispose(): void {
    this.title.dispose(); this.contextLabel.dispose(); this.assetLabel.dispose(); this.collisionLabel.dispose(); this.eligibilityLabel.dispose(); this.status.dispose(); this.divider.dispose();
    this.scroll.dispose();
    for (const label of this.sectionLabels) label.dispose();
    for (const label of this.fieldLabels) label.dispose(); for (const button of this.helpButtons) button.dispose(); for (const field of Object.values(this.fields)) field.dispose();
    for (const label of this.vehicleFieldLabels) label.dispose(); for (const button of this.vehicleHelpButtons) button.dispose(); for (const field of Object.values(this.vehicleFields)) field.dispose();
    this.vehicleToggle.dispose(); this.physicsModelLabel.dispose(); this.physicsModelRaycastButton.dispose(); this.physicsModelPhysicalButton.dispose();
    this.primary.dispose(); this.duplicate.dispose(); this.remove.dispose(); super.dispose();
  }
}

function text(value: string, size: number, weight: string, color: string): HudText { const label = new HudText({ x: 0, y: 0, width: 1 }, { size, weight, color }); label.setText(value); return label; }
function format(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""); }
function sideStyle() { return { fill: theme.panel.hex, border: theme.borderStrong.hex, borderWidth: 1, radius: { topLeft: 0, topRight: theme.radius.lg, bottomLeft: 0, bottomRight: theme.radius.lg }, shadow: "lg" as const, z: -0.2 }; }
