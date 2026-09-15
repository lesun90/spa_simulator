import type { SceneReference } from "./scene";
import type { AgentSnapshot } from "./agent";
import { createId } from "../../editor-core/scene";
import { freezeRecord, SCENARIO_RECORD_VERSION, validateScenarioRecord, type ScenarioRecord } from "./scenarioRecord";

/** Owns persisted scenario identity, authored state, and dirty-state transitions. */
export class ScenarioDocument {
  private identity: string;
  private scenarioName: string;
  private physicsEngineKey: string;
  private activeScene: SceneReference | null = null;
  private authoredAgents: readonly AgentSnapshot[] = Object.freeze([]);
  private materialFrictionOverrides: Readonly<Record<string, number>> = Object.freeze({});
  private modified = false;

  constructor(record: ScenarioRecord = newScenarioRecord()) {
    const valid = validateScenarioRecord(record);
    this.identity = valid.id;
    this.scenarioName = valid.name;
    this.physicsEngineKey = valid.engineKey;
    this.activeScene = valid.sceneReference;
    this.authoredAgents = valid.agents;
    this.materialFrictionOverrides = valid.materialFriction;
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

  get agents(): readonly AgentSnapshot[] {
    return this.authoredAgents;
  }

  get materialFriction(): Readonly<Record<string, number>> { return this.materialFrictionOverrides; }

  replaceAgents(agents: readonly AgentSnapshot[]): void {
    this.authoredAgents = Object.freeze([...agents]);
    this.modified = true;
  }

  setMaterialFriction(material: string, friction: number): void {
    if (!Number.isFinite(friction) || friction <= 0) throw new Error("Material friction must be a positive number.");
    if (this.materialFrictionOverrides[material] === friction) return;
    this.materialFrictionOverrides = Object.freeze({ ...this.materialFrictionOverrides, [material]: friction });
    this.modified = true;
  }

  toRecord(): ScenarioRecord {
    return freezeRecord({ version: SCENARIO_RECORD_VERSION, id: this.identity, name: this.scenarioName, sceneReference: this.activeScene, engineKey: this.physicsEngineKey, agents: this.authoredAgents, materialFriction: this.materialFrictionOverrides });
  }

  replaceWith(record: ScenarioRecord): void {
    const valid = validateScenarioRecord(record);
    this.identity = valid.id;
    this.scenarioName = valid.name;
    this.physicsEngineKey = valid.engineKey;
    this.activeScene = valid.sceneReference;
    this.authoredAgents = valid.agents;
    this.materialFrictionOverrides = valid.materialFriction;
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
  return freezeRecord({ version: SCENARIO_RECORD_VERSION, id, name, sceneReference: null, engineKey: "rapier", agents: [], materialFriction: {} });
}

function createScenarioId(): string {
  return createId("scenario");
}
