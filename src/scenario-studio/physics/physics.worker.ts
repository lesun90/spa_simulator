/// <reference lib="webworker" />
import RAPIER from "@dimforge/rapier3d-compat";
import type { AgentDraft, AgentSnapshot, PlacementHit, PlacementPreview, Ray3, Vector3Value } from "../domain/agent";
import type { SceneGeometryDescription } from "./PhysicsWorld";
import type { PhysicsWorkerRequest, PhysicsWorkerResponse } from "./PhysicsWorkerClient";

let world: RAPIER.World | null = null;
let sceneRevision = 0;
let initialized: Promise<void> | null = null;
const environmentHandles = new Set<number>();
const nonSupportingHandles = new Set<number>();
const agentColliders = new Map<string, RAPIER.Collider>();

self.addEventListener("message", (event: MessageEvent<PhysicsWorkerRequest>) => {
  void dispatch(event.data).then(
    (result) => self.postMessage({ id: event.data.id, result } satisfies PhysicsWorkerResponse),
    (error) => self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : "Physics request failed." } satisfies PhysicsWorkerResponse)
  );
});

async function dispatch(request: PhysicsWorkerRequest): Promise<unknown> {
  await ensureInitialized();
  const operation = request.operation;
  switch (operation.type) {
    case "replaceScene": return replaceScene(operation.scene);
    case "pickSurface": return pickSurface(operation.ray);
    case "previewAgentPlacement": return previewPlacement(operation.draft, operation.ray, operation.ignoreAgentId);
    case "addAgent": return addAgent(operation.agent, operation.expectedSceneRevision);
    case "updateAgent": return updateAgent(operation.agent, operation.expectedSceneRevision);
    case "removeAgent": return removeAgent(operation.id);
    case "clearAgents": return clearAgents();
    case "dispose": dispose(); return undefined;
  }
}

async function ensureInitialized(): Promise<void> {
  initialized ??= RAPIER.init().then(() => undefined);
  await initialized;
}

function replaceScene(scene: SceneGeometryDescription): number {
  const next = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const nextHandles = new Set<number>();
  const nextNonSupportingHandles = new Set<number>();
  try {
    if (scene.kind === "default-ground") {
      const ground = scene.defaultGround;
      if (!ground || !Number.isFinite(ground.width) || !Number.isFinite(ground.depth) || !Number.isFinite(ground.y) || ground.width <= 0 || ground.depth <= 0) {
        throw new Error("Default ground geometry is invalid.");
      }
      const collider = next.createCollider(RAPIER.ColliderDesc.cuboid(ground.width / 2, 0.05, ground.depth / 2).setTranslation(0, ground.y - 0.05, 0));
      nextHandles.add(collider.handle);
    } else {
      if (!scene.meshes.length) throw new Error("The imported scene has no supported solid geometry.");
      for (const mesh of scene.meshes) {
        if (mesh.vertices.length < 9 || mesh.indices.length < 3) continue;
        const collider = next.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices));
        nextHandles.add(collider.handle);
      }
      for (const mesh of scene.nonSupportingMeshes ?? []) {
        if (mesh.vertices.length < 9 || mesh.indices.length < 3) continue;
        const collider = next.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices).setSensor(true));
        nextNonSupportingHandles.add(collider.handle);
      }
      if (!nextHandles.size) throw new Error("The imported scene has no supported solid triangles.");
    }
  } catch (error) {
    next.free();
    throw error;
  }
  next.step();
  world?.free();
  world = next;
  environmentHandles.clear();
  for (const handle of nextHandles) environmentHandles.add(handle);
  nonSupportingHandles.clear();
  for (const handle of nextNonSupportingHandles) nonSupportingHandles.add(handle);
  agentColliders.clear();
  return ++sceneRevision;
}

function pickSurface(ray: Ray3): PlacementHit | null {
  const active = requireWorld();
  const hit = active.castRayAndGetNormal(new RAPIER.Ray(ray.origin, ray.direction), 5000, true, undefined, undefined, undefined, undefined,
    (collider) => environmentHandles.has(collider.handle) || nonSupportingHandles.has(collider.handle));
  if (!hit) return null;
  if (nonSupportingHandles.has(hit.collider.handle)) return null;
  return {
    point: addScaled(ray.origin, ray.direction, hit.timeOfImpact),
    normal: vector(hit.normal),
    sceneRevision
  };
}

function previewPlacement(draft: AgentDraft, ray: Ray3, ignoreAgentId?: string): PlacementPreview {
  const hit = pickSurface(ray);
  if (!hit) return invalid("Choose a solid surface inside the environment.");
  const pose = { position: { ...hit.point, y: hit.point.y + draft.placement.clearance }, headingRadians: draft.pose.headingRadians };
  if (hit.normal.y < Math.cos(draft.placement.maxSlopeDegrees * Math.PI / 180)) return invalid("This surface is too steep.", pose);
  const supportProblem = validateFootprint(draft, pose.position, pose.headingRadians, hit);
  if (supportProblem) return invalid(supportProblem, pose);
  if (overlapsAgent(draft, pose.position, pose.headingRadians, ignoreAgentId)) return invalid("This position overlaps another agent.", pose);
  return { valid: true, pose, reason: null, sceneRevision };
}

function validateFootprint(draft: AgentDraft, position: Vector3Value, heading: number, centerHit: PlacementHit): string | null {
  const half = draft.collision.halfExtents;
  const center = rotate(draft.collision.center.x, draft.collision.center.z, heading);
  const insetX = Math.max(half.x * 0.86, 0.05);
  const insetZ = Math.max(half.z * 0.86, 0.05);
  for (const [localX, localZ] of [[-insetX, -insetZ], [insetX, -insetZ], [-insetX, insetZ], [insetX, insetZ]]) {
    const offset = rotate(localX, localZ, heading);
    const footprint = { x: center.x + offset.x, z: center.z + offset.z };
    const origin = { x: position.x + footprint.x, y: position.y + Math.max(half.y * 2 + 1, 3), z: position.z + footprint.z };
    const support = pickSurface({ origin, direction: { x: 0, y: -1, z: 0 } });
    if (!support) return "The agent footprint is not fully supported.";
    if (support.normal.y < Math.cos(draft.placement.maxSlopeDegrees * Math.PI / 180)) return "The agent footprint crosses a surface that is too steep.";
    const expectedY = centerHit.point.y - (centerHit.normal.x * footprint.x + centerHit.normal.z * footprint.z) / Math.max(centerHit.normal.y, 0.001);
    if (Math.abs(support.point.y - expectedY) > 0.3) return "The agent footprint crosses an unsupported edge.";
  }
  return null;
}

function overlapsAgent(draft: AgentDraft, position: Vector3Value, heading: number, ignoreAgentId?: string): boolean {
  const active = requireWorld();
  const shape = new RAPIER.Cuboid(draft.collision.halfExtents.x, draft.collision.halfExtents.y, draft.collision.halfExtents.z);
  const center = collisionCenter(draft, position, heading);
  const ignored = ignoreAgentId ? agentColliders.get(ignoreAgentId) : undefined;
  return active.intersectionWithShape(center, rotation(heading), shape, undefined, undefined, ignored, undefined,
    (collider) => !environmentHandles.has(collider.handle) && !nonSupportingHandles.has(collider.handle) && collider !== ignored) !== null;
}

function addAgent(agent: AgentSnapshot, expectedSceneRevision: number): void {
  assertRevision(expectedSceneRevision);
  if (agentColliders.has(agent.id)) throw new Error(`Agent ${agent.id} already exists in physics.`);
  createAgentCollider(agent);
}

function updateAgent(agent: AgentSnapshot, expectedSceneRevision: number): void {
  assertRevision(expectedSceneRevision);
  const old = agentColliders.get(agent.id);
  if (!old) throw new Error(`Agent ${agent.id} is not in physics.`);
  const active = requireWorld();
  if (overlapsAgent(agent, agent.pose.position, agent.pose.headingRadians, agent.id)) throw new Error("This position overlaps another agent.");
  active.removeCollider(old, false);
  agentColliders.delete(agent.id);
  createAgentCollider(agent);
}

function createAgentCollider(agent: AgentSnapshot): void {
  const active = requireWorld();
  if (overlapsAgent(agent, agent.pose.position, agent.pose.headingRadians, agent.id)) throw new Error("This position overlaps another agent.");
  const center = collisionCenter(agent, agent.pose.position, agent.pose.headingRadians);
  const collider = active.createCollider(RAPIER.ColliderDesc.cuboid(agent.collision.halfExtents.x, agent.collision.halfExtents.y, agent.collision.halfExtents.z)
    .setTranslation(center.x, center.y, center.z).setRotation(rotation(agent.pose.headingRadians)).setMass(agent.mass));
  agentColliders.set(agent.id, collider);
  active.step();
}

function removeAgent(id: string): void {
  const collider = agentColliders.get(id);
  if (!collider || !world) return;
  world.removeCollider(collider, false);
  agentColliders.delete(id);
  world.step();
}

function clearAgents(): void { for (const id of [...agentColliders.keys()]) removeAgent(id); }
function assertRevision(expected: number): void { if (expected !== sceneRevision) throw new Error("The placement result is stale. Try again."); }
function requireWorld(): RAPIER.World { if (!world) throw new Error("Physics environment is still preparing."); return world; }
function invalid(reason: string, pose: PlacementPreview["pose"] = null): PlacementPreview { return { valid: false, pose, reason, sceneRevision }; }
function vector(value: { x: number; y: number; z: number }): Vector3Value { return { x: value.x, y: value.y, z: value.z }; }
function addScaled(a: Vector3Value, b: Vector3Value, scale: number): Vector3Value { return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale }; }
function rotate(x: number, z: number, heading: number): { x: number; z: number } { const c = Math.cos(heading), s = Math.sin(heading); return { x: x * c + z * s, z: -x * s + z * c }; }
function rotation(heading: number): RAPIER.Rotation { return { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }; }
function collisionCenter(draft: AgentDraft, position: Vector3Value, heading: number): Vector3Value {
  const horizontal = rotate(draft.collision.center.x, draft.collision.center.z, heading);
  return { x: position.x + horizontal.x, y: position.y + draft.collision.center.y, z: position.z + horizontal.z };
}
function dispose(): void { world?.free(); world = null; environmentHandles.clear(); nonSupportingHandles.clear(); agentColliders.clear(); }
