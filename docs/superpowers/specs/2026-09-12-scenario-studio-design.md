# Scenario Studio design

Date: 2026-09-12

Status: Design draft for user review. Implementation has not started.

## Purpose and agreed scope

Scenario Studio at `/scenario_studio` assembles a published scene and agents, then previews their physics and scripted behavior. Scene Studio remains the environment-authoring app at `/scene_studio`.

The first release targets 100 active agents with smooth playback. Agent behavior and scenario-level creator scripts support JavaScript and Python in the browser. Python targets Pyodide's supported standard library; a local Python service, native package support, and ML integrations are outside this release.

Users choose assets, edit settings and scripts, and control playback. Instance IDs, worker placement, lifecycle transitions, resource ownership, and cleanup are internal responsibilities.

The following sections include concrete implementation defaults for review alongside the requirements agreed in conversation.

## Current repository and reuse

- `src/main.ts` already routes to Scene Studio and provides the Scenario Studio placeholder.
- Existing renderer, camera/input code, HUD controls, asset loading, and thumbnail rendering provide reusable foundations. Reuse capabilities through focused adapters; do not make Scenario Studio depend on Scene Studio's editor state.
- `assets/scenes/environment.json` and `environment.glb` form an existing published environment package. The manifest carries hashes, transforms, units, chunks, and semantic records.
- Exported GLB material names include Asphalt, Grass, and Stone. The manifest currently lacks explicit physical surface settings.
- `assets/agents` contains vehicle models, thumbnails, asset metadata, wheel definitions, and approximate chassis collision boxes. These are initial geometry definitions, not complete driving-physics configurations.
- Existing scene-editor documents live in the editor's user-data store. Published scene browsing must not confuse that API with `assets/scenes`.
- The current application has no physics-engine or Python-runtime dependency.

## Workspace

Use a central viewport, a shared asset-browser panel along the bottom, an Agent Inspector on the left, and a compact scenario toolbar above the viewport. The bottom position is the proposed default and follows Scene Studio's existing asset-browser placement.

The toolbar exposes the scenario name, New/Open/Save, Play/Pause/Reset, and Scenario Script. A compact status area shows playback state and agent count. Performance details and script errors can expand without permanently occupying the viewport.

The shared browser has two tabs: **Scenes** and **Agents**. Both support search, thumbnails or a labeled fallback, selected-item feedback, loading/error states, and Refresh. Switching tabs preserves their independent selection and search state.

The application uses the existing HUD's visual language. The multiline script editor uses a native text-editing surface integrated with its panel, including keyboard selection, copy/paste, undo, scrolling, and accessible focus. Typing in it must not reach viewport shortcuts or agent input.

### Scene browsing and replacement

1. Clicking a scene card selects a candidate and shows its summary. It does not change the active scene.
2. **Use Scene** opens a confirmation dialog when replacing an active scene.
3. Confirmation names the new scene and explains that existing agents will be removed.
4. The replacement is loaded and validated before committing the switch. The current setup remains available if loading fails.
5. Successful replacement stops the run, clears authored and runtime agent instances, releases the old simulation resources, sets time to zero, clears agent selection, and activates the new scene.

Suggested dialog copy:

> Switch to “{sceneName}”? This removes {count} agents from the current setup and resets the simulation. The agent list will start empty. Your scenario script will be kept but disabled until you enable it again.

Actions: **Cancel** and **Switch Scene**. Use singular/plural grammar and also show the warning when the count is zero. The count is the union of authored and live instance identities, so an authored agent currently despawned during playback is still accounted for.

Switching scenes updates the current working document and marks it unsaved; it does not overwrite the saved scenario automatically. Retaining the creator-script text but disabling execution is a proposed default: a script for the old scene must not repopulate the new one unexpectedly. Clear scene-specific placement drafts and overrides.

Selecting the already active package is a no-op. If its content has changed, treat loading the changed package as scene replacement. Cancel leaves the setup intact. If a replacement interrupts playback, pause first; failure or cancellation leaves the old run paused for explicit resumption.

### Agent browsing and placement

Clicking a browser agent opens Agent Inspector with a **New agent** context. Its settings become defaults for subsequent placements of that asset in this scenario. They do not edit the source asset.

- **Add** enters placement mode; clicking a valid physical surface places an instance.
- Dragging a browser item into the viewport shows a placement preview. Dropping on a valid physical surface places the instance.
- Placement raycasts against scene colliders and uses the actual surface height, including bridges and raised ground. Water sensors and existing agents are excluded from placement targets in the first release.
- Account for the agent's origin and collision bounds so it rests on the surface rather than intersecting it. Reject unsupported or intersecting placements with visible feedback.
- Dropping outside a valid surface cancels placement. Escape cancels placement mode.
- Assets still loading cannot be placed; show progress and recoverable errors.

Clicking an existing viewport agent opens Agent Inspector with an **Existing agent** context. Selection is distinct from input control; a **Control this agent** action selects the single input-controlled agent.

Authoring placement, deletion, transforms, settings, and script edits are available in the ready state. During a run, including a paused run, existing-agent details remain inspectable; Reset returns to authoring. Scripts can spawn/despawn agents during playback.

### Agent Inspector

Display the asset preview, asset name, instance display name where applicable, and the current editing context. Settings include position and heading for an existing instance, validated physics settings, input-control eligibility, and **Suspend when distant** (off by default).

The Script section provides:

- Script enabled/disabled and Python/JavaScript selection.
- A multiline editable source editor.
- **Import Script** accepting `.py` and `.js` text files.
- Imported filename, validation feedback, and runtime errors associated with the relevant script/agent.

A successful import detects the language and places the full contents in the editor immediately. Cancel, read failure, unsupported extensions, or oversized files preserve the existing text. Confirm before replacing nonempty modified source. Language changes retain the source as a draft and require validation before execution.

Browser-item edits affect future placements. Existing-instance edits affect that instance only. Duplicated instances get independent configuration and script state. Source code is stored in the scenario, so importing a local script does not leave a dependency on its original filesystem location.

### Scenario creator script

**Scenario Script** opens a separate editing context using the same editor/import component. It can create/configure agents, assign behavior scripts from the scenario's named script collection, and schedule later spawning using simulation time.

The creator script supports startup and update hooks. Startup runs once for each new run; Pause/Play does not repeat it. Reset removes its runtime population, and the next Play executes startup from fresh state.

Creator-script spawns are runtime instances. Users do not supply internal IDs or manually release physics/rendering resources. The API returns opaque agent references for later commands; stale references report a useful error rather than controlling a different instance.

## Playback and scripting contract

Playback states are ready, preparing, running, paused, and error. Preparing covers dependency loading, script validation, and initial runtime construction. Play requires a valid active scene and enabled scripts that validate.

| Action | Required behavior |
| --- | --- |
| Play from ready | Snapshot authored setup, prepare resources, create runtime agents, initialize scripts, and start stepping. |
| Pause | Stop advancing simulation time and script hooks; keep camera and interface responsive. |
| Play from paused | Resume the same run and script state. |
| Reset | Invalidate pending results, discard runtime mutations, restore authored agents and transforms, clear input/velocities, and return to ready. |
| Script error/timeout | Stop advancing simulation, identify source and agent, and show the error. Reset is required before rerunning changed code. |

Both language adapters expose synchronous `on_start(context)`, `on_step(context, dt)`, and optional `on_stop(context)` hooks. JavaScript exports these functions; Python defines them in its script scope. Hook-local code can use supported language libraries, but scheduling must use simulation time and hooks. Detached timers/background tasks are not part of the supported lifecycle contract.

The context exposes per-instance state, simulation time, assigned input, bounded scene/nearby-agent queries, and queued commands. Creator contexts additionally expose spawn/despawn and configuration commands. Agent contexts control their own instance. Vehicle controls include throttle, brake, and steering; generic physics controls include forces/impulses. All commands are validated at the domain boundary.

Each instance has its own script context and state. Python namespaces and JavaScript script instances prevent accidental state reuse; shared runtimes are not advertised as security isolation between untrusted scripts.

Worker outputs carry the run generation and simulation-step identifier. The controller ignores old results after Reset, scene replacement, or disposal. Spawn/despawn commands commit between physics steps, in a stable order, and only after required resources are ready. An instance becomes visible and physically active together.

Input is sampled while the viewport has focus and delivered to the designated controlled agent. Pause, blur, focus entering a text field, scene replacement, and Reset clear held keys. Scripts receive simulation input through the API rather than installing their own DOM listeners.

## Automatic lifecycle and domain boundaries

Domain objects own private state and enforce legal transitions. Transport records may be plain data; domain behavior must not be a collection of public mutable records.

| Component | Responsibility |
| --- | --- |
| Scenario document | Own authored scene reference, initial agent definitions, script sources, and settings; validate edits and produce persistence records. |
| Scenario session | Own playback state, run generation, scene-change transaction, and coordination of injected subsystems. |
| Agent population | Own live instances and references; coordinate spawn/despawn and release owned resources. |
| Agent instance | Own configuration and lifecycle state for one agent. |
| Script scheduler | Own bounded work queues, worker assignment, step ordering, and script budgets. |
| Activation policy | Determine full or suspended simulation using agent settings and the designated focus. |

Replaceable boundaries include physics, rendering, script execution, input, and persistence. Define minimal interfaces there; JavaScript and Python are separate implementations of the script contract. Construct concrete implementations only at the application composition root. Physics handles, Three.js objects, Workers, DOM objects, and filesystem APIs remain inside their adapters.

Resources have explicit owners and idempotent disposal. Shared geometry/materials are retained while referenced and released when the last owner is gone. Per-instance physics bodies, worker state, event registrations, selection/input references, and visual instances are removed on despawn. Terminating a worker is a fallback for a stuck script, not a substitute for routine instance cleanup.

## Physics and surfaces

Use a replaceable Rapier adapter as the proposed initial implementation. Keep the interacting physics world together in a dedicated worker; script workers return commands rather than owning independent physics worlds.

Build static scene colliders from transformed GLB geometry, honoring scene units, instancing, material groups, and raised surfaces. Use physical-surface presets separate from visual materials. Explicit package metadata takes precedence; recognized material names provide a compatibility mapping for current exports. Unknown materials use a documented generic-solid preset and appear in import diagnostics. Do not infer physical types from rendered color.

Asphalt, grass, and stone presets affect contact friction and vehicle traction/rolling behavior. Preset values are centralized, identified in persisted settings, and tuned against the product checks rather than treated as measured real-world coefficients.

Water is a sensor surface with a documented finite-depth region and drag effect; it is not a supporting road collider. A proposed first-release default is a region extending two meters below each water surface, configured through the water preset. Solid geometry beneath remains physical. Buoyancy and fluid simulation are outside this release. Region construction must preserve the water footprint so bridges or adjacent road areas are not incorrectly classified as submerged.

Vehicle agents use their supplied chassis bounds and wheel metadata through a vehicle-controller adapter; wheel visuals follow simulated steering, suspension, and rotation. Models without vehicle metadata use a generic rigid-body configuration derived from validated bounds. Configuration errors prevent spawning that asset and show diagnostics.

Use native stationary-body sleeping and wake bodies on relevant control commands/contact. Optional **Suspend when distant** pauses an eligible agent's dynamics and behavior hooks together, preserves its state, and excludes its body from active collision participation until reactivation. This is explicitly an approximation and is off by default.

Measure distance from the controlled agent or, if none is controlled, the scene's fixed simulation-focus point. Camera movement does not change that focus. Use separate enter/exit radii; the proposed defaults are 40 m and 50 m. Controlled agents remain active. Check valid separation before reactivation and keep a blocked agent suspended with a diagnostic rather than introducing overlapping active bodies. Continuous distant traffic movement is outside the suspension mode.

## Performance design for 100 agents

Target 60 FPS rendering on the user's development machine with 100 active agents. Treat this as a measured acceptance target for representative scripts and assets, not a guarantee for arbitrary Python/JavaScript workloads.

- Physics advances at a fixed 60 Hz. Rendering interpolates published transforms independently of script execution.
- Default behavior hooks run at 20 Hz, with simulation-time `dt`; an explicit per-script 60 Hz setting supports input/control behaviors that need it. Between updates, the last continuous control command remains in effect.
- Use bounded pools per language with persistent agent-to-worker assignment. Start with one worker per language; allow a small hardware-aware cap, then tune with measurements. Load Pyodide once per Python worker.
- Batch snapshots and returned commands by worker; provide requested local observations rather than copying the whole world to every agent.
- At each script-update boundary, collect the required outputs before advancing the dependent physics step. Apply commands in stable order. Slow hooks slow simulation time without blocking the UI; show when the run is falling behind real time.
- Bound catch-up work and queued requests. Pause with diagnostics on a stuck hook; do not accumulate an unbounded backlog or keep applying old-run commands.
- Reuse model resources, batch compatible rendering where appropriate, and avoid rebuilding the scene or allocating physics bodies each frame.
- Preload assets referenced by authored agents and declared creator-script asset dependencies before Play. A runtime request for an undeclared, uncached asset enters preparing state while loading, with the camera still usable; users can declare dependencies to avoid these interruptions.
- Expose active/total agents, render frame times, physics-step cost, script-batch cost, worker queue depth, and simulated-time/wall-time ratio.

Do not rely on distance suspension to pass the 100-active-agent acceptance case. Its separate check covers correct suspension behavior.

## Assets and persistence

Published scene discovery is rooted at `assets/scenes`, supports the existing root-level environment pair, and discovers packages in subdirectories. Identify packages by a stable relative path plus model/manifest content identity. Validate versions, file references, hashes, units, and collision geometry before activation.

Agent discovery is rooted at `assets/agents`; reuse catalog parsing with an explicit URL base so nested scanning produces correct asset URLs. Read optional vehicle and default-script metadata through adapters. Duplicate IDs and malformed assets are shown as unavailable entries with diagnostics.

Use separate Scenario Studio API routes for published scene listings, agent listings, and scenario documents; preserve Scene Studio's existing scene-document API. Model/script file access stays within the declared asset roots.

Store scenario documents in a dedicated server-side directory, proposed as `~/.steerlab/scenarios`, with a separate `STEERLAB_SCENARIOS_DIR` override. Reuse existing atomic-write conventions. Save/open covers the name, scene reference, initial agents, script collection/source, creator-script enablement, physics presets/overrides, focus, and scheduling settings. Do not serialize live engine handles or runtime positions into the authored setup.

Missing or changed referenced assets produce actionable diagnostics on open. A saved document remains recoverable even if it cannot currently run. Source asset editing, a general asset importer, and a Python backend are outside this change.

## Error handling

- Scene load failure preserves the previous scene and agents.
- Spawn failure reports the asset and reason and leaves no partial instance.
- Script compilation errors appear in the editor and prevent Play for enabled scripts.
- Script exceptions/timeouts identify the script and instance, pause advancement, and remain visible until acknowledged/reset.
- Script edits and imports never discard the previous text on failure.
- Reset, scene replacement, and route disposal invalidate outstanding asynchronous work before releasing resources.
- Switching between browser-item and instance editing preserves the corresponding source draft in the document/session; no silent cross-assignment of settings or scripts.

## Product verification and acceptance

Do not add unit tests unless explicitly requested. Use build/type checks and direct browser verification, with repeatable browser scripts where useful.

Functional acceptance:

1. Both studio URLs still work; Scenario Studio does not initialize Scene Studio's editor state.
2. Scenes and Agents share one tabbed browser; Agent Inspector opens on the left for browser and viewport selections.
3. Scene selection requires confirmation. Cancel preserves state; confirming clears authored/live agents, resets the run, disables the retained creator script, and does not overwrite a saved document. Failed replacement preserves the old setup.
4. Add/drop uses physical scene surfaces, works on raised ground, and rejects invalid/intersecting placement.
5. Browser defaults and existing-instance settings stay separate. Imported `.py`/`.js` contents appear in the correct editor and survive save/open.
6. JavaScript and Python agents run together; automatic and keyboard-controlled examples work without input leaking from text fields.
7. Creator scripts spawn/configure agents at startup and over simulation time; Pause resumes state and Reset removes runtime mutations without duplicate agents or ghost bodies.
8. Script error, timeout, failed spawn, and stale worker-result cases produce the specified behavior.
9. Physical surface differences, wheel/chassis behavior, and optional distance suspension are observable in the viewport.
10. Repeated spawn/despawn, Reset, scene replacement, and app disposal return tracked body, instance, listener, and script-state counts to their expected baseline.

Performance acceptance:

- Exercise 100 simultaneously active vehicle agents on a representative published scene with simple movement scripts and contact interactions, including a 50 Python / 50 JavaScript mix.
- Preload assets and warm the run, then measure at least 60 seconds in a foreground browser with hardware acceleration. Record browser, viewport, device-pixel ratio, CPU/GPU, worker counts, and scene/model complexity.
- Aim for approximately 60 FPS, with a proposed acceptance floor of 58 FPS average, 95th-percentile frame intervals no worse than 25 ms, and simulated-time/wall-time ratio at least 0.95 under the representative workload. Report loading separately.
- Repeat with all JavaScript and all Python to identify language-specific bottlenecks. Include camera movement and input control during the run.
- Check stable resource counts and memory behavior across repeated runs. Headless/software-rendered checks verify function but do not establish the user's hardware FPS target.
- If the target is missed, use measured render/physics/script costs to optimize the responsible subsystem and report results before claiming the performance requirement met.

## Delivery boundaries

This is one coherent Scenario Studio subsystem with staged implementation and product checks: domain/persistence and discovery; workspace/placement; physics/playback; script runtimes/creator scripts; then 100-agent verification and tuning. These are sequencing boundaries, not separate user-facing releases that omit agreed requirements.

The implementation plan follows approval of this written spec. No runtime code or dependencies are changed by this document.

## References

- [Pyodide worker execution](https://pyodide.org/en/stable/usage/webworker.html)
- [Pyodide Python compatibility](https://pyodide.org/en/stable/usage/wasm-constraints.html)
- [Rapier sleeping behavior](https://rapier.rs/docs/user_guides/javascript/rigid_body_sleeping/)

These documents inform the runtime choices. Pin and verify dependency versions during implementation.
