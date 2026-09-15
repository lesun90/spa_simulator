# Scenario Studio design

Updated 2026-09-15. **Steps 1–4 complete** (`98cf824`, `b5a5000`, `0eca7da`, and Step 4 reviewed in the working tree); Steps 5–11 unimplemented.
[Plan](scenario-studio-implementation-plan.md) · [Review and evidence](scenario-studio-review.md)

This document owns product requirements; the plan owns delivery tasks, and the review guide owns verification commands/results. Sections below describe the release target unless marked current.

## Scope

`/scenario_studio` assembles published environments and agents for physical/scripted simulation. `/scene_studio` remains the environment authoring app; Scenario Studio must not depend on its `EditorState`.

First release: 100 active agents, JavaScript/Python agent and creator scripts, production Rapier and MuJoCo backends. Rapier is default; each scenario saves one registered engine for its interacting world. Additional engines require only an adapter/registration, without changes to domain, scripts or UI consumers. Python uses browser Pyodide and its supported standard library.

Excluded: local Python service, native Python packages/ML integration, source asset editing/general importer, buoyancy/fluid simulation, live engine hot-swapping, two engines solving one world, and continuous distant traffic in suspension mode. Users manage assets/settings/scripts/playback; IDs, workers, lifecycle and cleanup are automatic.

## Current implementation

- Separate route/composition root, authored scene/agent document and transactional session, injected catalog/presentation/physics boundaries, owned presentations and generation-guarded replacement.
- Green default ground/grid and collider; imported GLBs scale by `1 / unitsPerMeter`, fit the camera, and contribute transformed triangle support. Water geometry is retained as a non-supporting placement blocker, and imports never receive the default fallback. Rapier owns placement queries, agent colliders and live playback bodies in a dedicated worker through an open engine registry. Scenario name/New/Open/Save persist authored scenes and agents; Play/Pause/Reset run fixed-step Rapier playback with one controlled vehicle driven by throttle/steering/brake. No surface dynamics, scripted behavior or suspended-agent scaling yet; reload starts on default ground.
- Left scene/agent inspector, independent bottom Scenes/Agents browsers, search/Refresh/previews, Add/drag ghost, viewport selection, validated transform/duplicate/delete, named replacement warnings and orbit/zoom/reset. Per-asset and per-instance drafts survive context switches; successful scene replacement clears agents and scene drafts.
- `assets/scenes/sample` and `scene2` contain version-1 packages at one unit/meter. No root pair currently; discovery supports it as `.`. Vehicle assets include models, thumbnails, metadata, chassis bounds and wheels, not complete driving configurations.
- Shared dev/preview middleware serves scene and agent catalogs, scene package APIs and contained `/scenario-assets/{scenes,agents}/*` sources. Agent discovery is confined to `assets/agents` and reports malformed/duplicate metadata. Existing stack adds pinned Rapier to TypeScript, Vite/Node, Three.js, HUD primitives, canvas and stats.js; the FPS overlay is not simulation performance evidence.
- Cards borrow thumbnail textures; renderer owns/prunes targets and cancels stale work. Model templates remain cached until app teardown. Shared text fields preserve parent scroll clipping; scaled/rotated bounds normalize raised previews. Search retains the existing field's end-of-text editing limitation.

## Workspace and authoring

Central viewport; shared Scenes/Agents browser below; Agent Inspector left; compact toolbar above with name, New/Open/Save, Play/Pause/Reset and Scenario Script. Show playback/agent count; expand errors/performance on demand. Preserve existing HUD styling. Both browser tabs have independent search/selection, previews or labeled fallback, Refresh, and loading/error states. Expose controls only when functional.

### Environment and replacement

- Null published reference selects validated default-ground settings: green `0x558550`, 100 × 100 m, centered at Y=0, grass preset and matching static collider. New scenarios start here with zero agents. It counts as an active environment for confirmation.
- Imports use actual supported geometry/transforms/units, including raised surfaces. A manifest ground record does not prove a ground mesh exists. Never add default surface/collider beneath an import; invalid/empty geometry produces diagnostics.
- Card click selects a candidate only. Use Scene opens **Cancel / Switch Scene**, names the candidate, and warns even for zero agents. Count the union of authored/live identities, including authored agents despawned during playback; use singular/plural grammar.
- Pause an interrupted run before replacement. Stage/validate new resources; failure or cancellation preserves the old setup, paused for explicit resumption. An unchanged active reference is a no-op; changed content requires replacement.
- Successful commit stops the run, clears authored/live agents, selection, scene-specific drafts/overrides, releases old resources and resets time. Keep creator source but disable it, explaining that in the warning. Mark the working document dirty; never overwrite its saved copy automatically.

### Agents and inspector

Catalog selection opens **New agent** settings as per-asset placement defaults; viewport selection opens **Existing agent** settings for that instance. Preserve both drafts when switching contexts; never edit source assets. Show preview/asset name, instance name, position/heading, validated mass/collision/physics settings, input eligibility and Suspend when distant (off).

Add enters click placement; drag/drop shows a valid/invalid ghost. Raycast against actual support colliders, including bridges, excluding water sensors and agents. Seat collision bounds with small contact clearance; reject unsupported, overlapping or excessively steep positions. Outside drop/Escape cancels; loading assets cannot be placed. Reject stale picks. Transform edits and duplication repeat placement validation; copies have independent configuration/script state and internal IDs.

Selection differs from **Control this agent**, which assigns the single controlled instance. Authoring placement/deletion/transforms/settings/scripts is allowed only in ready state. Running/paused instances remain inspectable; Reset restores editing.

### Script editor and creator

Use one native multiline editor/import component for agent and Scenario Script contexts: selection, copy/paste, undo, scrolling and accessible focus. Provide enablement, language, filename, validation locations and agent/source-specific runtime errors. Import `.js`/`.py` detects language and displays full source immediately; limit source to **256 KiB UTF-8**. Cancel, unsupported extension, oversize or read failure preserves text. Confirm replacing modified nonempty source; language changes retain draft text and require validation. Save source in the scenario, independent of its original file.

Creator scripts create/configure/despawn agents and assign behaviors from a named program collection, with declared asset dependencies and simulation-time scheduling. Startup runs once per new run, never on resume. Spawns are runtime-only; opaque generation-bound references support later commands and reject stale/invalid targets. Queue creation until render/physics/script resources can activate together; failures release all partial resources and identify asset/reason. Reset removes runtime mutations and recreates creator state on next Play.

## Domain, ownership and playback

Objects own private state/invariants; immutable transport records may be plain data. Inject replaceable physics, rendering, input, script and persistence boundaries; construct implementations at composition roots. Keep Three.js, engine handles, Workers, DOM/filesystem types in adapters. Reuse existing components; avoid speculative abstractions.

| Owner | Responsibility |
| --- | --- |
| ScenarioDocument | Authored scene, initial agents, programs/settings; validated edits and persistence records. |
| ScenarioSession | Playback, run generation, transactional replacement and subsystem coordination. |
| AgentPopulation / AgentInstance | Internal identity, configuration, live state, spawn/despawn and resource release. |
| ScriptScheduler | Bounded queues, stable ordering, worker affinity and budgets. |
| Activation policy | Suspend/resume intentions from bounds, focus and validated radii. |

Explicit ownership and idempotent disposal apply everywhere. Despawn removes bodies, visuals, script contexts, event/selection/input references. Shared geometry/materials outlive borrowers and release with their owner. Cleanup must finish even if `on_stop` fails; worker termination is only a stuck-script fallback. Reset/replacement/disposal invalidate asynchronous results before releasing resources.

| State/action | Contract |
| --- | --- |
| ready → Play | Snapshot authored setup; enter preparing until environment, assets and enabled scripts validate; create runtime instances/contexts, then run. Prevent duplicate starts. |
| Pause / Play from paused | Stop time/hooks at an acknowledged boundary; camera/UI stay responsive. Resume the same run/state without repeating startup. |
| Reset | Invalidate pending work; discard runtime agents/mutations; restore authored transforms/settings, zero velocities/input/controls; return ready. |
| error / timeout | Stop advancement; identify script/instance and retain diagnostics until acknowledged/reset. Reset before running changed code. |

Save always serializes authored state, never runtime positions/engine handles. Viewport-focused input goes only to the controlled agent through the API; no script DOM listeners. Pause, blur, text focus, replacement and Reset clear keys. Editor shortcuts never reach camera/agent input.

## Script execution and scheduling

- Both languages expose synchronous `on_start(ctx)`, `on_step(ctx, dt)`, optional `on_stop(ctx)`; JavaScript exports them, Python defines them in its namespace. Allow helpers/standard facilities, but no detached timers/background scheduling. JavaScript rejects external imports/re-exports and async hooks using syntax-aware parsing, not regex export rewriting.
- Each instance has private persistent state and its own closure/namespace. Shared runtimes are not security isolation for untrusted scripts. Context supplies state, simulation time, assigned input, bounded local/nearby queries and validated queued commands. Agents control themselves; creators additionally spawn/despawn/configure.
- Drive commands: throttle/steering `[-1,1]`, brake `[0,1]`; generic force/impulse commands are engine-neutral. Enabled behavior replaces the built-in controller to avoid competing inputs.
- Physics advances **60 Hz** (1/60 s), with backend substeps allowed. Behavior defaults to **20 Hz**, optionally **60 Hz**, using simulation-time `dt`; retain continuous controls between hooks. Rendering independently interpolates snapshots.
- Stamp outputs with run generation and step; reject stale work. At each script boundary, collect required outputs, validate/apply commands in stable order, then advance dependent physics. Bound backlog/catch-up; slow scripts slow simulation, not UI, with visible lag. A **250 ms unresponsive-batch watchdog** stops the run, terminates the worker, invalidates contexts and requires Reset.
- Bounded pools per language, initially one worker each; cap using measured hardware while reserving rendering/physics capacity. Persistent instance affinity; change membership only between runs. Load Pyodide once per Python worker, on demand; show preparation/recovery errors and dispose proxies/namespaces. JavaScript-only runs do not download Python.
- Batch transferable observations/commands, reuse buffers/models, limit queries and thumbnails, batch compatible visuals, update wheels incrementally. Never copy the entire world per agent or rebuild bodies/world every frame.
- Preload authored and declared creator dependencies. Undeclared cold assets enter preparing until ready while the camera remains usable; queued references are not active bodies. Scheduling uses simulation time, so resume causes no wall-time spawn burst.

## Physics, surfaces and activation

One dedicated worker owns the selected engine's interacting world. The neutral contract covers preparation, scene/body construction, surface queries, commands, fixed stepping, observations, activation, reset and disposal. Registry keys are open strings with labels/capabilities. Missing capabilities/init/conversion failures produce diagnostics, never silent engine fallback.

Ready-state engine selection stages physics from authored data and commits the key only on success, preserving scene/agents/scripts. Running or paused changes require Reset. Both engines support every release flow; require consistent units/control semantics, not identical trajectories.

Build colliders from GLB mesh groups/instances with world transforms and meter conversion. Physical presets are separate from colors/material rendering: explicit package mapping → recognized normalized names → Generic Solid with diagnostics. Centralize Asphalt, Grass, Stone, Generic Solid and Water. Solid friction/restitution/rolling-resistance values are finite, nonnegative simulation defaults, not measured real-world coefficients; affect contacts and vehicle traction. Scene Physics lists mappings/overrides, editable in ready state and persisted per scene.

Water is non-supporting sensor geometry with a footprint-preserving region, default **2 m below the surface**, positive depth and drag on submerged portions. Preserve solid support underneath and bridge/shore clearances; broad bounding boxes must not classify adjacent roads as water. Malformed footprints disable the affected mapping with diagnostics. Release sensors on reset/replacement.

Vehicle controllers consume chassis bounds and `vehicle.json` wheel metadata; animate steering, suspension and spin from snapshots. Non-vehicles use validated generic bounds/bodies. Configuration errors block spawning. Use native stationary sleeping where supported and wake on commands/contact; otherwise preserve stationary behavior and measure its cost.

**Suspend when distant:** off by default and persisted per instance/default. Pause dynamics/hooks, exclude active collisions, preserve visible pose/state, clear stale controls. Focus is the controlled agent or saved fixed point, never the camera. Enter radius **40 m**, exit **50 m**; require positive exit > enter. Controlled agents stay active. Resume only at safe step boundaries after separation checks; blocked agents remain suspended with a reason and bounded retries. Reject control until safe activation; resume normal hook `dt` without catch-up. Paused playback never changes activation. Reset/replacement/disposal clears activation state.

### MuJoCo adapter

Use official `@mujoco/mujoco` browser WASM bindings, independent of Pyodide. Start single-threaded within the physics worker; enable internal multithreading only after measured benefit and verified host cross-origin-isolation headers/assets.

Compile neutral descriptions into appropriate primitives, heightfields or convex decomposition, preserving concavity, bridges and water boundaries; never use a scene-wide convex hull. Reject unsupported conversion. Cache artifacts by source hash and compiler/backend version.

Compiled topology is internal: reserve reusable inactive template slots, batch structural changes, prepare model replacement/reconstruction when capacity/shapes change. Verify pinned browser model-edit APIs; use reconstruction/state transfer if absent. Pause advancement while preparing, keep the old world until successful commit, preserve live pose/velocity/control/script references by stable domain ID. On failure preserve the world and report the failed spawn. Refresh indices/views after swaps; never retain borrowed WASM memory through destruction/reallocation. Release model/data/native handles exactly once. Measure compilation, rebuild stalls, native memory and reserved capacity separately.

## Assets and persistence

Scenes: `assets/scenes`, optional root pair and nested `environment.json`/`environment.glb`; identity is canonical relative key plus model/manifest hashes and version. Validate containment, references, versions, hashes, finite positive units and supported geometry. Current material names include Asphalt/Grass/Stone/Water and unmapped White/FrontColor. Agents: only `assets/agents`; reuse parsing with explicit URL base, optional vehicle/default-script metadata, duplicate-ID/malformed diagnostics.

API namespace `/api/scenario-studio`: existing `/scenes` and `/scene-package/{manifest,model}`; planned `/agents` and `/scenarios`. Package requests use key and both hashes; server resolves version from catalog. Keep Scene Studio document APIs separate and file access within asset roots.

Scenario store: `~/.steerlab/scenarios`, override `STEERLAB_SCENARIOS_DIR`; atomic temp-file/rename writes. Validate IDs, schema version, references, numbers and unique identities. Failed writes preserve prior files. New/Open/navigation confirm unsaved loss; Open stages complete resources before replacement. Missing/changed assets or unknown engines retain recoverable source/document data but block running. Reconstruct validated domain objects; normalize older records (missing engine → Rapier, suspension → false).

Persist name/identity/version, scene/null-default settings, initial agents, committed placement defaults, named script sources/filename/language/frequency/assignments, creator enablement/dependencies, engine/settings, surface presets/overrides, input eligibility, focus/radii and scheduling. Session drafts remain separate from committed instance data.

## Acceptance

Every feature ships usable UI, domain/adapters, persistence changes, failures and resource cleanup together. Verify all above interactions through normal product controls, both studio routes, and built client; no inert controls, scaffolding-only milestones or console-injected setups. Repeat every applicable functional flow on both engines. Commands/evidence live in the review guide. No new unit tests unless requested; Docker installs/builds and relevant existing regressions only. Preserve user assets/work; no deployment is implied.

Performance: **100 simultaneously active vehicles**, suspension off, representative correctly scaled scene/assets and movement/contact workload; include camera movement and controlled input. After preload/warmup, measure **60 seconds** in a foreground hardware-accelerated browser on the user's development machine. Run six cases: 100 JavaScript, 100 Python, 50/50 mix on each engine. Target ~60 FPS; require **average ≥58 FPS**, **p95 frame interval ≤25 ms**, **simulation/wall-time ≥0.95**. Smooth rendering cannot conceal slow simulation; optimize measured bottlenecks before completion.

Record browser, viewport/DPR, CPU/GPU, scene/model complexity, backend/binding version, substeps, workers, frame/physics/script costs, backlog, active/total/reserved counts, memory/resources and simulated-time ratio. Report loading/compilation/topology stalls separately; inspect spawn/despawn bursts and repeated Play/Pause/Reset/replacement/engine switches/disposal. Resource counts return to baseline, with intentional caches identified. Expose bounded aggregate metrics without per-agent UI loops. Software-rendered/headless checks prove functionality only.

## Runtime references

Verify/pin dependency versions when first implemented: [Pyodide workers](https://pyodide.org/en/stable/usage/webworker.html), [Python compatibility](https://pyodide.org/en/stable/usage/wasm-constraints.html), [Rapier sleeping](https://rapier.rs/docs/user_guides/javascript/rigid_body_sleeping/), [MuJoCo browser bindings](https://github.com/google-deepmind/mujoco/blob/main/wasm/README.md), [collision](https://mujoco.readthedocs.io/en/latest/computation/), [model editing](https://mujoco.readthedocs.io/en/latest/programming/modeledit.html).
