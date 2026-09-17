# Scenario Studio

Updated 2026-09-17. Source-checked at commit `530ef75` on `main`.

**Progress: 4 of 11 milestones complete. Next: Milestone 5, typed runtime bus and multi-agent control.**

This is the single design, delivery, and review document for `/scenario_studio`. Sections marked **Finished** describe code present in the current checkout. Sections marked **Planned** define future requirements and do not claim implementation.

## Product scope

Scenario Studio assembles published environments, agents, controllers, sensors, and visualizations for physical simulation. Scene Studio remains the environment-authoring application; Scenario Studio must not depend on Scene Studio's `EditorState`.

The target product supports:

- Published scenes and agents with durable scenario persistence.
- Rapier simulation with replaceable physics boundaries.
- Concurrent per-agent control through a typed pub/sub bus.
- JavaScript controllers managed by the local backend and independently managed Python/C++ services.
- First-class IMU, camera, and LiDAR objects attached to agents or the world.
- Foxglove-style world and panel visualization driven by messages.
- Creator scripts, runtime populations, optional distance suspension, a MuJoCo adapter, and measured 100-agent operation as later milestones.

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
- One `inputEligible` agent accepts validated throttle, steering, and brake input from W/A/S/D, arrow keys, and Space.
- Vehicles support raycast wheels and an optional physical wheel rig with chassis hulls, steering joints, suspension joints, and wheel bodies.
- Vehicle tuning scales with authored size; wheel steering, spin, and suspension animate from playback snapshots.
- Scene material names drive persisted friction overrides and vehicle traction. Saving during playback still writes authored state only.

Current limitations: control remains single-agent and vehicle-shaped. The repository has no runtime message bus, controller process gateway, authored scripts, sensors, object hierarchy, custom visualization plugins, creator scripts, distance suspension, MuJoCo adapter, or 100-agent performance proof.

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

### Milestone 5: typed runtime bus and multi-agent control

- [ ] Add typed channels, advertisement, subscription disposal, simulation timestamps, session/run metadata, and bounded in-process routing.
- [ ] Introduce automatic and explicit agent components plus registry-driven construction.
- [ ] Move vehicle commands from the one controlled-agent global into per-agent `VehicleComponent` instances.
- [ ] Publish lifecycle, ticks, agent state, and capabilities.
- [ ] Remove the single-agent compatibility path after keyboard control works through the bus.

Acceptance: two vehicles accept independent typed commands in one run; invalid and stale commands return diagnostics; Pause and Reset clear controls without leaks or bursts.

### Milestone 6: backend gateway and controller SDKs

- [ ] Ship the local WebSocket/protobuf gateway with channel discovery, queue limits, reconnection, origin policy, and cleanup.
- [ ] Add `ScriptSupervisor` for validated managed JavaScript assets.
- [ ] Add JavaScript and Python client SDKs; keep C++ compatible through generated protobuf bindings.
- [ ] Persist script assets and assignments in a migrated scenario record.
- [ ] Replace the old in-browser worker/Pyodide plan in all implementation decisions.

Acceptance: two managed JavaScript controllers and one external Python controller can discover agents, consume ticks/state, publish commands, survive Pause/Resume, and stop cleanly on Reset.

### Milestone 7: sensor objects and hierarchy

- [ ] Add `SensorSnapshot`, `SensorPopulation`, frame references, validation, migration, and persistence.
- [ ] Add `TransformResolver`, sensor factory registry, lifecycle owner, hierarchy UI, inspector, attach/detach, and deletion policy.
- [ ] Add bodyless, fixed, and dynamic body policies behind physics adapters.

Acceptance: standalone and agent-attached sensors save/reopen with stable local/world poses; moving an agent moves its attached bodyless sensor; invalid or dangling parents cannot commit.

### Milestone 8: IMU, camera, and LiDAR

- [ ] Extend neutral physics snapshots/queries with kinematics and bounded ray batches.
- [ ] Implement IMU sampling, camera render targets, and LiDAR point clouds at simulation-time rates.
- [ ] Add schemas, frame metadata, noise/config validation, previews, backpressure, and complete cleanup.

Acceptance: each sensor publishes typed, timestamped data from the correct frame; configured rates remain tied to simulation time; repeated Play/Reset returns resources to baseline.

### Milestone 9: custom visualization

- [ ] Implement declarative world layers and contained panels.
- [ ] Add schema-driven built-in visualizers and a custom plugin registry.
- [ ] Add Worker/iframe isolation, quotas, lifecycle diagnostics, and persisted configuration.

Acceptance: an external script visualizes a path and point cloud, a custom panel displays camera messages, and removing or resetting a plugin releases all subscriptions, DOM, and GPU resources.

### Milestone 10: creator scripts and runtime populations

- [ ] Add declared dependencies, generation-bound runtime identities, spawn/configure/despawn commands, and stable ordering.
- [ ] Stage render, physics, controller, sensor, and visualization resources transactionally.
- [ ] Remove all runtime mutations on Reset and recover cleanly from partial failures.

Acceptance: a creator spawns and removes agents with controllers and sensors; failed creation leaves no partial resources; Reset restores the authored population.

### Milestone 11: engine and scale hardening

- [ ] Add measured distance suspension only if active-world cost requires it.
- [ ] Implement and verify the MuJoCo adapter when a scenario requires behavior Rapier cannot provide.
- [ ] Profile representative scenes and optimize measured bottlenecks for 100 simultaneously active vehicles.
- [ ] Harden recording, diagnostics, reconnect behavior, lifecycle cleanup, and cross-language compatibility.

Performance acceptance: after preload and warmup, run a representative 100-agent workload for 60 seconds in a foreground hardware-accelerated browser. Record browser, viewport/DPR, CPU/GPU, scene complexity, engine versions, substeps, controller/sensor costs, backlog, active counts, memory, FPS, and simulation/wall-time ratio. Target average FPS at least 58, p95 frame interval at most 25 ms, and simulation/wall-time ratio at least 0.95. Headless software rendering proves behavior, not hardware performance.

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

The completed-work summary above is source-verified at `530ef75`. Historical browser and test counts from earlier reviews are intentionally omitted; run the commands above for current evidence before making a release claim.

## Runtime references

- [Foxglove WebSocket protocol](https://github.com/foxglove/ws-protocol/blob/main/docs/spec.md)
- [Foxglove extensions](https://docs.foxglove.dev/docs/extensions)
- [Rapier JavaScript documentation](https://rapier.rs/docs/user_guides/javascript/getting_started_js)
- [MuJoCo browser bindings](https://github.com/google-deepmind/mujoco/tree/main/wasm)
