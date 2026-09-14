import type { AgentDraft, AgentSnapshot, PlacementHit, PlacementPreview, Ray3 } from "../domain/agent";

export interface TriangleMeshDescription {
  readonly label: string;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
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

export interface PhysicsWorld extends PlacementSurface {
  replaceScene(scene: SceneGeometryDescription): Promise<number>;
  previewAgentPlacement(draft: AgentDraft, ray: Ray3, ignoreAgentId?: string): Promise<PlacementPreview>;
  addAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void>;
  updateAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void>;
  removeAgent(id: string): Promise<void>;
  clearAgents(): Promise<void>;
  dispose(): Promise<void>;
}

export interface PhysicsEngineFactory {
  readonly key: string;
  readonly label: string;
  create(): Promise<PhysicsWorld>;
}
