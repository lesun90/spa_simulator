# Agent/Vehicle Ownership Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Scenario Studio's split vehicle ownership (worker free functions + global maps + a scalar wheel-pose contract + a separate main-thread component/middleware layer) with one authoritative main-thread `SceneObject`/`Vehicle` aggregate per live entity, backed by exact per-part Rapier poses.

**Architecture:** Introduce a `SceneObject` domain hierarchy (`VisualObject`, `RigidObject`, `Vehicle`) on the main thread, each owning a `PresentationPort` and, where needed, a physics port. The physics worker keeps Rapier resources behind per-resource `PhysicsPortServer` objects instead of global maps and free functions. The wire contract between them becomes complete `BodyPose`s per rendered part instead of three reconstructed scalars. `AgentComponentRegistry`/`AgentComponent`/`VehicleComponent` are retired; `Middleware` channels remain the transport into the new `SceneObject.dispatch`.

**Tech Stack:** TypeScript, Three.js (main thread), Rapier3D (`@dimforge/rapier3d`, physics worker), the project's existing Web Worker + structured-clone RPC (`PhysicsWorkerClient`/`physics.worker.ts`), the existing `Middleware` pub-sub (`src/scenario-studio/runtime/Middleware.ts`).

**Spec:** `docs/superpowers/specs/2026-09-18-agent-vehicle-ownership-design.md`

## Global Constraints

- No unit tests unless explicitly requested. Verify by running the app (`CLAUDE.md`).
- **Sequencing policy (revised for speed): only the final result has to work.** Every task's commit must still typecheck (`npx tsc --noEmit` clean), but intermediate tasks are not required to leave Scenario Studio's playback rendering fully correct or even functional in the browser — that is only required starting at Task 4 (first full wiring) and confirmed at Task 6 (final product verification). Do not spend steps keeping old and new code paths simultaneously correct; replace outright.
- Depend on interfaces/abstract base classes at replaceable boundaries; inject dependencies; do not construct concrete implementations inside consumers (`CLAUDE.md`).
- Prefer composition over inheritance; inherit only for true is-a substitutability (`Vehicle`/`RigidObject`/`VisualObject` extend `SceneObject` — all true is-a).
- No generic `Manager`/`Helper`/`Utils` classes; no backwards-compatibility shims, aliases, or dead fallback branches once a piece is replaced (`CLAUDE.md`).
- Rapier remains the sole authority for a physical vehicle's rendered pose; rendering interpolates, it never simulates (spec "Design Goals").
- One main-thread `SceneObject` instance per live entity; the worker holds only port implementations, never a second domain class (spec "New Ownership Model").
- Spawn and removal become visible only at explicit physics-step and topology-version boundaries; command/pose queues stay bounded (spec "Required Invariants").
- Commands arrive only through `SceneObject.dispatch`; no subtype exposes its own public command method (tightened during spec audit).

## Deferred Out of This Plan

The spec's "Worker Transport for Heavy Scenes" section (packed `ArrayBuffer` wire format, per-slot topology table, `SharedArrayBuffer`) is **not** a task here. The current transport is one structured-clone RPC per fixed substep carrying every agent's transforms in one array (`stepPlayback` → `PlaybackSnapshot`), already batched, not per-body. Task 6's heavy-scene check measures whether that transport is actually a bottleneck before any binary-packing work is scheduled. If it finds a real bottleneck, write a follow-up spec addendum and plan for the transport work alone.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/scenario-studio/domain/SceneObjectPorts.ts` | *(new)* pose-frame types, `PresentationPort<TPose>`, action/envelope types |
| `src/scenario-studio/domain/SceneObject.ts` | *(new)* abstract `SceneObject<TPose>` base class |
| `src/scenario-studio/domain/VisualObject.ts` | *(new)* `VisualObject extends SceneObject` |
| `src/scenario-studio/domain/RigidObject.ts` | *(new)* `RigidObject extends SceneObject` for physical (non-vehicle) props |
| `src/scenario-studio/domain/Vehicle.ts` | *(new)* `Vehicle extends SceneObject`, owns `VehiclePhysicsPort` |
| `src/scenario-studio/physics/PhysicsWorld.ts` | *(modify)* `BodyPose`, `AgentWheelPose`, updated `AgentTransform` |
| `src/scenario-studio/physics/physics.worker.ts` | *(modify)* pose collection returns complete `BodyPose`s; per-resource `PhysicsPortServer` classes replace the global `playbackBodies`/`driveCommands` maps |
| `src/scenario-studio/physics/PhysicsWorkerClient.ts` | *(modify)* adds resource-scoped RPC methods |
| `src/scenario-studio/physics/VehiclePhysicsPort.ts` | *(new)* `VehiclePhysicsPort` interface + RPC implementation |
| `src/scenario-studio/physics/RigidBodyPhysicsPort.ts` | *(new)* `RigidBodyPhysicsPort` interface + RPC implementation |
| `src/scenario-studio/rendering/ThreePresentationPort.ts` | *(new)* `PresentationPort` Three.js implementation: bind-matrix binding, pose application |
| `src/scenario-studio/rendering/AgentVisuals.ts` | *(modify → shrink)* keeps ghost/selection/gizmo authoring UI only; live-instance rendering removed, replaced by `ThreePresentationPort` |
| `src/scenario-studio/domain/SceneObjectRegistry.ts` | *(new)* lookup/delegate registry; owns spawn/remove/dispatch transactions |
| `src/scenario-studio/domain/ScenarioSimulation.ts` | *(new)* owns `SceneObjectRegistry` + shared fixed-step loop; used *by* `ScenarioSession` |
| `src/scenario-studio/domain/ScenarioSession.ts` | *(modify)* delegates playback/runtime-object lifecycle to `ScenarioSimulation`; keeps authoring/document/scene concerns |
| `src/scenario-studio/runtime/AgentComponents.ts` | *(delete in Task 4)* superseded by `SceneObject.dispatch` |
| `src/scenario-studio/ScenarioStudioApp.ts` | *(modify in Task 4)* keyboard drive command becomes a `SceneObjectActionEnvelope` |
| `src/scenario-studio/domain/agent.ts`, `AgentInstance.ts`, `AgentPopulation.ts`, + all referencing files | *(rename in Task 5)* `AgentSnapshot`/`AgentInstance` → `SceneObjectSnapshot`/`SceneObjectInstance` |

---

### Task 1: Domain pose/port contracts + `SceneObject`/`VisualObject` base classes

Pure additive types and a base class hierarchy with no caller yet. Verified by typecheck only — becomes product-visible once wired in Task 4.

**Files:**
- Create: `src/scenario-studio/domain/SceneObjectPorts.ts`
- Create: `src/scenario-studio/domain/SceneObject.ts`
- Create: `src/scenario-studio/domain/VisualObject.ts`

**Interfaces:**
- Consumes: `Vector3Value` (`src/scenario-studio/domain/agent.ts:3-7`), `DriveCommand` (`src/scenario-studio/domain/playback.ts:5-9`), `BodyPose` (defined here, reused by Task 2)
- Produces: `SceneObjectId`, `WheelId`, `SceneObjectPoseFrame`, `VisualObjectPoseFrame`, `VehiclePoseFrame`, `PresentationPort<TPose>`, `SceneObjectAction`, `SceneObjectActionEnvelope`, `ActionContext`, `SceneObject<TPose>`, `VisualObject`

- [ ] **Step 1: Write `SceneObjectPorts.ts`**

```ts
import type { DriveCommand } from "./playback";

export type SceneObjectId = string;
export type WheelId = string;

export interface Vector3Value { readonly x: number; readonly y: number; readonly z: number; }

export interface BodyPose {
  readonly worldPositionMeters: Vector3Value;
  readonly worldOrientation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
}

export interface AgentWheelPose {
  readonly wheelId: WheelId;
  readonly suspensionBody: BodyPose;
  readonly steeringBody: BodyPose;
  readonly tireBody: BodyPose;
}

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
  readonly wheels: readonly AgentWheelPose[];
}

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

`PhysicsWorld.ts` will re-export `BodyPose`/`AgentWheelPose`/`Vector3Value` from this file in Task 2 rather than redefining them — one source of truth for the pose shape.

- [ ] **Step 2: Write `SceneObject.ts`**

Deviation from the spec's literal sketch, made during design review: `resetPhysics`/`releasePhysics` get **default no-op implementations**, not abstract ones — `VisualObject` has no physics port, so forcing every subtype to implement physics lifecycle hooks it doesn't have would contradict the goal that visual-only objects allocate no physics resources. Only `applyAction` stays abstract.

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
    if (pose.topologyVersion < this.currentPose.topologyVersion) return;
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
  protected setState(state: SceneObjectState): void { this.state = state; }

  protected abstract applyAction(action: SceneObjectAction): Promise<void>;
  protected async resetPhysics(): Promise<void> {}
  protected async releasePhysics(): Promise<void> {}
}
```

- [ ] **Step 3: Write `VisualObject.ts`**

```ts
import { SceneObject } from "./SceneObject";
import type { SceneObjectAction, VisualObjectPoseFrame } from "./SceneObjectPorts";

export class VisualObject extends SceneObject<VisualObjectPoseFrame> {
  protected async applyAction(action: SceneObjectAction): Promise<void> {
    throw new Error(`VisualObject ${this.id} does not accept actions of kind "${action.kind}".`);
  }
}
```

- [ ] **Step 4: Verify**

`npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/scenario-studio/domain/SceneObjectPorts.ts src/scenario-studio/domain/SceneObject.ts src/scenario-studio/domain/VisualObject.ts
git commit -m "feat(scenario-studio): add SceneObject pose/action contracts and base class hierarchy"
```

---

### Task 2: Exact per-part pose contract + `ThreePresentationPort`

Rewrites the worker's wheel-pose collection to publish complete `BodyPose`s, and replaces `AgentVisuals`'s scalar wheel reconstruction with a `PresentationPort` implementation outright — no intermediate "patch AgentVisuals in place" pass. `AgentVisuals` is stripped to authoring-only UI (ghost preview, ground-snap, selection gizmo); live-instance rendering has no caller until Task 4 wires `SceneObjectRegistry` in, so playback rendering is allowed to be non-functional in the browser between this task's commit and Task 4's.

**Files:**
- Modify: `src/scenario-studio/physics/PhysicsWorld.ts:24-32` (`AgentTransform`, re-export `BodyPose`/`AgentWheelPose` from `SceneObjectPorts.ts`)
- Modify: `src/scenario-studio/physics/physics.worker.ts:613-660` (`collectTransforms`, `collectRigWheelTransform`)
- Create: `src/scenario-studio/rendering/ThreePresentationPort.ts`
- Modify: `src/scenario-studio/rendering/AgentVisuals.ts` (delete `liveStates`/`ingest`/`presentInterpolated`/wheel-node scalar code at `17-41,150-237`; keep `prepare`/`show`/`update`/`remove`/`clear`/selection/ghost)

**Interfaces:**
- Produces: `AgentTransform.wheels?: readonly AgentWheelPose[]` (replacing the scalar shape); `ThreePresentationPort<TPose> implements PresentationPort<TPose>`
- Consumes (unchanged): `PhysicalWheelRig` (`physics.worker.ts:50-63`), `RAPIER.DynamicRayCastVehicleController` per-wheel getters (`physics.worker.ts:621-626`), `PresentationPort`/`VehiclePoseFrame`/`VisualObjectPoseFrame` (Task 1)

- [ ] **Step 1: Update `PhysicsWorld.ts`**

```ts
export type { BodyPose, AgentWheelPose, Vector3Value } from "../domain/SceneObjectPorts";
import type { AgentWheelPose } from "../domain/SceneObjectPorts";

export interface AgentTransform {
  readonly id: string;
  readonly position: Vector3Value;
  readonly headingRadians: number;
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  /** Complete per-part poses, index-paired with `agent.asset.wheels`. Absent for non-vehicle agents. */
  readonly wheels?: readonly AgentWheelPose[];
}
```

- [ ] **Step 2: Rewrite `collectRigWheelTransform` (physical rig) to read real body poses directly**

In `physics.worker.ts`, add `readonly id: string;` to `PhysicalWheelRig` (`physics.worker.ts:50-63`) and set it from `wheel.id` in `buildPhysicalWheelRig` (`physics.worker.ts:388,460`). Replace `physics.worker.ts:641-660`:

```ts
function bodyPose(body: RAPIER.RigidBody): BodyPose {
  const t = body.translation();
  const r = body.rotation();
  return { worldPositionMeters: { x: t.x, y: t.y, z: t.z }, worldOrientation: { x: r.x, y: r.y, z: r.z, w: r.w } };
}

function collectRigWheelTransform(wheel: PhysicalWheelRig): AgentWheelPose {
  const steeringBody = wheel.knuckleBody ? bodyPose(wheel.knuckleBody) : bodyPose(wheel.carriageBody);
  return { wheelId: wheel.id, suspensionBody: bodyPose(wheel.carriageBody), steeringBody, tireBody: bodyPose(wheel.wheelBody) };
}
```

- [ ] **Step 3: Rewrite the raycast branch to publish full poses**

The controller only exposes `wheelSteering`/`wheelRotation`/`wheelSuspensionLength` scalars (`physics.worker.ts:621-626`); reconstruct once here, using the same connection-point/axis convention already used when wheels were added (`physics.worker.ts:333-339`):

```ts
function quaternionMultiply(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}

function collectRaycastWheelTransform(wheelId: string, controller: RAPIER.DynamicRayCastVehicleController, index: number, chassis: RAPIER.RigidBody, connectionPointLocal: Vector3Value): AgentWheelPose {
  const chassisRotation = chassis.rotation();
  const chassisTranslation = chassis.translation();
  const steeringRadians = controller.wheelSteering(index) ?? 0;
  const rotationRadians = controller.wheelRotation(index) ?? 0;
  const suspensionLength = controller.wheelSuspensionLength(index) ?? 0;
  const localWheelPosition: Vector3Value = { x: connectionPointLocal.x, y: connectionPointLocal.y - suspensionLength, z: connectionPointLocal.z };
  const localSteeringRotation = { x: 0, y: Math.sin(steeringRadians / 2), z: 0, w: Math.cos(steeringRadians / 2) };
  const localSpinRotation = { x: -Math.sin(rotationRadians / 2), y: 0, z: 0, w: Math.cos(rotationRadians / 2) };
  const worldTirePosition = addVectors(chassisTranslation, rotateVector(localWheelPosition, chassisRotation));
  const worldTireRotation = quaternionMultiply(chassisRotation, quaternionMultiply(localSteeringRotation, localSpinRotation));
  const worldSteeringRotation = quaternionMultiply(chassisRotation, localSteeringRotation);
  const tireBody: BodyPose = { worldPositionMeters: worldTirePosition, worldOrientation: worldTireRotation };
  const steeringBody: BodyPose = { worldPositionMeters: worldTirePosition, worldOrientation: worldSteeringRotation };
  return { wheelId, suspensionBody: steeringBody, steeringBody, tireBody };
}
```

Add a module-level `const wheelConnectionPoints = new Map<string, Vector3Value[]>();`, populated right after the wheel-building loop in `preparePlayback` (`physics.worker.ts:333-337`, both branches) and cleared in `resetPlayback`/`teardownPlaybackBodies`. Update `collectTransforms` (`physics.worker.ts:613-639`):

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
      ? Array.from({ length: entry.wheelCount }, (_, index) => collectRaycastWheelTransform(wheelIds[index] ?? `wheel-${index}`, entry.controller!, index, entry.body, wheelConnectionPoints.get(id)![index]))
      : entry.rig?.wheels.map((wheel) => collectRigWheelTransform(wheel));
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

- [ ] **Step 4: Write `ThreePresentationPort.ts`**

```ts
import * as THREE from "three";
import type { AgentWheelPose, BodyPose, PresentationPort, VehiclePoseFrame, VisualObjectPoseFrame } from "../domain/SceneObjectPorts";
import type { WheelDescriptor } from "../domain/agent";

interface WheelBinding {
  readonly steering: THREE.Object3D;
  readonly wheel: THREE.Object3D;
  readonly suspension: THREE.Object3D;
  readonly suspensionBind: THREE.Matrix4;
  readonly steeringBind: THREE.Matrix4;
  readonly tireBind: THREE.Matrix4;
}

const scratchWorld = new THREE.Matrix4();
const scratchLocal = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternionA = new THREE.Quaternion();
const scratchQuaternionB = new THREE.Quaternion();
const scratchQuaternion = new THREE.Quaternion();
const unitScale = new THREE.Vector3(1, 1, 1);

/** visualWorld = chassisWorldInverse × interpolatedPhysicsBodyWorld × bindMatrix, converted back to the node's local space. */
function applyInterpolatedPart(node: THREE.Object3D, bind: THREE.Matrix4, chassis: THREE.Object3D, from: BodyPose, to: BodyPose, alpha: number): void {
  scratchPosition.set(
    from.worldPositionMeters.x + (to.worldPositionMeters.x - from.worldPositionMeters.x) * alpha,
    from.worldPositionMeters.y + (to.worldPositionMeters.y - from.worldPositionMeters.y) * alpha,
    from.worldPositionMeters.z + (to.worldPositionMeters.z - from.worldPositionMeters.z) * alpha
  );
  scratchQuaternionA.set(from.worldOrientation.x, from.worldOrientation.y, from.worldOrientation.z, from.worldOrientation.w);
  scratchQuaternionB.set(to.worldOrientation.x, to.worldOrientation.y, to.worldOrientation.z, to.worldOrientation.w);
  scratchQuaternion.copy(scratchQuaternionA).slerp(scratchQuaternionB, alpha);
  scratchWorld.compose(scratchPosition, scratchQuaternion, unitScale);
  scratchLocal.copy(chassis.matrixWorld).invert().multiply(scratchWorld).multiply(bind);
  scratchLocal.decompose(node.position, node.quaternion, node.scale);
}

function resolveWheelBindings(object: THREE.Object3D, wheels: readonly WheelDescriptor[]): (WheelBinding | null)[] {
  return wheels.map((wheel) => {
    const steering = object.getObjectByName(wheel.steeringNode);
    const wheelNode = object.getObjectByName(wheel.wheelNode);
    const suspension = object.getObjectByName(wheel.suspensionNode);
    if (!steering || !wheelNode || !suspension) return null;
    // Each node's local-to-object matrix at rest IS its bind matrix: the authored placement is the
    // physics rest pose, so binding against the node's current local transform reproduces the
    // authored pivot without any physics-side lookup.
    return { steering, wheel: wheelNode, suspension, suspensionBind: suspension.matrix.clone(), steeringBind: steering.matrix.clone(), tireBind: wheelNode.matrix.clone() };
  });
}

type Pose = VehiclePoseFrame | VisualObjectPoseFrame;

export class ThreePresentationPort<TPose extends Pose> implements PresentationPort<TPose> {
  private wheelBindings: (WheelBinding | null)[] | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly object: THREE.Object3D,
    private readonly wheels: readonly WheelDescriptor[]
  ) {}

  async prepare(): Promise<void> {
    this.wheelBindings = this.wheels.length ? resolveWheelBindings(this.object, this.wheels) : null;
  }

  activate(): void { this.scene.add(this.object); }

  applyPose(from: TPose, to: TPose, alpha: number): void {
    if (isVehiclePose(to) && isVehiclePose(from)) this.applyVehiclePose(from, to, alpha);
    else if (!isVehiclePose(to) && !isVehiclePose(from)) applyInterpolatedPart(this.object, IDENTITY, this.object, from.body, to.body, alpha);
  }

  private applyVehiclePose(from: VehiclePoseFrame, to: VehiclePoseFrame, alpha: number): void {
    applyInterpolatedPart(this.object, IDENTITY, this.object, from.chassis, to.chassis, alpha);
    this.object.updateMatrixWorld(true);
    to.wheels.forEach((toWheel: AgentWheelPose, index: number) => {
      const binding = this.wheelBindings?.[index];
      if (!binding) return;
      const fromWheel = from.wheels[index] ?? toWheel;
      applyInterpolatedPart(binding.suspension, binding.suspensionBind, this.object, fromWheel.suspensionBody, toWheel.suspensionBody, alpha);
      applyInterpolatedPart(binding.steering, binding.steeringBind, this.object, fromWheel.steeringBody, toWheel.steeringBody, alpha);
      applyInterpolatedPart(binding.wheel, binding.tireBind, this.object, fromWheel.tireBody, toWheel.tireBody, alpha);
    });
  }

  reset(): void {}

  release(): void { this.object.removeFromParent(); }
}

const IDENTITY = new THREE.Matrix4();
function isVehiclePose(pose: Pose): pose is VehiclePoseFrame { return "chassis" in pose; }
```

- [ ] **Step 5: Strip `AgentVisuals.ts` to authoring-only**

Delete the `liveStates`/`wheelNodes`/`restSuspensionLengths` fields and the `ingest`/`presentInterpolated`/`resolveWheelNodes`/`restSuspensionLength` methods (`AgentVisuals.ts:17-41,150-237` and the corresponding field declarations). Keep `prepare`/`show`/`update`/`remove`/`clear`/`select`/ghost-preview code — those remain authoring-time responsibilities. `ScenarioSession`'s playback loop will stop calling the removed methods once Task 4 rewires it; until then, expect a typecheck error at that one call site, which is fine to leave broken across this task's commit boundary per the sequencing policy — fix it when Task 4 rewires the loop, not here.

- [ ] **Step 6: Verify**

`npx tsc --noEmit`. Expect a pre-existing-caller error in `ScenarioSession.ts` where it called the now-removed `AgentVisuals` methods — note it, do not fix it here (Task 4 resolves it as part of the cutover). Confirm no *other* errors.

- [ ] **Step 7: Commit**

```bash
git add src/scenario-studio/physics/PhysicsWorld.ts src/scenario-studio/physics/physics.worker.ts src/scenario-studio/rendering/ThreePresentationPort.ts src/scenario-studio/rendering/AgentVisuals.ts
git commit -m "feat(scenario-studio): publish exact per-part wheel poses via ThreePresentationPort"
```

---

### Task 3: Physics ports + worker `PhysicsPortServer`s + `Vehicle`/`RigidObject`

Builds the real per-resource encapsulation directly (no "wrap the global maps, rewrite later" staging): each vehicle/rigid-body resource owns its own server object from the start. Still not wired into `ScenarioSession` — verified by typecheck.

**Files:**
- Modify: `src/scenario-studio/physics/physics.worker.ts` (introduce `resourceId`, `VehiclePhysicsPortServer`, `RigidBodyPhysicsPortServer`)
- Modify: `src/scenario-studio/physics/PhysicsWorkerClient.ts` (add resource-scoped RPC operations)
- Create: `src/scenario-studio/physics/VehiclePhysicsPort.ts`
- Create: `src/scenario-studio/physics/RigidBodyPhysicsPort.ts`
- Create: `src/scenario-studio/domain/Vehicle.ts`
- Create: `src/scenario-studio/domain/RigidObject.ts`

**Interfaces:**
- Produces: `VehiclePhysicsPortServer`/`RigidBodyPhysicsPortServer` (worker, keyed by `resourceId: number`), `VehiclePhysicsPort`/`RigidBodyPhysicsPort` (main thread), `Vehicle extends SceneObject<VehiclePoseFrame>`, `RigidObject extends SceneObject<VisualObjectPoseFrame>`
- Consumes: `PlaybackBody`, `PhysicalVehicleRig`, `driveAgent`, `collectRigWheelTransform`/`collectRaycastWheelTransform` (Task 2), `SceneObject`, `PresentationPort` (Task 1)

- [ ] **Step 1: Resource IDs and worker-side server classes**

Add `let nextResourceId = 1;` and extend `PlaybackBody` with `readonly resourceId: number;`, assigned in the `preparePlayback` loop (`physics.worker.ts:302-350`). Add:

```ts
class VehiclePhysicsPortServer {
  constructor(readonly resourceId: number, private readonly agentId: string) {}
  applyDriveCommand(command: DriveCommand, generation: number): void { driveAgent(this.agentId, command, generation); }
}

class RigidBodyPhysicsPortServer {
  constructor(readonly resourceId: number, private readonly agentId: string) {}
}

const vehiclePortServers = new Map<number, VehiclePhysicsPortServer>();
const rigidBodyPortServers = new Map<number, RigidBodyPhysicsPortServer>();
```

Construct the matching server at the end of each branch of the `preparePlayback` loop — `VehiclePhysicsPortServer` for the two vehicle branches (`physics.worker.ts:308,346`), `RigidBodyPhysicsPortServer` for the plain-body branch (`physics.worker.ts:347-350`) — and clear both maps in `resetPlayback`/`teardownPlaybackBodies`.

- [ ] **Step 2: Add resource-scoped worker operations**

In `PhysicsWorkerClient.ts`, extend `PhysicsWorkerOperation`:

```ts
| { type: "vehiclePortDriveCommand"; resourceId: number; command: DriveCommand; generation: number }
```

and add `vehiclePortDriveCommand(resourceId: number, command: DriveCommand, generation: number): Promise<void> { return this.request({ type: "vehiclePortDriveCommand", resourceId, command, generation }); }` alongside the existing `driveAgent` method (`PhysicsWorkerClient.ts:49`). Handle the operation in the worker's message switch by looking up `vehiclePortServers.get(resourceId)` and calling `applyDriveCommand`. `stepPlayback`'s bulk `PlaybackSnapshot` stays the transport for pose delivery — no per-resource pose-push RPC is needed since `ScenarioSimulation` (Task 4) fans the bulk result out to each object by ID.

- [ ] **Step 3: Main-thread `VehiclePhysicsPort`**

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

`RigidBodyPhysicsPort` follows the same shape in `RigidBodyPhysicsPort.ts` (no operations yet — props take no runtime commands today — it exists purely so a physical prop is one `SceneObject` with a real physics port, per the spec).

- [ ] **Step 4: `Vehicle` and `RigidObject`**

```ts
import { SceneObject } from "./SceneObject";
import type { SceneObjectAction, VehiclePoseFrame, PresentationPort } from "./SceneObjectPorts";
import type { VehiclePhysicsPort } from "../physics/VehiclePhysicsPort";
import { NEUTRAL_DRIVE_COMMAND, type DriveCommand } from "./playback";

export class Vehicle extends SceneObject<VehiclePoseFrame> {
  private command: DriveCommand = NEUTRAL_DRIVE_COMMAND;

  constructor(id: string, presentation: PresentationPort<VehiclePoseFrame>, generation: number, initialPose: VehiclePoseFrame, private readonly physics: VehiclePhysicsPort) {
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

`Vehicle` exposes no public command method of its own — `dispatch` (inherited) is the only entry point, matching the spec-audit correction. `RigidObject` in `RigidObject.ts` follows the same extension pattern over `VisualObjectPoseFrame`, with `applyAction` rejecting every action kind (no runtime commands for props today).

- [ ] **Step 5: Verify**

`npx tsc --noEmit`, same expected pre-existing `ScenarioSession.ts` error as Task 2 (still unresolved until Task 4), no new errors elsewhere.

- [ ] **Step 6: Commit**

```bash
git add src/scenario-studio/physics/physics.worker.ts src/scenario-studio/physics/PhysicsWorkerClient.ts src/scenario-studio/physics/VehiclePhysicsPort.ts src/scenario-studio/physics/RigidBodyPhysicsPort.ts src/scenario-studio/domain/Vehicle.ts src/scenario-studio/domain/RigidObject.ts
git commit -m "feat(scenario-studio): add resource-scoped physics ports and Vehicle/RigidObject"
```

---

### Task 4: `SceneObjectRegistry` + `ScenarioSimulation`, full cutover — first running-app checkpoint

This is where everything connects: `AgentComponentRegistry`/`AgentComponent`/`VehicleComponent` are deleted, `ScenarioSession`'s playback loop is rewritten to drive `SceneObjectRegistry`, and spawn/removal/topology-version transactions are built in from the start (no separate "simple registry first, add transactions later" pass). This is the first task verified end to end in the running app.

**Files:**
- Create: `src/scenario-studio/domain/SceneObjectRegistry.ts`
- Create: `src/scenario-studio/domain/ScenarioSimulation.ts`
- Modify: `src/scenario-studio/domain/ScenarioSession.ts` (delegate playback lifecycle to `ScenarioSimulation`; remove `componentRegistry`/`components` fields at `ScenarioSession.ts:30-31`, the `AgentComponents` import at `ScenarioSession.ts:13`, and the direct `AgentVisuals` playback calls Task 2 left broken)
- Delete: `src/scenario-studio/runtime/AgentComponents.ts`
- Modify: `src/scenario-studio/ScenarioStudioApp.ts:321-329` (`updateDriveCommand` publishes through the same `vehicleControlChannel` message shape as before — no envelope change needed at this call site, since translation into a `SceneObjectActionEnvelope` happens once, in the registry's channel subscription)

**Interfaces:**
- Consumes: `Vehicle`, `RigidObject`, `VisualObject` (Tasks 1, 3), `Middleware`/`vehicleControlChannel`/`commandStatusChannel` (`src/scenario-studio/runtime/messages.ts`, unchanged), `ThreePresentationPort` (Task 2)
- Produces: `SceneObjectRegistry.spawn(...)`, `.dispatch(envelope)`, `.remove(id)`, `.presentAll(alpha)`; `ScenarioSimulation` driving the fixed-step loop that today lives inline in `ScenarioSession`

- [ ] **Step 1: Implement `SceneObjectRegistry` with spawn/remove/dispatch together**

```ts
import type { SceneObject } from "./SceneObject";
import type { PresentationPort, SceneObjectActionEnvelope, SceneObjectPoseFrame } from "./SceneObjectPorts";

export class SceneObjectRegistry {
  private readonly objects = new Map<string, SceneObject<any>>();

  async spawn(id: string, presentation: PresentationPort<any>, build: () => Promise<SceneObject<any>>): Promise<string> {
    if (this.objects.has(id)) throw new Error(`SceneObject ${id} already registered.`);
    let prepared = false;
    try {
      await presentation.prepare();
      prepared = true;
      const object = await build();
      this.objects.set(id, object);
      presentation.activate();
      return id;
    } catch (error) {
      if (prepared) presentation.release();
      throw error;
    }
  }

  async dispatch(envelope: SceneObjectActionEnvelope): Promise<void> {
    const object = this.objects.get(envelope.objectId);
    if (!object) throw new Error(`No live SceneObject for ${envelope.objectId}.`);
    await object.dispatch(envelope);
  }

  async remove(id: string): Promise<void> {
    const object = this.objects.get(id);
    if (!object) return; // repeated removal is a no-op
    this.objects.delete(id); // reject later dispatch immediately; SceneObject.dispose (Task 1) sequences physics release before presentation release
    await object.dispose();
  }

  presentAll(alpha: number): void {
    for (const object of this.objects.values()) object.present(alpha);
  }

  acceptPose(id: string, pose: SceneObjectPoseFrame): void {
    (this.objects.get(id) as SceneObject<any> | undefined)?.acceptPhysicsPose(pose);
  }

  async disposeAll(): Promise<void> {
    for (const object of this.objects.values()) await object.dispose();
    this.objects.clear();
  }
}
```

- [ ] **Step 2: Implement `ScenarioSimulation`**

Moves the fixed-step orchestration that currently lives inline across `ScenarioSession.play`/`pause`/`reset` (`ScenarioSession.ts:215-`) into a dedicated class owning the registry, a `topologyVersion` counter (incremented on every successful `spawn`/`remove`), and the per-tick loop:

```ts
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { SceneObjectRegistry } from "./SceneObjectRegistry";
import type { VehiclePoseFrame, VisualObjectPoseFrame } from "./SceneObjectPorts";

export class ScenarioSimulation {
  readonly registry = new SceneObjectRegistry();
  private topologyVersion = 0;
  private step = 0;

  constructor(private readonly world: PhysicsWorld, private readonly generation: number) {}

  noteTopologyChange(): void { this.topologyVersion += 1; }

  async tick(dt: number): Promise<void> {
    const snapshot = await this.world.stepPlayback(dt, this.generation);
    this.step += 1;
    for (const transform of snapshot.transforms) {
      const pose = transform.wheels
        ? ({ resourceId: 0, generation: this.generation, physicsStep: this.step, topologyVersion: this.topologyVersion, chassis: { worldPositionMeters: transform.position, worldOrientation: transform.rotation }, wheels: transform.wheels } satisfies VehiclePoseFrame)
        : ({ resourceId: 0, generation: this.generation, physicsStep: this.step, topologyVersion: this.topologyVersion, body: { worldPositionMeters: transform.position, worldOrientation: transform.rotation } } satisfies VisualObjectPoseFrame);
      this.registry.acceptPose(transform.id, pose);
    }
  }

  present(alpha: number): void { this.registry.presentAll(alpha); }

  async dispose(): Promise<void> { await this.registry.disposeAll(); }
}
```

`ScenarioSession` constructs one `ScenarioSimulation` in `play()` (after `world.preparePlayback` succeeds, replacing `createRuntimeComponents`), calls `.tick(dt)`/`.present(alpha)` from wherever the render loop currently drives `AgentVisuals.ingest`/`presentInterpolated` (the call sites Task 2 left broken), and calls `.dispose()` in `reset()`/session `dispose()`. Populate the registry once per agent right after `preparePlayback`: for a vehicle agent, `registry.spawn(agent.id, new ThreePresentationPort(scene, object, agent.asset.wheels ?? []), async () => new Vehicle(agent.id, presentation, generation, initialPose, new RpcVehiclePhysicsPort(resourceId, physicsClient)))`; for a non-vehicle agent with a physics body, the `RigidObject` equivalent; for a purely visual agent, `VisualObject`. `noteTopologyChange()` is called after every successful `spawn`/`remove`.

- [ ] **Step 3: Route commands through `dispatch` instead of `AgentComponentRegistry`**

Replace `ScenarioSession`'s use of `componentRegistry`/`components` (`ScenarioSession.ts:30-31`, used in `play`/`pause`/`createRuntimeComponents`) with one `Middleware` subscription per vehicle agent, made when the simulation starts:

```ts
middleware.subscribe(vehicleControlChannel(agent.id), (event) => {
  const message = event.message;
  simulation.registry.dispatch({
    objectId: agent.id,
    resourceId: null,
    generation: message.generation,
    targetStep: message.targetStep,
    sequence: message.targetStep,
    action: { kind: "drive", command: message }
  }).then(
    () => onControllerDiagnostic({ type: "command-status", correlationId: message.correlationId, source: message.source, agentId: agent.id, accepted: true, message: "Command accepted." }),
    (error) => onControllerDiagnostic({ type: "command-status", correlationId: message.correlationId, source: message.source, agentId: agent.id, accepted: false, message: error instanceof Error ? error.message : "Command was rejected." })
  );
});
```

`targetStep` is already monotonic per agent in the existing protocol, so it doubles as `sequence` without a new counter. This subscription replaces `VehicleComponent`'s identical-purpose subscription (`AgentComponents.ts:20-24`) — same channel, same message shape, new destination.

- [ ] **Step 4: Delete `AgentComponents.ts`** and its import from `ScenarioSession.ts:13`.

- [ ] **Step 5: Verify in the running app (first full checkpoint)**

1. `npx tsc --noEmit` clean — the pre-existing errors from Tasks 2-3 must now be resolved.
2. Place a vehicle, press Play, drive with keyboard. Confirm it moves, steers, and the tire meshes track the collider (this is Task 2's pose contract, now actually rendering for the first time).
3. Pause/resume — command zeroes on pause, resumes correctly.
4. Reset — no console errors across repeated play/reset cycles.
5. If a managed controller script is configured, confirm ticks still reach the vehicle.

- [ ] **Step 6: Commit**

```bash
git add src/scenario-studio/domain/SceneObjectRegistry.ts src/scenario-studio/domain/ScenarioSimulation.ts src/scenario-studio/domain/ScenarioSession.ts src/scenario-studio/ScenarioStudioApp.ts
git rm src/scenario-studio/runtime/AgentComponents.ts
git commit -m "refactor(scenario-studio): wire SceneObjectRegistry/ScenarioSimulation, retire AgentComponents"
```

---

### Task 5: Rename `AgentSnapshot`/`AgentInstance` → `SceneObjectSnapshot`/`SceneObjectInstance`

Mechanical, done after the runtime cutover so it touches settled code once. Straight rename, no aliasing shim.

**Files:**
- Modify: `src/scenario-studio/domain/agent.ts`, `AgentInstance.ts` (file rename too), `AgentPopulation.ts`
- Modify every remaining reference found by the grep in Step 1

- [ ] **Step 1: Get the exact blast radius**

```bash
grep -rl "AgentSnapshot\|AgentInstance" src/ server/
```

Read each hit before editing.

- [ ] **Step 2: Rename**, propagating file by file, running `npx tsc --noEmit` after each file to catch missed references early.

- [ ] **Step 3: Verify in the running app**

Open a saved scenario, place/move/duplicate/delete agents, save, reload, play. The rename must be behaviorally invisible.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(scenario-studio): rename AgentSnapshot/AgentInstance to SceneObjectSnapshot/SceneObjectInstance"
```

---

### Task 6: Product verification pass

No new code — runs the spec's own "Product Verification" checklist end to end, using a Physical Minivan in Downtown, and decides whether the deferred binary transport is actually needed.

- [ ] **Step 1:** Settle on flat ground for five seconds. Confirm visual stillness and tire-to-collider agreement.
- [ ] **Step 2:** Suspend the vehicle and hold W. Confirm all four wheels wake, receive torque, and spin.
- [ ] **Step 3:** Release W while suspended. Confirm all four wheels spin down together.
- [ ] **Step 4:** Drive W+A then W+D (and arrow-key equivalents). Confirm front-wheel orientation and chassis heading change as commanded.
- [ ] **Step 5:** Drive one front tire onto a curb and stop. Confirm no visible penetration or offset between tire mesh and collider.
- [ ] **Step 6:** Pause, resume, reset, replay, dispose. Confirm no stale command or pose affects the new run.
- [ ] **Step 7:** Spawn a vehicle during playback, drive it, remove it with a command in flight. Confirm atomic appearance, stale-action rejection, and clean removal.
- [ ] **Step 8:** Spawn a representative heavy scene and observe frame time/responsiveness. If it holds up, record that the deferred binary-transport work is unnecessary for now; if not, write a follow-up spec addendum rather than improvising it here.
- [ ] **Step 9:** Record findings. Fix forward in the owning task's files if anything fails, then re-run the full checklist.

---

## Self-Review

**Spec coverage:** Problem/symptoms → Task 2; New Ownership Model/classes → Tasks 1, 3; Port Responsibilities → Tasks 2 (presentation), 3 (physics); Authoritative Pose Contract → Task 2; Physics Shape and Visual Binding → Task 2 Steps 4-5; Command Flow/retiring `AgentComponents` → Task 4 Steps 3-4; Dynamic Spawn/Action/Removal → Task 4 Step 1-2; Worker Transport for Heavy Scenes → deferred with a measurement gate in Task 6 Step 8; Required Invariants → Tasks 1, 2, 4; Product Verification → Task 6; Migration Boundary → Task 5 plus the deletion in Task 4.

**Placeholder scan:** clean — every step shows real code or an exact file:line target.

**Type consistency:** `BodyPose`/`AgentWheelPose` (Task 1) flow unchanged through `PhysicsWorld.ts`'s re-export, the worker's `collectRigWheelTransform`/`collectRaycastWheelTransform` (Task 2), `ThreePresentationPort` (Task 2), and `VehiclePoseFrame` construction in `ScenarioSimulation.tick` (Task 4). `SceneObjectActionEnvelope`/`SceneObjectAction` (Task 1) are consumed identically by `SceneObject.dispatch` (Task 1), `Vehicle.applyAction` (Task 3), and the registry subscription (Task 4).

**What changed from the original 10-task version:** merged the type/base-class scaffolding into one task, merged the pose-contract rewrite with its presentation-port implementation instead of patching `AgentVisuals` in place first, merged worker port-server encapsulation with the main-thread port/`Vehicle` classes, and merged the registry with spawn/removal transactions instead of adding them after a simpler version existed. The tradeoff, per instruction: Tasks 1-3 are not required to leave the running app functional — only to typecheck — with the first real running-app checkpoint at Task 4 and full verification at Task 6.
