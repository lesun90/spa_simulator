/// <reference lib="webworker" />
import RAPIER from "@dimforge/rapier3d-compat";
import { placementOriginY, scaledAgentCollision, scaledMass, scaledVehicleTuning, type AgentDraft, type SceneObjectSnapshot, type PlacementHit, type PlacementPreview, type Ray3, type ScaledVehicleTuning, type Vector3Value, type WheelDescriptor } from "../domain/agent";
import { NEUTRAL_DRIVE_COMMAND, validateDriveCommand, type DriveCommand } from "../domain/playback";
import { DEFAULT_MATERIAL_FRICTION } from "../domain/materialFriction";
import type { AgentPhysicsInput, AgentTransform, PlaybackSnapshot, SceneGeometryDescription } from "./PhysicsWorld";
import type { PhysicsWorkerRequest, PhysicsWorkerResponse } from "./PhysicsWorkerClient";
import type { AgentWheelPose, BodyPose } from "../domain/SceneObjectPorts";

const FIXED_STEP = 1 / 60;
// Comfortably above RenderLoop's 0.1s per-frame dt clamp so a normal slow frame never loses simulated time.
const MAX_SUBSTEPS_PER_CALL = 8;

// Physical-model tuning with no raycast-controller equivalent to derive from; expect empirical iteration.
const WHEEL_MASS_FRACTION = 0.015;
const CONNECTOR_BODY_MASS_KG = 5;
const STEERING_JOINT_STIFFNESS = 5e4;
const STEERING_JOINT_DAMPING = 2e3;
// Faceted tread gives the contact solver a stable support face at rest. Smooth
// cylinder contacts drift under suspension load; 48 sides keep radial error below 0.22%.
const WHEEL_TREAD_SEGMENTS = 48;
const SPIN_MOTOR_TARGET_RAD_PER_S = 1000; // unreachable target; setMotorMaxForce is the real throttle limiter.
const DRIVELINE_DRAG_FRACTION = 0.1;
// The chassis (hundreds-to-thousands of kg) is joint-connected to knuckle/carriage/wheel bodies that are
// orders of magnitude lighter. Rapier's iterative solver resolves joints between such mismatched masses poorly —
// an impulsive, single-wheel load (e.g. one wheel catching a curb) makes the light leg overreact and that noise
// couples back into the chassis as jitter. A dominance group was tried here and reverted: it makes the chassis
// immune to reaction forces from the (lower-dominance) legs entirely, which broke suspension support (the
// chassis fell onto its own hull collider instead of being held at ride height by the wheels) and, with it,
// visible steering. `setAdditionalSolverIterations` gives the same stiff-chain convergence help without ever
// breaking the two-way force coupling a suspension depends on.
const CHASSIS_ADDITIONAL_SOLVER_ITERATIONS = 4;
// Reconcile tire contacts and the light connector / heavy chassis constraints
// within each substep, especially when only one tire is supported by a curb.
const PHYSICAL_INTERNAL_SOLVER_ITERATIONS = 8;
// Rotates a collider's default +Y axis onto the vehicle's local -X (spin) axis: 90 degrees about Z.
const WHEEL_COLLIDER_ROTATION: RAPIER.Rotation = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };

interface PlaybackBody {
  readonly resourceId: number;
  readonly body: RAPIER.RigidBody;
  readonly kind: "generic" | "vehicle";
  readonly localCenter: Vector3Value;
  readonly controller?: RAPIER.DynamicRayCastVehicleController;
  readonly rig?: PhysicalVehicleRig;
  readonly wheelCount: number;
  /** Computed once from the agent's placed scale in preparePlayback; drive-force application reuses this instead of rescaling every substep. */
  readonly tuning?: ScaledVehicleTuning;
}

/** One wheel's real rigid-body chain: chassis -[steer?]- knuckle? -[suspension]- carriage -[spin]- wheel. */
interface PhysicalWheelRig {
  readonly id: string;
  readonly steeringJoint: RAPIER.RevoluteImpulseJoint | null;
  readonly suspensionJoint: RAPIER.PrismaticImpulseJoint;
  readonly spinJoint: RAPIER.RevoluteImpulseJoint;
  readonly knuckleBody: RAPIER.RigidBody | null;
  readonly carriageBody: RAPIER.RigidBody;
  readonly wheelBody: RAPIER.RigidBody;
  /** The wheel's connection point in the chassis's local frame, scaled; used to derive suspensionLength for fixed wheels. */
  readonly localAnchor: Vector3Value;
  readonly radiusScaled: number;
  readonly suspensionRestLength: number;
  /** Accumulated spin angle; Rapier's joints expose no angle getter, so this worker integrates it itself each step. */
  spinRadians: number;
}

interface PhysicalVehicleRig {
  readonly wheels: readonly PhysicalWheelRig[];
}

let world: RAPIER.World | null = null;
let sceneRevision = 0;
let initialized: Promise<void> | null = null;
let contactEventQueue: RAPIER.EventQueue | undefined;
const environmentHandles = new Map<number, string>();
const environmentMaterials = new Map<number, string>();
const nonSupportingHandles = new Set<number>();
const agentColliders = new Map<string, RAPIER.Collider>();

let playbackGeneration = 0;
const driveCommands = new Map<string, DriveCommand>();
let stepAccumulator = 0;
const playbackBodies = new Map<string, PlaybackBody>();
// Connected-joint contact suppression covers only adjacent bodies, not wheel -> chassis.
// Filter within each physical assembly while retaining collisions with other vehicles.
const physicalBodyOwners = new Map<number, number>();
const physicalContactHooks: RAPIER.PhysicsHooks = {
  filterContactPair(_collider1, _collider2, body1, body2) {
    const owner = physicalBodyOwners.get(body1);
    return owner !== undefined && owner === physicalBodyOwners.get(body2)
      ? null : RAPIER.SolverFlags.COMPUTE_IMPULSE;
  },
  filterIntersectionPair() { return true; }
};
/** The agents the live bodies were built from, so the step loop can read their tuning without re-sending them each step. */
let preparedAgents: readonly SceneObjectSnapshot[] = [];
/** Each raycast vehicle's per-wheel connection point in chassis-local space, needed to reconstruct full wheel poses from the controller's scalar outputs. */
const wheelConnectionPoints = new Map<string, Vector3Value[]>();

let nextResourceId = 1;

/** Encapsulates one vehicle's worker-side resource behind a stable ID; owns no state of its own beyond the ID, delegating to the shared playback maps until those maps are fully retired. */
class VehiclePhysicsPortServer {
  constructor(readonly resourceId: number, private readonly agentId: string) {}
  applyDriveCommand(command: DriveCommand, generation: number): void { driveAgent(this.agentId, command, generation); }
}

/** Same role as VehiclePhysicsPortServer, for a non-vehicle physical prop. Takes no runtime commands today. */
class RigidBodyPhysicsPortServer {
  constructor(readonly resourceId: number, private readonly agentId: string) {}
}

const vehiclePortServers = new Map<number, VehiclePhysicsPortServer>();
const rigidBodyPortServers = new Map<number, RigidBodyPhysicsPortServer>();
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
    case "preparePlayback": return preparePlayback(operation.agents, operation.expectedSceneRevision, operation.generation);
    case "stepPlayback": return stepPlayback(operation.dt, operation.generation);
    case "vehiclePortDriveCommand": {
      const server = vehiclePortServers.get(operation.resourceId);
      if (!server) throw new Error(`No vehicle physics port for resource ${operation.resourceId}.`);
      server.applyDriveCommand(operation.command, operation.generation);
      return undefined;
    }
    case "resetPlayback": return resetPlayback(operation.agents, operation.generation);
    case "dispose": dispose(); return undefined;
  }
}

async function ensureInitialized(): Promise<void> {
  initialized ??= RAPIER.init().then(() => undefined);
  await initialized;
  // Rapier only invokes contact hooks through its event-enabled stepping path.
  contactEventQueue ??= new RAPIER.EventQueue(true);
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

function addAgent(agent: SceneObjectSnapshot, expectedSceneRevision: number): void {
  assertRevision(expectedSceneRevision);
  if (agentColliders.has(agent.id)) throw new Error(`Agent ${agent.id} already exists in physics.`);
  createAgentCollider(agent);
}

function updateAgent(agent: SceneObjectSnapshot, expectedSceneRevision: number): void {
  assertRevision(expectedSceneRevision);
  const old = agentColliders.get(agent.id);
  if (!old) throw new Error(`Agent ${agent.id} is not in physics.`);
  const active = requireWorld();
  if (overlapsAgent(agent, agent.pose.position, agent.pose.headingRadians, agent.id)) throw new Error("This position overlaps another agent.");
  active.removeCollider(old, false);
  agentColliders.delete(agent.id);
  createAgentCollider(agent);
}

function createAgentCollider(agent: SceneObjectSnapshot): void {
  const active = requireWorld();
  if (overlapsAgent(agent, agent.pose.position, agent.pose.headingRadians, agent.id)) throw new Error("This position overlaps another agent.");
  const center = collisionCenter(agent, agent.pose.position, agent.pose.headingRadians);
  const half = scaledAgentCollision(agent).halfExtents;
  const collider = active.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
    .setTranslation(center.x, center.y, center.z).setRotation(rotation(agent.pose.headingRadians)).setMass(agent.mass));
  agentColliders.set(agent.id, collider);
  active.step(contactEventQueue, physicalContactHooks);
}

function removeAgent(id: string): void {
  const collider = agentColliders.get(id);
  if (!collider || !world) return;
  world.removeCollider(collider, false);
  agentColliders.delete(id);
  world.step();
}

function clearAgents(): void { for (const id of [...agentColliders.keys()]) removeAgent(id); }

function preparePlayback(agents: readonly AgentPhysicsInput[], expectedSceneRevision: number, generation: number): readonly { readonly id: string; readonly resourceId: number }[] {
  assertRevision(expectedSceneRevision);
  const active = requireWorld();
  teardownPlaybackBodies(active);
  for (const collider of agentColliders.values()) active.removeCollider(collider, false);
  agentColliders.clear();
  const resourceIds: { readonly id: string; readonly resourceId: number }[] = [];
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

    if (drive && agent.vehiclePhysicsModel === "physical") {
      const scaled = scaledVehicleTuning(drive.tuning, agent.mass, agent.scale);
      const body = buildPhysicalChassisBody(active, agent, center, agent.pose.headingRadians, agent.chassisHullPoints, scaled.mass);
      body.setLinearDamping(0.02);
      body.setAngularDamping(0.3);
      const wheels = drive.wheels.map((wheel) => buildPhysicalWheelRig(active, body, agent, localCenter, wheel, scaled));
      const resourceId = nextResourceId++;
      playbackBodies.set(agent.id, { resourceId, body, kind, localCenter, rig: { wheels }, wheelCount: wheels.length, tuning: scaled });
      vehiclePortServers.set(resourceId, new VehiclePhysicsPortServer(resourceId, agent.id));
      resourceIds.push({ id: agent.id, resourceId });
      continue;
    }

    const body = active.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(center.x, center.y, center.z)
      .setRotation(rotation(agent.pose.headingRadians))
      .setLinearDamping(drive ? 0.02 : 0.15)
      .setAngularDamping(drive ? 0.3 : 0.6));
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
      const connectionPoints: Vector3Value[] = [];
      wheels.forEach((wheel, index) => {
        // Wheel metadata shares the asset's unscaled model frame, so scale it before rebasing onto the chassis collider's center.
        // Rapier raycasts down from the connection point by suspensionRestLength to find the resting wheel position, so the
        // connection point itself sits one rest length above the authored (ground-touching) wheel center.
        const local = {
          x: wheel.position.x * agent.scale - localCenter.x,
          y: wheel.position.y * agent.scale - localCenter.y + scaled.suspensionRestLength,
          z: wheel.position.z * agent.scale - localCenter.z
        };
        connectionPoints.push(local);
        // The axle points to the vehicle's right (-X here, since assets author +X as left); with up=+Y that makes +Z the drive direction.
        controller.addWheel(local, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, scaled.suspensionRestLength, wheel.radius * agent.scale);
        controller.setWheelSuspensionStiffness(index, scaled.suspensionStiffness);
        controller.setWheelSuspensionCompression(index, scaled.suspensionDamping);
        controller.setWheelSuspensionRelaxation(index, scaled.suspensionDamping);
        controller.setWheelMaxSuspensionTravel(index, scaled.suspensionMaxTravel);
        controller.setWheelFrictionSlip(index, scaled.wheelFrictionSlip);
      });
      wheelConnectionPoints.set(agent.id, connectionPoints);
      const resourceId = nextResourceId++;
      playbackBodies.set(agent.id, { resourceId, body, kind, localCenter, controller, wheelCount: wheels.length, tuning: scaled });
      vehiclePortServers.set(resourceId, new VehiclePhysicsPortServer(resourceId, agent.id));
      resourceIds.push({ id: agent.id, resourceId });
    } else {
      active.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(scaledMass(agent.mass, agent.scale)).setFriction(1), body);
      const resourceId = nextResourceId++;
      playbackBodies.set(agent.id, { resourceId, body, kind, localCenter, wheelCount: 0 });
      rigidBodyPortServers.set(resourceId, new RigidBodyPhysicsPortServer(resourceId, agent.id));
      resourceIds.push({ id: agent.id, resourceId });
    }
  }
  active.integrationParameters.numInternalPgsIterations = physicalBodyOwners.size ? PHYSICAL_INTERNAL_SOLVER_ITERATIONS : 1;
  preparedAgents = agents;
  wheelSteeringRadians.clear();
  driveCommands.clear();
  stepAccumulator = 0;
  playbackGeneration = generation;
  active.step(contactEventQueue, physicalContactHooks);
  return resourceIds;
}

function scalePoints(points: Float32Array, scale: number): Float32Array {
  if (scale === 1) return points;
  const scaled = new Float32Array(points.length);
  for (let index = 0; index < points.length; index++) scaled[index] = points[index] * scale;
  return scaled;
}

/** Builds the physical-model chassis body: a convex hull of the real mesh when available, else the authored box. */
function buildPhysicalChassisBody(active: RAPIER.World, agent: SceneObjectSnapshot, center: Vector3Value, heading: number, hullPoints: Float32Array | undefined, mass: number): RAPIER.RigidBody {
  const body = active.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(center.x, center.y, center.z)
    .setRotation(rotation(heading))
    .setAdditionalSolverIterations(CHASSIS_ADDITIONAL_SOLVER_ITERATIONS));
  const hullDesc = hullPoints && hullPoints.length >= 12 ? RAPIER.ColliderDesc.convexHull(scalePoints(hullPoints, agent.scale)) : null;
  if (hullDesc) {
    // Hull vertices are in the asset frame; the rigid body is at the collision center.
    const localCenter = scaledAgentCollision(agent).center;
    active.createCollider(hullDesc.setTranslation(-localCenter.x, -localCenter.y, -localCenter.z).setMass(mass).setFriction(1), body);
  } else {
    const half = scaledAgentCollision(agent).halfExtents;
    active.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(mass).setFriction(1), body);
  }
  physicalBodyOwners.set(body.handle, body.handle);
  return body;
}

/** Builds one wheel's real rigid-body chain (see PhysicalWheelRig) and attaches it to the chassis body. */
function buildPhysicalWheelRig(active: RAPIER.World, chassis: RAPIER.RigidBody, agent: SceneObjectSnapshot, localCenter: Vector3Value, wheel: WheelDescriptor, scaled: ScaledVehicleTuning): PhysicalWheelRig {
  const localAnchor: Vector3Value = {
    x: wheel.position.x * agent.scale - localCenter.x,
    y: wheel.position.y * agent.scale - localCenter.y,
    z: wheel.position.z * agent.scale - localCenter.z
  };
  const chassisTranslation = chassis.translation();
  const chassisRotation = chassis.rotation();
  const anchorWorld = addVectors(chassisTranslation, rotateVector(localAnchor, chassisRotation));
  const connectorMass = Math.max(scaledMass(CONNECTOR_BODY_MASS_KG, agent.scale), 0.05);
  const zero: Vector3Value = { x: 0, y: 0, z: 0 };
  const identityRotation: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };
  const radiusScaled = wheel.radius * agent.scale;
  // Collider-free connectors need finite inertia. Match the attached tire's inertia
  // scale: a tiny sphere's inertia makes the steering motor turn the connector
  // without reliably transmitting that rotation through the loaded joint chain.
  const connectorAngularInertia = 0.5 * scaled.mass * WHEEL_MASS_FRACTION * radiusScaled ** 2;
  const connectorInertia: Vector3Value = { x: connectorAngularInertia, y: connectorAngularInertia, z: connectorAngularInertia };

  let steeringJoint: RAPIER.RevoluteImpulseJoint | null = null;
  let knuckleBody: RAPIER.RigidBody | null = null;
  let suspensionParent: RAPIER.RigidBody = chassis;
  let suspensionParentLocalAnchor = localAnchor;

  if (wheel.steerable) {
    knuckleBody = active.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(anchorWorld.x, anchorWorld.y, anchorWorld.z)
      .setRotation(chassisRotation)
      .setAdditionalMassProperties(connectorMass, zero, connectorInertia, identityRotation));
    steeringJoint = active.createImpulseJoint(RAPIER.JointData.revolute(localAnchor, zero, { x: 0, y: 1, z: 0 }), chassis, knuckleBody, true) as RAPIER.RevoluteImpulseJoint;
    steeringJoint.setContactsEnabled(false);
    steeringJoint.configureMotorModel(RAPIER.MotorModel.ForceBased);
    suspensionParent = knuckleBody;
    suspensionParentLocalAnchor = zero;
  }

  const carriageBody = active.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(anchorWorld.x, anchorWorld.y, anchorWorld.z)
    .setRotation(chassisRotation)
    .setAdditionalMassProperties(connectorMass, zero, connectorInertia, identityRotation));
  const suspensionJoint = active.createImpulseJoint(RAPIER.JointData.prismatic(suspensionParentLocalAnchor, zero, { x: 0, y: 1, z: 0 }), suspensionParent, carriageBody, true) as RAPIER.PrismaticImpulseJoint;
  suspensionJoint.setContactsEnabled(false);
  // Permit rebound below the authored hub position. Clamping at zero makes an
  // unloaded wheel chatter against its stop when the opposite wheel is on a curb.
  suspensionJoint.setLimits(-scaled.suspensionRestLength, scaled.suspensionMaxTravel);
  suspensionJoint.configureMotorModel(RAPIER.MotorModel.ForceBased);
  suspensionJoint.configureMotorPosition(0, scaled.suspensionStiffness, scaled.suspensionDamping);

  const widthScaled = wheel.width * agent.scale;
  const tirePoints: number[] = [];
  for (const y of [-widthScaled / 2, widthScaled / 2]) {
    for (let index = 0; index < WHEEL_TREAD_SEGMENTS; index++) {
      const angle = 2 * Math.PI * (index + 0.5) / WHEEL_TREAD_SEGMENTS;
      tirePoints.push(radiusScaled * Math.cos(angle), y, radiusScaled * Math.sin(angle));
    }
  }
  const tire = RAPIER.ColliderDesc.convexHull(new Float32Array(tirePoints));
  if (!tire) throw new Error(`Cannot build tire collider for ${wheel.id}.`);
  const wheelBody = active.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(anchorWorld.x, anchorWorld.y, anchorWorld.z)
    .setRotation(chassisRotation)
    .setCcdEnabled(true));
  active.createCollider(tire
    .setRotation(WHEEL_COLLIDER_ROTATION)
    .setMass(scaled.mass * WHEEL_MASS_FRACTION)
    .setFriction(scaled.wheelFrictionSlip)
    .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), wheelBody);
  physicalBodyOwners.set(wheelBody.handle, chassis.handle);
  const spinJoint = active.createImpulseJoint(RAPIER.JointData.revolute(zero, zero, { x: -1, y: 0, z: 0 }), carriageBody, wheelBody, true) as RAPIER.RevoluteImpulseJoint;
  spinJoint.setContactsEnabled(false);
  spinJoint.configureMotorModel(RAPIER.MotorModel.ForceBased);

  return { id: wheel.id, steeringJoint, suspensionJoint, spinJoint, knuckleBody, carriageBody, wheelBody, localAnchor, radiusScaled, suspensionRestLength: scaled.suspensionRestLength, spinRadians: 0 };
}

function stepPlayback(dt: number, generation: number): PlaybackSnapshot {
  assertPlaybackGeneration(generation);
  const active = requireWorld();
  stepAccumulator = Math.min(stepAccumulator + Math.max(dt, 0), FIXED_STEP * MAX_SUBSTEPS_PER_CALL);
  while (stepAccumulator >= FIXED_STEP) {
    applyDriveForces(preparedAgents);
    active.step(contactEventQueue, physicalContactHooks);
    stepAccumulator -= FIXED_STEP;
  }
  return { generation: playbackGeneration, transforms: collectTransforms() };
}

function driveAgent(agentId: string, command: DriveCommand, generation: number): void {
  assertPlaybackGeneration(generation);
  if (playbackBodies.get(agentId)?.kind !== "vehicle") throw new Error(`Agent ${agentId} cannot accept vehicle commands.`);
  const previous = driveCommands.get(agentId) ?? NEUTRAL_DRIVE_COMMAND;
  const next = validateDriveCommand(command);
  driveCommands.set(agentId, next);
  // Motor target changes (including returning steering to center) must wake a sleeping rig.
  if (next.throttle !== previous.throttle || next.steering !== previous.steering || next.brake !== previous.brake) {
    const entry = playbackBodies.get(agentId);
    entry?.body.wakeUp();
    for (const wheel of entry?.rig?.wheels ?? []) {
      wheel.knuckleBody?.wakeUp();
      wheel.carriageBody.wakeUp();
      wheel.wheelBody.wakeUp();
    }
  }
}

function resetPlayback(agents: readonly SceneObjectSnapshot[], generation: number): void {
  // Requests are serialized by the worker, but stale async callers can enqueue cleanup after a
  // newer Play has prepared its bodies. Older ownership must never tear down the newer run.
  if (generation < playbackGeneration) return;
  const active = requireWorld();
  teardownPlaybackBodies(active);
  driveCommands.clear();
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
  active.step(contactEventQueue, physicalContactHooks);
}

function teardownPlaybackBodies(active: RAPIER.World): void {
  for (const { body, controller, rig } of playbackBodies.values()) {
    if (controller) active.removeVehicleController(controller);
    if (rig) for (const wheel of rig.wheels) {
      physicalBodyOwners.delete(wheel.wheelBody.handle);
      active.removeRigidBody(wheel.wheelBody);
      active.removeRigidBody(wheel.carriageBody);
      if (wheel.knuckleBody) active.removeRigidBody(wheel.knuckleBody);
    }
    physicalBodyOwners.delete(body.handle);
    active.removeRigidBody(body);
  }
  playbackBodies.clear();
  preparedAgents = [];
  wheelSteeringRadians.clear();
  wheelConnectionPoints.clear();
  vehiclePortServers.clear();
  rigidBodyPortServers.clear();
}

function clearPlaybackState(): void {
  physicalBodyOwners.clear();
  playbackBodies.clear();
  preparedAgents = [];
  wheelSteeringRadians.clear();
  wheelConnectionPoints.clear();
  vehiclePortServers.clear();
  rigidBodyPortServers.clear();
  driveCommands.clear();
  stepAccumulator = 0;
  playbackGeneration = 0;
}

function applyDriveForces(agents: readonly SceneObjectSnapshot[]): void {
  for (const agent of agents) { updateVehicle(agent); updateVehiclePhysical(agent); }
}

function updateVehicle(agent: SceneObjectSnapshot): void {
  const entry = playbackBodies.get(agent.id);
  const controller = entry?.controller;
  const tuning = entry?.tuning;
  if (!controller || !tuning || !agent.asset.wheels) return;
  const command = driveCommands.get(agent.id) ?? NEUTRAL_DRIVE_COMMAND;
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

function updateVehiclePhysical(agent: SceneObjectSnapshot): void {
  const entry = playbackBodies.get(agent.id);
  const rig = entry?.rig;
  const tuning = entry?.tuning;
  if (!rig || !tuning) return;
  const command = driveCommands.get(agent.id) ?? NEUTRAL_DRIVE_COMMAND;
  const maxSteeringRadians = tuning.maxSteeringAngleDegrees * Math.PI / 180;
  const targetSteering = command.steering * maxSteeringRadians;
  const currentSteering = wheelSteeringRadians.get(agent.id) ?? 0;
  const steeringStep = tuning.steeringSpeedDegreesPerSecond * Math.PI / 180 * FIXED_STEP;
  const nextSteering = Math.abs(targetSteering - currentSteering) <= steeringStep
    ? targetSteering
    : currentSteering + Math.sign(targetSteering - currentSteering) * steeringStep;
  wheelSteeringRadians.set(agent.id, nextSteering);
  const scaledSteeringStiffness = STEERING_JOINT_STIFFNESS * agent.scale ** 2;
  const scaledSteeringDamping = STEERING_JOINT_DAMPING * agent.scale ** 2.5;
  const wheelVelocityDamping = tuning.mass / rig.wheels.length * rig.wheels[0].radiusScaled ** 2 / FIXED_STEP;
  for (const wheel of rig.wheels) {
    wheel.steeringJoint?.configureMotorPosition(nextSteering, scaledSteeringStiffness, scaledSteeringDamping);
    if (command.brake > 0) {
      // Force-based velocity damping must account for the supported vehicle mass;
      // a gain of 1 barely brakes at low speed, regardless of the torque limit.
      wheel.spinJoint.configureMotorVelocity(0, wheelVelocityDamping);
      wheel.spinJoint.setMotorMaxForce(command.brake * tuning.maxBrakeForceN * wheel.radiusScaled);
    } else if (command.throttle !== 0) {
      // Negated: positive motor velocity about the -X spin axis drives the contact patch toward +Z, which
      // pushes the chassis toward -Z (backward). Forward throttle needs the opposite target.
      wheel.spinJoint.configureMotorVelocity(-Math.sign(command.throttle) * SPIN_MOTOR_TARGET_RAD_PER_S, 1);
      // Every wheel has a powered spin motor: the physical model is all-wheel drive.
      wheel.spinJoint.setMotorMaxForce(Math.abs(command.throttle) * tuning.maxEngineForceN * wheel.radiusScaled);
    } else {
      // Apply the same light driveline drag to every wheel. Without it, a tire
      // unloaded by steering or a curb can coast visibly after key-up while
      // grounded tires stop from contact friction.
      wheel.spinJoint.configureMotorVelocity(0, wheelVelocityDamping);
      wheel.spinJoint.setMotorMaxForce(DRIVELINE_DRAG_FRACTION * tuning.maxBrakeForceN * wheel.radiusScaled);
    }
    // Measured about +X (not the joint's -X spin axis) to match the sign AgentVisuals applies directly as `wheel.rotation.x`.
    const spinAxisWorld = rotateVector({ x: 1, y: 0, z: 0 }, wheel.carriageBody.rotation());
    wheel.spinRadians += dot3(wheel.wheelBody.angvel(), spinAxisWorld) * FIXED_STEP;
  }
}

function collectTransforms(): AgentTransform[] {
  const transforms: AgentTransform[] = [];
  for (const [id, entry] of playbackBodies) {
    const translation = entry.body.translation();
    const rot = entry.body.rotation();
    const heading = yawOf(rot);
    const offset = rotateVector(entry.localCenter, rot);
    const controller = entry.controller;
    const wheelIds = preparedAgents.find((a) => a.id === id)?.asset.wheels?.map((w) => w.id) ?? [];
    const wheels: readonly AgentWheelPose[] | undefined = controller
      ? Array.from({ length: entry.wheelCount }, (_, index) =>
          collectRaycastWheelTransform(wheelIds[index] ?? `wheel-${index}`, controller, index, entry.body, wheelConnectionPoints.get(id)![index]))
      : entry.rig
        ? entry.rig.wheels.map((wheel) => collectRigWheelTransform(wheel))
        : undefined;
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

function bodyPose(body: RAPIER.RigidBody): BodyPose {
  const t = body.translation();
  const r = body.rotation();
  return { worldPositionMeters: { x: t.x, y: t.y, z: t.z }, worldOrientation: { x: r.x, y: r.y, z: r.z, w: r.w } };
}

type Quaternion = { readonly x: number; readonly y: number; readonly z: number; readonly w: number };

function quaternionMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}

/** These ARE real Rapier bodies, so their world poses are read directly — no scalar reconstruction needed. */
function collectRigWheelTransform(wheel: PhysicalWheelRig): AgentWheelPose {
  const steeringBody = wheel.knuckleBody ? bodyPose(wheel.knuckleBody) : bodyPose(wheel.carriageBody);
  return { wheelId: wheel.id, suspensionBody: bodyPose(wheel.carriageBody), steeringBody, tireBody: bodyPose(wheel.wheelBody) };
}

/**
 * The raycast controller only exposes wheelSteering/wheelRotation/wheelSuspensionLength scalars, so this is the
 * one place — inside the worker, not duplicated in the renderer — that turns them into full world poses, using
 * the same connection-point and axle convention used when the wheel was added (see the `controller.addWheel` call).
 */
function collectRaycastWheelTransform(wheelId: string, controller: RAPIER.DynamicRayCastVehicleController, index: number, chassis: RAPIER.RigidBody, connectionPointLocal: Vector3Value): AgentWheelPose {
  const chassisRotation = chassis.rotation();
  const chassisTranslation = chassis.translation();
  const steeringRadians = controller.wheelSteering(index) ?? 0;
  const rotationRadians = controller.wheelRotation(index) ?? 0;
  const suspensionLength = controller.wheelSuspensionLength(index) ?? 0;
  // Local wheel frame: start at the connection point, drop by suspensionLength along -Y,
  // rotate by steering about Y, then spin about the -X axle (matching the axle convention above).
  const localWheelPosition: Vector3Value = { x: connectionPointLocal.x, y: connectionPointLocal.y - suspensionLength, z: connectionPointLocal.z };
  const localSteeringRotation: Quaternion = { x: 0, y: Math.sin(steeringRadians / 2), z: 0, w: Math.cos(steeringRadians / 2) };
  const localSpinRotation: Quaternion = { x: -Math.sin(rotationRadians / 2), y: 0, z: 0, w: Math.cos(rotationRadians / 2) };
  const worldTirePosition = addVectors(chassisTranslation, rotateVector(localWheelPosition, chassisRotation));
  const worldTireRotation = quaternionMultiply(chassisRotation, quaternionMultiply(localSteeringRotation, localSpinRotation));
  const worldSteeringRotation = quaternionMultiply(chassisRotation, localSteeringRotation);
  const tireBody: BodyPose = { worldPositionMeters: worldTirePosition, worldOrientation: worldTireRotation };
  const steeringBody: BodyPose = { worldPositionMeters: worldTirePosition, worldOrientation: worldSteeringRotation };
  return { wheelId, suspensionBody: steeringBody, steeringBody, tireBody };
}

function assertPlaybackGeneration(expected: number): void {
  if (expected !== playbackGeneration) throw new Error("The playback run is stale. Try again.");
}

function assertRevision(expected: number): void { if (expected !== sceneRevision) throw new Error("The placement result is stale. Try again."); }
function requireWorld(): RAPIER.World { if (!world) throw new Error("Physics environment is still preparing."); return world; }
function invalid(reason: string, pose: PlacementPreview["pose"] = null): PlacementPreview { return { valid: false, pose, reason, sceneRevision }; }
function vector(value: { x: number; y: number; z: number }): Vector3Value { return { x: value.x, y: value.y, z: value.z }; }
function addScaled(a: Vector3Value, b: Vector3Value, scale: number): Vector3Value { return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale }; }
function addVectors(a: Vector3Value, b: Vector3Value): Vector3Value { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function dot3(a: Vector3Value, b: Vector3Value): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function yawOf(q: RAPIER.Rotation): number { return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)); }
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
function dispose(): void { contactEventQueue?.free(); contactEventQueue = undefined; world?.free(); world = null; environmentHandles.clear(); environmentMaterials.clear(); nonSupportingHandles.clear(); agentColliders.clear(); clearPlaybackState(); }
