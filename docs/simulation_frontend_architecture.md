# Simulation Frontend Architecture

## Overview

This document defines the initial frontend architecture for a browser-native robotics simulator.

The first target is autonomous-vehicle simulation, but the frontend should remain generic enough to extend to humanoids and other robotic agents later.

The frontend consists of three primary capabilities:

1. **Scene Editor**: create and modify simulation scenes.
2. **Scene Player**: run, pause, step, reset, and inspect simulations.
3. **Live Agent Runtime**: execute custom agent scripts inside the scene.

The initial implementation is fully client-side and does **not require an application backend**.

The architecture makes these boundaries explicit:

- `SceneDocument` is authored, validated, versioned data. It is not a Three.js object graph or a live physics world.
- `SceneRuntime` is a compiled, disposable execution instance. It owns simulation state and publishes render snapshots.
- The simulation worker is authoritative for simulation time, physics, sensors, and agent coordination.
- The main thread is authoritative for editor UI state and Three.js resources. It never advances simulation state.
- Worker messages are asynchronous. The design must tolerate delayed, dropped, or superseded render snapshots.

The initial release does not promise multiplayer collaboration, secure execution of untrusted code, bit-for-bit determinism across browsers, or server-side persistence.

---

## Product Characterization

The frontend is:

> A Three.js-based simulation authoring and playback application with an in-canvas editor layout, browser-side simulation runtime, and isolated programmable agent execution.

It is not just a renderer or visualization layer.

It owns:

- scene authoring
- simulation playback
- physics integration
- sensors
- live scripted agents
- scene inspection
- debugging UI

---

## Technology Stack

| Layer | Technology |
|---|---|
| Application UI | Three.js HUD/layout + TypeScript |
| 3D Rendering | Bare Three.js |
| UI / Three integration | In-canvas HUD and viewport layers coordinated by a composition root |
| Physics | Pluggable backend; Rapier WASM initially |
| Humanoid physics later | MuJoCo WASM option |
| Simulation execution | Dedicated Web Worker |
| Agent execution | Dedicated Web Worker per agent or worker pool |
| Worker communication | Versioned `postMessage` protocol with transferable buffers |
| High-rate shared state | TypedArrays; `SharedArrayBuffer` only when needed |
| Scene assets | GLB / glTF |
| Scene persistence | JSON initially; Protobuf-compatible model later |
| Build | Bazel |
| Packaging | Docker |
| Language | TypeScript strict mode |

The application does not require a component UI framework for the main simulator viewport.

Three.js owns the application UI, editor layout, and realtime visualization.

The simulation runtime owns physics, actors, sensors, and simulation time.

---

# 1. Scene Editor

The Scene Editor creates and modifies a canonical `SceneDocument`.

Typical layout:

```text
┌───────────────────────────────────────────────────────┐
│ Undo Redo     Move Rotate Scale      ▶ Play          │
├──────────────┬────────────────────────┬───────────────┤
│ Hierarchy    │                        │ Inspector     │
│              │                        │               │
│ World        │                        │ Vehicle       │
│ ├ Road       │      Three.js          │ Transform     │
│ ├ Ego        │      Viewport          │ Physics       │
│ │ ├ Camera   │                        │ Sensors       │
│ │ └ LiDAR    │                        │ Agent         │
│ ├ Car_01     │                        │               │
│ └ Human_01   │                        │               │
├──────────────┴────────────────────────┴───────────────┤
│ Assets / Scripts / Console                           │
└───────────────────────────────────────────────────────┘
```

## Editor Responsibilities

The editor is the sole writer of authored scene data. The Three.js HUD/layout layer should present:

- hierarchy
- inspector
- asset browser
- menus
- tabs
- forms
- scene metadata
- undo / redo
- selection metadata
- script configuration

Three.js should own:

- in-canvas docked layout
- HUD controls
- 3D viewport
- selection rendering
- raycasting
- camera
- grid
- transform gizmos
- scene visualization

A **gizmo** is an interactive 3D manipulation control such as move, rotate, or scale handles.

Three.js `TransformControls` can be used for this purpose.

---

# 2. Canonical Scene Document

The Three.js scene graph must **not** be the canonical scene file.

Use a framework-independent scene model.

Example:

```ts
interface SceneDocument {
  schemaVersion: number;
  id: string;
  name: string;

  assets: AssetDefinition[];
  entities: EntityDefinition[];
}

// Every referenced asset and entity ID must be unique.
// Entity parent links must form an acyclic hierarchy.
// Component payloads are validated before compilation.

interface EntityDefinition {
  id: string;
  name: string;
  parentId?: string;

  components: ComponentDefinition[];
}
```

An entity could look conceptually like:

```text
EgoVehicle
├── Transform
├── VisualModel
├── Collider
├── RigidBody
├── Vehicle
├── CameraSensor
├── ImuSensor
├── LidarSensor
└── AgentScript
```

A humanoid could later use:

```text
Humanoid_01
├── Transform
├── RobotModel
├── Articulation
├── CameraSensor
├── ImuSensor
├── JointSensors
└── AgentScript
```

This is component-based scene data, but a full ECS is not required initially.

The document format must also define, rather than imply:

- coordinate system and handedness
- units and unit conversions
- transform composition and parent-space semantics
- asset URI resolution and loading failures
- component type/version rules
- serialization of defaults and unknown fields

A validator must reject duplicate IDs, missing references, cycles, invalid component payloads, and unsupported schema versions before runtime compilation.

---

# 3. Editor Commands

Scene changes should go through an editor command system instead of arbitrary mutations.

Example:

```ts
editor.execute(
  new SetTransformCommand(
    entityId,
    newTransform
  )
);
```

This enables:

- undo
- redo
- dirty-state tracking
- deterministic change history
- reusable operations from gizmos and inspectors

Conceptually:

```text
Inspector ─────┐
               │
Gizmo ─────────┼──> EditorCommand ───> SceneDocument
               │
Hierarchy ─────┘
```

---

# 4. Scene Runtime

The editor and player should share the same runtime implementation.

Do not create independent editor and player renderers.

Use:

```text
                    SceneRuntime
                         │
                ┌────────┴────────┐
                │                 │
            EditorMode        PlayerMode
                │                 │
        selection/gizmo       simulation
        editing               physics
                              agents
                              sensors
```

The runtime maintains explicit entity mappings:

```text
SceneDocument Entity
        │ compile
        ▼
RuntimeEntity
├── stable entity ID
├── optional Three.js Object3D
├── optional physics handle
├── sensor handles
└── agent handle
```

The simulation worker owns authoritative runtime state. The viewport keeps only a presentation mapping from stable entity IDs to Three.js objects. Missing optional components are valid; invalid required references must fail compilation with a user-visible diagnostic rather than producing a partially initialized runtime.

Use stable entity IDs.

Do not use:

```ts
scene.getObjectByName(...)
```

for runtime dependency resolution.

## Runtime Boundary

`SceneRuntime` is a logical boundary, not a shared mutable object graph. Its authoritative simulation portion runs in the Simulation Worker. The main thread owns the Three.js presentation portion. They communicate through a versioned message protocol:

```text
Main thread                         Simulation Worker
  compile request  ───────────────▶  validate and build
  playback command ────────────────▶  advance runtime
  render snapshot  ◀───────────────  publish latest state
  diagnostics      ◀───────────────  report errors and events
```

Messages include a protocol version, scene or runtime ID, and simulation tick where applicable. Commands are idempotent or carry a request ID so stale responses can be ignored. A failed compilation leaves the previous runtime intact and returns structured diagnostics.

---

# 5. Play Mode

Pressing **Play** should create a runtime snapshot of the current scene.

```text
Editor SceneDocument
        │
        │ compile / snapshot
        ▼
RuntimeScene
├── physics bodies
├── actors
├── sensors
├── agents
└── rendering
```

The simulation operates on the runtime snapshot.

The snapshot is a deep, immutable-at-the-boundary compilation input. Runtime systems may mutate only their runtime-owned state. Editor commands may continue while stopped, but edits made during Play are either rejected or applied only to the next runtime; the MVP should reject structural edits while Play is active.

Stopping the simulation discards runtime mutations.

```text
RuntimeScene
    X discarded

Editor SceneDocument
    ✓ unchanged
```

This prevents physics or agent behavior from corrupting authored scene data.

---

# 6. Scene Player

The Scene Player executes compiled scenes.

Minimum controls:

- Play
- Pause
- Step
- Reset
- 0.5× speed
- 1× speed
- 2× speed

The player sends playback commands, but the simulation worker owns the authoritative clock and execution state. The player owns:

- play / pause / step / reset requests
- playback speed requests
- presentation of playback state

The simulation runtime owns:

- simulation clock
- physics stepping
- agent scheduling
- sensor scheduling
- runtime entity lifecycle
- reset implementation

Simulation time must be independent from browser render FPS.

The clock uses a fixed base timestep and an explicit accumulator or equivalent fixed-step policy. It must define behavior for overload, pause, reset, and speed changes. The MVP should cap catch-up work per render cycle and report dropped simulation time instead of blocking the UI indefinitely. `Step` advances exactly one configured physics timestep while paused; derived systems run according to their schedules.

Example:

```text
Physics            200 Hz
Vehicle Dynamics   200 Hz
IMU                200 Hz
LiDAR               20 Hz
Camera              30 Hz
Agent A             20 Hz

Rendering          ~60 Hz
Editor UI          event-driven
```

Rendering performance must not determine simulation timestep.

---

# 7. Live Agents

A scene entity may contain a live programmable agent.

Example:

```yaml
agent:
  script: agents/follow_lane.ts
  updateHz: 20

  parameters:
    targetSpeed: 10
```

A hierarchy may show:

```text
Vehicle_01
├── Transform
├── Vehicle
├── Sensors
└── Agent
    └── follow_lane.ts
```

Agents should be generic.

The same runtime can support:

- AV agents
- NPC vehicle agents
- pedestrian agents
- humanoid agents
- traffic-light controllers
- other scripted scene actors

---

# 8. Agent API

Agent scripts must **not** directly access Three.js, the renderer, or raw physics-engine objects.

Expose a controlled simulator API.

Example:

```ts
interface AgentContext {
  readonly time: number;
  readonly dt: number;

  self: SelfAPI;
  world: WorldAPI;
  sensors: SensorAPI;
  control: ControlAPI;

  log(...args: unknown[]): void;
}
```

Example vehicle agent:

```ts
export function onTick(ctx: AgentContext) {
  const speed = ctx.self.velocity();

  if (speed < 10) {
    ctx.control.throttle(0.4);
  } else {
    ctx.control.throttle(0);
  }
}
```

Example LiDAR-based agent:

```ts
export function onTick(ctx: AgentContext) {
  const lidar = ctx.sensors.lidar("front");

  if (lidar.minRange < 5) {
    ctx.control.brake(1);
    return;
  }

  ctx.control.throttle(0.3);
}
```

Agents should produce commands rather than directly mutating world state.

Each tick reads a coherent, immutable simulation snapshot. Commands are timestamped with the simulation tick, validated by the runtime, and applied at a defined phase after agent execution. If multiple agents target the same actuator, the runtime applies an explicit arbitration policy and reports conflicts. Commands that arrive late, are malformed, or target deleted entities are rejected without mutating simulation state.

```text
Simulation Snapshot
        │
        ▼
      Agent
        │
        ▼
     Commands
        │
        ▼
Simulation Runtime
```

---

# 9. Agent Lifecycle

Recommended lifecycle:

```ts
export interface Agent {
  onInit?(ctx: AgentContext): void | Promise<void>;

  onTick?(
    ctx: AgentContext
  ): void | Promise<void>;

  onEvent?(
    event: AgentEvent,
    ctx: AgentContext
  ): void | Promise<void>;

  onDestroy?(): void | Promise<void>;
}

// The runtime awaits each callback with a deadline and records failures.
// Callback execution is serialized per agent unless explicitly changed by the protocol.
```

Lifecycle:

```text
load
 ↓
onInit
 ↓
onTick
 ↓
onTick
 ↓
onEvent
 ↓
...
 ↓
onDestroy
```

Agents must not create their own simulation loops.

Do not allow scripts to own:

```ts
requestAnimationFrame(...)
setInterval(...)
```

Scheduling belongs to `AgentRuntime`.

---

# 10. Agent Isolation

Agent scripts should execute in Web Workers.

```text
Main Thread
├── Three.js editor UI
└── Three.js viewport

Simulation Worker
├── physics
├── sensors
└── agent coordinator
        │
        ▼
    Agent Worker
```

This prevents agent scripts from blocking the UI thread. It does not guarantee simulation progress: a simulation-worker stall, message backlog, or excessive sensor work can still reduce responsiveness.

A watchdog should enforce execution budgets. The budget must be measured in the agent worker, and timeout behavior must be explicit: reject the current tick, emit a diagnostic, and terminate or suspend the agent according to policy. Worker termination is not a way to interrupt arbitrary synchronous JavaScript reliably; the host must enforce a hard wall-clock limit by terminating the worker from outside it. Cleanup is best effort.

Example:

```text
Agent frequency: 20 Hz

normal budget: < 5 ms
maximum budget: 20 ms
```

If an agent exceeds the allowed budget, terminate the worker and expose an error state.

Example UI:

```text
Vehicle_01
Agent: follow_lane.ts

Status: ERROR
Reason: execution timeout
```

A Web Worker provides fault isolation from the UI thread, but should **not** be considered a secure sandbox for hostile code. In particular, do not expose secrets, privileged browser capabilities, or unrestricted network access to agent code.

For v1, agent scripts should be treated as trusted project code and loaded only from the current project. Any future untrusted-code mode needs a separately designed security boundary, capability policy, resource quotas, and an explicit threat model.

If arbitrary third-party scripts are supported later, use a stronger sandbox.

---

# 11. State Ownership

Three categories of state must remain separate.

## Application / Editor State

Owned by editor state and the Three.js HUD/layout layer:

- selected entity
- active editor tool
- open panels
- scene metadata
- configuration forms
- playback controls
- logs and status

## Render State

Owned by Three.js:

- scene graph
- meshes
- materials
- GPU buffers
- render targets
- camera
- visualization state
- gizmos

## Simulation State

Owned by the simulator runtime:

- actor poses
- velocity
- physics state
- joint state
- sensors
- controllers
- simulation clock

High-frequency state should flow directly:

```text
Simulation Worker
    ↓ asynchronous snapshots
Main-thread presentation cache
    ↓
Three.js
```

Snapshots should carry a monotonically increasing simulation tick or sequence number. The viewport may render the newest complete snapshot available and must never write authoritative simulation state. Use transferable buffers first; use `SharedArrayBuffer` only when profiling demonstrates a need and the required cross-origin isolation headers are available.

Avoid:

```text
Simulation
    ↓
component UI state
    ↓
Three.js
```

for realtime updates.

---

# 12. Frontend-Only Operation

The simulator frontend can operate without a traditional backend.

The browser can provide:

```text
Browser
├── Three.js editor UI
├── Three.js viewport
├── Scene Editor
├── Scene Player
├── Simulation Worker
│   ├── physics WASM
│   ├── sensors
│   └── scheduler
├── Agent Worker(s)
└── local scene / asset storage
```

No application backend is required for:

- scene creation
- scene editing
- scene playback
- physics
- sensors
- live agents
- local file loading
- local save/load
- GLB assets
- Protobuf decoding
- Web Workers
- WASM

A lightweight static HTTP server is still recommended instead of opening the app directly through `file://`.

This is needed for reliable support of:

- ES modules
- Web Workers
- WASM
- browser security policies

`SharedArrayBuffer` additionally requires a cross-origin-isolated context, normally established with appropriate COOP and COEP response headers. It is optional, not a baseline requirement for the frontend.

The static server is **not** considered an application backend.

---

# 13. When a Backend Becomes Necessary

A backend may be introduced later for:

- cloud scene persistence
- user authentication
- multi-user collaboration
- cloud asset management
- remote simulations
- distributed compute
- telemetry
- experiment tracking
- shared scenario libraries
- permissions
- versioned projects

These capabilities should remain optional additions rather than dependencies of the core simulator runtime.

---

# 14. Recommended Project Structure

```text
src/
│
├── app/
│   ├── App.ts
│   └── config.ts
│
├── editor/
│   ├── Editor.ts
│   ├── commands/
│   ├── hierarchy/
│   ├── inspector/
│   ├── assets/
│   └── tools/
│
├── player/
│   ├── Player.ts
│   ├── PlayerController.ts
│   └── PlaybackControls.ts
│
├── scene/
│   ├── SceneDocument.ts
│   ├── SceneSerializer.ts
│   ├── SceneCompiler.ts
│   └── components/
│
├── runtime/
│   ├── SceneRuntime.ts
│   ├── EntityRegistry.ts
│   ├── SimulationClock.ts
│   └── Scheduler.ts
│
├── agents/
│   ├── Agent.ts
│   ├── AgentContext.ts
│   ├── AgentRuntime.ts
│   ├── AgentWorker.ts
│   └── AgentProtocol.ts
│
├── viewport/
│   ├── ThreeViewport.ts
│   ├── Renderer.ts
│   ├── CameraSystem.ts
│   ├── SelectionSystem.ts
│   ├── GizmoSystem.ts
│   └── layers/
│
├── physics/
│   ├── PhysicsBackend.ts
│   └── rapier/
│
├── sensors/
│   ├── Sensor.ts
│   ├── CameraSensor.ts
│   ├── ImuSensor.ts
│   └── LidarSensor.ts
│
└── assets/
```

Important dependency rules:

```text
Editor
   ↓
SceneDocument
   ↓
SceneCompiler
   ↓
SceneRuntime
   ↓
Physics / Sensors / Agents

Player
   ↓
SceneRuntime

ThreeViewport
   ↓ consumes snapshots and sends presentation events
Runtime Presentation API
   ↓
SceneRuntime protocol
```

The viewport must not mutate `SceneRuntime` directly. Selection and gizmo results become editor commands, or explicit runtime control requests when the simulator is paused.

Forbidden dependencies:

```text
SceneRuntime → component UI framework ✗
SceneRuntime → Editor       ✗
Agent        → Three.js     ✗
Physics      → Three.js     ✗
```

---

# 15. MVP Scope

## Scene Editor

Initial features:

- hierarchy
- Three.js viewport
- entity selection
- move / rotate / scale gizmos
- inspector
- add / delete / duplicate entity
- GLB asset import
- save / load scene
- undo / redo
- Vehicle entity
- Static Object entity
- Camera sensor
- simple sensor configuration
- attach Agent script

## Scene Player

Initial features:

- Play
- Pause
- Step
- Reset
- playback speed
- physics
- camera sensor
- IMU
- simplified LiDAR
- live agents

## Live Agent Runtime

Initial features:

- JavaScript / TypeScript agent scripts
- Web Worker execution
- `onInit`
- `onTick`
- `onDestroy`
- read own state
- basic world queries
- sensor access
- command output
- logging
- execution timeout
- error reporting

---

# 16. Core Design Rules

1. `SceneDocument` is the authored source of truth.
2. Three.js scene state is runtime visualization state only.
3. Editor and Player share the same Scene Runtime.
4. Play mode executes a snapshot of the authored document.
5. Simulation state must not mutate the editor document.
6. Agents must not access Three.js directly.
7. Agents issue commands rather than directly mutating world state.
8. Agent scheduling uses simulation time.
9. Physics and rendering loops are independent.
10. Component UI frameworks must not own high-frequency simulation state.
11. Runtime entities use stable IDs.
12. Do not use object names for dependency lookup.
13. Custom agent scripts execute outside the UI thread.
14. Scene serialization must be independent of the rendering framework.
15. The core simulator must remain functional without an application backend.

---

## Final Architecture Summary

```text
                       Three.js Application
                              │
             ┌────────────────┴────────────────┐
             │                                 │
       Scene Editor                       Scene Player
             │                                 │
             └────────── SceneDocument ────────┘
                              │
                         SceneCompiler
                              │
                              ▼
                        SceneRuntime
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
      Physics               Sensors               Agents
        │                     │                     │
    Rapier WASM        Camera / IMU / LiDAR     Web Workers
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                      Runtime Snapshot
                              │
                              ▼
                        Three.js Viewport
```

The initial frontend should therefore be characterized as:

> **A standalone browser-native simulation authoring and playback environment with a versioned scene model, worker-authoritative simulation runtime, asynchronous Three.js presentation, and worker-isolated programmable agents.**

The key invariant is simple: authored data is changed through editor commands, simulation data is changed only by the simulation runtime, and the viewport renders snapshots without becoming an owner of either.
