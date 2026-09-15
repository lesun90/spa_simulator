import type { AgentDraft, AgentSnapshot, PlacementHit, PlacementPreview, Ray3, Vector3Value } from "../domain/agent";
import type { DriveCommand } from "../domain/playback";

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
}

export interface PlaybackSnapshot {
  readonly generation: number;
  readonly transforms: readonly AgentTransform[];
}

export interface PhysicsWorld extends PlacementSurface {
  replaceScene(scene: SceneGeometryDescription): Promise<number>;
  previewAgentPlacement(draft: AgentDraft, ray: Ray3, ignoreAgentId?: string): Promise<PlacementPreview>;
  addAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void>;
  updateAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void>;
  removeAgent(id: string): Promise<void>;
  clearAgents(): Promise<void>;
  /** Builds live bodies for every authored agent from their baseline snapshot. `controlledAgentId` names the one agent, if any, that accepts drive commands. */
  preparePlayback(agents: readonly AgentSnapshot[], controlledAgentId: string | null, expectedSceneRevision: number, generation: number): Promise<void>;
  /** Advances fixed 1/60 s substeps to cover wall-clock `dt` and returns transforms stamped with `generation`; rejects once `generation` is no longer the active run. */
  stepPlayback(dt: number, generation: number): Promise<PlaybackSnapshot>;
  /** Applies a validated throttle/steering/brake command to the controlled agent; rejects once `generation` is no longer the active run. */
  driveControlledAgent(command: DriveCommand, generation: number): Promise<void>;
  /** Releases live bodies and restores the authored, query-only colliders for `agents`. Safe to call repeatedly. */
  resetPlayback(agents: readonly AgentSnapshot[], generation: number): Promise<void>;
  dispose(): Promise<void>;
}

export interface PhysicsEngineFactory {
  readonly key: string;
  readonly label: string;
  create(): Promise<PhysicsWorld>;
}
