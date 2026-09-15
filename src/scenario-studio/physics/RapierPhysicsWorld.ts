import type { AgentDraft, AgentSnapshot, PlacementHit, PlacementPreview, Ray3 } from "../domain/agent";
import type { DriveCommand } from "../domain/playback";
import type { PhysicsEngineFactory, PhysicsWorld, PlaybackSnapshot, SceneGeometryDescription } from "./PhysicsWorld";
import { PhysicsWorkerClient } from "./PhysicsWorkerClient";

export class RapierPhysicsWorld implements PhysicsWorld {
  private readonly client = new PhysicsWorkerClient();

  replaceScene(scene: SceneGeometryDescription): Promise<number> {
    const cloneMeshes = (meshes: readonly SceneGeometryDescription["meshes"][number][]) => meshes.map((mesh) => ({ ...mesh, vertices: mesh.vertices.slice(), indices: mesh.indices.slice() }));
    const copy = { ...scene, meshes: cloneMeshes(scene.meshes), nonSupportingMeshes: cloneMeshes(scene.nonSupportingMeshes ?? []) };
    return this.client.replaceScene(copy);
  }
  pickSurface(ray: Ray3): Promise<PlacementHit | null> { return this.client.pickSurface(ray); }
  previewAgentPlacement(draft: AgentDraft, ray: Ray3, ignoreAgentId?: string): Promise<PlacementPreview> {
    return this.client.previewAgentPlacement(draft, ray, ignoreAgentId);
  }
  addAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void> { return this.client.addAgent(agent, expectedSceneRevision); }
  updateAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void> { return this.client.updateAgent(agent, expectedSceneRevision); }
  removeAgent(id: string): Promise<void> { return this.client.removeAgent(id); }
  clearAgents(): Promise<void> { return this.client.clearAgents(); }
  preparePlayback(agents: readonly AgentSnapshot[], controlledAgentId: string | null, expectedSceneRevision: number, generation: number): Promise<void> {
    return this.client.preparePlayback(agents, controlledAgentId, expectedSceneRevision, generation);
  }
  stepPlayback(dt: number, generation: number): Promise<PlaybackSnapshot> { return this.client.stepPlayback(dt, generation); }
  driveControlledAgent(command: DriveCommand, generation: number): Promise<void> { return this.client.driveControlledAgent(command, generation); }
  resetPlayback(agents: readonly AgentSnapshot[], generation: number): Promise<void> { return this.client.resetPlayback(agents, generation); }
  dispose(): Promise<void> { return this.client.dispose(); }
}

export class RapierPhysicsEngineFactory implements PhysicsEngineFactory {
  readonly key = "rapier";
  readonly label = "Rapier";
  async create(): Promise<PhysicsWorld> { return new RapierPhysicsWorld(); }
}
