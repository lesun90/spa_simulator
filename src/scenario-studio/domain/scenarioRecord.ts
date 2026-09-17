import { DEFAULT_VEHICLE_PHYSICS_MODEL, DEFAULT_VEHICLE_TUNING, validateAgentDraft, type AgentAssetReference, type AgentSnapshot, type Vector3Value, type VehiclePhysicsModel, type VehicleTuning, type WheelDescriptor } from "./agent";
import type { SceneReference } from "./scene";

export const SCENARIO_RECORD_VERSION = 1 as const;

export interface ScenarioRecord {
  readonly version: typeof SCENARIO_RECORD_VERSION;
  readonly id: string;
  readonly name: string;
  readonly sceneReference: SceneReference | null;
  readonly engineKey: string;
  readonly agents: readonly AgentSnapshot[];
  readonly materialFriction: Readonly<Record<string, number>>;
}

export interface ScenarioSummary {
  readonly id: string;
  readonly name: string;
  readonly agentCount: number;
  readonly updatedAt: string;
}

export function validateScenarioRecord(value: unknown): ScenarioRecord {
  const source = record(value, "Scenario record");
  if (source.version !== SCENARIO_RECORD_VERSION) throw new Error(`Unsupported scenario record version ${String(source.version)}.`);
  const id = identity(source.id, "Scenario ID");
  const name = requiredText(source.name, "Scenario name", 80);
  const engineKey = identity(source.engineKey, "Physics engine key");
  const materialFriction = source.materialFriction === undefined ? {} : materialFrictionMap(source.materialFriction);
  const sceneReference = source.sceneReference === null ? null : validateSceneReference(source.sceneReference);
  if (!Array.isArray(source.agents)) throw new Error("Scenario agents must be an array.");
  const agents = source.agents.map(validateAgentSnapshot);
  const ids = new Set<string>();
  for (const agent of agents) {
    if (ids.has(agent.id)) throw new Error(`Duplicate agent ID ${agent.id}.`);
    ids.add(agent.id);
  }
  for (const agent of agents) {
    const support = agent.pose.support;
    if (support?.kind === "agent" && (!ids.has(support.id) || support.id === agent.id)) {
      throw new Error(`Agent ${agent.id} has an invalid support reference.`);
    }
  }
  for (const agent of agents) {
    const visited = new Set<string>([agent.id]);
    let support = agent.pose.support;
    while (support?.kind === "agent") {
      if (visited.has(support.id)) throw new Error(`Agent ${agent.id} has a cyclic support reference.`);
      visited.add(support.id);
      support = agents.find((candidate) => candidate.id === support!.id)?.pose.support;
    }
  }
  return freezeRecord({ version: SCENARIO_RECORD_VERSION, id, name, sceneReference, engineKey, agents, materialFriction });
}

export function validateScenarioSummary(value: unknown): ScenarioSummary {
  const source = record(value, "Scenario summary");
  const agentCount = source.agentCount;
  if (!Number.isSafeInteger(agentCount) || (agentCount as number) < 0) throw new Error("Scenario summary agent count must be a nonnegative integer.");
  if (typeof source.updatedAt !== "string" || !Number.isFinite(Date.parse(source.updatedAt))) throw new Error("Scenario summary update time is invalid.");
  return Object.freeze({
    id: identity(source.id, "Scenario ID"),
    name: requiredText(source.name, "Scenario name", 80),
    agentCount: agentCount as number,
    updatedAt: source.updatedAt
  });
}

export function freezeRecord(value: ScenarioRecord): ScenarioRecord {
  return Object.freeze({
    version: SCENARIO_RECORD_VERSION,
    id: value.id,
    name: value.name,
    engineKey: value.engineKey,
    sceneReference: value.sceneReference ? Object.freeze({ ...value.sceneReference }) : null,
    agents: Object.freeze(value.agents.map((agent) => Object.freeze({ id: agent.id, ...validateAgentDraft(agent) }))),
    materialFriction: Object.freeze({ ...value.materialFriction })
  });
}

function validateSceneReference(value: unknown): SceneReference {
  const source = record(value, "Scene reference");
  if (!Number.isSafeInteger(source.formatVersion) || (source.formatVersion as number) <= 0) throw new Error("Scene format version must be a positive integer.");
  return Object.freeze({
    key: requiredText(source.key, "Scene key", 512),
    modelSha256: hash(source.modelSha256, "Scene model hash"),
    manifestSha256: hash(source.manifestSha256, "Scene manifest hash"),
    formatVersion: source.formatVersion as number
  });
}

function validateAgentSnapshot(value: unknown): AgentSnapshot {
  const source = record(value, "Authored agent");
  const asset = validateAgentAsset(source.asset);
  const pose = record(source.pose, "Agent pose");
  const collision = record(source.collision, "Agent collision");
  const placement = record(source.placement, "Agent placement settings");
  const supportValue = pose.support;
  let support: AgentSnapshot["pose"]["support"] = null;
  if (supportValue !== null && supportValue !== undefined) {
    const item = record(supportValue, "Agent support");
    if (item.kind !== "scene" && item.kind !== "agent") throw new Error("Agent support kind is invalid.");
    support = Object.freeze({
      kind: item.kind,
      id: item.kind === "agent" ? identity(item.id, "Agent support ID") : requiredText(item.id, "Scene support ID", 512)
    });
  }
  if (typeof source.inputEligible !== "boolean") throw new Error("Agent input eligibility must be a boolean.");
  return Object.freeze({
    id: identity(source.id, "Agent ID"),
    asset,
    name: requiredText(source.name, "Agent name", 80),
    scale: numeric(source.scale, "Agent scale"),
    pose: { position: vector(pose.position, "Agent position"), headingRadians: numeric(pose.headingRadians, "Agent heading"), support },
    mass: numeric(source.mass, "Agent mass"),
    vehicle:
      source.vehicle === undefined
        ? asset.category === "vehicles" ? DEFAULT_VEHICLE_TUNING : null
        : source.vehicle === null
          ? null
          : validateVehicleTuningRecord(source.vehicle),
    collision: { center: vector(collision.center, "Collision center"), halfExtents: vector(collision.halfExtents, "Collision half-extents") },
    placement: { maxSlopeDegrees: numeric(placement.maxSlopeDegrees, "Maximum placement slope"), clearance: numeric(placement.clearance, "Placement clearance") },
    inputEligible: source.inputEligible,
    vehiclePhysicsModel: source.vehiclePhysicsModel === undefined
      ? DEFAULT_VEHICLE_PHYSICS_MODEL
      : validateVehiclePhysicsModel(source.vehiclePhysicsModel)
  } satisfies AgentSnapshot);
}

function validateVehiclePhysicsModel(value: unknown): VehiclePhysicsModel {
  if (value !== "raycast" && value !== "physical") throw new Error('Agent vehicle physics model must be "raycast" or "physical".');
  return value;
}

function validateAgentAsset(value: unknown): AgentAssetReference {
  const source = record(value, "Agent asset reference");
  const bounds = record(source.bounds, "Agent asset bounds");
  const collision = record(source.collision, "Agent asset collision");
  const boundsMin = vector(bounds.min, "Agent bounds min");
  const boundsMax = vector(bounds.max, "Agent bounds max");
  const collisionHalfExtents = vector(collision.halfExtents, "Agent asset collision half-extents");
  if (boundsMax.x <= boundsMin.x || boundsMax.y <= boundsMin.y || boundsMax.z <= boundsMin.z) throw new Error("Agent asset bounds must have positive dimensions.");
  if (collisionHalfExtents.x <= 0 || collisionHalfExtents.y <= 0 || collisionHalfExtents.z <= 0) throw new Error("Agent asset collision half-extents must be positive.");
  const wheels = source.wheels === undefined ? undefined : validateWheelList(source.wheels);
  return Object.freeze({
    id: identity(source.id, "Agent asset ID"),
    key: requiredText(source.key, "Agent asset key", 512),
    label: requiredText(source.label, "Agent asset label", 160),
    category: requiredText(source.category, "Agent asset category", 160),
    modelUrl: requiredText(source.modelUrl, "Agent model URL", 2048),
    thumbnailUrl: source.thumbnailUrl === null ? null : requiredText(source.thumbnailUrl, "Agent thumbnail URL", 2048),
    modelSha256: hash(source.modelSha256, "Agent model hash"),
    metadataSha256: hash(source.metadataSha256, "Agent metadata hash"),
    unitsPerMeter: positive(source.unitsPerMeter, "Agent units per meter"),
    bounds: { min: boundsMin, max: boundsMax },
    collision: { center: vector(collision.center, "Agent asset collision center"), halfExtents: collisionHalfExtents },
    ...(wheels ? { wheels } : {})
  });
}

function validateVehicleTuningRecord(value: unknown): VehicleTuning {
  const source = record(value, "Vehicle tuning");
  return Object.freeze({
    maxEngineForceN: positive(source.maxEngineForceN, "Vehicle max engine force"),
    maxBrakeForceN: positive(source.maxBrakeForceN, "Vehicle max brake force"),
    maxSteeringAngleDegrees: numeric(source.maxSteeringAngleDegrees, "Vehicle max steering angle"),
    steeringSpeedDegreesPerSecond: positive(source.steeringSpeedDegreesPerSecond, "Vehicle steering speed"),
    suspensionStiffness: positive(source.suspensionStiffness, "Vehicle suspension stiffness"),
    suspensionDamping: positive(source.suspensionDamping, "Vehicle suspension damping"),
    suspensionRestLength: positive(source.suspensionRestLength, "Vehicle suspension rest length"),
    suspensionMaxTravel: positive(source.suspensionMaxTravel, "Vehicle suspension max travel"),
    wheelFrictionSlip: positive(source.wheelFrictionSlip, "Vehicle wheel friction slip")
  });
}

function validateWheelList(value: unknown): WheelDescriptor[] {
  if (!Array.isArray(value)) throw new Error("Agent asset wheels must be an array.");
  return value.map(validateWheel);
}

function validateWheel(value: unknown): WheelDescriptor {
  const source = record(value, "Agent asset wheel");
  const radius = positive(source.radius, "Wheel radius");
  return Object.freeze({
    id: requiredText(source.id, "Wheel ID", 32),
    wheelNode: requiredText(source.wheelNode, "Wheel node name", 128),
    steeringNode: requiredText(source.steeringNode, "Steering node name", 128),
    suspensionNode: requiredText(source.suspensionNode, "Suspension node name", 128),
    position: vector(source.position, "Wheel position"),
    radius,
    width: source.width === undefined ? radius * 0.7 : positive(source.width, "Wheel width"),
    steerable: typeof source.steerable === "boolean" ? source.steerable : (() => { throw new Error("Wheel steerable flag must be a boolean."); })()
  });
}

function materialFrictionMap(value: unknown): Record<string, number> {
  const source = record(value, "Scenario material friction");
  const result: Record<string, number> = {};
  for (const [material, friction] of Object.entries(source)) result[material] = positive(friction, `Friction for material "${material}"`);
  return result;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function vector(value: unknown, label: string): Vector3Value {
  const source = record(value, label);
  return Object.freeze({ x: numeric(source.x, label), y: numeric(source.y, label), z: numeric(source.z, label) });
}

function numeric(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must contain finite numbers.`);
  return value;
}

function positive(value: unknown, label: string): number {
  const result = numeric(value, label);
  if (result <= 0) throw new Error(`${label} must be positive.`);
  return result;
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return trimmed;
}

function identity(value: unknown, label: string): string {
  const id = requiredText(value, label, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error(`${label} contains unsupported characters.`);
  return id;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 value.`);
  return value;
}
