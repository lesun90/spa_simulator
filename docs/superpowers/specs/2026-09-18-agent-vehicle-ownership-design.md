# Scene Object and Vehicle Runtime Design

**Status:** Proposed design, awaiting approval

## Problem

Scenario Studio represents one live vehicle in several places at once. The physics worker owns Rapier bodies and joints. The main thread owns Three.js nodes. `ScenarioSession`, runtime components, worker-level maps, and rendering caches each own another part of the vehicle's behavior or state.

The reported failures exposed weaknesses in that split:

- steering input reached the worker, but the physical front-wheel assembly did not turn correctly;
- drive torque reached only part of the wheel set;
- sleeping wheel bodies did not wake when throttle changed;
- front and rear wheels behaved differently after input release;
- suspension jittered under uneven load;
- a rendered tire could appear inside a curb while its Rapier tire body occupied another pose.

Individual physics changes address motor, collider, and solver defects. The ownership redesign centralizes the rules those fixes must preserve; class structure alone does not guarantee correct physics.

The new design introduces a live `SceneObject` aggregate on the main thread and a concrete `Vehicle extends SceneObject`. Each scene object owns its presentation port and may own a physics port. A visual-only object has no physics port. A vehicle owns a required vehicle physics port. Rapier remains the sole authority for physical-model transforms.

## Current Design

The current runtime path looks like this:

```text
ScenarioSession
├── AgentPopulation                         authored AgentSnapshot records
├── AgentComponents                        pending commands
├── PhysicsWorld / PhysicsWorkerClient      worker request routing
└── AgentVisuals
    ├── Three.js object map
    ├── wheel-node map
    ├── authored rest-transform cache
    └── interpolation cache

physics.worker.ts
├── playbackBodies                          chassis plus optional controller/rig
├── driveCommands                           command state
├── wheelSteeringRadians                    steering state
├── preparedAgents                          tuning and authored data
├── PhysicalVehicleRig records              wheel bodies and joints
└── free functions                          build, drive, step, sample, reset
```

`AgentSnapshot` describes authored data. It does not represent a live agent and cannot own runtime transitions. `PlaybackBody` and `PhysicalVehicleRig` group references, but free functions and global maps still mutate their state.

During playback, the worker returns this wheel contract:

```ts
interface CurrentWheelTransform {
  readonly steeringRadians: number;
  readonly rotationRadians: number;
  readonly suspensionLength: number;
}
```

The worker derives those values from several sources:

- steering comes from the knuckle orientation relative to the chassis;
- wheel rotation comes from a separately accumulated `spinRadians` value;
- suspension length comes from projecting tire displacement onto the chassis up axis.

`AgentVisuals` combines those scalars with cached GLB node transforms and a separately calculated suspension rest length. The renderer therefore rebuilds a wheel pose instead of displaying the tire body's pose.

## Why the Current Design Produced the Failures

### The vehicle has no runtime owner

The chassis, wheel chains, command, steering value, authored tuning, render nodes, and interpolation samples live in separate collections. A command must update several collections correctly. Wake, reset, and disposal must also find every related entry.

This structure allowed a throttle change to update the command while some wheel bodies remained asleep. It allowed drive and neutral-drag rules to cover different wheel subsets. Nothing at the type boundary required an operation to cover the complete vehicle.

### The physics-to-rendering contract loses information

A physical tire has a world position and quaternion. Three scalars cannot describe its complete pose. Contact with a curb can move and tilt the tire in directions that the scalar suspension projection does not preserve.

The renderer then applies its own assumptions about:

- wheel order;
- local axes and rotation signs;
- authored pivots;
- suspension rest positions;
- parent-child transforms;
- the relationship between chassis space and wheel-node space.

Physics and rendering can each perform a locally reasonable calculation and still disagree. That disagreement can cause visible curb clipping: the tire mesh shows a reconstructed position while collision detection uses the Rapier tire body.

### Physical behavior is spread across free functions

`buildPhysicalChassisBody`, `buildPhysicalWheelRig`, `driveAgent`, `updateVehiclePhysical`, `collectTransforms`, reset logic, and disposal logic all operate on parts of the same vehicle. Their shared invariant exists only as a convention.

The steering, AWD, suspended-wheel wake, and input-release defects required changes in different functions. Future changes to traction control, damage, trailers, or active suspension would expand that coordination burden.

### Index pairing hides identity errors

The current snapshot pairs wheels with authored descriptors by array index. The contract cannot detect a changed order, missing wheel, duplicated binding, or stale visual node. A stable wheel ID is required at the physics and rendering boundary.

### Lifecycle ownership is split

The session changes playback generations, components flush commands, the worker creates or removes Rapier resources, and `AgentVisuals` manages the Three.js clone. Creation can expose one side before the other succeeds. Removal and reset depend on several callers cleaning their own maps.

This makes dynamic spawning and removal hard to define. It also lets an old command or pose race with a replacement object that uses the same authored ID.

## Design Goals

The runtime must provide these properties:

- one main-thread object owns each scene object's lifecycle and domain behavior;
- visual-only objects work without allocating physics resources;
- worker adapters own Rapier resources without becoming duplicate domain objects;
- Rapier body poses remain authoritative for a physical vehicle;
- rendering interpolates authoritative poses without simulating vehicle parts;
- commands affect the complete vehicle aggregate;
- spawn, action, reset, and removal have explicit step and generation semantics;
- physics remains in a worker so large scenes do not block rendering or input;
- high-frequency transport stays bounded and avoids per-body object allocation.

## New Ownership Model

One authoritative `SceneObject` instance lives on the main thread. `Vehicle` extends it and owns vehicle behavior, presentation, and its remote physics capability. The physics worker owns only port implementations and Rapier resources. It does not contain a second `Vehicle` domain class.

```text
Main thread

ScenarioSimulation
└── SceneObjectRegistry
    └── SceneObject[]
        ├── VisualObject extends SceneObject
        │   └── PresentationPort → Three.js nodes
        └── Vehicle extends SceneObject
            ├── PresentationPort → Three.js nodes
            ├── VehiclePhysicsPort → worker capability
            ├── command and steering state
            └── lifecycle and action validation

Physics worker

PhysicsWorkerWorld
├── shared Rapier.World
└── PhysicsPortServer[] keyed by resource ID
    ├── RigidBodyPhysicsPortServer
    ├── RaycastVehiclePhysicsPortServer
    └── PhysicalVehiclePhysicsPortServer
        └── private bodies, colliders, joints, and registrations
```

`SceneObject` is a domain name. It must not be confused with `THREE.Object3D`, which remains a rendering-engine resource owned behind `PresentationPort`.

A JavaScript object cannot execute in both runtimes. The main-thread `Vehicle` sends step-stamped requests through `VehiclePhysicsPort`; the worker implementation performs local Rapier operations and returns authoritative poses. The presentation port is local to the main thread, but still hides Three.js resources and applies only the owner’s requests.

`ScenarioSimulation` owns the shared physics world protocol. It batches requests from scene objects, advances the worker's Rapier world once per fixed substep, and routes returned frames to their owning objects. A scene object cannot step the world directly.

## Scene Object and Vehicle Classes

This API sketch shows the main-thread domain hierarchy. Its contracts contain no Rapier or Three.js types.

```ts
declare abstract class SceneObject<TPose extends SceneObjectPoseFrame> {
  readonly id: SceneObjectId;
  private readonly presentation: PresentationPort<TPose>;
  private previousPose: TPose;
  private currentPose: TPose;
  private generation: number;
  private state: "ready" | "running" | "paused" | "removing" | "disposed";

  dispatch(action: SceneObjectActionEnvelope): Promise<void>;
  acceptPhysicsPose(pose: TPose): void;
  present(interpolationAlpha: number): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reset(generation: number): Promise<void>;
  dispose(): Promise<void>;

  protected abstract applyAction(action: SceneObjectAction): Promise<void>;
  protected abstract resetPhysics(): Promise<void>;
  protected abstract releasePhysics(): Promise<void>;
}

declare class VisualObject extends SceneObject<VisualObjectPoseFrame> {}

declare class Vehicle extends SceneObject<VehiclePoseFrame> {
  private readonly physics: VehiclePhysicsPort;
  private command: DriveCommand;
  private steeringRadians: number;

  protected applyAction(action: SceneObjectAction): Promise<void>;
}
```

`SceneObject` implements identity, lifecycle validation, pose ownership, presentation, and disposal once. `VisualObject` uses only a presentation port. `Vehicle` requires `VehiclePhysicsPort` and owns command interpretation, steering progression, AWD, braking, neutral drag, and complete-assembly wake policy. A drive command is one variant of `SceneObjectAction`; `Vehicle` interprets it inside its `applyAction` override. `Vehicle` exposes no public method of its own for issuing commands — every caller, including keyboard input and managed controller scripts, goes through the inherited `dispatch`. This keeps the registry's "no subtype inspection" rule true in practice, not just in the registry's own code.

Factories prepare a presentation port for every visible object. They create a physics port only for an object that needs physical behavior. If either required resource fails, the factory releases all prepared resources before publishing the object. Existing `AgentSnapshot` and `AgentInstance` migrate to `SceneObjectSnapshot` and `SceneObjectInstance`; they remain authored-data records rather than live objects.

## Port Responsibilities

| Responsibility | Domain owner | Port responsibility |
|---|---|---|
| Identity, actions, lifecycle, and disposal | `SceneObject` | Deliver requests and acknowledgments |
| Steering, AWD, braking, and neutral drag | `Vehicle` | Apply complete motor targets to Rapier joints |
| Visual-only object behavior | `VisualObject` | Present the object without allocating Rapier state |
| Physical motion and contact solution | Rapier | Return actual body poses through the physics port |
| Pose interpolation and visual binding | `SceneObject` owns the two authoritative frames | Apply immutable bindings to the supplied interpolated pose |

`VehiclePhysicsPort` has physical and raycast implementations. The factory selects one when the vehicle is created. The implementations own engine handles and worker-local request queues; they do not own vehicle rules, user commands, or object lifecycle state.

The physical implementation encapsulates bodies, colliders, joints, and collision-owner registrations. Each port operation covers the complete assembly. Wheel resources remain private records unless independent behavior later warrants a component class. Pure math and shape-description helpers may remain free functions.

`PresentationPort` provides prepare, activate, apply pose, reset, and release operations. Its Three.js implementation owns cloned nodes and immutable bindings. `SceneObject` owns the two-frame pose buffer and supplies the interpolated pose. The presentation port does not integrate wheel rotation, derive steering, or change object lifecycle.

## Authoritative Pose Contract

The semantic contract carries complete poses:

```ts
interface BodyPose {
  readonly worldPositionMeters: Vector3Value;
  readonly worldOrientation: QuaternionValue;
}

interface VehiclePoseFrame {
  readonly resourceId: number;
  readonly generation: number;
  readonly physicsStep: number;
  readonly topologyVersion: number;
  readonly chassis: BodyPose;
  readonly wheels: readonly {
    readonly wheelId: WheelId;
    readonly suspensionBody: BodyPose;
    readonly steeringBody: BodyPose;
    readonly tireBody: BodyPose;
  }[];
}
```

The physical implementation publishes exact Rapier poses. The raycast implementation publishes complete poses calculated by its worker-side controller. Both models use the same rendering contract.

The main thread may interpolate positions and quaternions between two frames. It may not integrate wheel rotation, derive steering, recalculate suspension travel, or feed interpolated state back to physics.

## Physics Shape and Visual Binding

The asset boundary creates one immutable, meter-scaled shape description for every rendered physical part. Physics and rendering consume the same description. Neither side recomputes bounds, centers, axes, or rest transforms.

The chassis collider uses a convex hull derived from authored chassis vertices when the asset supplies them. Tire dimensions come from authored wheel bounds. The production visual keeps the detailed GLB geometry and materials, while its transform follows the matching physical body.

`PresentationPort` calculates one immutable bind matrix per rendered part during creation:

```text
visualWorld = physicsBodyWorld × visualFromPhysicsBody
```

The bind matrix preserves the authored pivot, rest rotation, and scale. It removes the current assumption that runtime steering, spin, and suspension can be reapplied safely to GLB local transforms.

Required chassis and tire nodes bind one-to-one by stable IDs. Assets may omit visible suspension or steering hardware; when those nodes exist, they bind to their corresponding bodies. Creation fails with an asset diagnostic for missing required nodes, duplicate IDs, wheel-count mismatches, or non-invertible bind matrices.

A physics debug view renders collider shapes directly. It provides an exact collision silhouette for curb-contact diagnosis without replacing production materials.

### Visual overlap and physical penetration

A tire can overlap a curb on screen for two different reasons. The visual can disagree with a correctly positioned collider, or the collider itself can penetrate because of its shape, time step, solver settings, or contact configuration. The current scalar contract makes those cases difficult to distinguish.

The new boundary measures them separately. Pose-agreement diagnostics compare each rendered tire with its authoritative body pose. Contact diagnostics compare the tire collider with the curb geometry. `Vehicle` owns the assembly configuration; its physics adapter applies collider dimensions, continuous collision detection, solver iterations, suspension limits, and self-collision filtering as one complete setup. Exact visual binding exposes any remaining physical penetration instead of hiding it behind a second wheel calculation.

## Command Flow

```text
main-thread input/controller
  → SceneObjectRegistry / typed action
  → Vehicle.dispatch
  → VehiclePhysicsPort / target physics step
  → shared Rapier world step
  → authoritative pose frame
  → Vehicle.acceptPhysicsPose
  → PresentationPort / interpolation
```

Each action carries object ID, physics resource ID when applicable, generation, target physics step, and source-scoped sequence number. The main-thread object rejects stale identities, unsupported actions, duplicate sequences, and actions for removing or disposed objects. The worker port server rejects stale resource and generation messages.

This retires `AgentComponentRegistry`, `AgentComponent`, and `VehicleComponent`. Their staleness checks, per-agent command queue, and status publication move into `SceneObject.dispatch` and `Vehicle.applyAction`, which already own that validation for every action, not only drive commands. The existing `Middleware` transport (`vehicleControlChannel`, `commandStatusChannel`, `lifecycleChannel`, `tickChannel`, `keyboardChannel`) is not retired: it remains the bus that turns keyboard input and managed-controller ticks into `SceneObjectActionEnvelope`s addressed to `SceneObjectRegistry.dispatch`, and that carries acknowledgment back out as `CommandStatusMessage`. Only the per-capability component wrapper disappears; the pub-sub decoupling between input sources and the target object does not.

A changed drive command wakes the complete physical aggregate. Throttle applies motor targets to all four tire joints. Brake and neutral drag use the same wheel set. Steering affects only wheels described as steerable, while the returned tire poses still cover every wheel.

## Dynamic Spawn, Action, and Removal

`ScenarioSimulation` owns the live main-thread `SceneObjectRegistry` and exposes this runtime API:

```ts
interface SceneObjectRuntime {
  spawn(request: SpawnSceneObjectRequest): Promise<SceneObjectId>;
  remove(id: SceneObjectId, generation: number, targetStep?: number): Promise<void>;
  dispatch(action: SceneObjectActionEnvelope): Promise<void>;
}
```

The registry performs lookup and delegates behavior to the target `SceneObject`. It does not inspect subtype internals. Actions use discriminated message types instead of arbitrary method names or callbacks.

Spawn follows one transaction:

1. Reserve an object ID and generation on the main thread.
2. Prepare hidden rendering resources through `PresentationPort`.
3. If the object requires physics, allocate a fresh worker resource through its physics port and wait for its initial authoritative pose.
4. Construct and register the single `SceneObject`, then activate its presentation.
5. Complete the spawn request after the required ports acknowledge readiness.
6. On failure or cancellation, release both prepared sides. Late acknowledgments cannot reactivate canceled resources.

Removal follows one ordered transition:

1. Mark the object as removing and reject later actions.
2. If it has physics, request complete assembly release at the next requested physics-step boundary.
3. Release presentation nodes after the physics port acknowledges removal, then reject stale poses for that resource.
4. Delete the registry entry after all required ports acknowledge removal.

Repeated removal succeeds without side effects. Resource IDs are not reused within a generation. Stale requests cannot affect a replacement with the same authored ID. Reset neutralizes commands, resets the full assembly when present, and clears presentation interpolation history. Session pause stops shared stepping while lifecycle acknowledgments can still complete.

If a thread or transport fails, the session enters an error state and each surviving adapter releases its local resources. A replacement session uses a new generation. The API does not report successful removal before the required acknowledgment.

Physical props can use a `RigidObject extends SceneObject` with a rigid-body physics port. Visual-only props use `VisualObject`. Future object types extend `SceneObject` only when they share its lifecycle and presentation contract.

## Worker Transport for Heavy Scenes

Rapier stays in a dedicated worker so collision solving does not block rendering, input, or the HUD.

The TypeScript pose interfaces describe meaning. The high-frequency wire format uses packed numeric records in pooled transferable `ArrayBuffer` objects. Stable numeric resource and part IDs replace repeated strings. A topology table maps buffer slots to scene objects and parts when objects are added, removed, or rebuilt.

The transport follows these rules:

- batch commands by target physics step;
- advance the shared Rapier world once per fixed substep;
- publish one frame identity with generation, step, and topology version;
- retain only the two newest complete frames needed for interpolation;
- discard superseded render frames instead of replaying them and increasing latency;
- return consumed buffers to the worker for reuse;
- bound command and pose queues;
- cap catch-up work and report backlog.

`SharedArrayBuffer` may replace transferable buffers when deployment enables cross-origin isolation. The semantic contract remains unchanged.

One interacting Rapier world stays on one worker because its bodies can collide and constrain one another. Independent scenes may use separate workers. The design does not partition one collision world and lose cross-partition contacts.

## How the New Design Addresses Each Symptom

| Symptom | Current structural cause | New invariant |
|---|---|---|
| Steering input does not turn the vehicle | Command, steering state, joints, and wake behavior live in separate maps and functions | Main-thread `Vehicle` owns command and steering policy, applies complete targets through its physics port, and receives actual poses |
| Vehicle behaves as front-wheel drive | Drive-force application can select a subset without an aggregate-level rule | The vehicle applies AWD targets to its owned tire set as one operation |
| Suspended wheels do not spin | A command can change while child rigid bodies remain asleep | Any changed drive command wakes chassis, connectors, and all tire bodies |
| Front wheels keep spinning after release | Neutral drag and motor state can cover different wheel subsets | Brake and neutral drag operate on the same complete tire collection |
| Suspension jitters under uneven load | Assembly setup, solver tuning, contact rules, and sampling are spread across functions | `Vehicle` configures its complete assembly through one physics port; verification measures one-sided load stability |
| Tire appears inside a curb | Scalar reconstruction can misplace the visual; collider shape or solver configuration can also permit physical penetration | Exact tire poses remove visual error, while the physical aggregate owns and verifies collider and contact configuration |
| Physics and visuals drift | Both subsystems derive wheel state | Physics publishes authoritative poses; rendering only interpolates them |
| Dynamic removal leaves stale state | Cleanup spans unrelated maps on both threads | Removal is an idempotent aggregate transition with generation, resource, step, and topology validation |

## Required Invariants

- The main-thread registry owns one authoritative `SceneObject` instance per live entity.
- Each visible object owns one presentation port. Physics ports exist only for objects that require physics.
- `Vehicle` owns its vehicle policy and one exclusive vehicle physics port.
- The worker port server encapsulates all Rapier resources and registrations for its owning object.
- Each `SceneObject` owns its two-frame pose buffer; its presentation port owns rendering resources and immutable bindings, with no vehicle behavior or independent physical state.
- No consumer can access mutable bodies, joints, render nodes, or pose buffers.
- The shared physics world advances once per fixed substep regardless of agent count.
- All physical tires receive drive torque under throttle.
- Changed commands wake the complete physical vehicle.
- All tires receive consistent brake and neutral-drag behavior.
- Physical vehicle visuals use exact body poses and perform no independent simulation.
- Rendered physical-part origins remain within 5 mm of their interpolated authoritative poses.
- Rendered orientations remain within 0.5 degrees of their interpolated authoritative orientations.
- Flat-ground chassis motion after settling remains below 1 mm over five seconds.
- With one tire supported by a curb, suspension-body motion after settling remains below 2 mm over five seconds.
- A tire in curb contact has no persistent penetration deeper than 5 mm.
- Command and pose queues remain bounded under sustained load.
- Spawn and removal become visible only at explicit physics-step and topology-version boundaries.

## Product Verification

Verification uses a Physical Minivan in Downtown and inspects both sides of the physics-to-visual boundary.

1. Let the vehicle settle on flat ground for five seconds. Measure chassis stability and visual-to-physics pose agreement.
2. Suspend the vehicle and hold W. Confirm all four tire bodies wake, receive torque, and show rotation from returned tire poses.
3. Release W while suspended. Confirm all tires spin down together under neutral drag.
4. Drive with W+A and then W+D, or the matching arrow keys. Confirm front-tire orientation and chassis heading change in the commanded directions.
5. Drive one front tire onto a curb and stop. Measure contact penetration, suspension stability, and tire visual agreement.
6. Pause, resume, reset, replace the playback generation, and dispose. Confirm stale commands cannot affect the new generation and no owned resource remains.
7. Spawn a vehicle during playback, drive it through typed actions, and remove it while commands remain in flight. Confirm atomic appearance, stale-action rejection, synchronized physics and visual removal, and safe pose-buffer slot reuse.
8. Repeat with a representative heavy scene and many physical bodies. Record physics-step time, render-frame time, queue depth, buffer reuse, discarded superseded frames, and input latency. Confirm the UI remains responsive and queues stay bounded.

Temporary instrumentation will record physical and rendered part poses at the ownership boundary. The implementation will remove it afterward unless the pose-agreement diagnostic has continuing operational value. This work adds no unit tests unless requested.

## Migration Boundary

The implementation will:

- migrate `AgentSnapshot` and `AgentInstance` into generic `SceneObjectSnapshot` and `SceneObjectInstance` authored-data records;
- introduce live `SceneObject`, `VisualObject`, `RigidObject`, and `Vehicle` aggregates on the main thread;
- replace worker `PlaybackBody` records and vehicle-mutating free functions with worker physics-port servers and injected main-thread physics ports;
- retire `AgentComponentRegistry`, `AgentComponent`, and `VehicleComponent`, folding their staleness checks and command queue into `SceneObject.dispatch`; keep the `Middleware` channels as the transport into `dispatch` and out to `CommandStatusMessage`;
- replace scalar physical-wheel snapshots with complete part poses;
- replace wheel reconstruction in `AgentVisuals` with `PresentationPort` bindings owned by each scene object;
- add exclusive ports, topology versions, and typed scene-object action envelopes;
- preserve controller scripts, middleware channels, scenario records, and the physics-worker deployment model.

The implementation will not move Rapier onto the main thread, move Three.js into the worker, or partition one interacting physics world. It adds future scene-object subtypes only when they share `SceneObject` lifecycle and presentation behavior.
