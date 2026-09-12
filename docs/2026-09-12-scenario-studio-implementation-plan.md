# Scenario Studio Implementation Plan

> **For agentic workers:** Use the `executing-plans` skill to implement this plan feature by feature. Execute inline unless the user explicitly requests delegation. Track the feature steps and their implementation checklist with `- [ ]` syntax. Read the design spec before starting.

**Goal:** Deliver Scenario Studio with confirmed scene selection, physical agent placement, editable/importable JavaScript and Python scripts, automatic agent lifecycle handling, production Rapier and MuJoCo backends, and smooth simulation of 100 active agents.

**Architecture:** Domain objects own authored state and simulation lifecycle. Rendering, physics, input, scripting, and persistence are injected through replaceable boundaries. A registry selects an engine adapter without changing its consumers; one physics worker owns that engine's interacting world. Bounded JavaScript and Python worker pools execute scripts and return commands at defined simulation boundaries.

**Tech Stack:** Existing TypeScript, Vite, Three.js, Node server integration, and HUD controls; Rapier and official MuJoCo WebAssembly bindings behind separate physics adapters; Pyodide in browser workers; a native multiline script-editing surface. Resolve and pin new package/runtime versions during the feature that first needs them, using official documentation and the repository's Docker workflow.

**Spec:** [Scenario Studio design](2026-09-12-scenario-studio-design.md).

## Global constraints

- Scenario Studio at `/scenario_studio` assembles a published scene and agents, then previews their physics and scripted behavior. Scene Studio remains the environment-authoring app at `/scene_studio`.
- The first release targets 100 active agents with smooth playback.
- Physics is an explicitly replaceable subsystem. Production must include both **Rapier** and **MuJoCo** backends.
- Additional engines integrate by implementing the physics contract and registering an adapter, without changing scenario, agent, script, or UI consumers.
- Show the default empty green flat ground only when no scene is selected. Imported scenes never receive this fallback surface or collider.
- Python targets Pyodide's supported standard library; a local Python service, native package support, and ML integrations are outside this release.
- Users choose assets, edit settings and scripts, and control playback. Instance IDs, worker placement, lifecycle transitions, resource ownership, and cleanup are internal responsibilities.
- Domain objects own private state and enforce legal transitions. Transport records may be plain data; domain behavior must not be a collection of public mutable records.
- Do not add unit tests unless explicitly requested. Use build/type checks and direct browser verification, with repeatable browser scripts where useful.
- Do not rely on distance suspension to pass the 100-active-agent acceptance case.
- Keep the user's existing changes and assets intact. Commit only the files belonging to the completed feature.
- Run dependency installation and project builds inside Docker, following `README.md`.

---

## What counts as a completed step

Each numbered step is a complete, independently reviewable product feature. Its domain changes, adapters, UI, persistence updates, error handling, and documentation ship together. Internal setup is part of that feature's checklist, never a separate milestone.

At the end of each step, the reviewer can open the real application, use real assets through its normal controls, and observe the promised behavior without a console command, mock server, manually injected state, or another unfinished step. Earlier features continue to work. Controls for features not yet delivered remain absent; do not ship inert buttons or language choices that cannot execute.

Review the built client as well as the development app. Step 1 makes the Scenario Studio server middleware reusable by development and local release-build review. A Vite preview is a local review server, not a production hosting strategy. Each feature must use the same API contracts in the production host; this plan does not authorize deployment or invent new hosting infrastructure.

Before marking any step complete:

1. Run that step's browser walkthrough against the actual app and collect a screenshot or short recording of its result.
2. Run `docker compose exec -T app npm run build:check` and `git diff --check`.
3. Run relevant existing regression checks only when the changed shared code warrants them. Do not add unit tests.
4. Review the diff for resource ownership, cross-module coupling, failure behavior, and regressions in `/scene_studio`.
5. Record the commands/results and any measured limitations in the feature's commit or review description. Commit the complete feature as a review boundary.

For local release-build review, Step 1 introduces these scripts:

```text
npm run review:build
  tsc --noEmit && vite build --outDir /tmp/steerlab-review-dist --emptyOutDir

npm run review:serve
  vite preview --outDir /tmp/steerlab-review-dist --host 0.0.0.0 --port 4173
```

Run both inside the Compose app container. The review server must mount the same Scenario Studio APIs and read-only asset routes as development. Use an available host-port mapping for browser access; do not interrupt the existing port-5173 app or alter its saved data. Pass a separate `STEERLAB_SCENARIOS_DIR` for review writes from Step 3 onward.

## File ownership and reuse map

Paths below are the intended locations. Before creating a file, use CodeGraph to check for an existing equivalent. If an existing type serves the same responsibility, extend it and update this plan's path rather than duplicating it.

| Path or group | Responsibility |
| --- | --- |
| `src/scenario-studio/main.ts`, `ScenarioStudioApp.ts` | Route entry and composition root; create concrete adapters and own shutdown. |
| `src/scenario-studio/domain/ScenarioDocument.ts`, `ScenarioSession.ts` | Authored document invariants, scene-change transactions, playback/run generation. |
| `src/scenario-studio/domain/AgentInstance.ts`, `AgentPopulation.ts` | Per-agent state and automatic population lifecycle. |
| `src/scenario-studio/domain/scene.ts`, `agent.ts`, `scenario.ts` | Focused immutable transport records/value types for the corresponding domain concepts. |
| `src/scenario-studio/catalog/SceneCatalog.ts`, `AgentCatalog.ts`, `HttpSceneCatalog.ts`, `HttpAgentCatalog.ts` | Catalog boundaries and HTTP implementations. |
| `src/scenario-studio/ui/ScenarioWorkspace.ts`, `AssetBrowserPanel.ts`, `SceneBrowserTab.ts`, `AgentBrowserTab.ts`, `AgentInspectorPanel.ts`, `PlaybackToolbar.ts` | Scenario-specific composition of existing HUD primitives and user actions. |
| `src/scenario-studio/ui/ScriptEditorPanel.ts`, `ScenarioScriptPanel.ts`, `PerformancePanel.ts` | Complete script-authoring and performance-inspection features. |
| `src/scenario-studio/rendering/ScenarioViewport.ts`, `SceneGeometrySource.ts`, `AgentVisuals.ts` | Three.js adaptation, scene extraction, model ownership, interpolation, selection. |
| `src/scenario-studio/domain/DefaultGround.ts` | Validated built-in green-ground definition, shared by rendering and physics adapters. |
| `src/scenario-studio/physics/PhysicsWorld.ts`, `PhysicsWorkerClient.ts`, `physics.worker.ts`, `RapierPhysicsWorld.ts`, `VehicleController.ts`, `SurfacePresets.ts`, `WaterRegions.ts` | Engine-neutral physics boundary and worker/engine implementations. |
| `src/scenario-studio/physics/PhysicsEngineRegistry.ts`, `mujoco/MujocoPhysicsWorld.ts`, `mujoco/MujocoModelCompiler.ts`, `mujoco/MujocoAgentSlots.ts`, `mujoco/MujocoVehicleController.ts`, `ui/PhysicsEnginePanel.ts` | Registered engine selection and MuJoCo model/collision/lifecycle adaptation. |
| `src/scenario-studio/input/ScenarioInput.ts` | Focus-aware camera, editor, and controlled-agent input routing. |
| `src/scenario-studio/scripts/ScriptProgram.ts`, `ScriptRuntime.ts`, `ScriptScheduler.ts`, `ScriptContext.ts`, `JavaScriptRuntime.ts`, `javascript.worker.ts`, `JavaScriptCompiler.ts`, `PythonRuntime.ts`, `python.worker.ts` | Script sources, validated commands, lifecycle, scheduling, and language adapters. |
| `src/scenario-studio/simulation/DistanceActivation.ts`, `SimulationMetrics.ts` | Optional simulation activation and measured runtime costs. |
| `src/scenario-studio/persistence/ScenarioRepository.ts`, `HttpScenarioRepository.ts` | Persistence boundary and client adapter. |
| `server/scenarioStudioPlugin.ts`, `server/scenarioStudio/routes.ts`, `publishedScenes.ts`, `agentCatalog.ts`, `scenarioStore.ts` | Shared HTTP composition, discovery, validation, atomic persistence. |
| `scripts/verifyScenarioStudio.mjs`, `scripts/benchmarkScenarioStudio.mjs` | Direct product walkthroughs and browser performance capture; not unit tests. |
| `docs/scenario-studio-review.md`, `docs/scenario-studio-performance.md` | Repeatable reviewer instructions and actual measured performance evidence. |

Reuse `Renderer`, `RenderLoop`, `Viewport`, `CameraRig`, `InteractionSystem`, HUD kit primitives, and `ThumbnailRenderer` where their contracts fit. Keep the Scenario Studio viewport separate from `WorldFeature`, which depends on `EditorState` and terrain-authoring behavior. Reuse or extend `AssetManager` for model caching with explicit ownership; its clones share geometry/materials and must not be individually disposed as owners.

Do not create empty versions of every file in this map. Introduce each file with its first working feature.

## Delivery sequence

| Step | Complete feature | Reviewer sees |
| --- | --- | --- |
| 1 | Browse and confirm a published scene | Real scene cards and an interactive loaded viewport. |
| 2 | Add, inspect, edit, and remove agents | Shared browser tabs, physical placement, and left Agent Inspector. |
| 3 | Save and reopen scenarios | A complete authored setup survives page refresh and reopening. |
| 4 | Play, pause, reset, and control a vehicle | Physical motion, collisions, driving, and reliable restoration. |
| 5 | Physical surface interactions | Observable asphalt/grass/stone behavior and water-region drag. |
| 6 | Write/import JavaScript agent behavior | A script edited in the inspector controls a placed agent. |
| 7 | Create populations with a scenario script | Startup/timed spawning and despawning without manual lifecycle work. |
| 8 | Write/import Python behavior and creator scripts | Python and JavaScript agents execute together in the browser. |
| 9 | Suspend selected agents when distant | A working opt-in setting with visible activation status. |
| 10 | Select and use the MuJoCo production backend | The existing app and scripts work with either registered engine. |
| 11 | Run and inspect 100 agents smoothly | Repeatable 100-agent playback and measured results for both engines. |

---

## Step 1 — Browse and confirm a published scene

- [x] **Feature complete and reviewed**

**Deliverable:** `/scenario_studio` opens on an empty green flat ground with a usable viewport and Scenes browser. Clicking a card previews its selection; **Use Scene** loads the actual package after confirmation. No agent or playback controls are exposed in this step.

**Files:** Create the route/composition root, scene domain/catalog files, `DefaultGround.ts`, `ScenarioDocument.ts`, `ScenarioSession.ts`, workspace/scene-browser UI, `ScenarioViewport.ts`, `server/scenarioStudioPlugin.ts`, `server/scenarioStudio/routes.ts`, `server/scenarioStudio/publishedScenes.ts`, and `docs/scenario-studio-review.md`. Modify `src/main.ts`, `vite.config.ts`, `package.json`, and `README.md`.

**Boundary:** Define these records in `domain/scene.ts` and the interface in `catalog/SceneCatalog.ts`. `EnvironmentManifest` is the existing engine-free type from `src/environment/types.ts`.

```ts
export interface SceneReference {
  readonly key: string;
  readonly modelSha256: string;
  readonly manifestSha256: string;
  readonly formatVersion: number;
}
export interface SceneChoice {
  readonly label: string;
  readonly reference: SceneReference;
  readonly thumbnailUrl: string | null;
  readonly available: boolean;
  readonly diagnostics: readonly string[];
}
export interface ScenePackageData {
  readonly reference: SceneReference;
  readonly manifest: EnvironmentManifest;
  readonly glb: Uint8Array;
}
export interface SceneCatalog {
  list(): Promise<readonly SceneChoice[]>;
  load(reference: SceneReference): Promise<ScenePackageData>;
}
```

`ScenarioSession.replaceScene(reference: SceneReference): Promise<void>` is the only committed scene-change action. The UI owns the confirmation dialog; the domain does not call DOM APIs. Prepare the new owned viewport resource, check the request generation, then commit document/presentation together and dispose the old resource. On failure, dispose the prepared resource and retain the old setup.

**Implementation checklist:**

- [x] Discover the root `environment.json`/`environment.glb` pair and nested packages under `assets/scenes`. Use canonical relative keys; validate path containment, manifest version, model hash, and finite positive units. A bad package becomes an unavailable card with its reason instead of breaking the entire list.
- [x] Add `GET /api/scenario-studio/scenes` and package-loading routes to shared middleware. Serve required scene/agent source files under their explicit asset prefixes in built-client review without shadowing Vite's hashed `/assets` bundles. Attach middleware through both development and preview hooks.
- [x] Compose existing renderer/camera/HUD facilities into the new app. Scope keyboard/pointer handlers and resize behavior to its canvas. Load models with original transforms and units; fit the camera to the actual scene bounds.
- [x] Add the built-in default environment for a null scene reference: a flat green 100 m by 100 m ground centered at Y=0. Own its geometry through the scene transaction. When selecting any imported scene, remove the default surface; never recreate it underneath an import because a ground mesh is missing. Treat the default environment as active when deciding to show the replacement warning.
- [x] Implement candidate selection, **Use Scene**, loading progress, Refresh, errors, and the specified replacement confirmation. At this stage the agent-removal count is zero. Selecting the unchanged active reference does nothing; changed content is a replacement.
- [x] Protect against rapid selection, cancellation, and route disposal with request generations. Failed or obsolete loads must release their resources.
- [x] Add the release-build review scripts defined above and document exact commands/URLs used in the local environment. Extend the same shared middleware when subsequent features add routes.

**Production review:** Open the built app and observe the empty green flat ground. Load the existing published scene, verify the default surface is removed, orbit/zoom/resize, choose another valid package, cancel replacement, then confirm it. Load a valid package with no ground mesh and verify no green fallback appears beneath it. Refresh the catalog after adding/removing a review fixture. Try an invalid hash and confirm the current scene remains visible. Verify `/scene_studio` still works in its existing supported environment.

**Exit gate:** Real package geometry renders; selection alone never replaces it; cancellation/failure is nondestructive; the built client can reach the same catalog and source files. Commit: `feat: browse published scenes in Scenario Studio`.

## Step 2 — Add, inspect, edit, and remove agents on physical surfaces

- [ ] **Feature complete and reviewed**

**Deliverable:** The shared browser now has Scenes and Agents tabs. Users add or drag agents onto real colliders and edit/remove them through the left Agent Inspector. Scene replacement removes the complete population after the warning.

**Files:** Create `domain/agent.ts`, `AgentInstance.ts`, `AgentPopulation.ts`, agent catalog adapters, `AgentBrowserTab.ts`, `AgentInspectorPanel.ts`, `AssetBrowserPanel.ts`, `rendering/SceneGeometrySource.ts`, `AgentVisuals.ts`, and the physics boundary/worker/adapter files. Modify the workspace, document/session, server routes, `server/assetCatalog.ts` where reuse needs a configurable URL base, `package.json`, lockfile, and the review guide.

**Consumes:** Step 1 scene/session contracts and existing `AssetCatalogEntry` metadata. **Produces:** `AgentDraft` with asset key, display name, position/heading, positive mass, collision configuration, and placement settings; `AgentInstance` owns validated state. Define engine-free geometry records and placement contracts in `physics/PhysicsWorld.ts`:

```ts
export interface Vector3Value { readonly x: number; readonly y: number; readonly z: number; }
export interface Ray3 { readonly origin: Vector3Value; readonly direction: Vector3Value; }
export interface PlacementHit { readonly point: Vector3Value; readonly normal: Vector3Value; }
export interface PlacementSurface {
  pickSurface(ray: Ray3): Promise<PlacementHit | null>;
}
export interface PhysicsWorld extends PlacementSurface {
  dispose(): Promise<void>;
}
export interface PhysicsEngineFactory {
  readonly key: string;
  create(): Promise<PhysicsWorld>;
}
```

`ScenarioSession.placeAgent(draft: AgentDraft, ray: Ray3): Promise<void>` validates support/overlap before committing. `AgentPopulation` allocates identity internally and exposes behavior for adding, editing, selecting, duplicating, and removing instances. The viewport receives snapshots/events rather than owning domain state.

Register the Rapier factory through `PhysicsEngineRegistry`; the explicit replacement requirement justifies this boundary from the first physics feature. Extend `PhysicsWorld` with complete body/control/step operations in Step 4 and implement both backends against that same contract. The contract uses engine-neutral shapes, units, commands, and snapshots; engine keys are open registered strings.

**Implementation checklist:**

- [ ] Scan only `assets/agents`; preserve public model/thumbnail URLs when catalog parsing is reused. Read vehicle metadata, reject duplicate keys, and present unavailable assets with diagnostics. Add `GET /api/scenario-studio/agents`.
- [ ] Pin Rapier in Docker and register its worker adapter behind the placement boundary. Extract all mesh groups/instances with world transforms and convert scene units consistently to physics meters. Keep collider descriptors independent of Rapier classes so the MuJoCo compiler can consume the same scene definition in Step 10.
- [ ] Create a static support collider from `DefaultGround` only for the null-scene environment. Imported packages get colliders from actual geometry, not from the mere presence of `manifest.ground`. Dispose the default collider when loading an import, and exercise placement both before and after that transition.
- [ ] Implement thumbnail cards, independent tab searches/selections, and the **New agent** versus **Existing agent** inspector contexts. Browser settings become per-asset placement drafts; instance edits stay local to that instance. Hide the Script and suspension controls until their complete features arrive.
- [ ] Implement Add/click and drag/drop with a valid/invalid ghost, Escape cancellation, and stale-pick rejection. Use collision bounds and a small contact clearance to seat the body; reject unsupported, overlapping, or excessively steep placement. Exclude agents and water-tagged geometry from support targets.
- [ ] Add instance selection, name/position/heading/mass editing, duplicate, and delete actions with finite-value/positive-mass checks. Moving/duplicating reruns support and overlap validation. Read source unit metadata rather than automatically shrinking vehicles to fit a tile.
- [ ] Own render instances and colliders as one placement transaction. Dispose both on failure/removal; keep shared model resources alive while referenced. Integrate population clearing into scene replacement, including the accurate warning count.

**Production review:** Select a car in the browser and observe the left inspector; set a name/default, add it on a road, drag a second onto a bridge, and try dropping outside the world, on water, and on another agent. Edit one instance and verify the other stays unchanged. Duplicate/delete it. Switch scenes: Cancel preserves all agents, Confirm clears them, and a failed scene load preserves them. Verify at least two agent types at correct physical scale.

**Exit gate:** Placement uses actual supporting geometry and automatic lifecycle cleanup; the two inspector contexts cannot overwrite each other. Commit: `feat: place and inspect scenario agents`.

## Step 3 — Save, reopen, and create scenarios

- [ ] **Feature complete and reviewed**

**Deliverable:** Users can create, name, save, and reopen an authored scenario through the toolbar, including its scene and agent settings.

**Files:** Create `domain/scenario.ts`, persistence boundary/client files, `server/scenarioStudio/scenarioStore.ts`, and a scenario document picker in the UI. Modify document/session, toolbar/workspace, shared routes, and review documentation.

**Boundary:** Define `ScenarioRecord` in `domain/scenario.ts` with format/version, document ID/name, `SceneReference | null`, default-ground settings, an open registered physics-engine key (default `rapier`), and authored agent records. A null scene reference selects the built-in green ground and remains runnable. Each following feature adds its own fields with normalization defaults and updates save/open in the same feature. Older documents remain readable. Unavailable engine keys remain recoverable document data and block Play with a diagnostic; do not silently replace them.

```ts
export interface ScenarioSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}
export interface ScenarioRepository {
  list(): Promise<readonly ScenarioSummary[]>;
  open(id: string): Promise<ScenarioRecord>;
  save(record: ScenarioRecord): Promise<void>;
}
```

**Implementation checklist:**

- [ ] Add scenario list/open/save routes below `/api/scenario-studio/scenarios`, using a dedicated `STEERLAB_SCENARIOS_DIR` override and `~/.steerlab/scenarios` default. Validate route IDs, schema versions, scene references, numeric values, and duplicate instance identities before writing.
- [ ] Reuse the existing atomic temporary-file/rename convention. Preserve the prior file on validation or write failure; report the error in the product.
- [ ] Add New/Open/Save, scenario naming, and unsaved-change tracking. Confirm discarding unsaved work on New/Open or navigation away. Scene replacement marks the working document dirty but does not auto-save it.
- [ ] Reconstruct domain objects through validating constructors when loading. Stage the scene and all initial agents before replacing the current setup. If assets are missing, retain the document/source data in a recoverable, non-runnable state with specific diagnostics.
- [ ] Preserve inspector placement drafts in the session and committed instance edits in the document. Distinguish document state from renderer/physics snapshots so future playback cannot leak runtime positions into saves.

**Production review:** Place two different agents, rename/configure them, save, reload the page, and reopen the scenario. Confirm the scene and exact authored transforms/settings return. Repeat with the default green ground and verify it remains the selected environment. Replace its scene and verify the agent list is empty but reopening the saved copy restores the previous setup. Exercise a failed write and a missing-asset document without losing the last good saved file.

**Exit gate:** A saved setup survives a new browser session; failures preserve recoverable data. Commit: `feat: save and reopen scenarios`.

## Step 4 — Play, pause, reset, and drive a physical vehicle

- [ ] **Feature complete and reviewed**

**Deliverable:** Users press Play to see physical motion/collisions, pause without losing camera control, reset to the authored setup, and use **Control this agent** to drive a vehicle.

**Files:** Create `ui/PlaybackToolbar.ts`, `input/ScenarioInput.ts`, `physics/VehicleController.ts`, and `simulation/SimulationMetrics.ts`. Extend session/population, physics worker/adapter, `AgentVisuals.ts`, document persistence, and the inspector/review guide.

**Boundary:** Define engine-free `DriveCommand` with throttle/steering in `[-1, 1]` and brake in `[0, 1]`. Extend the physics interface with step, control-command, snapshot, reset, and disposal operations. Each logical step consumes exactly 1/60 second; adapters can internally substep without changing script time or exposing solver types. Snapshots carry generation, step index, simulation time, transforms, velocities, and wheel pose data. The session exposes `play(): Promise<void>`, `pause(): void`, and `reset(): Promise<void>`.

```ts
export const PHYSICS_STEP_SECONDS = 1 / 60;
export type PlaybackState = "ready" | "preparing" | "running" | "paused" | "error";
export interface RunStamp { readonly generation: number; readonly step: number; }
```

**Implementation checklist:**

- [ ] Implement legal playback transitions, authored-baseline capture, generation invalidation, and bounded fixed-step advancement in the physics worker. Render interpolated snapshots through the existing single render loop; do not run physics on the rendering thread.
- [ ] Construct chassis bodies and wheel controls from `vehicle.json`; apply steering/braking/throttle through an injected vehicle adapter. Animate wheel steering, spin, and suspension from simulation snapshots. Assets without vehicle metadata use validated generic bodies.
- [ ] Add **Control this agent**, input eligibility, and visible control bindings. Clear input on blur, Pause, Reset, and text focus. In this step the built-in controller uses the same drive-command boundary that scripts will consume.
- [ ] Restrict authored edits to ready state. A paused run remains inspectable, and Reset restores editability. Prevent duplicate Play starts and hold preparing state until models/physics are ready.
- [ ] Reset replaces all live transforms/velocities/control state from the authored baseline. Ignore delayed snapshots from prior generations; release bodies/vehicle controls on removal and scene change. Save during playback serializes only the authored document.
- [ ] Extend persisted settings with input eligibility and physics configuration, normalizing older files. Record live body/instance counts internally for leak verification from this step onward.

**Production review:** Place cars on flat and sloped support, Play, and observe gravity/collisions. Control one car, drive/steer/brake, pause while holding a key, move the camera, resume, and verify no stuck input. Reset repeatedly and confirm exact authored positions and zero velocities. Save during a run and reopen: the original setup returns. Change scene during playback and verify the old world cannot reappear.

**Exit gate:** Visible physical driving and reliable Play/Pause/Reset work in the built app; resource counts return to baseline. Commit: `feat: preview and control scenario physics`.

## Step 5 — Drive across physical surfaces and water regions

- [ ] **Feature complete and reviewed**

**Deliverable:** Scene surfaces produce observable physical differences, and users can inspect/change their preset mapping in a Scene Physics section reached from the active scene's details.

**Files:** Create `physics/SurfacePresets.ts`, `physics/WaterRegions.ts`, and `ui/ScenePhysicsPanel.ts`. Extend geometry extraction, physics/vehicle adapters, scene loading, document persistence, and the review guide.

**Boundary:** Define `SurfacePreset` as a validated value object for a solid surface or water region. A solid preset owns contact friction, restitution, and rolling-resistance settings; a water preset owns depth and drag. Concrete surface behaviors implement the physics adapter's surface-policy contract, keeping engine types out of the document.

**Implementation checklist:**

- [ ] Preserve primitive/material identity through geometry extraction, including multi-material and instanced meshes. Resolve explicit package mappings first, recognized normalized material names second, and a generic-solid default with diagnostics last.
- [ ] Centralize named Asphalt, Grass, Stone, Generic Solid, and Water presets. Treat coefficients as configurable simulation defaults, not measured real-world material constants. Apply road/grass traction and rolling behavior through the vehicle adapter as well as rigid-body contacts.
- [ ] Add a Scene Physics view listing discovered surface names and their presets, editable only in ready state. Validate nonnegative finite coefficients and positive water depth; persist overrides with the scene reference.
- [ ] Build finite water regions from the actual water footprint, defaulting to two meters below the surface, and apply drag to overlapping body portions. Keep water non-supporting and preserve solid geometry beneath. Do not use one broad bounding box that swallows adjacent roads or bridges.
- [ ] Include water behavior in the same scene-change transaction and release sensors on replacement/reset. A malformed footprint disables the affected mapping with a diagnostic rather than silently turning water into road.

**Production review:** Drive the same vehicle with the same control input across asphalt and grass; inspect the mappings and modify a preset to observe the change. Enter water and observe drag/no supporting water floor. Cross a bridge and drive beside a water boundary without false water activation. Save/reopen the overrides and verify unknown materials show their fallback diagnostic.

**Exit gate:** Surface mappings affect the actual simulation and survive persistence; water boundaries match visible geometry. Commit: `feat: simulate scene surface interactions`.

## Step 6 — Write and import JavaScript agent behavior

- [ ] **Feature complete and reviewed**

**Deliverable:** Selecting a catalog or placed agent opens an editable Script section. Imported `.js` source appears in the editor and controls that agent on Play, automatically or using viewport input.

**Files:** Create script program/context/runtime/scheduler files, JavaScript adapter/compiler/worker, `ui/ScriptEditorPanel.ts`, and `scripts/verifyScenarioStudio.mjs`. Extend inspector, session, persistence, diagnostics, package/lockfile, and the review guide.

**Boundary:** `ScriptProgram` owns name, language, enabled state, and validated source. Define the following in `scripts/ScriptRuntime.ts`; transfer records contain only values and validated command records, with `RunStamp` from Step 4.

```ts
export interface ScriptBatch {
  readonly stamp: RunStamp;
  readonly instanceKeys: readonly string[];
  readonly elapsedSeconds: number;
}
export interface ScriptRuntime {
  prepare(program: ScriptProgram, instanceKeys: readonly string[]): Promise<void>;
  run(batch: ScriptBatch): Promise<void>;
  release(instanceKeys: readonly string[]): Promise<void>;
  dispose(): Promise<void>;
}
```

The runtime receives observation/input records through an injected snapshot source and sends command batches to an injected command sink; `run` resolves only after that batch is delivered or fails. `ScriptContext` exposes private-per-instance state, simulation time, input sampling, bounded observations, and `drive`, force, and impulse commands. It never exposes a Rapier body or Three.js object.

Example source that must work when imported:

```js
export function on_step(ctx, dt) {
  ctx.drive({
    throttle: ctx.input.isDown("KeyW") ? 0.5 : 0,
    steering: ctx.input.isDown("KeyA") ? -0.5 : ctx.input.isDown("KeyD") ? 0.5 : 0,
    brake: ctx.input.isDown("Space") ? 1 : 0
  });
}
```

**Implementation checklist:**

- [ ] Integrate a native multiline editor with language label, enable/disable, source validation, and Import Script. Preserve the prior text on cancel/read failure; confirm replacement of a modified nonempty draft. Enforce a documented 256 KiB UTF-8 source limit and report syntax locations. Stop propagation of editing shortcuts to simulation input.
- [ ] Define the supported single-file JavaScript hook format: named `on_start`, `on_step`, optional `on_stop`, local helper declarations, and standard JavaScript facilities. Compile with syntax-aware parsing into a fresh closure per instance; reject external module imports/re-exports and asynchronous hooks with useful errors. Use a parser such as Acorn, pinned with the feature; do not rewrite exports with regex or share mutable module globals among instances.
- [ ] Implement one persistent JavaScript worker initially, bounded request queues, instance state, and batch execution. Update hooks default to 20 Hz with an optional 60 Hz setting. Validate/normalize every command before physics consumes it; keep continuous controls until replaced.
- [ ] Integrate script boundaries into fixed-step simulation: await the scheduled outputs, apply their commands in stable order, then advance the dependent step. Keep rendering/camera responsive while waiting. Stamp all work so Pause/Reset and scene changes cannot apply late results; Pause must not advance hook state past its acknowledged boundary.
- [ ] Add hook exceptions and a 250 ms unresponsive-batch watchdog to the visible error flow. A timeout pauses the run and terminates the stuck worker; mark its contexts invalid and require Reset. Native cleanup always runs even if `on_stop` fails.
- [ ] Persist source/filename/language, script frequency, enabled state, instance assignment, and catalog placement drafts where committed to the scenario. Existing-agent edits are independent; duplication creates independent runtime state. An enabled script replaces the built-in drive controller for that agent to avoid competing inputs.
- [ ] Add repeatable browser walkthroughs for import, editing, automatic driving, keyboard control, error recovery, and Reset using normal UI operations. Do not expose Python selection until Step 8 can execute it.

**Production review:** Import the example into a selected instance and drive it. Modify the source to use constant throttle and observe automatic movement. Give two instances the same program with an incrementing `ctx.state` counter and verify separate state. Import malformed code, cause a hook exception, and exercise a nonterminating hook: the camera stays usable and the error identifies the script/agent. Reset, fix, and rerun; old commands cannot affect the new run. Save/reopen both browser defaults and instance overrides.

**Exit gate:** Inspector editing/import is connected to real worker execution, physics, input, persistence, and error handling. Commit: `feat: author JavaScript agent behavior`.

## Step 7 — Create populations with a scenario script

- [ ] **Feature complete and reviewed**

**Deliverable:** **Scenario Script** opens an editor whose startup/update hooks create and despawn agents automatically, including timed spawns and assigned behaviors.

**Files:** Create `ui/ScenarioScriptPanel.ts` and `scripts/CreatorContext.ts`. Extend population/instance/session, script scheduler/context, script collection UI, preload/disposal paths, persistence, and browser review scripts.

**Boundary:** `CreatorContext` extends script capabilities with `spawn`, `despawn`, and agent configuration commands. Define `SpawnRequest` with asset key, optional display name, physical position/heading, named behavior-program reference, and validated physics overrides. `spawn(request)` returns an opaque agent reference tied to the current generation. A queued reference cannot be mistaken for an active body; invalid/stale targets produce diagnostics.

**Implementation checklist:**

- [ ] Reuse the same source editor/import component for the creator context. Add a named behavior-script collection so creator scripts can assign saved programs without embedding or duplicating their source.
- [ ] Add creator enablement, declared asset dependencies, startup/update hooks, and simulation-time scheduling. Preload declared assets before Play; an undeclared cold asset temporarily enters preparing state until ready, without blocking the camera.
- [ ] Queue creation/removal/configuration between physics steps. Allocate IDs internally, validate asset/program references and transforms, and stage render/physics/script resources together. Failed spawns release every partial resource and produce an actionable error.
- [ ] Make runtime creation/deletion temporary. Reset restores authored instances, drops all runtime-only instances, invalidates references, and recreates creator state on the next Play. Pause/resume does not repeat startup.
- [ ] Finalize scene replacement semantics: show the authored/live union count, clear both sets, retain creator text but disable it, and clear scene-specific overrides/drafts. Cancel/failure preserves the prior setup; warn that creator enablement changes on confirmation.
- [ ] Persist the creator source, named behavior collection, dependencies, and enabled state in the authored scenario. Never persist runtime-only population changes as initial agents during Save.

**Production review:** Create a script that spawns a named group at startup on valid road positions and another agent every two seconds of simulation time. Assign the JavaScript driving program from Step 6. Pause for several seconds and resume: no wall-time burst occurs and startup does not repeat. Despawn an agent and verify its visual, collisions, script updates, and input references disappear. Reset and Play twice with stable counts. Replace the scene and verify the retained creator script is disabled and the new agent list stays empty.

**Exit gate:** The reviewer creates dynamic populations entirely through product scripting; no ID allocation or cleanup code is required in user scripts. Commit: `feat: create agents with scenario scripts`.

## Step 8 — Run Python agent and creator scripts alongside JavaScript

- [ ] **Feature complete and reviewed**

**Deliverable:** The existing editor/import flow accepts Python and executes it in-browser for both individual agents and the scenario creator. A mixed-language scenario plays, pauses, resets, and saves correctly.

**Files:** Create `scripts/PythonRuntime.ts` and `python.worker.ts`. Extend script compiler/validation registration, editor/import, scheduler, runtime asset serving/build configuration, package/lockfile, and browser review scripts.

**Consumes:** The exact `ScriptRuntime`, `RunStamp`, command, input, and creator contracts already used by JavaScript. Register language implementations at the composition root; the session does not acquire language branches.

Example Python source that must work when imported:

```python
import math

def on_start(ctx):
    ctx.state["elapsed"] = 0.0

def on_step(ctx, dt):
    ctx.state["elapsed"] += dt
    ctx.drive({
        "throttle": 0.3,
        "steering": math.sin(ctx.state["elapsed"]) * 0.2,
        "brake": 0.0,
    })
```

**Implementation checklist:**

- [ ] Pin Pyodide and package its required runtime files for same-origin loading through the built app. Initialize it in a module worker, once per worker. Expose preparation progress and a recoverable runtime-load error; JavaScript-only scenarios must not download Python unnecessarily.
- [ ] Compile Python source with filename-aware diagnostics and create a separate namespace/context per instance. Bridge standard-library results, input, state, and commands through value records. Dispose Python proxies and instance namespaces on release.
- [ ] Implement equivalent startup/update/shutdown, creator commands, batching, timeouts, generation rejection, and 20/60 Hz scheduling. Give each instance persistent worker affinity; never create a Python interpreter per agent.
- [ ] Enable Python/JavaScript selection and `.py` imports in both editor contexts. Preserve text on language changes, validate before execution, and show a concise supported-standard-library note. Reject unsupported imports with their actual exception; do not imply arbitrary desktop Python compatibility.
- [ ] On a stuck Python worker, pause and invalidate its contexts, terminate it, and prepare a fresh runtime on Reset. A failed cleanup hook cannot retain bodies/visuals or block Reset.
- [ ] Round-trip Python source and mixed assignments through Save/Open. Run Python creator/JavaScript behavior and JavaScript creator/Python behavior combinations through the same named-program references.

**Production review:** Import the Python example and observe motion. Add a JavaScript-controlled agent to the same scene and use Play/Pause/Reset. Verify a Python input script cannot receive keys while the editor is focused. Use standard-library math/random with a fixed seed in creator scripts. Exercise syntax/import errors, a stuck Python hook, repeated Reset, and a cold runtime load without freezing the UI. Reopen the saved mixed scenario in the built client.

**Exit gate:** Both languages deliver the same product capabilities and automatic lifecycle behavior; Python works without a local Python service. Commit: `feat: support Python scenario and agent scripts`.

## Step 9 — Suspend selected agents when distant

- [ ] **Feature complete and reviewed**

**Deliverable:** The Agent Inspector exposes **Suspend when distant**, off by default, with visible active/suspended status and a configurable simulation focus in scenario settings.

**Files:** Create `simulation/DistanceActivation.ts`. Extend agent settings, population/session, scheduler, physics adapter, inspector, scenario settings/persistence, and browser reviews.

**Boundary:** Define a pure activation policy over engine-free agent bounds, current activation state, a focus point, and validated radii. It issues suspend/resume intentions; population/physics perform transitions at simulation boundaries.

**Implementation checklist:**

- [ ] Add the per-instance/default checkbox and explanatory copy: distant agents pause movement and behavior; this mode does not maintain continuous traffic. Persist the choice and normalize existing scenarios to false.
- [ ] Use the controlled agent as focus, or the saved fixed focus point when none is controlled. Default activation radius to 40 m and deactivation radius to 50 m; require positive values with exit radius greater than entry radius.
- [ ] On suspension, stop hooks and dynamics, exclude the body from active collision participation, retain its visible pose/state, and clear stale input/control commands. Suspended hooks receive normal scheduler `dt` on resumption, not a catch-up interval spanning their suspension.
- [ ] Reactivate only at a safe simulation boundary after separation/overlap checks. If occupied, remain suspended with a visible reason and retry with bounded work. Controlled agents must be active; reject taking control of a blocked instance until safe activation succeeds.
- [ ] Ensure camera motion does not move the simulation focus. Reset/replacement/disposal remove all activation state. Paused simulation never changes activation underneath the inspector.

**Production review:** Enable suspension on one agent and leave another unchecked. Move the controlled focus beyond the exit radius and back inside the entry radius; inspect pose/script counters and status. Move only the camera and verify no activation changes. Occupy the reactivation location and verify the blocked diagnostic instead of an overlap impulse. Save/Open and confirm opt-in state and radii persist.

**Exit gate:** The opt-in feature has explicit, observable semantics and does not affect always-active agents. Commit: `feat: suspend distant scenario agents`.

## Step 10 — Select and use the MuJoCo production backend

- [ ] **Feature complete and reviewed**

**Deliverable:** Scenario settings expose **Physics Engine: Rapier / MuJoCo**. Selecting either backend produces a complete working scenario with physical placement, driving, both script languages, creator lifecycle, surfaces, suspension, persistence, and playback controls. MuJoCo is a production implementation, not a demo or unavailable menu option.

**Files:** Create `physics/mujoco/MujocoPhysicsWorld.ts`, `MujocoModelCompiler.ts`, `MujocoAgentSlots.ts`, `MujocoVehicleController.ts`, and `ui/PhysicsEnginePanel.ts`. Extend the existing engine registry, worker composition, capability diagnostics, persistence, source-asset cache/build serving, package/lockfile, and browser walkthroughs. Shared domain/script consumers retain their existing engine-neutral contracts.

**Consumes/produces:** Implement Step 2's `PhysicsEngineFactory`/`PhysicsWorld` contract, including operations added in Steps 4–9. Register key `mujoco` alongside `rapier`. Registry entries provide a display label and capabilities; selection UI enumerates registrations. A new engine is an added adapter/registration, not another branch inside `ScenarioSession`, agents, input, or scripts.

**Implementation checklist:**

- [ ] Pin the official `@mujoco/mujoco` bindings and bundle their WASM/JS assets for same-origin release-build loading. Start with the single-threaded build inside the dedicated physics worker. Record the tested binding version and required API coverage; expose initialization failures without falling back to Rapier. MuJoCo runtime ownership is independent of Pyodide. [Official browser bindings](https://github.com/google-deepmind/mujoco/blob/main/wasm/README.md)
- [ ] Compile the neutral world/agent descriptions into MuJoCo model data. Convert coordinate conventions and units inside the adapter. Preserve convex/concave geometry correctly using primitives, suitable heightfields, and convex decomposition as needed; keep bridge passages and water boundaries open. Cache collision/model artifacts by source hash and compiler/backend version. Reject a conversion with unsupported geometry rather than silently enclosing it in a scene-wide convex hull. [Collision representations](https://mujoco.readthedocs.io/en/latest/computation/)
- [ ] Implement body observations, surface queries, contact/material behavior, forces/impulses, stable substeps, and wheel/chassis controls behind the existing interfaces. Shared throttle/brake/steering semantics remain available even if the underlying vehicle implementations differ. Port water-region and distance-activation behavior through backend methods, not MuJoCo checks in the domain.
- [ ] Make lifecycle automatic despite compiled topology: reserve reusable inactive slots for expected templates where useful; batch structural changes and prepare model replacements when capacity/shape changes require them. Preserve active agents' positions, velocities, controls, and script references by stable domain identity. Pause advancement while structural preparation is pending; keep the old world intact until a valid replacement can commit. Measure structural-change stalls separately in Step 11. [Model editing](https://mujoco.readthedocs.io/en/latest/programming/modeledit.html)
- [ ] Verify the pinned browser bindings actually expose the chosen model-editing operations. Use validated model reconstruction and state transfer if those operations are unavailable. Refresh all views/indices after model replacement, and release owned model/data/native handles exactly once; never retain borrowed WASM memory across destruction or reallocation.
- [ ] Add engine selection in ready-state scenario settings. Preserve authored scene, agents, and scripts while preparing the chosen engine; commit the engine key only on success. Switching engines does not clear agents or perform scene replacement. Changes during running/paused playback require Reset first. Save/Open retains the selected key and validated settings.
- [ ] Run every prior feature walkthrough on MuJoCo and rerun Rapier after shared changes. Check behavioral contract parity rather than requiring identical trajectories. Include failed engine preparation, invalid collision conversion, resource disposal, repeated engine switching, creator spawns/despawns, and stale messages from a replaced engine worker.

**Production review:** Open a saved scripted scenario, select MuJoCo, place an agent, and Play. Drive it across surfaces, run Python and JavaScript behavior, execute timed creator spawns, pause/reset, and use distance suspension. Save/reopen and verify MuJoCo remains selected. Reset and switch to Rapier: authored agents and scripts remain. Check body/worker/native-resource counts across repeated switches.

**Exit gate:** Both registered backends support the complete product through the same domain and script contracts. Neither is silently substituted for the other. Commit: `feat: add selectable MuJoCo physics backend`.

## Step 11 — Run and inspect 100 agents smoothly

- [ ] **Feature complete and reviewed**

**Deliverable:** A 100-agent example scenario runs smoothly through the normal UI on both Rapier and MuJoCo, and a Performance panel explains render, physics, and scripting costs. This step includes measured optimizations, not just a final test pass.

**Files:** Create `ui/PerformancePanel.ts`, `scripts/benchmarkScenarioStudio.mjs`, `docs/scenario-studio-performance.md`, and named example scenarios under `assets/scenarios/examples/`. Extend metrics, scheduler/pools, rendering batches, caching, and review scripts as indicated by measurements. Add **Open Example** to the existing scenario picker so users can run the examples without copying files into their user-data directory.

**Boundary:** `SimulationMetrics` collects bounded samples and produces immutable aggregate records for FPS/frame intervals, physics/script time, worker backlog, active/total instances, resource counts, and simulation/wall-time ratio. Sampling and aggregation must not add a per-agent UI update loop.

**Implementation checklist:**

- [ ] Author a correctly scaled, adequately sized review scene through the existing scene pipeline, or select an existing published scene with room for 100 non-overlapping vehicles. Do not shrink physics bodies or silently change scene units just to fit the benchmark. Add examples for 100 JavaScript agents, 100 Python agents, and a 50/50 mix using representative movement and contact behavior; all suspension flags are false.
- [ ] Expose examples in the product and save opened copies into user data rather than modifying source-controlled examples. Include one user-controlled vehicle and timed population changes for lifecycle review; use a stable 100-active population during the timed performance sample.
- [ ] Add the Performance panel and record a baseline before optimization. Bound JavaScript/Python worker pools independently; begin with one worker each and cap total script workers according to measured hardware capacity while reserving capacity for rendering and the physics worker. Worker count does not grow with agent count.
- [ ] Optimize measured bottlenecks: batch transferable snapshots/commands, reuse buffers and model resources, avoid whole-world observations per agent, batch compatible visuals, keep wheel updates incremental, and cap live thumbnails. Preserve stable step ordering and bounded queues. Pool membership changes only between runs so stateful agents do not silently migrate.
- [ ] Run a foreground, hardware-accelerated 60-second sample after preload/warmup for each language mix on each engine: six cases in total. Capture camera movement/input, frame intervals, physics/script costs, memory/resource counts, worker counts, viewport/DPR, browser, CPU/GPU, selected engine/version, solver substeps, and simulation-time ratio. Report loading and model compilation separately.
- [ ] Meet the design targets on both engines: approximately 60 FPS, at least 58 FPS average, p95 frame interval at most 25 ms, and simulation/wall-time ratio at least 0.95 for the representative workload. Do not mask slow simulation with smooth rendering alone. If either engine misses the target, identify and fix its limiting subsystem before closing the step.
- [ ] Profile MuJoCo topology changes and inactive-slot overhead with representative timed spawn/despawn bursts. Separate active agents from reserved capacity in the panel. Tune automatic capacity/preparation so routine lifecycle work does not introduce repeated visible stalls; do not hide model rebuild costs inside the script timing aggregate. Only enable MuJoCo's internally multithreaded build if measurements warrant it and the release host supplies the required cross-origin-isolation headers; verify all app/script assets under those headers.
- [ ] Run repeated Play/Pause/Reset, scripted spawn/despawn, scene replacement, and route disposal. Verify tracked bodies, visuals, event registrations, and worker contexts return to their expected baseline; explain intentional cache retention separately from leaked live instances.
- [ ] Record actual measurements and environment in the performance document, and run the full functional walkthrough on the built client. Headless/software-rendered runs establish behavior only; they are not evidence that the hardware FPS requirement is met.

**Production review:** Open the 100-agent mixed example from Scenario Studio, Play, orbit/zoom and control a vehicle while viewing the performance panel. Repeat the all-Python and all-JavaScript examples on Rapier and MuJoCo. Pause/reset/switch scenes and engines, and watch the population/resource counts recover. Review all six recorded hardware results against the stated thresholds.

**Exit gate:** All 100 agents remain active on each production engine, simulation keeps pace with wall time, rendering meets the measured target, and lifecycle/resource behavior remains stable. Commit: `feat: deliver smooth 100-agent scenario playback`.

## Coverage and review record

| Design requirement | Delivering steps |
| --- | --- |
| Separate app route, reusable viewport/HUD, green default environment only without a scene | 1; physical support in 2 and persistence in 3 |
| Scene browsing, explicit confirmation, failure preservation | 1; agent/script cleanup completed in 2, 4, 7 |
| Shared Scenes/Agents tabs and left Agent Inspector | 2 |
| Add/drop on actual physical surfaces; correct units | 2 |
| Independent placement defaults/instance edits | 2; script parity in 6 and 8 |
| New/Open/Save and recoverable missing assets | 3; schema extensions accompany 4–9 |
| Play/Pause/Reset, driving, input focus | 4 |
| Physical surface mapping, water, vehicle traction | 5 |
| Script editor/import, diagnostics, auto/input behavior | 6 and 8 |
| Creator script and automatic spawn/despawn | 7 and 8 |
| Bounded workers, separate instance state, stale-result rejection | 4, 6–8; scaling in 11 |
| Optional distance suspension | 9 |
| Open physics contract, production Rapier and MuJoCo adapters | Boundary in 2/4; complete second backend and selection in 10 |
| 100 active agents, smooth rendering and real-time simulation on both engines | 11 |
| Lifecycle ownership, disposal, failure cleanup | Each owning feature; repeated-run evidence in 11 |
| Reviewable production behavior after every step | Every step's built-client walkthrough and exit gate |

Current state: Step 1 is implemented and reviewed; Steps 2–11 remain unchecked.
