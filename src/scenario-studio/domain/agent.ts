import type { AssetCatalogEntry } from "../../editor-core/assets";
import type { PresentationPort, VehiclePoseFrame, VisualObjectPoseFrame } from "./SceneObjectPorts";

export interface Vector3Value {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Ray3 {
  readonly origin: Vector3Value;
  readonly direction: Vector3Value;
}

export interface PlacementHit {
  readonly point: Vector3Value;
  readonly normal: Vector3Value;
  readonly support: AgentSupportReference;
  readonly sceneRevision: number;
}

export interface WheelDescriptor {
  readonly id: string;
  readonly wheelNode: string;
  readonly steeringNode: string;
  readonly suspensionNode: string;
  readonly position: Vector3Value;
  readonly radius: number;
  readonly width: number;
  readonly steerable: boolean;
}

export interface AgentAssetReference {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly modelUrl: string;
  readonly thumbnailUrl: string | null;
  readonly modelSha256: string;
  readonly metadataSha256: string;
  readonly unitsPerMeter: number;
  readonly bounds: { readonly min: Vector3Value; readonly max: Vector3Value };
  readonly collision: {
    readonly center: Vector3Value;
    readonly halfExtents: Vector3Value;
  };
  readonly wheels?: readonly WheelDescriptor[];
}

/** Which physics model simulates a vehicle's wheels during playback. See VehiclePhysicsModel usage in the physics worker. */
export type VehiclePhysicsModel = "raycast" | "physical";
export const DEFAULT_VEHICLE_PHYSICS_MODEL: VehiclePhysicsModel = "raycast";

export interface AgentChoice {
  readonly asset: AgentAssetReference;
  readonly available: boolean;
  readonly diagnostics: readonly string[];
}

export interface AgentPose {
  readonly position: Vector3Value;
  readonly headingRadians: number;
  readonly support?: AgentSupportReference | null;
}

export interface VehicleTuning {
  readonly maxEngineForceN: number;
  readonly maxBrakeForceN: number;
  readonly maxSteeringAngleDegrees: number;
  readonly steeringSpeedDegreesPerSecond: number;
  readonly suspensionStiffness: number;
  readonly suspensionDamping: number;
  readonly suspensionRestLength: number;
  readonly suspensionMaxTravel: number;
  readonly wheelFrictionSlip: number;
}

// Forces are applied identically to all 4 wheels (no drive-wheel split), so the effective total is
// roughly 4x these per-wheel values. Chosen so an unscaled 1200kg car pulls ~3 m/s^2 under full throttle
// (an ordinary sedan's 0-100kph in ~10s) and ~7 m/s^2 under full brake — both comfortably under the tire
// friction ceiling (wheelFrictionSlip * per-wheel normal load), so accelerating/braking is force-limited
// and predictable rather than traction-limited and skiddy. The previous defaults (4000N/6000N) produced
// supercar-tier acceleration that left a 40m test scene within about a second of throttle input.
export const DEFAULT_VEHICLE_TUNING: VehicleTuning = Object.freeze({
  maxEngineForceN: 900,
  maxBrakeForceN: 2200,
  maxSteeringAngleDegrees: 35,
  steeringSpeedDegreesPerSecond: 120,
  suspensionStiffness: 60000,
  suspensionDamping: 900,
  suspensionRestLength: 0.12,
  suspensionMaxTravel: 0.2,
  wheelFrictionSlip: 1.6
});

export type AgentSupportReference =
  | { readonly kind: "scene"; readonly id: string }
  | { readonly kind: "agent"; readonly id: string };

export interface AgentDraft {
  readonly asset: AgentAssetReference;
  readonly name: string;
  readonly scale: number;
  readonly pose: AgentPose;
  readonly mass: number;
  readonly vehicle: VehicleTuning | null;
  readonly collision: {
    readonly center: Vector3Value;
    readonly halfExtents: Vector3Value;
  };
  readonly placement: {
    readonly maxSlopeDegrees: number;
    readonly clearance: number;
  };
  readonly inputEligible: boolean;
  /** Ignored for non-vehicle categories. See VehiclePhysicsModel. */
  readonly vehiclePhysicsModel: VehiclePhysicsModel;
}

export interface SceneObjectSnapshot extends AgentDraft {
  readonly id: string;
}

export interface PlacementPreview {
  readonly valid: boolean;
  readonly pose: AgentPose | null;
  readonly reason: string | null;
  readonly sceneRevision: number;
}

export interface AgentPresentation { dispose(): void; }
export interface AgentPresenter {
  prepare(agent: SceneObjectSnapshot): Promise<AgentPresentation>;
  show(agent: SceneObjectSnapshot, presentation: AgentPresentation): void;
  update(agent: SceneObjectSnapshot): void;
  remove(id: string): void;
  clear(): void;
  /** A presentation port bound to this agent's already-shown visual instance, for a live vehicle SceneObject. */
  createVehiclePresentationPort(agent: SceneObjectSnapshot): PresentationPort<VehiclePoseFrame>;
  /** Same as above, for a non-vehicle physical SceneObject (RigidObject). */
  createBodyPresentationPort(agent: SceneObjectSnapshot): PresentationPort<VisualObjectPoseFrame>;
}

/** Whether this agent receives drive commands and a Vehicle SceneObject, rather than a plain RigidObject. */
export function isDrivenVehicle(agent: AgentDraft): boolean {
  return agent.asset.category === "vehicles" && Boolean(agent.vehicle) && Boolean(agent.asset.wheels?.length);
}

/** Adapts a placed agent's asset reference into the shape AssetManager's generic loader/cache understands. */
export function assetEntry(agent: SceneObjectSnapshot): AssetCatalogEntry {
  return {
    id: `${agent.asset.id}:${agent.asset.modelSha256}:${agent.asset.metadataSha256}`,
    label: agent.asset.label,
    category: agent.asset.category,
    source: "shared",
    implementation: "glb",
    modelUrl: agent.asset.modelUrl,
    thumbnailUrl: agent.asset.thumbnailUrl ?? undefined
  };
}

/**
 * Defaults a new agent to its native real-world size (scale 1), on the assumption that both the asset
 * and the scene it's placed into are authored in realistic meters. Fitting scale to the scene's road
 * width was tried and dropped: it forced ordinary vehicles into extreme mass/force regimes on narrow
 * roads, which is what made them feel physically wrong (jittery, low-traction) once simulated. Resizing
 * an instance — e.g. scaling up a toy-scale model — is still supported, but only as an explicit choice
 * via `scale`, not an automatic one.
 */
export function createAgentDraft(asset: AgentAssetReference): AgentDraft {
  return freezeDraft({
    asset,
    name: asset.label,
    scale: 1,
    pose: { position: { x: 0, y: 0, z: 0 }, headingRadians: 0, support: null },
    mass: 1200,
    vehicle: asset.category === "vehicles" ? DEFAULT_VEHICLE_TUNING : null,
    collision: asset.collision,
    placement: { maxSlopeDegrees: 35, clearance: 0.03 },
    inputEligible: true,
    vehiclePhysicsModel: DEFAULT_VEHICLE_PHYSICS_MODEL
  });
}

export function validateAgentDraft(draft: AgentDraft): AgentDraft {
  if (!draft.asset.id.trim() || !draft.asset.key.trim()) throw new Error("Agent asset identity is missing.");
  if (!draft.name.trim()) throw new Error("Agent name is required.");
  if (draft.name.trim().length > 80) throw new Error("Agent name must be 80 characters or fewer.");
  positive(draft.scale, "Agent scale");
  finiteVector(draft.pose.position, "Agent position");
  finite(draft.pose.headingRadians, "Agent heading");
  positive(draft.mass, "Agent mass");
  finiteVector(draft.collision.center, "Collision center");
  positiveVector(draft.collision.halfExtents, "Collision half-extents");
  positive(draft.placement.clearance, "Placement clearance", true);
  if (!Number.isFinite(draft.placement.maxSlopeDegrees) || draft.placement.maxSlopeDegrees < 0 || draft.placement.maxSlopeDegrees >= 90) {
    throw new Error("Maximum placement slope must be between 0 and 90 degrees.");
  }
  if (draft.vehicle) validateVehicleTuning(draft.vehicle);
  if (draft.vehiclePhysicsModel !== "raycast" && draft.vehiclePhysicsModel !== "physical") {
    throw new Error("Vehicle physics model must be raycast or physical.");
  }
  return freezeDraft({ ...draft, name: draft.name.trim() });
}

export function freezeDraft(draft: AgentDraft): AgentDraft {
  return Object.freeze({
    name: draft.name,
    scale: draft.scale,
    mass: draft.mass,
    vehicle: draft.vehicle ? Object.freeze({ ...draft.vehicle }) : null,
    inputEligible: draft.inputEligible,
    vehiclePhysicsModel: draft.vehiclePhysicsModel,
    asset: Object.freeze({ ...draft.asset }),
    pose: Object.freeze({
      ...draft.pose,
      position: Object.freeze({ ...draft.pose.position }),
      support: draft.pose.support ? Object.freeze({ ...draft.pose.support }) : null
    }),
    collision: Object.freeze({
      center: Object.freeze({ ...draft.collision.center }),
      halfExtents: Object.freeze({ ...draft.collision.halfExtents })
    }),
    placement: Object.freeze({ ...draft.placement })
  });
}

// Below this, a wheel's raycast travel is smaller than ordinary road-mesh seams and camber, so a scaled-down
// vehicle bounces off geometry a full-size car would roll over without noticing. This is a terrain-precision
// floor, independent of the mass/force scaling below: real bumps don't shrink just because the car did.
const MIN_SUSPENSION_REST_LENGTH_M = 0.06;
const MIN_SUSPENSION_MAX_TRAVEL_M = 0.1;

export interface ScaledVehicleTuning {
  readonly mass: number;
  readonly maxEngineForceN: number;
  readonly maxBrakeForceN: number;
  readonly maxSteeringAngleDegrees: number;
  readonly steeringSpeedDegreesPerSecond: number;
  readonly suspensionStiffness: number;
  readonly suspensionDamping: number;
  readonly suspensionRestLength: number;
  readonly suspensionMaxTravel: number;
  readonly wheelFrictionSlip: number;
}

/**
 * The mass an agent actually simulates with at its placed scale: every authored asset is treated as a
 * uniformly scaled, constant-density copy of itself, so mass follows volume (scale^3) rather than staying
 * at its authored value while the body shrinks around it. The single source of this rule — every place that
 * needs a simulated mass, vehicle or not, calls this instead of scaling `draft.mass` inline.
 */
export function scaledMass(mass: number, scale: number): number {
  return mass * scale ** 3;
}

/**
 * The tuning actually used to simulate a vehicle at its placed scale, treating it as a uniformly scaled,
 * constant-density copy of the authored (scale-1) car rather than the authored car's full mass and power
 * squeezed into a smaller body. For a scale factor s: length terms (suspension travel) scale as s; mass
 * scales as s^3 (volume, via scaledMass); force scales as s^3 (so acceleration — force/mass — stays the
 * same); suspension stiffness is force/length so it scales as s^3/s = s^2; damping scales as s^2.5 to hold
 * the damping ratio (~stiffness*mass) constant instead of leaving the suspension under- or over-damped at
 * small scales. Angles and the dimensionless friction-slip coefficient don't scale.
 */
export function scaledVehicleTuning(vehicle: VehicleTuning, mass: number, scale: number): ScaledVehicleTuning {
  return {
    mass: scaledMass(mass, scale),
    maxEngineForceN: vehicle.maxEngineForceN * scale ** 3,
    maxBrakeForceN: vehicle.maxBrakeForceN * scale ** 3,
    maxSteeringAngleDegrees: vehicle.maxSteeringAngleDegrees,
    steeringSpeedDegreesPerSecond: vehicle.steeringSpeedDegreesPerSecond,
    suspensionStiffness: vehicle.suspensionStiffness * scale ** 2,
    suspensionDamping: vehicle.suspensionDamping * scale ** 2.5,
    suspensionRestLength: Math.max(vehicle.suspensionRestLength * scale, MIN_SUSPENSION_REST_LENGTH_M),
    suspensionMaxTravel: Math.max(vehicle.suspensionMaxTravel * scale, MIN_SUSPENSION_MAX_TRAVEL_M),
    wheelFrictionSlip: vehicle.wheelFrictionSlip
  };
}

export function scaledAgentCollision(draft: AgentDraft): AgentDraft["collision"] {
  const scale = draft.scale;
  return {
    center: {
      x: draft.collision.center.x * scale,
      y: draft.collision.center.y * scale,
      z: draft.collision.center.z * scale
    },
    halfExtents: {
      x: draft.collision.halfExtents.x * scale,
      y: draft.collision.halfExtents.y * scale,
      z: draft.collision.halfExtents.z * scale
    }
  };
}

export function agentBoundsOverlap(a: AgentDraft, b: AgentDraft): boolean {
  const first = collisionFrame(a);
  const second = collisionFrame(b);
  const epsilon = 0.0001;
  if (first.minY >= second.maxY - epsilon || first.maxY <= second.minY + epsilon) return false;
  const delta = { x: second.center.x - first.center.x, z: second.center.z - first.center.z };
  for (const axis of [first.axisX, first.axisZ, second.axisX, second.axisZ]) {
    const distance = Math.abs(dot(delta, axis));
    const firstRadius = first.halfX * Math.abs(dot(first.axisX, axis)) + first.halfZ * Math.abs(dot(first.axisZ, axis));
    const secondRadius = second.halfX * Math.abs(dot(second.axisX, axis)) + second.halfZ * Math.abs(dot(second.axisZ, axis));
    if (distance >= firstRadius + secondRadius - epsilon) return false;
  }
  return true;
}

export function authoredBounds(draft: AgentDraft): { min: Vector3Value; max: Vector3Value } {
  const frame = collisionFrame(draft);
  const halfX = Math.abs(frame.axisX.x) * frame.halfX + Math.abs(frame.axisZ.x) * frame.halfZ;
  const halfZ = Math.abs(frame.axisX.z) * frame.halfX + Math.abs(frame.axisZ.z) * frame.halfZ;
  return {
    min: { x: frame.center.x - halfX, y: frame.minY, z: frame.center.z - halfZ },
    max: { x: frame.center.x + halfX, y: frame.maxY, z: frame.center.z + halfZ }
  };
}

export function agentFootprintContainsPoint(agent: AgentDraft, point: Pick<Vector3Value, "x" | "z">): boolean {
  const frame = collisionFrame(agent);
  const delta = { x: point.x - frame.center.x, z: point.z - frame.center.z };
  return Math.abs(dot(delta, frame.axisX)) <= frame.halfX + 0.0001 && Math.abs(dot(delta, frame.axisZ)) <= frame.halfZ + 0.0001;
}

export function agentSupportsFootprint(support: AgentDraft, candidate: AgentDraft): boolean {
  const base = collisionFrame(support);
  const placed = collisionFrame(candidate);
  for (const xSign of [-1, 1]) for (const zSign of [-1, 1]) {
    const point = {
      x: placed.center.x + placed.axisX.x * placed.halfX * xSign + placed.axisZ.x * placed.halfZ * zSign,
      z: placed.center.z + placed.axisX.z * placed.halfX * xSign + placed.axisZ.z * placed.halfZ * zSign
    };
    const delta = { x: point.x - base.center.x, z: point.z - base.center.z };
    if (Math.abs(dot(delta, base.axisX)) > base.halfX + 0.0001 || Math.abs(dot(delta, base.axisZ)) > base.halfZ + 0.0001) return false;
  }
  return true;
}

export function placementOriginY(draft: AgentDraft, surfaceY: number): number {
  const collision = scaledAgentCollision(draft);
  let bottom = collision.center.y - collision.halfExtents.y;
  for (const wheel of draft.asset.wheels ?? []) {
    bottom = Math.min(bottom, (wheel.position.y - wheel.radius) * draft.scale);
  }
  return surfaceY + draft.placement.clearance - bottom;
}

interface CollisionFrame {
  readonly center: { x: number; z: number };
  readonly axisX: { x: number; z: number };
  readonly axisZ: { x: number; z: number };
  readonly halfX: number;
  readonly halfZ: number;
  readonly minY: number;
  readonly maxY: number;
}

function collisionFrame(draft: AgentDraft): CollisionFrame {
  const collision = scaledAgentCollision(draft);
  const cosine = Math.cos(draft.pose.headingRadians);
  const sine = Math.sin(draft.pose.headingRadians);
  const axisX = { x: cosine, z: -sine };
  const axisZ = { x: sine, z: cosine };
  const center = {
    x: draft.pose.position.x + axisX.x * collision.center.x + axisZ.x * collision.center.z,
    z: draft.pose.position.z + axisX.z * collision.center.x + axisZ.z * collision.center.z
  };
  const centerY = draft.pose.position.y + collision.center.y;
  return {
    center,
    axisX,
    axisZ,
    halfX: collision.halfExtents.x,
    halfZ: collision.halfExtents.z,
    minY: centerY - collision.halfExtents.y,
    maxY: centerY + collision.halfExtents.y
  };
}

function dot(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return a.x * b.x + a.z * b.z;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
}

function positive(value: number, label: string, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${label} must be ${allowZero ? "nonnegative" : "positive"}.`);
  }
}

function finiteVector(value: Vector3Value, label: string): void {
  finite(value.x, label); finite(value.y, label); finite(value.z, label);
}

function positiveVector(value: Vector3Value, label: string): void {
  positive(value.x, label); positive(value.y, label); positive(value.z, label);
}

function validateVehicleTuning(vehicle: VehicleTuning): void {
  positive(vehicle.maxEngineForceN, "Vehicle max engine force");
  positive(vehicle.maxBrakeForceN, "Vehicle max brake force");
  if (!Number.isFinite(vehicle.maxSteeringAngleDegrees) || vehicle.maxSteeringAngleDegrees <= 0 || vehicle.maxSteeringAngleDegrees >= 90) {
    throw new Error("Vehicle max steering angle must be between 0 and 90 degrees.");
  }
  positive(vehicle.steeringSpeedDegreesPerSecond, "Vehicle steering speed");
  positive(vehicle.suspensionStiffness, "Vehicle suspension stiffness");
  positive(vehicle.suspensionDamping, "Vehicle suspension damping");
  positive(vehicle.suspensionRestLength, "Vehicle suspension rest length");
  positive(vehicle.suspensionMaxTravel, "Vehicle suspension max travel");
  positive(vehicle.wheelFrictionSlip, "Vehicle wheel friction slip");
}
