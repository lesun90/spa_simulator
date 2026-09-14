# Scenario Studio implementation plan

**Progress:** 2/11 complete. Step 1: `98cf824`; Step 2: `b5a5000`, reviewed 2026-09-14. Steps 3–11 not started. **Next: Step 3**, New/Open/Save.

[Design requirements](scenario-studio-design.md) · [Commands and evidence](scenario-studio-review.md)

## Execution rules

Use `executing-plans`, inline unless delegation is requested. The design is authoritative; this plan specifies delivery order and work locations. Every step inherits its requirements. Deliver working UI/domain/adapters/persistence/error handling together; hide controls until usable. Preserve user work/assets and existing flows. Install/pin dependencies and build in Docker. No new unit tests unless requested.

To reduce implementation context:

1. Read this status/rules section, the current step, and its linked design sections. Read other steps only for an actual dependency; skip completed-step history and evidence unless investigating a regression.
2. Use CodeGraph first where indexed. Query exact symbols/call paths; read focused source ranges and relevant repository instructions. Batch independent queries; avoid whole-directory dumps, rereading unchanged files, or copying source into the plan.
3. Reuse existing types/adapters. Keep the change within the step; resolve ordinary implementation choices without reopening settled design. Avoid speculative abstractions and broad rewrites.
4. Run the common gate once on the finished change. Repeat only checks affected by a subsequent edit/failure; widen checks when shared code or evidence warrants it. Do not skip a required check to save tokens.
5. Record only status, commit, concise outcome/limits and evidence links here. Put logs/screenshots in the review artifacts. Handoffs contain current step, changed files, decisions, failed/passed checks and next action—not the full history.

**Common completion gate:** use normal controls in development and built client; capture evidence; run Docker `build:check`, `review:build`, `git diff --check`, and relevant existing/browser regressions. Review ownership, stale results, failures and Scene Studio compatibility. Record results/limits in the review guide; commit the complete feature. Preview shares Scenario Studio middleware; it is not a production host or proof of Scene Studio preview API support. From Step 3, isolate review writes with `STEERLAB_SCENARIOS_DIR`.

## Existing owners

Paths below are relative to `src/scenario-studio/` unless prefixed `src/`, `server/`, `scripts/` or `docs/`. Planned files are introduced only with their working feature; use CodeGraph to find equivalents first.

| Existing files | Extend/reuse for |
| --- | --- |
| `main.ts`, `ScenarioStudioApp.ts` | Route/composition, adapters, render loop/input/shutdown. |
| `domain/ScenarioDocument.ts`, `ScenarioSession.ts` | Scene-only authored state and transactional replacement; add agents/playback/persistence. |
| `domain/scene.ts`, `ScenePresentation.ts`, `DefaultGround.ts`; `catalog/SceneCatalog.ts`, `HttpSceneCatalog.ts` | Existing scene records, catalog/presenter ports and visual default ground. Read source for exact implemented contracts. |
| `ui/ScenarioHudFeature.ts`, `SceneBrowserPanel.ts`, `HudText.ts` | Existing shell/search/cards/confirmation. Extend for tabs; avoid parallel workspace/browser implementations. |
| `rendering/ScenarioViewport.ts`, `ScenarioSceneThumbnails.ts`, `ScenarioHudCache.ts` | Owned presentations, camera, preview cache and HUD invalidation. |
| `server/scenarioStudioPlugin.ts`, `server/scenarioStudio/{routes,publishedScenes}.ts` | Shared dev/preview discovery, validation and contained source routes. |
| Shared `src/engine/` and HUD primitives | Renderer/RenderLoop/Viewport, CameraRig, InteractionSystem/InputManager, AssetManager, ThumbnailRenderer, TextField, PerformanceMonitor. |

Keep Scenario Studio separate from `WorldFeature`/`EditorState`. AssetManager owns cached geometry/materials; clones/cards borrow them. Existing FPS monitoring does not replace future simulation metrics. Reuse the three browser probes listed in the review guide.

## Step 1 — Published-scene browsing

- [x] **Complete and reviewed:** route/default ground, real package loading, search, named confirmation, failure preservation, previews/camera, lifecycle fixes and review evidence. Details: [Step 1 results](scenario-studio-review.md#results-and-evidence). No physics or agents delivered.

## Step 2 — Physical agent placement and physics abstraction

- [x] **Complete and reviewed:** agent-only catalog/API, Rapier worker abstraction, transformed solid/non-supporting geometry, physical placement, instance authoring, transactional cleanup and review evidence. Physics remains placement-only until Step 4; surface presets/water dynamics remain Step 5.

Design: [agents](scenario-studio-design.md#agents-and-inspector), [physics](scenario-studio-design.md#physics-surfaces-and-activation), [replacement](scenario-studio-design.md#environment-and-replacement).

**Add:** `domain/{agent,AgentInstance,AgentPopulation}.ts`; `catalog/{AgentCatalog,HttpAgentCatalog}.ts`; `server/scenarioStudio/agentCatalog.ts`; `ui/{AgentBrowserTab,AgentInspectorPanel}.ts`; `rendering/{SceneGeometrySource,AgentVisuals}.ts`; `physics/{PhysicsWorld,PhysicsEngineRegistry,PhysicsWorkerClient,physics.worker,RapierPhysicsWorld}.ts`. Extend existing owners, `server/assetCatalog.ts`, package/lockfile. Extract shared browser chrome only when the Agents tab needs it.

**Contract:** immutable `Vector3Value{x,y,z}`, `Ray3{origin,direction}`, `PlacementHit{point,normal}`. `PlacementSurface.pickSurface(ray: Ray3): Promise<PlacementHit|null>`; `PhysicsWorld` extends it with `dispose(): Promise<void>`. `PhysicsEngineFactory` has open string `key` and `create(): Promise<PhysicsWorld>`; register Rapier. `AgentDraft` carries asset/name/pose, positive mass, collision and placement settings. `ScenarioSession.placeAgent(draft: AgentDraft, ray: Ray3): Promise<void>` validates before commit; population allocates IDs, viewport consumes snapshots/events.

- [x] Discover only agent assets via the new `/agents` API; preserve URL bases, parse metadata, diagnose duplicates/malformed assets.
- [x] Pin Rapier; extract neutral transformed/meter-scaled geometry and support colliders in its worker. Default collider exists only for null scene; keep descriptions usable by MuJoCo.
- [x] Add independent browser tabs/drafts, inspector contexts, Add/drop ghost, validated transforms/duplicate/delete and selection. Reject stale/invalid picks; scripts/suspension remain hidden.
- [x] Commit/release agent visuals/colliders together; extend scene replacement with population cleanup and accurate warning counts.

**Review:** two vehicle types at correct scale; road/bridge placement; reject water/outside/overlap/steep support; independent defaults/instance edits; duplicate/delete; canceled/failed replacement preserves agents, successful replacement clears them. Common gate.

## Step 3 — New/Open/Save

- [ ] **Complete and reviewed**

Design: [persistence](scenario-studio-design.md#assets-and-persistence).

**Add:** `domain/scenario.ts`, `persistence/{ScenarioRepository,HttpScenarioRepository}.ts`, `server/scenarioStudio/scenarioStore.ts`, scenario picker/toolbar. Extend document/session/routes.

**Contract:** versioned `ScenarioRecord` starts with ID/name, scene/null-ground settings, open engine key and authored agents; later steps extend/normalize it. `ScenarioSummary{id,name,updatedAt}`. Repository: `list(): Promise<readonly ScenarioSummary[]>`, `open(id: string): Promise<ScenarioRecord>`, `save(record: ScenarioRecord): Promise<void>`.

- [ ] Implement `/scenarios` routes, isolated store, schema/identity/numeric validation and atomic failure-safe writes.
- [ ] Add naming, dirty/discard handling and staged Open through validating constructors; retain recoverable data when assets/engine are unavailable.
- [ ] Separate session drafts, authored edits and live snapshots; scene replacement marks dirty without auto-save.

**Review:** save two configured agents, reload/reopen exact authored state on imported/default ground; replace scene then reopen saved copy; failed write and missing asset preserve data. Common gate.

## Step 4 — Playback and driving

- [ ] **Complete and reviewed**

Design: [playback](scenario-studio-design.md#domain-ownership-and-playback), [scheduling](scenario-studio-design.md#script-execution-and-scheduling), [vehicles](scenario-studio-design.md#physics-surfaces-and-activation).

**Add:** `ui/PlaybackToolbar.ts`, `input/ScenarioInput.ts`, `physics/VehicleController.ts`, `simulation/SimulationMetrics.ts`. Extend population/session, physics worker/world, visuals, inspector and persistence.

**Contract:** `PlaybackState = ready|preparing|running|paused|error`; `RunStamp{generation,step}`; `PHYSICS_STEP_SECONDS=1/60`; validated `DriveCommand`. Session `play(): Promise<void>`, `pause(): void`, `reset(): Promise<void>`. Extend physics with commands/step/reset and stamped snapshots containing time, transforms, velocities and wheel poses.

- [ ] Implement legal transitions, preparation, authored baseline, bounded worker stepping and render interpolation.
- [ ] Build vehicle/generic bodies and wheel animation; add controlled-agent input through the common drive boundary.
- [ ] Enforce ready-only authoring; Reset clears live state/stale snapshots; save authored state during runs. Track body/instance counts and persist eligibility/configuration.

**Review:** gravity/contact on flat/sloped support, drive/steer/brake, held-key Pause/blur, camera responsiveness, repeated Reset, save while running and scene replacement during playback. Common gate.

## Step 5 — Surfaces and water

- [ ] **Complete and reviewed**

Design: [physics/surfaces](scenario-studio-design.md#physics-surfaces-and-activation).

**Add:** `physics/{SurfacePresets,WaterRegions}.ts`, `ui/ScenePhysicsPanel.ts`. Extend geometry, vehicle/world adapters and persistence.

- [ ] Resolve material groups/instances to validated `SurfacePreset` value objects/policies, honoring explicit mappings and documented fallbacks.
- [ ] Add ready-state Scene Physics mapping/override UI; implement contact/traction/rolling effects and footprint-correct water depth/drag.
- [ ] Persist settings; validate malformed regions and release sensors with scene/reset lifecycle.

**Review:** comparable asphalt/grass driving, edited coefficients, water entry, bridge/shore exclusions, unknown-material diagnostics and save/reopen. Common gate.

## Step 6 — JavaScript agent scripts

- [ ] **Complete and reviewed**

Design: [editor](scenario-studio-design.md#script-editor-and-creator), [execution](scenario-studio-design.md#script-execution-and-scheduling).

**Add:** `scripts/{ScriptProgram,ScriptContext,ScriptRuntime,ScriptScheduler,JavaScriptRuntime,JavaScriptCompiler,javascript.worker}.ts`, `ui/ScriptEditorPanel.ts`. Extend inspector/session, persistence and browser workflows.

**Contract:** ScriptProgram owns name/language/enablement/validated source. `ScriptBatch{stamp: RunStamp, instanceKeys: readonly string[], elapsedSeconds: number}`. Runtime `prepare(program: ScriptProgram, instanceKeys: readonly string[]): Promise<void>`, `run(batch: ScriptBatch): Promise<void>`, `release(instanceKeys: readonly string[]): Promise<void>`, `dispose(): Promise<void>`. Inject observation/input source and command sink; run resolves after delivery or failure.

- [ ] Implement editor/import limits, draft protection, focus and filename/location diagnostics.
- [ ] Pin a syntax parser (e.g. Acorn), compile supported exports into per-instance closures, implement worker affinity/batching, frequencies, command validation and watchdog.
- [ ] Integrate acknowledged Pause/step ordering, recovery/disposal and persistence. Enabled scripts replace built-in control; Python remains hidden.

**Review:** imported `on_step` with W/A/D/Space drive input and constant-throttle variant; independent counters in shared programs; bad syntax, exception, endless hook and recovery; save/reopen defaults/overrides. Common gate.

## Step 7 — Creator scripts and populations

- [ ] **Complete and reviewed**

Design: [creator](scenario-studio-design.md#script-editor-and-creator), [lifecycle](scenario-studio-design.md#domain-ownership-and-playback).

**Add:** `scripts/CreatorContext.ts`, `ui/ScenarioScriptPanel.ts`; extend program collection, population, preload/scheduler and persistence.

**Contract:** `SpawnRequest` contains asset/name/physical pose, named behavior reference and validated overrides; `spawn(request)` returns an opaque generation-bound queued reference. Creator context supports despawn/configuration; no user IDs or engine handles.

- [ ] Reuse editor; add named behaviors, enablement/dependencies, startup/update and simulation-time scheduling.
- [ ] Stage/validate resources before between-step spawn/despawn; release partial failures, reject stale references and support undeclared cold-asset preparation.
- [ ] Keep runtime mutations out of saves. Reset restores authored population; scene replacement uses authored/live union count, retains/disables creator source and clears scene drafts/overrides. Persist authored creator/collection settings.

**Review:** startup group plus spawn every two simulation seconds, assigned driving behavior; Pause without burst/repeated startup; complete despawn cleanup; repeated Reset/Play; replacement remains empty with creator disabled. Common gate.

## Step 8 — Python and mixed-language scripting

- [ ] **Complete and reviewed**

Design: [execution](scenario-studio-design.md#script-execution-and-scheduling).

**Add:** `scripts/{PythonRuntime,python.worker}.ts`. Extend language registration/editor, scheduler, same-origin runtime serving, dependencies and workflows; preserve Step 6 runtime/command contracts.

- [ ] Pin/package lazy-loaded Pyodide; one interpreter per worker, instance namespaces/proxy disposal, progress and recoverable load errors.
- [ ] Implement hook/creator/input/command parity, affinity, batching, watchdog and generation handling. Register adapters at composition root, without language branches in session.
- [ ] Enable `.py` imports/language choice with draft retention and supported-library guidance; actual import exceptions stay visible. Persist and reopen mixed assignments.

**Review:** `math`-based driving, seeded random creator, mixed agents and both creator/behavior language combinations, editor focus, syntax/import failure, stuck hook, cold load and repeated Reset. Common gate.

## Step 9 — Distance suspension

- [ ] **Complete and reviewed**

Design: [activation](scenario-studio-design.md#physics-surfaces-and-activation).

**Add:** `simulation/DistanceActivation.ts`; extend population/world/scheduler, inspector/settings/persistence. Policy consumes neutral bounds, current state, focus/radii and emits transition intentions.

- [ ] Add persisted off-by-default setting, explanatory copy and visible active/suspended/blocked status; validate focus/radii.
- [ ] Coordinate boundary-safe dynamics/hooks/collision suspension and separation-checked resumption; clear stale controls and lifecycle state. Keep controlled agents active, camera independent, Pause stable.

**Review:** opted-in versus always-active agent, both radii, camera-only movement, blocked reactivation/control, normal resumed `dt`, save/reopen. Common gate.

## Step 10 — Selectable production MuJoCo

- [ ] **Complete and reviewed**

Design: [MuJoCo](scenario-studio-design.md#mujoco-adapter), [physics](scenario-studio-design.md#physics-surfaces-and-activation).

**Add:** `physics/mujoco/{MujocoPhysicsWorld,MujocoModelCompiler,MujocoAgentSlots,MujocoVehicleController}.ts`, `ui/PhysicsEnginePanel.ts`. Extend registry/worker composition, capabilities/cache/runtime serving and persistence.

- [ ] Pin/package official bindings; implement the accumulated PhysicsWorld contract, collision compilation, surfaces, vehicles, water and activation. Keep domain/scripts unchanged.
- [ ] Implement automatic capacity/topology preparation, stable-ID state transfer, cache keys, transactional model replacement, borrowed-memory invalidation and exact native cleanup. Verify available model-edit APIs.
- [ ] Enumerate registry choices (Rapier/MuJoCo) in ready-state UI; commit engine selection only after successful preparation and persist it.

**Review:** run Steps 2–9 on MuJoCo and regress Rapier; compare contract behavior, not trajectories. Include initialization/conversion failure, topology changes, stale worker output, repeated switching, source preservation and native/body/worker resource counts. Common gate.

## Step 11 — Smooth 100-agent playback

- [ ] **Complete and reviewed**

Design: [performance acceptance](scenario-studio-design.md#acceptance).

**Add:** `ui/PerformancePanel.ts`, `scripts/benchmarkScenarioStudio.mjs`, `docs/scenario-studio-performance.md`, examples in `assets/scenarios/examples/`; extend SimulationMetrics, measured bottlenecks and scenario picker.

- [ ] Create adequately sized, correctly scaled 100-JS/100-Python/50–50 examples with suspension off; Open Example saves user copies, preserving sources. Include controlled driving/timed lifecycle changes, but hold 100 active agents steady during samples.
- [ ] Record baseline; expose bounded aggregate metrics; tune worker caps, transfers/buffers, queries, batching/caches and incremental visuals only from measurements.
- [ ] Run all six hardware cases with camera/input and specified thresholds. Separately profile preload, compilation, reserved slots and spawn/despawn topology stalls; optimize failing backends before closing.
- [ ] Verify repeated runs/replacement/engine switches/disposal and baseline resource recovery. Record environment, actual results, limits and full built-client walkthrough in the performance document. Common gate.
