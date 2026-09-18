# Scenario Studio

Updated 2026-09-17. Source-checked at commit `c53cc04` plus the current working tree on `main`.

**Progress: 5 of 12 milestones complete. Next: Milestone 6, connect external controllers.**

This is the single design, delivery, and review document for `/scenario_studio`. Sections marked **Finished** describe code present in the current checkout. Sections marked **Planned** define future requirements and do not claim implementation.

## Product scope

Scenario Studio assembles published environments, agents, controllers, sensors, and visualizations for physical simulation. Scene Studio remains the environment-authoring application; Scenario Studio must not depend on Scene Studio's `EditorState`.

The target product supports:

- Published scenes and agents with durable scenario persistence.
- Rapier simulation with replaceable physics boundaries.
- Concurrent per-agent control through a typed pub/sub bus.
- JavaScript controllers authored in Scenario Studio and managed by the local backend, plus independently managed Python/C++ services.
- First-class IMU, camera, and LiDAR objects attached to agents or the world.
- Foxglove-style world and panel visualization driven by messages.
- Creator scripts, runtime populations, user-selected MuJoCo physics, optional distance suspension, and measured 100-agent operation as later milestones.

The first gateway is local to the simulator host. Durable broker storage, distributed federation, arbitrary unsandboxed browser code, general source-asset editing, buoyancy, two engines solving one interacting world, and live engine switching during playback are outside the current target.

## Finished summary

### Milestone 1: scene browsing

- `/scenario_studio` has its own composition root, viewport, HUD, published-scene catalog, search, refresh, previews, candidate selection, named replacement confirmation, and default ground.
- Imported GLBs use manifest units and transformed mesh geometry. Invalid or empty packages fail without replacing the active scene.
- Scene presentation and cached rendering resources have explicit, idempotent ownership and stale-load protection.

### Milestone 2: agents and placement

- The agent catalog discovers contained assets and reports unavailable malformed or duplicate entries.
- Users can configure, place, select, transform, duplicate, and delete agents through the product UI.
- Placement checks actual scene geometry, bridges, slope, overlap, water/non-supporting geometry, stale picks, and agent support relationships.
- Rapier runs in a dedicated worker behind the engine-neutral `PhysicsWorld` boundary.

### Milestone 3: scenario persistence

- Versioned scenario records persist the scenario identity, name, scene reference, Rapier key, authored agents, vehicle configuration, and material-friction overrides.
- New, Open, and Save use a contained server store with validation, atomic replacement, dirty-state confirmation, and failed-open/save preservation.
- Opening stages and validates scene, agent, physics, and presentation resources before committing the new document.

### Milestone 4: playback and vehicle physics

- Ready, Preparing, Running, Paused, and Error states coordinate Play, Pause, Resume, and Reset.
- The worker advances fixed `1/60 s` substeps, stamps snapshots by run generation, rejects stale work, and restores authored state on Reset.
- Keyboard input supplies validated throttle, steering, and brake commands from W/A/S/D, arrow keys, and Space.
- Vehicles support raycast wheels and an optional physical wheel rig with chassis hulls, steering joints, suspension joints, and wheel bodies.
- Vehicle tuning scales with authored size; wheel steering, spin, and suspension animate from playback snapshots.
- Scene material names drive persisted friction overrides and vehicle traction. Saving during playback still writes authored state only.

### Milestone 5: create and run JavaScript controllers

- [x] Added typed in-process channels, simulation timestamps, session/run metadata, bounded routing, and disposable advertisements and subscriptions.
- [x] Added registry-built agent components and moved commands into per-agent `VehicleComponent` instances and physics-worker command state.
- [x] Published lifecycle, ticks, agent state, capabilities, keyboard input, and correlated command status.
- [x] Added an accessible source editor, version-2 persisted script assets and assignments, version-1 migration, validation diagnostics, and dirty-state protection.
- [x] Added the backend-managed JavaScript `ScriptSupervisor` and lifecycle SDK with source, import, execution, instance, and queue limits.
- [x] Routed keyboard and script commands through the same component channels and removed the single-agent physics command path.

Verified outcome: one saved constant-throttle controller runs two assigned vehicles with independent script state. Pause emits no ticks or command burst, Resume continues the run, Reset restores authored state, and reopening restores source and assignments. Syntax, runtime, timeout, malformed-command, queue-limit, and stale-generation failures identify their controller and agent.

Current limitations: managed controllers are local JavaScript only. Users cannot connect external controller services, add sensors, create custom visualizations, generate runtime populations, select MuJoCo, or run a verified 100-agent workload.

## Architecture rules

- Domain objects own state and invariants. Immutable transport records may remain plain values.
- Inject replaceable physics, rendering, persistence, input, messaging, script, sensor, and visualization boundaries.
- Keep Three.js, Rapier, DOM, Worker, WebSocket, protobuf, filesystem, and process types inside adapters.
- Use composition for spatial relationships. A sensor is not an agent and does not inherit agent behavior.
- Add a factory or registry only when multiple implementations form a real family.
- Every owner exposes idempotent cleanup. Reset, replacement, disconnect, and disposal invalidate late asynchronous work before releasing resources.

## Scenario hierarchy and persistence

**Planned.** The authored hierarchy is:

```text
Scenario
├── Environment
├── Agents
│   └── Agent
│       ├── Components
│       └── Sensors
├── Standalone sensors
└── Visualizations
```

Agents, sensors, scripts, and visualizations remain separate persisted collections. References build the hierarchy; parent objects do not duplicate child ID lists.

The current record is version 1 and contains `sceneReference`, `engineKey`, `agents`, and `materialFriction`. The next schema revision must migrate older records without data loss and add component attachments, script assets/assignments, sensors, and visualization configuration. A missing sensors collection migrates to `[]`.

Persist authored state only. Runtime poses, physics handles, transient messages, subscriptions, live sensor buffers, and rendered primitives never enter the scenario record. Store script and visualization assets by portable ID and content hash rather than machine-specific absolute paths.

Record validation covers identity, version, finite numeric values, unique IDs, asset hashes, parent references, component and sensor configuration, rates, engine availability, and cyclic dependencies. Failed validation or staging preserves the active scenario and its saved file.

## Agent components and multi-agent control

**Planned.** Agent behavior is organized by computation ownership:

```ts
interface AgentComponent<TCommand extends Message> {
  readonly key: string;
  readonly capabilities: readonly AgentCapability[];
  readonly commandChannel: Channel<TCommand>;
  applyCommand(message: TCommand, context: CommandContext): CommandStatus;
}
```

Throttle, steering, and braking remain one `VehicleComponent` because the physics worker computes them together. Lighting or generic kinematics use separate components because another subsystem owns their behavior.

Automatic components derive from agent data and cannot be removed. Explicit components, including script attachments and accessories, use Add/Remove controls and persisted configuration. `AgentComponentFactory` and `AgentComponentRegistry` assemble the component set without branching on agent type.

The component rejects malformed, out-of-range, stale, and unauthorized commands with a correlated `CommandStatus`. It does not silently clamp or discard them. Each component retains its last accepted continuous command until replacement, timeout, Pause, Reset, or disposal returns it to neutral.

The current `DriveCommand`, `controlledAgentId`, and single global worker command are compatibility paths to remove after the multi-agent component path works end to end.

## Sensors and coordinate frames

**Planned.** Sensors are first-class scenario objects:

```ts
interface SensorSnapshot {
  readonly id: string;
  readonly name: string;
  readonly typeKey: string;
  readonly frame: {
    readonly parent: { kind: "world" } | { kind: "agent"; id: string };
    readonly localPose: Pose3;
  };
  readonly body:
    | { kind: "none" }
    | { kind: "fixed"; collision: CollisionShape }
    | { kind: "dynamic"; mass: number; collision: CollisionShape };
  readonly updateRateHz: number;
  readonly config: Readonly<Record<string, unknown>>;
}
```

`SensorSnapshot.frame.parent` is the only attachment source of truth. `TransformResolver` computes world poses without exposing rendering or physics types. Attaching or detaching a sensor preserves its world pose. Deleting an agent with attached sensors requires an explicit cascade or detach choice.

A bodyless sensor follows its resolved parent frame. A fixed sensor creates a body/collider joined to its agent or fixed to the world. A dynamic sensor creates an independently simulated body. Body policy remains independent of sensor type, so LiDAR and camera can be bodyless or body-backed.

`SensorTypeRegistry` contains real IMU, camera, and LiDAR factories. `SensorRuntime` schedules them from simulation time and owns all queries, render targets, buffers, publications, and cleanup.

- IMU publishes stamped pose, linear/angular velocity, and acceleration derived from physics kinematics.
- Camera renders from its resolved frame into an owned target and publishes bounded raw or compressed images.
- LiDAR submits bounded batched physics rays and publishes point clouds in a declared coordinate frame.

Sensor configuration defines rate, frame, range/resolution, noise, and type-specific limits. Reset, replacement, or disposal releases all sensor resources and invalidates pending samples.

## Runtime bus and backend gateway

**Planned.** Browser-resident components use a typed in-process bus. A WebSocket client bridges advertised channels to a local backend gateway. WebSocket supplies duplex transport; protobuf supplies schemas and cross-language bindings.

```ts
interface Middleware {
  advertise<T extends Message>(channel: Channel<T>): Advertisement;
  publish<T extends Message>(channel: Channel<T>, message: T, time: SimulationTime): PublishResult;
  subscribe<T extends Message>(channel: Channel<T>, handler: (event: MessageEvent<T>) => void): Subscription;
}
```

`Advertisement` and `Subscription` expose idempotent `dispose()`. Each channel fixes one topic, schema name, serialized schema, and encoding for its lifetime. Events carry simulation time, sequence, session ID, and run generation.

The gateway follows the Foxglove WebSocket model for server information, channel advertisement, subscriptions, client publishing, status, timestamps, and session identity. Implement only the required subset first while preserving compatible framing for later tools.

The gateway owns:

- External connection and topic routing.
- Schema advertisement and discovery.
- Per-client queue and frame-size limits.
- Latest-value pressure policy for controls and live sensor frames.
- Reliable ordered lifecycle and status delivery.
- Localhost binding, origin checks, and configured authentication policy.
- Reconnection, disconnect cleanup, and stale-generation rejection.

Core commands and sensor samples use concrete protobuf messages. Dynamic `google.protobuf.Struct` is not the core command format. Each command includes correlation, source, session, generation, and target-step metadata.

Initial topics:

| Topic | Payload | Publisher |
| --- | --- | --- |
| `simulation/lifecycle` | lifecycle/session state | Scenario runtime |
| `simulation/tick` | generation, step, time, `dt` | Scenario runtime |
| `agents/<id>/<component>/control` | component command | controller |
| `agents/<id>/state` | agent pose and kinematics | Scenario runtime |
| `agents/<id>/capabilities` | component capabilities | Scenario runtime |
| `input/keyboard` | key state change | input publisher |
| `sensors/<id>/metadata` | sensor/frame description | Sensor runtime |
| `sensors/<id>/imu` | IMU sample | IMU runtime |
| `sensors/<id>/image` | image | camera runtime |
| `sensors/<id>/points` | point cloud | LiDAR runtime |
| `visualization/<id>/scene` | declarative scene update | controller/visualizer |
| `status/commands` | correlated command status | command router |

## Controller model

**Planned.** `ScenarioSession` remains browser-resident and never spawns host processes. The backend gateway owns one `ScriptSupervisor` that starts and stops trusted workspace-local JavaScript controllers from validated asset references.

- Managed JavaScript starts during Play preparation, pauses command production on Pause, and stops on Reset, replacement, or disposal.
- External Python, C++, and persistent JavaScript services own their processes and connect through the same gateway.
- Clients discover the active session, agents, components, sensors, and schemas rather than relying on a hardcoded agent ID alone.
- A thin language SDK supplies `onStart`, `onTick`, and `onStop` lifecycle hooks, input state, typed component handles, subscriptions, diagnostics, and raw typed pub/sub as an escape hatch.

Controller scheduling uses simulation time. The runtime publishes tick `N`; commands targeting it apply at the defined step `N + 1` boundary. Pause publishes no ticks and accumulates no command burst. Reset changes the run generation, clears commands, and rejects earlier output.

Managed scripts have source/import limits, execution and queue budgets, useful syntax/runtime diagnostics, and guaranteed teardown. The gateway restricts script assets to configured workspace roots. Production packages the gateway as an explicit service; Vite middleware is only a development/review host.

Creator scripts use the same SDK and gateway but own runtime-only population changes. They declare asset dependencies, create/configure/despawn agents, and assign controllers through generation-bound references. Reset removes runtime mutations and recreates creator state on the next Play.

## Custom visualization

**Planned.** Visualization consumes advertised message channels and produces two kinds of output:

- World layers for poses, lines, paths, boxes, point clouds, camera frustums, markers, and labels.
- Panels for images, plots, tables, state, and diagnostics.

```ts
interface VisualizationPlugin {
  start(context: VisualizationContext): void;
  stop(): void;
  dispose(): void;
}
```

External scripts publish declarative `SceneUpdate`, `PointCloud`, `Image`, or other advertised messages. The browser owns the Three.js objects, DOM roots, and GPU resources created from those messages. Scripts never receive the raw Three.js scene.

Repository-owned plugins may implement the interface directly. User-authored transforms run in Web Workers; custom panel code runs in sandboxed iframes. Both receive capability-limited APIs, bounded history, size and primitive limits, and no unrestricted filesystem, DOM, renderer, or network access.

`VisualizationRegistry` maps schemas to built-in or custom visualizers. `VisualizationHost` owns one root per plugin and clears run-scoped output on Pause, Reset, replacement, disconnect, stale generation, or disposal.

## Playback, physics, and environments

The current Rapier worker remains the owner of the interacting world. The neutral physics boundary expands only when a concrete feature needs a query or command. Sensor ray batches, body kinematics, multi-agent component commands, activation, reset, and disposal stay engine-neutral at the boundary.

Scene colliders preserve authored transforms, meter conversion, concavity, raised surfaces, bridges, material names, and non-supporting water geometry. The simulator never inserts default ground below an imported environment. Material presets and per-scenario overrides remain separate from rendering colors.

Ready to Play snapshots authored state and enters Preparing until assets, physics, controllers, sensors, and visualizations are valid. Pause stops simulation time at an acknowledged boundary while leaving UI and camera responsive. Resume continues the same run. Reset invalidates work, removes runtime mutations, restores authored state, clears controls and sensor output, and returns to Ready.

Future distance suspension is off by default. It pauses dynamics and controller/sensor work for eligible distant agents, preserves visible state, uses hysteresis, and resumes only at a safe step boundary. The camera does not define simulation focus.

The planned MuJoCo adapter implements the same neutral boundary through official browser WASM bindings. It may rebuild internal models when topology changes, but it must preserve stable domain IDs and either commit the prepared replacement or leave the prior world intact. Rapier remains the default and no scenario silently falls back between engines.

## UI requirements

The current viewport, toolbar, browsers, and inspector remain the shell. Planned additions are:

- A hierarchy showing environment, agents, components, attached sensors, standalone sensors, and visualizations.
- Component and sensor Add/Remove/configuration controls.
- Script asset import/editing, assignment, validation diagnostics, and controller status. Failed import or validation preserves the current source.
- Gateway connection/session status.
- Sensor previews and bounded visualization panels.
- Errors that identify the owning agent, component, sensor, controller, or visualizer.

Authoring is allowed only in Ready unless a feature defines a safe staged edit. Running and Paused objects remain inspectable. Controls appear only when functional; the UI contains no scaffolding-only buttons.

## Remaining work

### Milestone 6: connect external controllers

**User outcome:** A user can run an independently managed service that discovers the active simulation, subscribes to available data, and controls agents through the local backend.

- [ ] Expose the runtime bus through the local WebSocket/protobuf gateway with channel discovery, schemas, client publishing, status, timestamps, and session identity.
- [ ] Add per-client queue and frame limits, latest-value pressure for controls, reliable lifecycle/status delivery, reconnection, origin policy, authentication policy, and disconnect cleanup.
- [ ] Add Python and external JavaScript SDKs; keep C++ compatible through generated protobuf bindings.
- [ ] Show gateway connection, client, session, and diagnostic status in Scenario Studio.
- [ ] Package the gateway as an explicit production service while retaining contained Vite middleware for development and review.

Acceptance: start an external Python controller, discover two agents without hardcoded IDs, subscribe to ticks and agent state, and publish independent commands. Disconnect and reconnect without retaining stale commands; Pause, Resume, Reset, and application shutdown leave no client, subscription, or process resources behind.

### Milestone 7: add and use IMU sensors

**User outcome:** A user can add an IMU to an agent or the world, configure its frame and rate, inspect its live values, and save the sensor with the scenario.

- [ ] Add `SensorSnapshot`, `SensorPopulation`, parent-frame references, validation, migration, persistence, and stable sensor identities.
- [ ] Add the scenario hierarchy, sensor Add/Remove controls, inspector, attach/detach behavior, and explicit cascade-or-detach handling when an agent is deleted.
- [ ] Add `TransformResolver`, sensor registry/runtime ownership, and bodyless, fixed, and dynamic body policies behind physics adapters.
- [ ] Publish IMU metadata, pose, linear/angular velocity, and acceleration at simulation-time rates with bounded noise configuration.
- [ ] Add a live IMU panel and expose the same typed data to managed and external controllers.

Acceptance: attach an IMU to a vehicle, view its values while driving, consume the same samples from a controller, save, reopen, and recover the configured local pose and rate. Moving the vehicle moves the sensor frame; invalid parents and cycles cannot commit; repeated Play/Reset releases sampling resources.

### Milestone 8: use camera and LiDAR data

**User outcome:** A user can attach cameras and LiDARs, preview their output, and consume typed image and point-cloud messages in controllers.

- [ ] Add camera and LiDAR sensor factories using the hierarchy, frame resolution, body policy, persistence, and lifecycle introduced by Milestone 7.
- [ ] Add owned camera render targets, bounded image encoding, batched physics rays, point-cloud generation, and declared coordinate frames.
- [ ] Add configuration for rate, resolution, range, field of view, sampling density, noise, and output limits.
- [ ] Add live previews, message schemas, backpressure, diagnostics, and cleanup for GPU targets, ray buffers, image buffers, and pending samples.

Acceptance: attach a camera and LiDAR to a moving vehicle, view both previews, and consume timestamped images and point clouds from a controller. Samples follow the configured frame and simulation-time rate. Invalid configuration preserves the last valid setup, and repeated Play/Reset returns owned resources to baseline.

### Milestone 9: create custom visualizations

**User outcome:** A user can choose available message channels and create a saved world overlay or panel that updates during simulation.

- [ ] Add a visualization browser/editor that lists compatible channels and creates persisted visualization instances from built-in or user-authored plugins.
- [ ] Implement declarative world layers for poses, lines, paths, boxes, point clouds, frustums, markers, and labels.
- [ ] Implement contained panels for images, plots, tables, state, and diagnostics with bounded history.
- [ ] Run user-authored transforms in Workers and panel code in sandboxed iframes with capability-limited APIs, quotas, and useful diagnostics.
- [ ] Add schema-driven `VisualizationRegistry` selection and `VisualizationHost` ownership for subscriptions, DOM, Three.js objects, and GPU resources.

Acceptance: select agent-state data to draw a path, select LiDAR data to draw a point cloud, and create a panel for camera images. Save and reopen all three. Removing a visualization, disconnecting its source, or resetting the run clears its subscriptions and owned resources without affecting the source data.

### Milestone 10: generate runtime populations

**User outcome:** A user can write a creator script that spawns, configures, controls, and removes agents and sensors while a scenario runs.

- [ ] Add creator-script assets, dependency declarations, editor diagnostics, and assignments using the existing controller workflow.
- [ ] Add generation-bound runtime identities and typed spawn, configure, assign-controller, attach-sensor, and despawn commands.
- [ ] Stage rendering, physics, controller, sensor, and visualization resources as one transaction before exposing a runtime object.
- [ ] Show authored and runtime-created objects distinctly in the hierarchy while keeping runtime mutations out of persisted authored state.
- [ ] Tear down creator state on Reset, replacement, failure, disconnect, and disposal in stable order.

Acceptance: write a creator that spawns a configured vehicle with a controller and sensor, observes it through a visualization, then removes it. A failed creation leaves no partial object or resource. Reset removes all runtime mutations, and the next Play recreates the same deterministic population.

### Milestone 11: choose a simulation engine

**User outcome:** A user can choose Rapier or MuJoCo for a scenario and understand whether the authored scenario is supported before starting playback.

- [ ] Implement the MuJoCo adapter through official browser WASM bindings behind the existing neutral physics boundary.
- [ ] Add engine selection, capability reporting, preflight validation, persisted engine configuration, and clear unsupported-feature diagnostics.
- [ ] Preserve stable domain IDs across MuJoCo model rebuilds and commit a prepared replacement only after every required body, joint, material, and sensor query succeeds.
- [ ] Keep Rapier as the default; never switch engines or downgrade behavior without an explicit user action.
- [ ] Verify equivalent lifecycle, command, sensor, reset, replacement, failure-preservation, and cleanup behavior across both engines where their declared capabilities overlap.

Acceptance: save one scenario with Rapier and another with MuJoCo, reopen each, and run supported controllers and sensors. An unsupported configuration blocks Play with actionable diagnostics while preserving the authored scenario and prior prepared world. Switching engines in Ready rebuilds successfully or leaves the previous engine active.

### Milestone 12: run large scenarios reliably

**User outcome:** A user can run, inspect, and diagnose a representative 100-agent scenario without unbounded latency, resource growth, or hidden simulation slowdown.

- [ ] Add runtime metrics for frame interval, simulation/wall-time ratio, step backlog, controller/sensor cost, message pressure, active/suspended counts, and memory/resource ownership.
- [ ] Add recording and diagnostic export for lifecycle, commands, state, sensor rates, disconnects, and dropped/coalesced messages.
- [ ] Profile representative saved scenarios and optimize measured bottlenecks across rendering, physics, messaging, controllers, sensors, and visualization.
- [ ] Add distance suspension only if measurements show inactive distant agents prevent the target workload from meeting its budget; expose its state and preserve safe step-boundary behavior.
- [ ] Harden reconnect, Reset, replacement, error recovery, and cross-language compatibility under sustained load.

Acceptance: after preload and warmup, run a representative 100-agent workload for 60 seconds in a foreground hardware-accelerated browser. Record browser, viewport/DPR, CPU/GPU, scene complexity, engine versions, substeps, controller/sensor costs, backlog, active counts, memory, FPS, and simulation/wall-time ratio. Target average FPS at least 58, p95 frame interval at most 25 ms, and simulation/wall-time ratio at least 0.95. The user can export diagnostics and identify throttled, suspended, disconnected, or failing participants. Headless software rendering proves behavior, not hardware performance.

## Verification

Use Docker Compose from the repository root. Do not install review dependencies on the host.

```bash
docker compose exec -T app npm run review:build
docker compose exec -T app npx --no-install vite-node scripts/verifyScenarioStudio.ts
docker compose exec -T app npx --no-install vite-node scripts/verifyApplicationWorkflows.ts
docker compose exec -T app npx --no-install vite-node scripts/verifyResourceLifecycle.ts
docker compose exec -T app npm run build:check
docker compose exec -T app npm test -- --run --maxWorkers=1 --minWorkers=1 tests/interactionSystem.test.ts tests/assetBrowserLayout.test.ts tests/disposeObject.test.ts
git diff --check
```

For a built-client review on port 4173:

```bash
docker compose run --rm --no-deps -p 127.0.0.1:4173:4173 app sh -c 'npm run review:build && npm run review:serve'
```

Verify behavior through product controls rather than console-injected state. Every milestone covers success, failure preservation, stale-work rejection, Reset/replacement/disposal, and affected application regressions. Do not add unit tests unless requested. A passing headless walkthrough does not establish hardware FPS.

The completed-work summary above is source-verified at `c53cc04` plus the current working tree. Historical browser and test counts from earlier reviews are intentionally omitted; run the commands above for current evidence before making a release claim.

## Runtime references

- [Foxglove WebSocket protocol](https://github.com/foxglove/ws-protocol/blob/main/docs/spec.md)
- [Foxglove extensions](https://docs.foxglove.dev/docs/extensions)
- [Rapier JavaScript documentation](https://rapier.rs/docs/user_guides/javascript/getting_started_js)
- [MuJoCo browser bindings](https://github.com/google-deepmind/mujoco/tree/main/wasm)
