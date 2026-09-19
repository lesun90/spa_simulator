import type { AgentDraft, SceneObjectSnapshot, PlacementHit, PlacementPreview, Ray3 } from "../domain/agent";
import type { AgentPhysicsInput, PhysicsEngineFactory, PhysicsWorld, PlaybackSnapshot, SceneGeometryDescription } from "./PhysicsWorld";
import { PhysicsWorkerClient } from "./PhysicsWorkerClient";
import { RpcVehiclePhysicsPort, type VehiclePhysicsPort } from "./VehiclePhysicsPort";
import { RpcRigidBodyPhysicsPort, type RigidBodyPhysicsPort } from "./RigidBodyPhysicsPort";

export class RapierPhysicsWorld implements PhysicsWorld {
  private readonly client = new PhysicsWorkerClient();

  replaceScene(scene: SceneGeometryDescription, materialFriction: Readonly<Record<string, number>>): Promise<number> {
    const cloneMeshes = (meshes: readonly SceneGeometryDescription["meshes"][number][]) => meshes.map((mesh) => ({ ...mesh, vertices: mesh.vertices.slice(), indices: mesh.indices.slice() }));
    const copy = { ...scene, meshes: cloneMeshes(scene.meshes), nonSupportingMeshes: cloneMeshes(scene.nonSupportingMeshes ?? []) };
    return this.client.replaceScene(copy, materialFriction);
  }
  updateGroundFriction(materialFriction: Readonly<Record<string, number>>): Promise<void> { return this.client.updateGroundFriction(materialFriction); }
  pickSurface(ray: Ray3): Promise<PlacementHit | null> { return this.client.pickSurface(ray); }
  previewAgentPlacement(draft: AgentDraft, ray: Ray3, ignoreAgentId?: string): Promise<PlacementPreview> {
    return this.client.previewAgentPlacement(draft, ray, ignoreAgentId);
  }
  addAgent(agent: SceneObjectSnapshot, expectedSceneRevision: number): Promise<void> { return this.client.addAgent(agent, expectedSceneRevision); }
  updateAgent(agent: SceneObjectSnapshot, expectedSceneRevision: number): Promise<void> { return this.client.updateAgent(agent, expectedSceneRevision); }
  removeAgent(id: string): Promise<void> { return this.client.removeAgent(id); }
  clearAgents(): Promise<void> { return this.client.clearAgents(); }
  preparePlayback(agents: readonly AgentPhysicsInput[], expectedSceneRevision: number, generation: number): Promise<readonly { readonly id: string; readonly resourceId: number }[]> {
    // Clone before transfer: chassisHullPoints may be AssetManager's cached array, shared by every instance of
    // that asset — transferring its buffer directly would detach (neuter) the cache for everyone else.
    const copies = agents.map((agent) => agent.chassisHullPoints ? { ...agent, chassisHullPoints: agent.chassisHullPoints.slice() } : agent);
    return this.client.preparePlayback(copies, expectedSceneRevision, generation);
  }
  stepPlayback(dt: number, generation: number): Promise<PlaybackSnapshot> { return this.client.stepPlayback(dt, generation); }
  resetPlayback(agents: readonly SceneObjectSnapshot[], generation: number): Promise<void> { return this.client.resetPlayback(agents, generation); }
  createVehiclePhysicsPort(resourceId: number): VehiclePhysicsPort { return new RpcVehiclePhysicsPort(resourceId, this.client); }
  createRigidBodyPhysicsPort(resourceId: number): RigidBodyPhysicsPort { return new RpcRigidBodyPhysicsPort(resourceId); }
  dispose(): Promise<void> { return this.client.dispose(); }
}

export class RapierPhysicsEngineFactory implements PhysicsEngineFactory {
  readonly key = "rapier";
  readonly label = "Rapier";
  async create(): Promise<PhysicsWorld> { return new RapierPhysicsWorld(); }
}
