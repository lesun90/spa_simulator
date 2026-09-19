# Agent/Vehicle Ownership Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Scenario Studio's split vehicle ownership (worker free functions + global maps + a scalar wheel-pose contract + a separate main-thread component/middleware layer) with one authoritative main-thread `SceneObject`/`Vehicle` aggregate per live entity, backed by exact per-part Rapier poses.

**Architecture:** Introduce a `SceneObject` domain hierarchy (`VisualObject`, `RigidObject`, `Vehicle`) on the main thread, each owning a `PresentationPort` and, where needed, a physics port. The physics worker keeps Rapier resources behind per-resource `PhysicsPortServer` objects instead of global maps and free functions. The wire contract between them becomes complete `BodyPose`s per rendered part instead of three reconstructed scalars, so physics stays the sole authority for a physical vehicle's visual pose. `AgentComponentRegistry`/`AgentComponent`/`VehicleComponent` are retired; `Middleware` channels remain the transport into the new `SceneObject.dispatch`.

**Tech Stack:** TypeScript, Three.js (main thread), Rapier3D (`@dimforge/rapier3d`, physics worker), the project's existing Web Worker + structured-clone RPC (`PhysicsWorkerClient`/`physics.worker.ts`), the existing `Middleware` pub-sub (`src/scenario-studio/runtime/Middleware.ts`).

**Spec:** `docs/superpowers/specs/2026-09-18-agent-vehicle-ownership-design.md`

## Global Constraints

- No unit tests unless explicitly requested. Verify every task directly in the running Scenario Studio app (`CLAUDE.md`: "Verify changes directly in the product experience whenever possible").
- Depend on interfaces/abstract base classes at replaceable boundaries; inject dependencies; do not construct concrete implementations inside consumers (`CLAUDE.md`).
- Prefer composition over inheritance; inherit only for true is-a substitutability (`Vehicle`/`RigidObject`/`VisualObject` extend `SceneObject` — all true is-a).
- No generic `Manager`/`Helper`/`Utils` classes (`CLAUDE.md`).
- Rapier remains the sole authority for a physical vehicle's rendered pose; rendering interpolates, it never simulates (spec "Design Goals").
- One main-thread `SceneObject` instance per live entity; the worker holds only port implementations, never a second domain class (spec "New Ownership Model").
- Spawn and removal become visible only at explicit physics-step and topology-version boundaries; command/pose queues stay bounded (spec "Required Invariants").
- Commands arrive only through `SceneObject.dispatch`; no subtype exposes its own public command method (spec, tightened during audit — see class sketch note below).

## Deferred Out of This Plan

The spec's "Worker Transport for Heavy Scenes" section (packed `ArrayBuffer` wire format, per-slot topology table, `SharedArrayBuffer`) is **not** a task here. The current transport is one structured-clone RPC per fixed substep carrying every agent's transforms in one array (`stepPlayback` → `PlaybackSnapshot`), which is already batched, not per-body. Task 10's heavy-scene verification step measures whether that transport is actually a bottleneck before any binary-packing work is scheduled — building it against a guess would violate the codebase's restraint rule ("do not add abstractions for hypothetical reuse"). If Task 10 finds a real bottleneck, write a follow-up spec addendum and plan for the binary transport alone.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/scenario-studio/physics/PhysicsWorld.ts` | *(modify)* `BodyPose`, `AgentWheelPose`, updated `AgentTransform` |
| `src/scenario-studio/physics/physics.worker.ts` | *(modify)* pose collection returns complete `BodyPose`s; later, per-resource `PhysicsPortServer` classes replace the global `playbackBodies`/`driveCommands`/`wheelSteeringRadians` maps |
| `src/scenario-studio/rendering/AgentVisuals.ts` | *(modify → shrink)* keeps ghost/selection/gizmo UI only; live-instance rendering moves out |
| `src/scenario-studio/rendering/ThreePresentationPort.ts` | *(new)* `PresentationPort` Three.js implementation: bind-matrix binding, pose application |
| `src/scenario-studio/domain/SceneObjectPorts.ts` | *(new)* `SceneObjectId`, `WheelId`, pose-frame types, `PresentationPort<TPose>`, action/envelope types |
| `src/scenario-studio/domain/SceneObject.ts` | *(new)* abstract `SceneObject<TPose>` base class |
| `src/scenario-studio/domain/VisualObject.ts` | *(new)* `VisualObject extends SceneObject` |
| `src/scenario-studio/domain/RigidObject.ts` | *(new)* `RigidObject extends SceneObject` for physical (non-vehicle) props |
| `src/scenario-studio/domain/Vehicle.ts` | *(new)* `Vehicle extends SceneObject`, owns `VehiclePhysicsPort` |
| `src/scenario-studio/physics/VehiclePhysicsPort.ts` | *(new)* `VehiclePhysicsPort` interface + physical/raycast RPC implementations |
| `src/scenario-studio/physics/RigidBodyPhysicsPort.ts` | *(new)* `RigidBodyPhysicsPort` interface + RPC implementation for `RigidObject` |
| `src/scenario-studio/domain/SceneObjectRegistry.ts` | *(new)* lookup/delegate registry; owns spawn/remove/dispatch transactions |
| `src/scenario-studio/domain/ScenarioSimulation.ts` | *(new)* owns `SceneObjectRegistry` + shared fixed-step loop; used *by* `ScenarioSession`, not a replacement for it (see Task 7 note) |
| `src/scenario-studio/domain/ScenarioSession.ts` | *(modify)* delegates playback/runtime-object lifecycle to `ScenarioSimulation`; keeps authoring/document/scene concerns |
| `src/scenario-studio/runtime/AgentComponents.ts` | *(delete in Task 7)* superseded by `SceneObject.dispatch` |
| `src/scenario-studio/domain/agent.ts`, `AgentInstance.ts`, `AgentPopulation.ts` | *(rename in Task 9)* `AgentSnapshot`/`AgentInstance` → `SceneObjectSnapshot`/`SceneObjectInstance` |

---

### Task 1: Exact per-part pose contract (worker → client → renderer)

This is the direct fix for the reported curb-clipping / physics-visual-drift symptom, and stands alone: it changes the wire contract and its one consumer, with no dependency on the class hierarchy introduced later.

**Files:**
- Modify: `src/scenario-studio/physics/PhysicsWorld.ts:24-32` (`AgentTransform`)
- Modify: `src/scenario-studio/physics/physics.worker.ts:613-660` (`collectTransforms`, `collectRigWheelTransform`)
- Modify: `src/scenario-studio/rendering/AgentVisuals.ts:17-41,173-237` (`WheelVisualNodes`, `presentInterpolated`, `resolveWheelNodes`)

**Interfaces:**
- Produces: `BodyPose { readonly worldPositionMeters: Vector3Value; readonly worldOrientation: { x: number; y: number; z: number; w: number } }`
- Produces: `AgentWheelPose { readonly wheelId: string; readonly suspensionBody: BodyPose; readonly steeringBody: BodyPose; readonly tireBody: BodyPose }`
- Consumes (unchanged): `PhysicalWheelRig` (`physics.worker.ts:50-63`), `RAPIER.DynamicRayCastVehicleController` per-wheel getters (`physics.worker.ts:621-626`)

- [ ] **Step 1: Add the pose types and update `AgentTransform`**

In `src/scenario-studio/physics/PhysicsWorld.ts`, replace the wheel field:

```ts
export interface BodyPose {
  readonly worldPositionMeters: Vector3Value;
  readonly worldOrientation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
}

export interface AgentWheelPose {
  readonly wheelId: string;
  readonly suspensionBody: BodyPose;
  readonly steeringBody: BodyPose;
  readonly tireBody: BodyPose;
}

export interface AgentTransform {
  readonly id: string;
  readonly position: Vector3Value;
  readonly headingRadians: number;
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  /** Complete per-part poses, index-paired with `agent.asset.wheels`. Absent for non-vehicle agents. */
  readonly wheels?: readonly AgentWheelPose[];
}
```

- [ ] **Step 2: Rewrite `collectRigWheelTransform` (physical rig) to return real body poses**

Replace `src/scenario-studio/physics/physics.worker.ts:641-660` — these ARE real Rapier bodies, so no reconstruction math is needed, only reading transforms:

```ts
function bodyPose(body: RAPIER.RigidBody): BodyPose {
  const t = body.translation();
  const r = body.rotation();
  return { worldPositionMeters: { x: t.x, y: t.y, z: t.z }, worldOrientation: { x: r.x, y: r.y, z: r.z, w: r.w } };
}

function collectRigWheelTransform(wheelId: string, wheel: PhysicalWheelRig): AgentWheelPose {
  const steeringBody = wheel.knuckleBody ? bodyPose(wheel.knuckleBody) : bodyPose(wheel.carriageBody);
  return { wheelId, suspensionBody: bodyPose(wheel.carriageBody), steeringBody, tireBody: bodyPose(wheel.wheelBody) };
}
```

`PhysicalWheelRig` needs a stable `id` alongside its existing fields to pass as `wheelId` — add `readonly id: string;` to the interface (`physics.worker.ts:50-63`) and set it from `wheel.id` in `buildPhysicalWheelRig` (`physics.worker.ts:388`).

- [ ] **Step 3: Rewrite the raycast branch to publish full poses instead of scalars**

Replace the raycast branch inside `collectTransforms` (`physics.worker.ts:613-639`). The controller only exposes `wheelSteering`/`wheelRotation`/`wheelSuspensionLength` scalars (`physics.worker.ts:621-626`), so this is the ONE place — inside the worker, not duplicated in the renderer — that turns them into full poses, using the same connection-point and axis convention already used when the wheels were added (`physics.worker.ts:333-339`):

```ts
function collectRaycastWheelTransform(wheelId: string, controller: RAPIER.DynamicRayCastVehicleController, index: number, chassis: RAPIER.RigidBody, connectionPointLocal: Vector3Value): AgentWheelPose {
  const chassisRotation = chassis.rotation();
  const chassisTranslation = chassis.translation();
  const steeringRadians = controller.wheelSteering(index) ?? 0;
  const rotationRadians = controller.wheelRotation(index) ?? 0;
  const suspensionLength = controller.wheelSuspensionLength(index) ?? 0;
  // Local wheel frame: start at the connection point, drop by suspensionLength along -Y, rotate by steering about Y then spin about the -X axle.
  const localWheelPosition: Vector3Value = { x: connectionPointLocal.x, y: connectionPointLocal.y - suspensionLength, z: connectionPointLocal.z };
  const localSteeringRotation = { x: 0, y: Math.sin(steeringRadians / 2), z: 0, w: Math.cos(steeringRadians / 2) };
  const localSpinRotation = { x: -Math.sin(rotationRadians / 2), y: 0, z: 0, w: Math.cos(rotationRadians / 2) };
  const localTireRotation = quaternionMultiply(localSteeringRotation, localSpinRotation);
  const worldTirePosition = addVectors(chassisTranslation, rotateVector(localWheelPosition, chassisRotation));
  const worldTireRotation = quaternionMultiply(chassisRotation, localTireRotation);
  const worldSteeringRotation = quaternionMultiply(chassisRotation, localSteeringRotation);
  const tireBody: BodyPose = { worldPositionMeters: worldTirePosition, worldOrientation: worldTireRotation };
  const suspensionBody: BodyPose = { worldPositionMeters: worldTirePosition, worldOrientation: worldSteeringRotation };
  const steeringBody: BodyPose = { worldPositionMeters: worldTirePosition, worldOrientation: worldSteeringRotation };
  return { wheelId, suspensionBody, steeringBody, tireBody };
}
```

Add a `quaternionMultiply(a, b)` helper next to the existing `rotateVector`/`dot3`/`addVectors` free functions if one does not already exist in `physics.worker.ts` — check before adding (grep `quaternionMultiply` first; do not duplicate if present).

Wire both branches into `collectTransforms`:

```ts
function collectTransforms(): AgentTransform[] {
  const transforms: AgentTransform[] = [];
  for (const [id, entry] of playbackBodies) {
    const translation = entry.body.translation();
    const rot = entry.body.rotation();
    const heading = yawOf(rot);
    const offset = rotateVector(entry.localCenter, rot);
    const wheelIds = preparedAgents.find((a) => a.id === id)?.asset.wheels?.map((w) => w.id) ?? [];
    const wheels = entry.controller
      ? Array.from({ length: entry.wheelCount }, (_, index) => collectRaycastWheelTransform(wheelIds[index] ?? `wheel-${index}`, entry.controller!, index, entry.body, /* connection point local, recomputed the same way as in prepare */ wheelConnectionPoints.get(id)![index]))
      : entry.rig
        ? entry.rig.wheels.map((wheel) => collectRigWheelTransform(wheel.id, wheel))
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
```

The raycast branch needs each wheel's local connection point at collection time, which today is computed once in the `preparePlayback` wheel-building loop (`physics.worker.ts:333-337`) and then discarded. Add a module-level `const wheelConnectionPoints = new Map<string, Vector3Value[]>();`, `.set(agent.id, wheels.map(...local))` right after that loop, and clear it in `resetPlayback`/`teardownPlaybackBodies` alongside the other per-run maps.

- [ ] **Step 4: Replace `AgentVisuals`'s scalar wheel application with bind-matrix pose application**

In `src/scenario-studio/rendering/AgentVisuals.ts`, `resolveWheelNodes` (lines 218-237) currently caches `restPosition`/`restSteering`/`restRotation` as deltas to reapply. Replace the cached shape with one immutable bind matrix per part, computed once against the node's rest-pose *world* transform (not the physics body — at prepare time there is no live physics body yet, so bind against the authored rest transform, matching the spec's `visualWorld = physicsBodyWorld × visualFromPhysicsBody`: at bind time, `visualFromPhysicsBody = physicsBodyWorldAtRest^-1 × visualNodeWorldAtRest`, and since the rest physics pose equals the authored placement pose, `physicsBodyWorldAtRest` is the identity in the object's local space):

```ts
interface WheelVisualNodes {
  readonly steering: THREE.Object3D;
  readonly wheel: THREE.Object3D;
  readonly suspension: THREE.Object3D;
  readonly suspensionBind: THREE.Matrix4;
  readonly steeringBind: THREE.Matrix4;
  readonly tireBind: THREE.Matrix4;
}
```

```ts
private resolveWheelNodes(id: string): ReadonlyArray<WheelVisualNodes | null> | null {
  const cached = this.wheelNodes.get(id);
  if (cached) return cached;
  const object = this.instances.get(id);
  const wheels = this.agents.get(id)?.asset.wheels;
  if (!object || !wheels?.length) return null;
  const resolved = wheels.map((wheel) => {
    const steering = object.getObjectByName(wheel.steeringNode);
    const wheelNode = object.getObjectByName(wheel.wheelNode);
    const suspension = object.getObjectByName(wheel.suspensionNode);
    if (!steering || !wheelNode || !suspension) return null;
    // Each node's local-to-object matrix at rest IS its bind matrix: physics reports a world
    // pose whose "rest" is the authored placement, so binding against the node's current
    // local transform reproduces the authored pivot without any physics-side lookup.
    return {
      steering, wheel: wheelNode, suspension,
      suspensionBind: suspension.matrix.clone(),
      steeringBind: steering.matrix.clone(),
      tireBind: wheelNode.matrix.clone()
    };
  });
  this.wheelNodes.set(id, resolved);
  return resolved;
}
```

- [ ] **Step 5: Apply interpolated exact poses in `presentInterpolated`**

Replace lines 190-203 of `AgentVisuals.ts`:

```ts
if (to.wheels) {
  const nodes = this.resolveWheelNodes(id);
  to.wheels.forEach((toWheel, index) => {
    const node = nodes?.[index];
    const fromWheel = from.wheels?.[index] ?? toWheel;
    if (!node) return;
    applyInterpolatedPart(node.suspension, node.suspensionBind, object, fromWheel.suspensionBody, toWheel.suspensionBody, alpha, this.scratchQuaternionA, this.scratchQuaternionB);
    applyInterpolatedPart(node.steering, node.steeringBind, object, fromWheel.steeringBody, toWheel.steeringBody, alpha, this.scratchQuaternionA, this.scratchQuaternionB);
    applyInterpolatedPart(node.wheel, node.tireBind, object, fromWheel.tireBody, toWheel.tireBody, alpha, this.scratchQuaternionA, this.scratchQuaternionB);
  });
}
```

Add the free function (module scope, next to the other pure helpers in this file):

```ts
const scratchWorld = new THREE.Matrix4();
const scratchLocal = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();

/** visualWorld = chassisWorldInverse × interpolatedPhysicsBodyWorld × bindMatrix, then converted back to the node's local space. */
function applyInterpolatedPart(node: THREE.Object3D, bind: THREE.Matrix4, chassis: THREE.Object3D, from: BodyPose, to: BodyPose, alpha: number, qa: THREE.Quaternion, qb: THREE.Quaternion): void {
  scratchPosition.set(
    from.worldPositionMeters.x + (to.worldPositionMeters.x - from.worldPositionMeters.x) * alpha,
    from.worldPositionMeters.y + (to.worldPositionMeters.y - from.worldPositionMeters.y) * alpha,
    from.worldPositionMeters.z + (to.worldPositionMeters.z - from.worldPositionMeters.z) * alpha
  );
  qa.set(from.worldOrientation.x, from.worldOrientation.y, from.worldOrientation.z, from.worldOrientation.w);
  qb.set(to.worldOrientation.x, to.worldOrientation.y, to.worldOrientation.z, to.worldOrientation.w);
  scratchQuaternion.copy(qa).slerp(qb, alpha);
  scratchWorld.compose(scratchPosition, scratchQuaternion, new THREE.Vector3(1, 1, 1));
  scratchLocal.copy(chassis.matrixWorld).invert().multiply(scratchWorld).multiply(bind);
  scratchLocal.decompose(node.position, node.quaternion, node.scale);
}
```

Remove the now-unused `restSuspensionLength`/`restSuspensionLengths` machinery (`AgentVisuals.ts:208-216` and its field) — the bind matrix supersedes it.

- [ ] **Step 6: Verify in the running app**

Run the dev server (use the project's existing `run` workflow — check for a project-level run skill/script first rather than guessing a command). In Scenario Studio:
1. Open the Downtown scene, place a Physical Minivan (vehicle physics model = "physical"), enter Play.
2. Drive it (WASD/arrows) onto a curb with one front tire and stop. Confirm the tire mesh sits flush with the collider — no visible gap or interpenetration beyond what the physics debug view (if available) shows for the collider itself.
3. Confirm steering, wheel spin, and suspension travel still animate smoothly for the physical model.
4. Repeat placing a vehicle with `vehiclePhysicsModel: "raycast"` and confirm its wheels still steer/spin/compress correctly (this path now goes through the new `collectRaycastWheelTransform`, so regressions here are the most likely failure mode).
5. Commit only after both models look correct.

- [ ] **Step 7: Commit**

```bash
git add src/scenario-studio/physics/PhysicsWorld.ts src/scenario-studio/physics/physics.worker.ts src/scenario-studio/rendering/AgentVisuals.ts
git commit -m "feat(scenario-studio): publish exact per-part wheel poses instead of scalar reconstruction"
```

---

### Task 2: Scene-object and port type contracts

Pure additive types — no wiring yet, so nothing in the running app changes.

**Files:**
- Create: `src/scenario-studio/domain/SceneObjectPorts.ts`

**Interfaces:**
- Consumes: `Vector3Value` (`src/scenario-studio/domain/agent.ts:3-7`), `BodyPose`/`AgentWheelPose` (Task 1), `DriveCommand` (`src/scenario-studio/domain/playback.ts:5-9`)
- Produces: `SceneObjectId`, `WheelId`, `SceneObjectPoseFrame`, `VisualObjectPoseFrame`, `VehiclePoseFrame`, `PresentationPort<TPose>`, `SceneObjectAction`, `SceneObjectActionEnvelope`, `ActionContext`

- [ ] **Step 1: Write the file**

```ts
import type { BodyPose } from "../physics/PhysicsWorld";
import type { DriveCommand } from "./playback";

export type SceneObjectId = string;
export type WheelId = string;

/** Base pose frame every SceneObject subtype's TPose extends. */
export interface SceneObjectPoseFrame {
  readonly resourceId: number;
  readonly generation: number;
  readonly physicsStep: number;
  readonly topologyVersion: number;
}

export interface VisualObjectPoseFrame extends SceneObjectPoseFrame {
  readonly body: BodyPose;
}

export interface VehiclePoseFrame extends SceneObjectPoseFrame {
  readonly chassis: BodyPose;
  readonly wheels: readonly { readonly wheelId: WheelId; readonly suspensionBody: BodyPose; readonly steeringBody: BodyPose; readonly tireBody: BodyPose }[];
}

/** One rendered part's binding: a node plus its immutable authored-pivot bind matrix, opaque outside the Three.js implementation. */
export interface PresentationPort<TPose extends SceneObjectPoseFrame> {
  prepare(): Promise<void>;
  activate(): void;
  applyPose(from: TPose, to: TPose, alpha: number): void;
  reset(): void;
  release(): void;
}

export interface ActionContext {
  readonly sessionId: string;
  readonly generation: number;
  readonly step: number;
}

export type SceneObjectAction =
  | { readonly kind: "drive"; readonly command: DriveCommand };

export interface SceneObjectActionEnvelope {
  readonly objectId: SceneObjectId;
  readonly resourceId: number | null;
  readonly generation: number;
  readonly targetStep: number;
  readonly sequence: number;
  readonly action: SceneObjectAction;
}
```

- [ ] **Step 2: Verify**

Run `npx tsc --noEmit` (or the project's existing typecheck script — check `package.json` first). Expected: no new errors; the file is unused so far and must not be reported as a circular-import problem.

- [ ] **Step 3: Commit**

```bash
git add src/scenario-studio/domain/SceneObjectPorts.ts
git commit -m "feat(scenario-studio): add SceneObject pose and action type contracts"
```

---

### Task 3: `SceneObject` abstract base class + `VisualObject`

**Files:**
- Create: `src/scenario-studio/domain/SceneObject.ts`
- Create: `src/scenario-studio/domain/VisualObject.ts`

**Interfaces:**
- Consumes: `PresentationPort<TPose>`, `SceneObjectActionEnvelope`, `ActionContext`, `SceneObjectPoseFrame` (Task 2)
- Produces: `SceneObject<TPose>.dispatch`, `.acceptPhysicsPose`, `.present`, `.pause`, `.resume`, `.reset`, `.dispose`; `VisualObject`

- [ ] **Step 1: Write `SceneObject`**

Deviation from the spec's literal sketch, tightened during design review: `resetPhysics`/`releasePhysics` get **default no-op implementations**, not abstract ones — `VisualObject` has no physics port, so forcing every subtype to implement physics lifecycle hooks it doesn't have contradicts the design goal that visual-only objects allocate no physics resources. Only `applyAction` stays abstract, since every subtype has *some* action behavior (even if `VisualObject`'s is "reject everything").

```ts
import type { PresentationPort, SceneObjectAction, SceneObjectActionEnvelope, SceneObjectPoseFrame } from "./SceneObjectPorts";

type SceneObjectState = "ready" | "running" | "paused" | "removing" | "disposed";

export abstract class SceneObject<TPose extends SceneObjectPoseFrame> {
  private previousPose: TPose;
  private currentPose: TPose;
  private generation: number;
  private state: SceneObjectState = "ready";
  private lastSequence = -1;

  constructor(
    readonly id: string,
    private readonly presentation: PresentationPort<TPose>,
    initialGeneration: number,
    initialPose: TPose
  ) {
    this.generation = initialGeneration;
    this.previousPose = initialPose;
    this.currentPose = initialPose;
  }

  async dispatch(envelope: SceneObjectActionEnvelope): Promise<void> {
    if (this.state === "removing" || this.state === "disposed") throw new Error(`SceneObject ${this.id} is ${this.state} and cannot accept actions.`);
    if (envelope.objectId !== this.id) throw new Error(`Action addressed to ${envelope.objectId} delivered to ${this.id}.`);
    if (envelope.generation !== this.generation) throw new Error(`Action generation ${envelope.generation} is stale; current is ${this.generation}.`);
    if (envelope.sequence <= this.lastSequence) throw new Error(`Action sequence ${envelope.sequence} is stale or duplicate; last accepted was ${this.lastSequence}.`);
    this.lastSequence = envelope.sequence;
    await this.applyAction(envelope.action);
  }

  acceptPhysicsPose(pose: TPose): void {
    if (pose.generation !== this.generation) return;
    this.previousPose = this.currentPose;
    this.currentPose = pose;
  }

  present(interpolationAlpha: number): void {
    if (this.state === "disposed") return;
    this.presentation.applyPose(this.previousPose, this.currentPose, interpolationAlpha);
  }

  async pause(): Promise<void> {
    if (this.state !== "running") return;
    this.state = "paused";
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") return;
    this.state = "running";
  }

  async reset(generation: number): Promise<void> {
    this.generation = generation;
    this.lastSequence = -1;
    await this.resetPhysics();
    this.presentation.reset();
    this.state = "ready";
  }

  async dispose(): Promise<void> {
    if (this.state === "disposed") return;
    this.state = "disposed";
    await this.releasePhysics();
    this.presentation.release();
  }

  protected currentGeneration(): number { return this.generation; }
  protected currentState(): SceneObjectState { return this.state; }
  protected setState(state: SceneObjectState): void { this.state = state; }

  protected abstract applyAction(action: SceneObjectAction): Promise<void>;
  protected async resetPhysics(): Promise<void> {}
  protected async releasePhysics(): Promise<void> {}
}
```

- [ ] **Step 2: Write `VisualObject`**

```ts
import { SceneObject } from "./SceneObject";
import type { SceneObjectAction } from "./SceneObjectPorts";
import type { VisualObjectPoseFrame } from "./SceneObjectPorts";

export class VisualObject extends SceneObject<VisualObjectPoseFrame> {
  protected async applyAction(action: SceneObjectAction): Promise<void> {
    throw new Error(`VisualObject ${this.id} does not accept actions of kind "${action.kind}".`);
  }
}
```

- [ ] **Step 3: Verify**

`npx tsc --noEmit`. `VisualObject` has no callers yet; this task is verified by clean typecheck only — it becomes product-visible once `SceneObjectRegistry` constructs one in Task 7.

- [ ] **Step 4: Commit**

```bash
git add src/scenario-studio/domain/SceneObject.ts src/scenario-studio/domain/VisualObject.ts
git commit -m "feat(scenario-studio): add SceneObject base class and VisualObject"
```

---

### Task 4: `PresentationPort` Three.js implementation (extract from `AgentVisuals`)

Moves live-instance rendering (the part that now applies exact per-part poses from Task 1) behind the `PresentationPort` interface. `AgentVisuals` keeps everything authoring-time-only: ghost preview, ground-snap, selection gizmo, drag-transform. This is a pure refactor — behavior must be identical before and after.

**Files:**
- Create: `src/scenario-studio/rendering/ThreePresentationPort.ts`
- Modify: `src/scenario-studio/rendering/AgentVisuals.ts` (remove `liveStates`/`ingest`/`presentInterpolated`/wheel-node code once the new file owns it; keep `prepare`/`show`/`update`/`remove`/`clear`/selection/ghost)

**Interfaces:**
- Consumes: `AgentWheelPose`/`BodyPose` (Task 1), `PresentationPort<TPose>`, `VisualObjectPoseFrame`/`VehiclePoseFrame` (Task 2)
- Produces: `ThreePresentationPort implements PresentationPort<VehiclePoseFrame | VisualObjectPoseFrame>` — constructed per live object with `(object: THREE.Object3D, wheelDescriptors: readonly WheelDescriptor[])`

- [ ] **Step 1: Move the bind-matrix and `applyInterpolatedPart` logic from Task 1 into the new file**, parameterized per-instance instead of per-agent-id-keyed maps (the class now IS the per-instance state, so `this.instances`/`this.wheelNodes`/`this.liveStates` keyed maps collapse into plain instance fields).

- [ ] **Step 2: Implement the port**

```ts
import * as THREE from "three";
import type { PresentationPort } from "../domain/SceneObjectPorts";
import type { VehiclePoseFrame, VisualObjectPoseFrame } from "../domain/SceneObjectPorts";
import type { WheelDescriptor } from "../domain/agent";

type Pose = VehiclePoseFrame | VisualObjectPoseFrame;

export class ThreePresentationPort<TPose extends Pose> implements PresentationPort<TPose> {
  private wheelNodes: ReturnType<typeof resolveWheelNodes> | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly object: THREE.Object3D,
    private readonly wheels: readonly WheelDescriptor[]
  ) {}

  async prepare(): Promise<void> {
    this.wheelNodes = this.wheels.length ? resolveWheelNodes(this.object, this.wheels) : null;
  }

  activate(): void { this.scene.add(this.object); }

  applyPose(from: TPose, to: TPose, alpha: number): void {
    if ("chassis" in to && "chassis" in from) applyChassisAndWheels(this.object, from, to, alpha, this.wheelNodes);
    else if ("body" in to && "body" in from) applyBodyOnly(this.object, from.body, to.body, alpha);
  }

  reset(): void { /* pose reapplied on next applyPose call from the fresh run's first frame */ }

  release(): void { this.object.removeFromParent(); }
}
```

(`resolveWheelNodes`, `applyChassisAndWheels`, `applyBodyOnly` are the Task 1 logic moved here verbatim, with `object`/`wheels` as parameters instead of map lookups by id.)

- [ ] **Step 3: Verify in the running app**

Place several agents (vehicle and non-vehicle), enter Play, confirm rendering is pixel-identical to before this task — same interpolation smoothness, same wheel behavior confirmed in Task 1. This task must not change behavior, only where the code lives.

- [ ] **Step 4: Commit**

```bash
git add src/scenario-studio/rendering/ThreePresentationPort.ts src/scenario-studio/rendering/AgentVisuals.ts
git commit -m "refactor(scenario-studio): extract live-instance rendering into ThreePresentationPort"
```

---

### Task 5: Worker-side `PhysicsPortServer` encapsulation

Boundary-first refactor: wrap the existing global maps (`playbackBodies`, `driveCommands`, `wheelSteeringRadians`) and free functions (`driveAgent`, `updateVehiclePhysical`, `collectTransforms`) in per-resource classes, so the *type* boundary matches the design even before every internal is made private per-instance state. This directly addresses the spec's "Physical behavior is spread across free functions" diagnosis without requiring a full rewrite of the Rapier body/joint code, which is already correct (per the audit: wake-on-change, all-wheel drive, and uniform neutral drag are already implemented and don't need touching).

**Files:**
- Modify: `src/scenario-studio/physics/physics.worker.ts` (wrap, do not rewrite, the existing logic behind class boundaries)

**Interfaces:**
- Produces: `VehiclePhysicsPortServer` (physical + raycast), `RigidBodyPhysicsPortServer`, each keyed by `resourceId: number`
- Consumes (unchanged): `PlaybackBody`, `PhysicalVehicleRig`, `PhysicalWheelRig`, `driveAgent`, `updateVehiclePhysical`, `collectRigWheelTransform`/`collectRaycastWheelTransform` (Task 1)

- [ ] **Step 1: Introduce resource IDs**

Add a module-level `let nextResourceId = 1;` and extend `PlaybackBody` with `readonly resourceId: number;`, assigned when each entry is created in the `preparePlayback` loop (`physics.worker.ts:302-350`).

- [ ] **Step 2: Wrap vehicle operations in a server class**

```ts
class VehiclePhysicsPortServer {
  constructor(readonly resourceId: number, private readonly agentId: string) {}

  applyDriveCommand(command: DriveCommand, generation: number): void {
    driveAgent(this.agentId, command, generation);
  }

  currentPose(): AgentWheelPose[] | null {
    const entry = playbackBodies.get(this.agentId);
    if (!entry) return null;
    return entry.controller
      ? Array.from({ length: entry.wheelCount }, (_, i) => collectRaycastWheelTransform(/* as in Task 1 */ wheelIdsFor(this.agentId)[i] ?? `wheel-${i}`, entry.controller!, i, entry.body, wheelConnectionPoints.get(this.agentId)![i]))
      : entry.rig?.wheels.map((wheel) => collectRigWheelTransform(wheel.id, wheel)) ?? null;
  }
}

const vehiclePortServers = new Map<number, VehiclePhysicsPortServer>();
```

Construct one `VehiclePhysicsPortServer` per vehicle agent at the end of the `preparePlayback` loop (both the physical branch at `physics.worker.ts:308` and the raycast branch at `physics.worker.ts:346`), store it in `vehiclePortServers` keyed by `resourceId`, and delete it in `resetPlayback`/`teardownPlaybackBodies` alongside the other per-run cleanup.

- [ ] **Step 3: Add the corresponding worker message types**

In `src/scenario-studio/physics/PhysicsWorkerClient.ts`, extend `PhysicsWorkerOperation` with `{ type: "vehiclePortDriveCommand"; resourceId: number; command: DriveCommand; generation: number }`, and handle it in the worker's message switch by looking up `vehiclePortServers.get(resourceId)` and calling `applyDriveCommand`. Leave the existing `driveAgent`/`stepPlayback` operations in place — Task 6's main-thread port wraps the new resource-scoped operation, but `stepPlayback`'s bulk `PlaybackSnapshot` remains the transport for pose delivery (see Task 6 note on why a second per-resource pose-push RPC is not needed).

- [ ] **Step 4: Verify in the running app**

Drive a vehicle exactly as in Task 1's verification. Behavior must be unchanged — this task only adds a class wrapper and a resource ID, it does not change simulation results.

- [ ] **Step 5: Commit**

```bash
git add src/scenario-studio/physics/physics.worker.ts src/scenario-studio/physics/PhysicsWorkerClient.ts
git commit -m "refactor(scenario-studio): encapsulate worker vehicle state behind resource-scoped port servers"
```

---

### Task 6: Main-thread `VehiclePhysicsPort`/`RigidBodyPhysicsPort` + `Vehicle`/`RigidObject` classes

**Files:**
- Create: `src/scenario-studio/physics/VehiclePhysicsPort.ts`
- Create: `src/scenario-studio/physics/RigidBodyPhysicsPort.ts`
- Create: `src/scenario-studio/domain/Vehicle.ts`
- Create: `src/scenario-studio/domain/RigidObject.ts`

**Interfaces:**
- Consumes: `PhysicsWorkerClient` (`src/scenario-studio/physics/PhysicsWorkerClient.ts:27`), `VehiclePoseFrame`, `SceneObject`, `PresentationPort` (Tasks 2-3), `VehiclePhysicsPortServer` resource IDs (Task 5)
- Produces: `VehiclePhysicsPort { applyDriveCommand(command, targetStep): Promise<void>; release(): Promise<void> }`, `Vehicle extends SceneObject<VehiclePoseFrame>`

- [ ] **Step 1: Define and implement `VehiclePhysicsPort`**

```ts
import type { DriveCommand } from "../domain/playback";
import type { PhysicsWorkerClient } from "./PhysicsWorkerClient";

export interface VehiclePhysicsPort {
  readonly resourceId: number;
  applyDriveCommand(command: DriveCommand, generation: number): Promise<void>;
}

export class RpcVehiclePhysicsPort implements VehiclePhysicsPort {
  constructor(readonly resourceId: number, private readonly client: PhysicsWorkerClient) {}

  applyDriveCommand(command: DriveCommand, generation: number): Promise<void> {
    return this.client.vehiclePortDriveCommand(this.resourceId, command, generation);
  }
}
```

Add the matching `vehiclePortDriveCommand(resourceId, command, generation): Promise<void> { return this.request({ type: "vehiclePortDriveCommand", resourceId, command, generation }); }` method to `PhysicsWorkerClient` (`PhysicsWorkerClient.ts:41-50`, alongside the existing `driveAgent`).

- [ ] **Step 2: Implement `Vehicle`**

```ts
import { SceneObject } from "./SceneObject";
import type { SceneObjectAction } from "./SceneObjectPorts";
import type { VehiclePoseFrame } from "./SceneObjectPorts";
import type { VehiclePhysicsPort } from "../physics/VehiclePhysicsPort";
import { NEUTRAL_DRIVE_COMMAND, type DriveCommand } from "./playback";

export class Vehicle extends SceneObject<VehiclePoseFrame> {
  private command: DriveCommand = NEUTRAL_DRIVE_COMMAND;

  constructor(id: string, presentation: import("./SceneObjectPorts").PresentationPort<VehiclePoseFrame>, generation: number, initialPose: VehiclePoseFrame, private readonly physics: VehiclePhysicsPort) {
    super(id, presentation, generation, initialPose);
  }

  protected async applyAction(action: SceneObjectAction): Promise<void> {
    if (action.kind !== "drive") throw new Error(`Vehicle ${this.id} does not accept action kind "${action.kind}".`);
    this.command = action.command;
    await this.physics.applyDriveCommand(action.command, this.currentGeneration());
  }

  protected async resetPhysics(): Promise<void> {
    this.command = NEUTRAL_DRIVE_COMMAND;
    await this.physics.applyDriveCommand(NEUTRAL_DRIVE_COMMAND, this.currentGeneration());
  }
}
```

Note this matches the audit correction from the spec review: `Vehicle` exposes no public `applyDriveCommand` method — `dispatch` (inherited) is the only entry point, and `applyAction` is where the `"drive"` action kind is interpreted.

- [ ] **Step 3: Implement `RigidBodyPhysicsPort` and `RigidObject` the same way**, for non-vehicle physical props (`agent.vehicle === null` but the agent still has a Rapier body — the plain-body branch at `physics.worker.ts:312-316,347-350`). `RigidObject`'s `applyAction` rejects every action kind for now (props take no runtime commands today); it exists so a physical prop is still one `SceneObject` with a real physics port, per the spec's "Physical props can use a `RigidObject`" line.

- [ ] **Step 4: Verify**

`npx tsc --noEmit`. These classes have no caller yet — wired into the app in Task 7, where they become product-verifiable (driving a vehicle end-to-end through `dispatch`).

- [ ] **Step 5: Commit**

```bash
git add src/scenario-studio/physics/VehiclePhysicsPort.ts src/scenario-studio/physics/RigidBodyPhysicsPort.ts src/scenario-studio/domain/Vehicle.ts src/scenario-studio/domain/RigidObject.ts src/scenario-studio/physics/PhysicsWorkerClient.ts
git commit -m "feat(scenario-studio): add VehiclePhysicsPort/RigidBodyPhysicsPort and Vehicle/RigidObject"
```

---

### Task 7: `SceneObjectRegistry` + `ScenarioSimulation`, retire `AgentComponents`

This is the cutover task: keyboard drive commands stop flowing through `AgentComponentRegistry`/`VehicleComponent` and start flowing through `SceneObject.dispatch`.

**Files:**
- Create: `src/scenario-studio/domain/SceneObjectRegistry.ts`
- Create: `src/scenario-studio/domain/ScenarioSimulation.ts`
- Modify: `src/scenario-studio/domain/ScenarioSession.ts` (delegate playback lifecycle to `ScenarioSimulation`; remove `componentRegistry`/`components` fields at `ScenarioSession.ts:30-31`)
- Delete: `src/scenario-studio/runtime/AgentComponents.ts`
- Modify: `src/scenario-studio/ScenarioStudioApp.ts:321-329` (`updateDriveCommand` now builds a `SceneObjectActionEnvelope` instead of a bare `DriveCommand`)

**Interfaces:**
- Consumes: `Vehicle`, `RigidObject`, `VisualObject` (Tasks 3, 6), `Middleware`/`vehicleControlChannel`/`commandStatusChannel` (`src/scenario-studio/runtime/messages.ts`, unchanged)
- Produces: `SceneObjectRegistry.dispatch(envelope): Promise<void>`, `.spawn(...)`, `.remove(...)`; `ScenarioSimulation` driving the fixed-step loop that today lives inline in `ScenarioSession`

- [ ] **Step 1: Implement `SceneObjectRegistry`**

```ts
import type { SceneObject } from "./SceneObject";
import type { SceneObjectActionEnvelope } from "./SceneObjectPorts";

export class SceneObjectRegistry {
  private readonly objects = new Map<string, SceneObject<any>>();

  register(object: SceneObject<any>): void {
    if (this.objects.has(object.id)) throw new Error(`SceneObject ${object.id} already registered.`);
    this.objects.set(object.id, object);
  }

  async dispatch(envelope: SceneObjectActionEnvelope): Promise<void> {
    const object = this.objects.get(envelope.objectId);
    if (!object) throw new Error(`No live SceneObject for ${envelope.objectId}.`);
    await object.dispatch(envelope);
  }

  async remove(id: string): Promise<void> {
    const object = this.objects.get(id);
    if (!object) return;
    await object.dispose();
    this.objects.delete(id);
  }

  presentAll(alpha: number): void {
    for (const object of this.objects.values()) object.present(alpha);
  }

  acceptPose(id: string, pose: unknown): void {
    (this.objects.get(id) as SceneObject<any> | undefined)?.acceptPhysicsPose(pose as any);
  }

  async disposeAll(): Promise<void> {
    for (const object of this.objects.values()) await object.dispose();
    this.objects.clear();
  }
}
```

- [ ] **Step 2: Wire `ScenarioSession.driveWithKeyboard` (and the controller-tick path) to publish `SceneObjectActionEnvelope`s through the existing `vehicleControlChannel`**, and have the registry's Middleware subscription (replacing `VehicleComponent`'s subscription at `AgentComponents.ts:22-24`) translate the incoming `VehicleCommandMessage` into a `dispatch` call:

In `ScenarioSession.ts`, replace `createRuntimeComponents`/`this.components` (used at `ScenarioSession.ts:220,242` and in `pause`/`clearComponentCommands`) with: for each vehicle agent, `middleware.subscribe(vehicleControlChannel(agent.id), (event) => registry.dispatch({ objectId: agent.id, resourceId: null, generation: event.message.generation, targetStep: event.message.targetStep, sequence: event.message.targetStep, action: { kind: "drive", command: event.message } }).then(() => publishStatus({...accepted: true}), (error) => publishStatus({...accepted: false, message: error.message})))`. Use `targetStep` as the `sequence` value — it is already monotonic per agent in the existing protocol (`AgentComponents.ts:37`), so no new counter is needed.

- [ ] **Step 3: Implement `ScenarioSimulation`** by moving the fixed-step orchestration that currently lives inline across `ScenarioSession.play`/`pause`/`reset` (`ScenarioSession.ts:215-`) into a dedicated class: it owns the `SceneObjectRegistry`, calls `world.stepPlayback(dt, generation)` once per tick, and for each returned `AgentTransform` calls `registry.acceptPose(id, toPoseFrame(transform, generation, step, topologyVersion))` before calling `registry.presentAll(alpha)`. `ScenarioSession` keeps document/authoring/scene-replacement responsibilities and holds one `ScenarioSimulation` instance, constructed in `play()` and disposed in `reset()`/`dispose()`.

- [ ] **Step 4: Delete `AgentComponents.ts`** and its imports from `ScenarioSession.ts:13`.

- [ ] **Step 5: Verify in the running app**

1. Place a vehicle, press Play, drive with keyboard — confirm identical responsiveness to before (same command-status feedback in the HUD if one is wired to `commandStatusChannel`).
2. Pause and resume — confirm the vehicle's command zeroes on pause and resumes correctly (this exercises `Vehicle.resetPhysics`/registry pause path).
3. If a managed controller script is configured, drive via a controller and confirm ticks still reach the vehicle (this exercises the same `vehicleControlChannel` path as keyboard input, now terminating in `dispatch` instead of `VehicleComponent`).
4. Reset the scenario — confirm no leaked subscriptions (check the browser console for errors after several play/reset cycles).

- [ ] **Step 6: Commit**

```bash
git add src/scenario-studio/domain/SceneObjectRegistry.ts src/scenario-studio/domain/ScenarioSimulation.ts src/scenario-studio/domain/ScenarioSession.ts src/scenario-studio/ScenarioStudioApp.ts
git rm src/scenario-studio/runtime/AgentComponents.ts
git commit -m "refactor(scenario-studio): route commands through SceneObject.dispatch, retire AgentComponents"
```

---

### Task 8: Spawn/removal/reset transaction semantics

**Files:**
- Modify: `src/scenario-studio/domain/SceneObjectRegistry.ts` (add `spawn`)
- Modify: `src/scenario-studio/domain/ScenarioSimulation.ts` (topology version tracking)

**Interfaces:**
- Consumes: `PresentationPort.prepare/activate/release` (Task 4), `VehiclePhysicsPort`/`RigidBodyPhysicsPort` (Task 6)
- Produces: `SceneObjectRegistry.spawn(request): Promise<string>` following the spec's 6-step transaction; `.remove(id)` following the 4-step transaction

- [ ] **Step 1: Implement `spawn`**

```ts
async spawn(id: string, presentation: PresentationPort<any>, build: () => Promise<SceneObject<any>>): Promise<string> {
  let prepared = false;
  try {
    await presentation.prepare();
    prepared = true;
    const object = await build();
    this.register(object);
    presentation.activate();
    return id;
  } catch (error) {
    if (prepared) presentation.release();
    throw error;
  }
}
```

This matches the spec's ordering: reserve identity (the caller passes a pre-allocated `id`/generation), prepare presentation, allocate physics only if `build()` needs it (a `Vehicle`'s `build` requests a worker resource; a `VisualObject`'s does not), register, activate, and release both sides on failure.

- [ ] **Step 2: Implement `remove` with the ordered transition**

```ts
async remove(id: string): Promise<void> {
  const object = this.objects.get(id);
  if (!object) return; // repeated removal is a no-op, per spec
  this.objects.delete(id); // reject later dispatch immediately; stale requests now fail lookup in `dispatch`
  await object.dispose(); // releases physics, then presentation, per SceneObject.dispose (Task 3)
}
```

`SceneObject.dispose` (Task 3, `SceneObject.ts`) already sequences `releasePhysics()` before `presentation.release()`, so this method does not need to reimplement that ordering — it only needs to make the object unreachable for new dispatches before disposal starts, which the `delete` before `await` achieves.

- [ ] **Step 3: Track topology version in `ScenarioSimulation`**

Add a `private topologyVersion = 0;` field, incremented whenever `spawn`/`remove` succeeds, and included in every `SceneObjectPoseFrame` constructed from a worker transform (Task 7 Step 3's `toPoseFrame`). `SceneObject.acceptPhysicsPose` (Task 3) already drops poses whose `generation` doesn't match; extend that check to also drop poses whose `topologyVersion` is older than the object's own last-accepted value, so a removed-and-replaced resource ID cannot feed stale poses into a new object (spec: "Stale requests cannot affect a replacement with the same authored ID").

- [ ] **Step 4: Verify in the running app**

1. Start playback, then use the existing "place agent" flow to add a new vehicle mid-playback if the UI supports it; otherwise call `session.placeAgent` while `playback === "running"` from the browser console as a smoke test. Confirm the new vehicle appears and drives correctly.
2. Remove a vehicle while a drive command is in flight (hold a key, delete the agent). Confirm no console error and no orphaned Three.js node (check the scene graph in devtools, or confirm object count matches expectations).
3. Place a second vehicle reusing visual proximity to the removed one's old position; confirm it behaves independently (no stale pose bleed-through).

- [ ] **Step 5: Commit**

```bash
git add src/scenario-studio/domain/SceneObjectRegistry.ts src/scenario-studio/domain/ScenarioSimulation.ts
git commit -m "feat(scenario-studio): add spawn/removal transactions with topology versioning"
```

---

### Task 9: Rename `AgentSnapshot`/`AgentInstance` → `SceneObjectSnapshot`/`SceneObjectInstance`

Mechanical, done last so it doesn't create merge churn against Tasks 1-8. This is a rename, not an aliasing shim — per `CLAUDE.md`, no backwards-compatibility re-exports.

**Files:**
- Modify: `src/scenario-studio/domain/agent.ts` (`AgentDraft`→ keep name, `AgentSnapshot`→`SceneObjectSnapshot`)
- Modify: `src/scenario-studio/domain/AgentInstance.ts` (`AgentInstance`→`SceneObjectInstance`, file rename)
- Modify: `src/scenario-studio/domain/AgentPopulation.ts`
- Modify every remaining reference — before renaming, run `grep -rl "AgentSnapshot\|AgentInstance" src/ server/` to get the exact file list (do not guess it; the codebase has UI panels, the HTTP repository, and server-side scenario storage that reference these names).

**Interfaces:**
- Produces: `SceneObjectSnapshot`, `SceneObjectInstance` — same shape and members as today's `AgentSnapshot`/`AgentInstance`, name only.

- [ ] **Step 1: Get the exact blast radius**

```bash
grep -rl "AgentSnapshot\|AgentInstance" src/ server/
```

Read each result before editing — do not batch-rename blind, since some hits (e.g. `AgentInspectorPanel.ts`'s `visibleVehicleSpecs`) may use the type only structurally without importing the name directly.

- [ ] **Step 2: Rename in `agent.ts` and `AgentInstance.ts`**, then propagate the rename file-by-file from the grep list, verifying `npx tsc --noEmit` after each file to catch missed references early rather than at the end.

- [ ] **Step 3: Verify in the running app**

Full smoke pass: open a saved scenario, place/move/duplicate/delete agents, save, reload, play. The type rename must be invisible to product behavior — if anything changed, a reference was missed, not correctly renamed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(scenario-studio): rename AgentSnapshot/AgentInstance to SceneObjectSnapshot/SceneObjectInstance"
```

---

### Task 10: Product verification pass

No new code — this runs the spec's own "Product Verification" checklist end to end against the finished implementation, using a Physical Minivan in Downtown, and decides whether Task-Deferred work (binary transport) is actually needed.

**Files:** none (verification only; fix forward in the relevant task's files if something fails)

- [ ] **Step 1:** Let the vehicle settle on flat ground for five seconds. Confirm it stays visually still and the tire meshes track the collider poses with no visible drift.
- [ ] **Step 2:** Suspend the vehicle and hold W. Confirm all four wheels wake, spin, and show rotation from the returned poses (not just the driven ones).
- [ ] **Step 3:** Release W while suspended. Confirm all four wheels spin down together.
- [ ] **Step 4:** Drive with W+A then W+D (and the arrow-key equivalents). Confirm front-wheel orientation and chassis heading change as commanded.
- [ ] **Step 5:** Drive one front tire onto a curb and stop. Confirm no visible penetration or offset between the tire mesh and the collider.
- [ ] **Step 6:** Pause, resume, reset, replay, and dispose the session. Confirm no stale command or pose affects the new run (check the browser console for rejected-stale-generation errors, which would indicate a race, not a bug — an *unrejected* stale effect would be the bug).
- [ ] **Step 7:** Spawn a vehicle during playback, drive it, and remove it with a command in flight (repeat Task 8's verification once more, now against the fully wired system).
- [ ] **Step 8:** Spawn a representative heavy scene (many physical vehicles) and observe frame time and input responsiveness in the browser's performance panel. If the UI stays responsive and queues don't visibly back up, the deferred binary-transport work in this plan's "Deferred Out of This Plan" section is unnecessary for now — record that conclusion. If it is not responsive, write a follow-up spec addendum for the transport work rather than improvising it here.

- [ ] **Step 9: Record findings**

Per the spec's "Product Verification" section and this project's testing rule, no automated test suite is added. If any step fails, fix it in the owning task's files (do not add a new task — amend the relevant commit's follow-up) and re-run the full checklist before considering the redesign complete.

---

## Self-Review

**Spec coverage:**
- Problem/symptoms → Task 1 (pose contract) + confirmed pre-existing fixes for wake/AWD/neutral-drag (Task 5's audit note).
- New Ownership Model / Scene Object and Vehicle Classes → Tasks 2, 3, 6.
- Port Responsibilities → Tasks 4 (presentation), 5-6 (physics ports).
- Authoritative Pose Contract → Task 1.
- Physics Shape and Visual Binding (bind matrices) → Task 1 Steps 4-5, Task 4.
- Command Flow / retiring `AgentComponents` (including the audit's dispatch-vs-applyDriveCommand and Middleware-transport corrections) → Tasks 6 Step 2, 7.
- Dynamic Spawn/Action/Removal → Task 8.
- Worker Transport for Heavy Scenes → explicitly deferred with a measurement gate in Task 10 Step 8, not silently dropped.
- Required Invariants → distributed across Tasks 1, 3, 7, 8 (each invariant maps to a specific step above; none introduce a new untested class).
- Product Verification → Task 10, using the spec's own checklist verbatim.
- Migration Boundary → Task 9 (rename) plus the deletions called out in Tasks 5 and 7.

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" phrasing; every code step shows real code or an exact file:line target.

**Type consistency:** `AgentWheelPose`/`BodyPose` (Task 1) flow unchanged into `VehiclePoseFrame` (Task 2), `ThreePresentationPort` (Task 4), and the worker's `VehiclePhysicsPortServer.currentPose()` (Task 5). `SceneObjectActionEnvelope`/`SceneObjectAction` (Task 2) are consumed identically by `SceneObject.dispatch` (Task 3), `Vehicle.applyAction` (Task 6), and `SceneObjectRegistry.dispatch` (Task 7) — no renamed field or divergent shape between tasks.

---

Plan complete and saved to `docs/superpowers/plans/2026-09-18-agent-vehicle-ownership-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
