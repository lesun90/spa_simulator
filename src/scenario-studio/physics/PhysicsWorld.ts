import type { AgentDraft, AgentSnapshot, PlacementHit, PlacementPreview, Ray3, Vector3Value } from "../domain/agent";
import type { AgentWheelPose } from "../domain/SceneObjectPorts";
import type { VehiclePhysicsPort } from "./VehiclePhysicsPort";
import type { RigidBodyPhysicsPort } from "./RigidBodyPhysicsPort";

export type { BodyPose, AgentWheelPose } from "../domain/SceneObjectPorts";

export interface TriangleMeshDescription {
  readonly label: string;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly material: string;
}

/** Neutral, meter-scaled scene geometry shared by physics adapters. */
export interface SceneGeometryDescription {
  readonly kind: "default-ground" | "imported";
  readonly meshes: readonly TriangleMeshDescription[];
  readonly nonSupportingMeshes?: readonly TriangleMeshDescription[];
  readonly defaultGround?: { readonly width: number; readonly depth: number; readonly y: number };
}

export interface PlacementSurface {
  pickSurface(ray: Ray3): Promise<PlacementHit | null>;
}

/** Neutral transform for one live playback body, stamped with the run that produced it. */
export interface AgentTransform {
  readonly id: string;
  readonly position: Vector3Value;
  readonly headingRadians: number;
  /** Full body orientation, including pitch and roll on uneven terrain. */
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  /** Complete per-part poses, index-paired with `agent.asset.wheels`. Absent for non-vehicle agents. */
  readonly wheels?: readonly AgentWheelPose[];
}

export interface PlaybackSnapshot {
  readonly generation: number;
  readonly transforms: readonly AgentTransform[];
}

/**
 * Transport-only shape at the physics boundary: an agent snapshot plus its optional chassis hull, resolved
 * from the real mesh right before entering playback. Never persisted and never part of AgentSnapshot/ScenarioRecord.
 */
export interface AgentPhysicsInput extends AgentSnapshot {
  readonly chassisHullPoints?: Float32Array;
}

export interface PhysicsWorld extends PlacementSurface {
  replaceScene(scene: SceneGeometryDescription, materialFriction: Readonly<Record<string, number>>): Promise<number>;
  /** Re-applies friction to the current ground colliders in place, without rebuilding geometry or disturbing agent colliders. */
  updateGroundFriction(materialFriction: Readonly<Record<string, number>>): Promise<void>;
  previewAgentPlacement(draft: AgentDraft, ray: Ray3, ignoreAgentId?: string): Promise<PlacementPreview>;
  addAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void>;
  updateAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void>;
  removeAgent(id: string): Promise<void>;
  clearAgents(): Promise<void>;
  /** Builds live bodies for every authored agent from their baseline snapshot; returns each agent's worker-side physics resource ID. */
  preparePlayback(agents: readonly AgentPhysicsInput[], expectedSceneRevision: number, generation: number): Promise<readonly { readonly id: string; readonly resourceId: number }[]>;
  /** Advances fixed 1/60 s substeps to cover wall-clock `dt` and returns transforms stamped with `generation`; rejects once `generation` is no longer the active run. */
  stepPlayback(dt: number, generation: number): Promise<PlaybackSnapshot>;
  /** Releases live bodies and restores the authored, query-only colliders for `agents`. Safe to call repeatedly. */
  resetPlayback(agents: readonly AgentSnapshot[], generation: number): Promise<void>;
  /** Builds the engine-specific physics port for a vehicle resource returned from `preparePlayback`. */
  createVehiclePhysicsPort(resourceId: number): VehiclePhysicsPort;
  /** Same as above, for a non-vehicle physical resource. */
  createRigidBodyPhysicsPort(resourceId: number): RigidBodyPhysicsPort;
  dispose(): Promise<void>;
}

export interface PhysicsEngineFactory {
  readonly key: string;
  readonly label: string;
  create(): Promise<PhysicsWorld>;
}
