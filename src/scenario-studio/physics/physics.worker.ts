/// <reference lib="webworker" />
import RAPIER from "@dimforge/rapier3d-compat";
import { placementOriginY, scaledAgentCollision, scaledMass, scaledVehicleTuning, type AgentDraft, type AgentSnapshot, type PlacementHit, type PlacementPreview, type Ray3, type ScaledVehicleTuning, type Vector3Value } from "../domain/agent";
import { NEUTRAL_DRIVE_COMMAND, validateDriveCommand, type DriveCommand } from "../domain/playback";
import { DEFAULT_MATERIAL_FRICTION } from "../domain/materialFriction";
import type { AgentTransform, PlaybackSnapshot, SceneGeometryDescription } from "./PhysicsWorld";
import type { PhysicsWorkerRequest, PhysicsWorkerResponse } from "./PhysicsWorkerClient";

const FIXED_STEP = 1 / 60;
// Comfortably above RenderLoop's 0.1s per-frame dt clamp so a normal slow frame never loses simulated time.
const MAX_SUBSTEPS_PER_CALL = 8;

interface PlaybackBody {
  readonly body: RAPIER.RigidBody;
  readonly kind: "generic" | "vehicle";
  readonly localCenter: Vector3Value;
  readonly controller?: RAPIER.DynamicRayCastVehicleController;
  readonly wheelCount: number;
  /** Computed once from the agent's placed scale in preparePlayback; drive-force application reuses this instead of rescaling every substep. */
  readonly tuning?: ScaledVehicleTuning;
}

let world: RAPIER.World | null = null;
let sceneRevision = 0;
let initialized: Promise<void> | null = null;
const environmentHandles = new Map<number, string>();
const environmentMaterials = new Map<number, string>();
const nonSupportingHandles = new Set<number>();
const agentColliders = new Map<string, RAPIER.Collider>();

let playbackGeneration = 0;
let controlledBodyId: string | null = null;
let driveCommand: DriveCommand = NEUTRAL_DRIVE_COMMAND;
let stepAccumulator = 0;
const playbackBodies = new Map<string, PlaybackBody>();
/** The agents the live bodies were built from, so the step loop can read their tuning without re-sending them each step. */
let preparedAgents: readonly AgentSnapshot[] = [];
/** Current front-wheel steering angle per agent, ramped toward the commanded angle instead of snapping. */
const wheelSteeringRadians = new Map<string, number>();

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
    case "replaceScene": return replaceScene(operation.scene, operation.materialFriction);
    case "updateGroundFriction": updateGroundFriction(operation.materialFriction); return undefined;
    case "pickSurface": return pickSurface(operation.ray);
    case "previewAgentPlacement": return previewPlacement(operation.draft, operation.ray, operation.ignoreAgentId);
    case "addAgent": return addAgent(operation.agent, operation.expectedSceneRevision);
    case "updateAgent": return updateAgent(operation.agent, operation.expectedSceneRevision);
    case "removeAgent": return removeAgent(operation.id);
    case "clearAgents": return clearAgents();
    case "preparePlayback": return preparePlayback(operation.agents, operation.controlledAgentId, operation.expectedSceneRevision, operation.generation);
    case "stepPlayback": return stepPlayback(operation.dt, operation.generation);
    case "driveControlledAgent": return driveControlledAgent(operation.command, operation.generation);
    case "resetPlayback": return resetPlayback(operation.agents, operation.generation);
    case "dispose": dispose(); return undefined;
  }
}

async function ensureInitialized(): Promise<void> {
  initialized ??= RAPIER.init().then(() => undefined);
  await initialized;
}

function replaceScene(scene: SceneGeometryDescription, materialFriction: Readonly<Record<string, number>>): number {
  const next = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const nextHandles = new Set<number>();
  const nextLabels = new Map<number, string>();
  const nextMaterials = new Map<number, string>();
  const nextNonSupportingHandles = new Set<number>();
  try {
    if (scene.kind === "default-ground") {
      const ground = scene.defaultGround;
      if (!ground || !Number.isFinite(ground.width) || !Number.isFinite(ground.depth) || !Number.isFinite(ground.y) || ground.width <= 0 || ground.depth <= 0) {
        throw new Error("Default ground geometry is invalid.");
      }
      const collider = next.createCollider(RAPIER.ColliderDesc.cuboid(ground.width / 2, 0.05, ground.depth / 2).setTranslation(0, ground.y - 0.05, 0).setFriction(DEFAULT_MATERIAL_FRICTION.default));
      nextHandles.add(collider.handle);
      nextLabels.set(collider.handle, "scene:default-ground");
    } else {
      if (!scene.meshes.length) throw new Error("The imported scene has no supported solid geometry.");
      for (const [index, mesh] of scene.meshes.entries()) {
        if (mesh.vertices.length < 9 || mesh.indices.length < 3) continue;
        const friction = materialFriction[mesh.material] ?? DEFAULT_MATERIAL_FRICTION[mesh.material] ?? DEFAULT_MATERIAL_FRICTION.default;
        const collider = next.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices).setFriction(friction));
        nextHandles.add(collider.handle);
        nextLabels.set(collider.handle, `scene:${index}:${mesh.label}`);
        nextMaterials.set(collider.handle, mesh.material);
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
  for (const [handle, label] of nextLabels) environmentHandles.set(handle, label);
  environmentMaterials.clear();
  for (const [handle, material] of nextMaterials) environmentMaterials.set(handle, material);
  nonSupportingHandles.clear();
  for (const handle of nextNonSupportingHandles) nonSupportingHandles.add(handle);
  agentColliders.clear();
  clearPlaybackState();
  return ++sceneRevision;
}

function updateGroundFriction(materialFriction: Readonly<Record<string, number>>): void {
  const active = requireWorld();
  for (const [handle, material] of environmentMaterials) {
    const collider = active.colliders.get(handle);
    if (!collider) continue;
    collider.setFriction(materialFriction[material] ?? DEFAULT_MATERIAL_FRICTION[material] ?? DEFAULT_MATERIAL_FRICTION.default);
  }
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
    support: { kind: "scene", id: environmentHandles.get(hit.collider.handle) ?? "scene:unknown" },
    sceneRevision
  };
}

function previewPlacement(draft: AgentDraft, ray: Ray3, ignoreAgentId?: string): PlacementPreview {
  const hit = pickSurface(ray);
  if (!hit) return invalid("Choose a solid surface inside the environment.");
  const pose = { position: { ...hit.point, y: placementOriginY(draft, hit.point.y) }, headingRadians: draft.pose.headingRadians, support: hit.support };
  if (hit.normal.y < Math.cos(draft.placement.maxSlopeDegrees * Math.PI / 180)) return invalid("This surface is too steep.", pose);
  const supportProblem = validateFootprint(draft, pose.position, pose.headingRadians, hit);
  if (supportProblem) return invalid(supportProblem, pose);
  return { valid: true, pose, reason: null, sceneRevision };
}

function validateFootprint(draft: AgentDraft, position: Vector3Value, heading: number, centerHit: PlacementHit): string | null {
  const collision = scaledAgentCollision(draft);
  const half = collision.halfExtents;
  const center = rotate(collision.center.x, collision.center.z, heading);
  const sampleSpacing = 0.2;
  const columns = Math.max(1, Math.ceil(half.x * 2 / sampleSpacing));
  const rows = Math.max(1, Math.ceil(half.z * 2 / sampleSpacing));
  for (let column = 0; column <= columns; column++) for (let row = 0; row <= rows; row++) {
    const localX = -half.x + half.x * 2 * column / columns;
    const localZ = -half.z + half.z * 2 * row / rows;
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
  const half = scaledAgentCollision(draft).halfExtents;
  const shape = new RAPIER.Cuboid(half.x, half.y, half.z);
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
  const half = scaledAgentCollision(agent).halfExtents;
  const collider = active.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
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

function preparePlayback(agents: readonly AgentSnapshot[], controlledAgentId: string | null, expectedSceneRevision: number, generation: number): void {
  assertRevision(expectedSceneRevision);
  const active = requireWorld();
  teardownPlaybackBodies(active);
  for (const collider of agentColliders.values()) active.removeCollider(collider, false);
  agentColliders.clear();
  let controlledKind: "generic" | "vehicle" | null = null;
  for (const agent of agents) {
    const kind: "generic" | "vehicle" = agent.asset.category === "vehicles" ? "vehicle" : "generic";
    const collision = scaledAgentCollision(agent);
    const localCenter = collision.center;
    const half = collision.halfExtents;
    const center = collisionCenter(agent, agent.pose.position, agent.pose.headingRadians);
    // Every vehicle needs wheel support; only the selected one receives driver input.
    const drive = kind === "vehicle" && agent.vehicle && agent.asset.wheels?.length
      ? { tuning: agent.vehicle, wheels: agent.asset.wheels }
      : null;
    const body = active.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(center.x, center.y, center.z)
      .setRotation(rotation(agent.pose.headingRadians))
      .setLinearDamping(drive && agent.id === controlledAgentId ? 0.02 : 0.15)
      .setAngularDamping(drive && agent.id === controlledAgentId ? 0.3 : 0.6));
    if (drive) {
      const { tuning, wheels } = drive;
      // Treat the vehicle as a uniformly scaled, constant-density copy of the authored car rather than the
      // authored car's full mass and power squeezed into a smaller body — see scaledVehicleTuning for the
      // scaling law. That keeps mass and rotational inertia consistent (both derived from the same scaled
      // collider), so Rapier's normal setMass-derived inertia is correct again without an explicit override.
      const scaled = scaledVehicleTuning(tuning, agent.mass, agent.scale);
      active.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(scaled.mass).setFriction(1), body);
      const controller = active.createVehicleController(body);
      controller.indexUpAxis = 1;
      // Rapier 0.20 exposes the forward-axis setter under this (upstream misspelled) name; `indexForwardAxis` is read-only.
      controller.setIndexForwardAxis = 2;
      wheels.forEach((wheel, index) => {
        // Wheel metadata shares the asset's unscaled model frame, so scale it before rebasing onto the chassis collider's center.
        // Rapier raycasts down from the connection point by suspensionRestLength to find the resting wheel position, so the
        // connection point itself sits one rest length above the authored (ground-touching) wheel center.
        const local = {
          x: wheel.position.x * agent.scale - localCenter.x,
          y: wheel.position.y * agent.scale - localCenter.y + scaled.suspensionRestLength,
          z: wheel.position.z * agent.scale - localCenter.z
        };
        // The axle points to the vehicle's right (-X here, since assets author +X as left); with up=+Y that makes +Z the drive direction.
        controller.addWheel(local, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, scaled.suspensionRestLength, wheel.radius * agent.scale);
        controller.setWheelSuspensionStiffness(index, scaled.suspensionStiffness);
        controller.setWheelSuspensionCompression(index, scaled.suspensionDamping);
        controller.setWheelSuspensionRelaxation(index, scaled.suspensionDamping);
        controller.setWheelMaxSuspensionTravel(index, scaled.suspensionMaxTravel);
        controller.setWheelFrictionSlip(index, scaled.wheelFrictionSlip);
      });
      playbackBodies.set(agent.id, { body, kind, localCenter, controller, wheelCount: wheels.length, tuning: scaled });
    } else {
      active.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(scaledMass(agent.mass, agent.scale)).setFriction(1), body);
      playbackBodies.set(agent.id, { body, kind, localCenter, wheelCount: 0 });
    }
    if (agent.id === controlledAgentId) controlledKind = kind;
  }
  controlledBodyId = controlledAgentId && controlledKind === "vehicle" ? controlledAgentId : null;
  preparedAgents = agents;
  wheelSteeringRadians.clear();
  driveCommand = NEUTRAL_DRIVE_COMMAND;
  stepAccumulator = 0;
  playbackGeneration = generation;
  active.step();
}

function stepPlayback(dt: number, generation: number): PlaybackSnapshot {
  assertPlaybackGeneration(generation);
  const active = requireWorld();
  stepAccumulator = Math.min(stepAccumulator + Math.max(dt, 0), FIXED_STEP * MAX_SUBSTEPS_PER_CALL);
  while (stepAccumulator >= FIXED_STEP) {
    applyDriveForces(preparedAgents);
    active.step();
    stepAccumulator -= FIXED_STEP;
  }
  return { generation: playbackGeneration, transforms: collectTransforms() };
}

function driveControlledAgent(command: DriveCommand, generation: number): void {
  assertPlaybackGeneration(generation);
  driveCommand = validateDriveCommand(command);
}

function resetPlayback(agents: readonly AgentSnapshot[], generation: number): void {
  const active = requireWorld();
  teardownPlaybackBodies(active);
  controlledBodyId = null;
  driveCommand = NEUTRAL_DRIVE_COMMAND;
  stepAccumulator = 0;
  playbackGeneration = generation;
  for (const agent of agents) {
    if (agentColliders.has(agent.id)) continue;
    const center = collisionCenter(agent, agent.pose.position, agent.pose.headingRadians);
    const half = scaledAgentCollision(agent).halfExtents;
    const collider = active.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z).setRotation(rotation(agent.pose.headingRadians)).setMass(agent.mass));
    agentColliders.set(agent.id, collider);
  }
  active.step();
}

function teardownPlaybackBodies(active: RAPIER.World): void {
  for (const { body, controller } of playbackBodies.values()) {
    if (controller) active.removeVehicleController(controller);
    active.removeRigidBody(body);
  }
  playbackBodies.clear();
  preparedAgents = [];
  wheelSteeringRadians.clear();
}

function clearPlaybackState(): void {
  playbackBodies.clear();
  preparedAgents = [];
  wheelSteeringRadians.clear();
  controlledBodyId = null;
  driveCommand = NEUTRAL_DRIVE_COMMAND;
  stepAccumulator = 0;
  playbackGeneration = 0;
}

function applyDriveForces(agents: readonly AgentSnapshot[]): void {
  for (const agent of agents) updateVehicle(agent);
}

function updateVehicle(agent: AgentSnapshot): void {
  const entry = playbackBodies.get(agent.id);
  const controller = entry?.controller;
  const tuning = entry?.tuning;
  if (!controller || !tuning || !agent.asset.wheels) return;
  const command = agent.id === controlledBodyId ? driveCommand : NEUTRAL_DRIVE_COMMAND;
  const maxSteeringRadians = tuning.maxSteeringAngleDegrees * Math.PI / 180;
  const targetSteering = command.steering * maxSteeringRadians;
  const currentSteering = wheelSteeringRadians.get(agent.id) ?? 0;
  const steeringStep = tuning.steeringSpeedDegreesPerSecond * Math.PI / 180 * FIXED_STEP;
  const nextSteering = Math.abs(targetSteering - currentSteering) <= steeringStep
    ? targetSteering
    : currentSteering + Math.sign(targetSteering - currentSteering) * steeringStep;
  wheelSteeringRadians.set(agent.id, nextSteering);

  agent.asset.wheels.forEach((wheel, index) => {
    controller.setWheelEngineForce(index, command.throttle * tuning.maxEngineForceN);
    controller.setWheelBrake(index, command.brake * tuning.maxBrakeForceN);
    if (wheel.steerable) controller.setWheelSteering(index, nextSteering);
    // The ground collider from the previous step's contact; the design accepts that one-step lag over re-raycasting here.
    const groundFriction = controller.wheelGroundObject(index)?.friction() ?? 1;
    controller.setWheelFrictionSlip(index, tuning.wheelFrictionSlip * groundFriction);
  });
  controller.updateVehicle(FIXED_STEP);
}

function collectTransforms(): AgentTransform[] {
  const transforms: AgentTransform[] = [];
  for (const [id, entry] of playbackBodies) {
    const translation = entry.body.translation();
    const rot = entry.body.rotation();
    const heading = Math.atan2(2 * (rot.x * rot.z + rot.w * rot.y), 1 - 2 * (rot.x * rot.x + rot.y * rot.y));
    const offset = rotateVector(entry.localCenter, rot);
    const controller = entry.controller;
    const wheels = controller ? Array.from({ length: entry.wheelCount }, (_, index) => ({
      steeringRadians: controller.wheelSteering(index) ?? 0,
      rotationRadians: controller.wheelRotation(index) ?? 0,
      suspensionLength: controller.wheelSuspensionLength(index) ?? 0
    })) : undefined;
    transforms.push({
      id,
      position: { x: translation.x - offset.x, y: translation.y - offset.y, z: translation.z - offset.z },
      headingRadians: heading,
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      ...(wheels ? { wheels } : {})
    });
  }
  return transforms;
}

function assertPlaybackGeneration(expected: number): void {
  if (expected !== playbackGeneration) throw new Error("The playback run is stale. Try again.");
}

function assertRevision(expected: number): void { if (expected !== sceneRevision) throw new Error("The placement result is stale. Try again."); }
function requireWorld(): RAPIER.World { if (!world) throw new Error("Physics environment is still preparing."); return world; }
function invalid(reason: string, pose: PlacementPreview["pose"] = null): PlacementPreview { return { valid: false, pose, reason, sceneRevision }; }
function vector(value: { x: number; y: number; z: number }): Vector3Value { return { x: value.x, y: value.y, z: value.z }; }
function addScaled(a: Vector3Value, b: Vector3Value, scale: number): Vector3Value { return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale }; }
function rotate(x: number, z: number, heading: number): { x: number; z: number } { const c = Math.cos(heading), s = Math.sin(heading); return { x: x * c + z * s, z: -x * s + z * c }; }
function rotateVector(value: Vector3Value, q: RAPIER.Rotation): Vector3Value {
  // q * value * inverse(q), for the normalized body quaternion.
  const tx = 2 * (q.y * value.z - q.z * value.y);
  const ty = 2 * (q.z * value.x - q.x * value.z);
  const tz = 2 * (q.x * value.y - q.y * value.x);
  return {
    x: value.x + q.w * tx + q.y * tz - q.z * ty,
    y: value.y + q.w * ty + q.z * tx - q.x * tz,
    z: value.z + q.w * tz + q.x * ty - q.y * tx
  };
}
function rotation(heading: number): RAPIER.Rotation { return { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }; }
function collisionCenter(draft: AgentDraft, position: Vector3Value, heading: number): Vector3Value {
  const center = scaledAgentCollision(draft).center;
  const horizontal = rotate(center.x, center.z, heading);
  return { x: position.x + horizontal.x, y: position.y + center.y, z: position.z + horizontal.z };
}
function dispose(): void { world?.free(); world = null; environmentHandles.clear(); environmentMaterials.clear(); nonSupportingHandles.clear(); agentColliders.clear(); clearPlaybackState(); }
