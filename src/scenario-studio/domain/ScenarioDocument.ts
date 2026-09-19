import type { SceneReference } from "./scene";
import type { SceneObjectSnapshot } from "./agent";
import { createId } from "../../editor-core/scene";
import { freezeRecord, SCENARIO_RECORD_VERSION, validateScenarioRecord, type ScenarioRecord } from "./scenarioRecord";
import { validateControllerAssignment, validateControllerScript, type ControllerAssignment, type ControllerScript } from "./controller";

/** Owns persisted scenario identity, authored state, and dirty-state transitions. */
export class ScenarioDocument {
  private identity: string;
  private scenarioName: string;
  private physicsEngineKey: string;
  private activeScene: SceneReference | null = null;
  private authoredAgents: readonly SceneObjectSnapshot[] = Object.freeze([]);
  private materialFrictionOverrides: Readonly<Record<string, number>> = Object.freeze({});
  private controllerScripts: readonly ControllerScript[] = Object.freeze([]);
  private assignments: readonly ControllerAssignment[] = Object.freeze([]);
  private modified = false;

  constructor(record: ScenarioRecord = newScenarioRecord()) {
    const valid = validateScenarioRecord(record);
    this.identity = valid.id;
    this.scenarioName = valid.name;
    this.physicsEngineKey = valid.engineKey;
    this.activeScene = valid.sceneReference;
    this.authoredAgents = valid.agents;
    this.materialFrictionOverrides = valid.materialFriction;
    this.controllerScripts = valid.controllers;
    this.assignments = valid.controllerAssignments;
  }

  get id(): string { return this.identity; }
  get name(): string { return this.scenarioName; }
  get engineKey(): string { return this.physicsEngineKey; }
  get isDirty(): boolean { return this.modified; }

  get sceneReference(): SceneReference | null {
    return this.activeScene;
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Scenario name is required.");
    if (trimmed.length > 80) throw new Error("Scenario name must be 80 characters or fewer.");
    if (trimmed === this.scenarioName) return;
    this.scenarioName = trimmed;
    this.modified = true;
  }

  replaceScene(reference: SceneReference | null): void {
    this.activeScene = reference ? Object.freeze({ ...reference }) : null;
    this.modified = true;
  }

  get agents(): readonly SceneObjectSnapshot[] {
    return this.authoredAgents;
  }

  get materialFriction(): Readonly<Record<string, number>> { return this.materialFrictionOverrides; }
  get controllers(): readonly ControllerScript[] { return this.controllerScripts; }
  get controllerAssignments(): readonly ControllerAssignment[] { return this.assignments; }

  replaceAgents(agents: readonly SceneObjectSnapshot[]): void {
    this.authoredAgents = Object.freeze([...agents]);
    const ids = new Set(agents.map((agent) => agent.id));
    this.assignments = Object.freeze(this.assignments.flatMap((assignment) => {
      const agentIds = assignment.agentIds.filter((id) => ids.has(id));
      return agentIds.length ? [Object.freeze({ controllerId: assignment.controllerId, agentIds: Object.freeze(agentIds) })] : [];
    }));
    this.modified = true;
  }

  setMaterialFriction(material: string, friction: number): void {
    if (!Number.isFinite(friction) || friction <= 0) throw new Error("Material friction must be a positive number.");
    if (this.materialFrictionOverrides[material] === friction) return;
    this.materialFrictionOverrides = Object.freeze({ ...this.materialFrictionOverrides, [material]: friction });
    this.modified = true;
  }

  saveController(script: ControllerScript, agentIds: readonly string[]): void {
    const validScript = validateControllerScript(script);
    const controllers = [...this.controllerScripts.filter((item) => item.id !== validScript.id), validScript];
    const assignment = validateControllerAssignment({ controllerId: validScript.id, agentIds }, new Set(controllers.map((item) => item.id)), new Set(this.authoredAgents.map((agent) => agent.id)));
    this.controllerScripts = Object.freeze(controllers);
    this.assignments = Object.freeze([...this.assignments.filter((item) => item.controllerId !== validScript.id), assignment]);
    this.modified = true;
  }

  deleteController(id: string): void {
    if (!this.controllerScripts.some((item) => item.id === id)) return;
    this.controllerScripts = Object.freeze(this.controllerScripts.filter((item) => item.id !== id));
    this.assignments = Object.freeze(this.assignments.filter((item) => item.controllerId !== id));
    this.modified = true;
  }

  toRecord(): ScenarioRecord {
    return freezeRecord({ version: SCENARIO_RECORD_VERSION, id: this.identity, name: this.scenarioName, sceneReference: this.activeScene, engineKey: this.physicsEngineKey, agents: this.authoredAgents, materialFriction: this.materialFrictionOverrides, controllers: this.controllerScripts, controllerAssignments: this.assignments });
  }

  replaceWith(record: ScenarioRecord): void {
    const valid = validateScenarioRecord(record);
    this.identity = valid.id;
    this.scenarioName = valid.name;
    this.physicsEngineKey = valid.engineKey;
    this.activeScene = valid.sceneReference;
    this.authoredAgents = valid.agents;
    this.materialFrictionOverrides = valid.materialFriction;
    this.controllerScripts = valid.controllers;
    this.assignments = valid.controllerAssignments;
    this.modified = false;
  }

  markSaved(record: ScenarioRecord): boolean {
    const valid = validateScenarioRecord(record);
    if (valid.id !== this.identity) throw new Error("Saved scenario identity does not match the open scenario.");
    if (JSON.stringify(valid) !== JSON.stringify(this.toRecord())) return false;
    this.replaceWith(valid);
    return true;
  }
}

export function newScenarioRecord(name = "Untitled scenario", id = createScenarioId()): ScenarioRecord {
  return freezeRecord({ version: SCENARIO_RECORD_VERSION, id, name, sceneReference: null, engineKey: "rapier", agents: [], materialFriction: {}, controllers: [], controllerAssignments: [] });
}

function createScenarioId(): string {
  return createId("scenario");
}
