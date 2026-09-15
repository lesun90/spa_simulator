# Scenario Studio implementation plan

> **For agentic workers:** use `executing-plans` milestone by milestone. Work inline unless the user requests delegation.

**Goal:** deliver the complete Scenario Studio core loop with maintainable domain boundaries, then refine it from user evidence.

**Architecture:** domain objects own authored and playback invariants. Inject persistence, physics, scripts, rendering and input adapters through narrow contracts; build one production implementation of each contract before adding variants.

**Tech stack:** TypeScript, Three.js, Rapier worker, Vite, Vitest and Playwright.

**Spec:** [Scenario Studio design](scenario-studio-design.md)

**Core progress:** 4/5 milestones complete. Milestone 1: `98cf824`; Milestone 2: `b5a5000`; Milestone 3: `0eca7da`; Milestone 4 completed and reviewed in the working tree on 2026-09-15. **Next: Milestone 5**, JavaScript agent behavior.

[Design requirements](scenario-studio-design.md) · [Commands and evidence](scenario-studio-review.md)

## Delivery model

Build the smallest end-to-end workflow that protects the architecture, then put it in front of users. User testing decides which refinements and extensions move into active work.

Each core milestone must provide:

- one usable path through UI, domain and adapters;
- stable contracts at replaceable boundaries;
- validation, stale-result protection and cleanup where data or resources cross a boundary;
- focused verification of domain invariants and one real browser workflow;
- a concise review of ownership, dependency direction and lifecycle behavior.

Do not hold a core milestone for responsive polish, exhaustive error matrices, speculative performance work or features outside its primary workflow. Record those findings in the backlog. Fix data loss, invalid state, resource leaks and boundary violations before moving on.

## Global architecture constraints

These requirements are mandatory in core work and later refinement:

1. Domain objects own state and invariants. Domain code does not depend on UI, rendering, storage, networking or a physics engine.
2. Persistence, physics, scripts, rendering and input meet the domain through small interfaces. Inject implementations at the composition root.
3. Engine and framework types stay inside adapters. Domain snapshots use immutable neutral values.
4. Constructors leave objects usable. Async preparation commits atomically or releases partial work; generation stamps reject obsolete results.
5. Owners release workers, registrations, GPU resources, native allocations and borrowed presentations. Repeated disposal remains safe.
6. Persisted records are versioned and validated. Failed open/save operations preserve the current recoverable state.
7. Add an abstraction only for a boundary that is replaceable now or named in the accepted roadmap. One implementation does not need a hierarchy.
8. Extend existing owners and helpers before adding parallel implementations. Keep files focused on one responsibility.

## Verification gates

### Task gate

Run only checks affected by the edit:

- TypeScript for contract or implementation changes;
- relevant existing tests, adding tests only when requested;
- direct product verification for the changed interaction;
- `git diff --check`.

### Milestone gate

Run once after the end-to-end path works:

- production build;
- one browser workflow covering the milestone's happy path and its main state-preservation invariant;
- focused regression checks for shared code;
- architecture review for ownership, dependency direction and stale async work.

### Release and hardening gate

Run Docker builds, the full repository suite, broad browser matrices, performance measurements and compatibility sweeps before a release or when a change reaches the affected boundary. Do not rerun this gate for every small task.

From Milestone 3, isolate review writes with `STEERLAB_SCENARIOS_DIR`. Keep screenshots and logs in review artifacts rather than this plan.

## Existing owners

Paths are relative to `src/scenario-studio/` unless they start with `src/`, `server/`, `scripts/` or `docs/`.

| Owner | Responsibility |
| --- | --- |
| `main.ts`, `ScenarioStudioApp.ts` | Composition, render loop, input routing and shutdown. |
| `domain/ScenarioDocument.ts`, `domain/ScenarioSession.ts` | Authored state, use cases, transactions and playback state. |
| `domain/agent.ts`, `domain/AgentInstance.ts`, `domain/AgentPopulation.ts` | Agent values, invariants, identity and support relationships. |
| `catalog/` and future `persistence/` | Catalog and scenario repository ports plus HTTP adapters. |
| `physics/` | Physics boundary, engine registry and Rapier worker adapter. |
| `rendering/` | Scene and agent presentations; no authored-state ownership. |
| `ui/` | HUD panels and user input drafts; no domain policy. |
| `server/scenarioStudio/` | Contained discovery, validation and persistence routes. |
| Shared `src/engine/`, `src/features/` | Renderer, interaction, asset ownership and reusable controls. |

Keep Scenario Studio separate from `WorldFeature` and `EditorState`. `AssetManager` owns cached geometry and materials; visual clones borrow them.

## Milestone 1: Published-scene browsing

- [x] Load published environment packages and retain the current scene when loading fails.
- [x] Provide scene search, confirmation, thumbnails, default-ground fallback and owned presentation cleanup.
- [x] Verify the route, real package loading, camera framing and repeated disposal.

Details: [Milestone 1 results](scenario-studio-review.md#results-and-evidence).

## Milestone 2: Authored agent placement

- [x] Discover agent assets through the agent-only catalog and API.
- [x] Extract neutral transformed scene geometry for query-only Rapier support colliders.
- [x] Show optional description, scene size, cell size and seed in Scene Inspector.
- [x] Provide independent scene/agent browser tabs and help for every Agent Inspector field.
- [x] Reuse Scene Studio selection, move, rotate and uniform-resize controls. Apply scale to visuals, collision bounds and future physics bodies.
- [x] Place on solid scene or authored-agent surfaces. Validate slope, clearance, scaled-footprint coverage and oriented-box overlap.
- [x] Store support identity and reject transform or deletion of a supporting agent until its dependents move.
- [x] Clear selection on an empty click and release detached controls.
- [x] Keep agent bodies out of authoring. Successful scene replacement clears authored agents; failed replacement preserves them.

Core contracts:

- `PlacementHit{point,normal,support,sceneRevision}` identifies a scene or authored-agent support.
- `AgentDraft` contains asset, name, pose, positive scale/mass, collision and placement settings.
- `ScenarioSession.placeAgent(draft, ray)` validates and commits authored state plus visuals.
- `PhysicsWorld` supplies scene queries during authoring and owns future live bodies during playback.

Review evidence covers metadata, help, scene placement, stacking, support protection, transforms, empty-click unselection and the absence of authoring-time agent-body operations. Focused tests, TypeScript and the production build pass. The full suite has two unrelated `glbToJsTool` module-format failures. Run the remaining Docker checks before committing this revision.

## Milestone 3: Scenario persistence

- [x] Define versioned `ScenarioRecord` and `ScenarioSummary` domain values containing name, scene reference, engine key and authored agents.
- [x] Add a `ScenarioRepository` port with `list`, `open` and `save`; implement its HTTP adapter and contained server store.
- [x] Validate identity, record version and numeric fields at the storage boundary. Write files atomically.
- [x] Add New, Open and Save controls with scenario naming and a dirty-state discard confirmation.
- [x] Stage Open through domain constructors. A malformed record, missing asset or failed request must leave the current scenario intact and show a useful error.

Core acceptance: create a scenario, place two agents, save it, change the workspace, reopen it and recover the same authored state. Verify one failed open and one failed save preserve the current work.

Review evidence covers the visible naming/New/Open/Save path, two-agent save and reopen, isolated storage, invalid-write atomicity, dirty discard confirmation, New, and failed open/save preservation. Open validates and prepares current scene and agent assets before committing physics, presentations, population or document state. TypeScript, production/review builds, the built-client workflow, shared application/lifecycle workflows and scoped regressions pass.

Defer: autosave, recent files, import/export, recovery history, keyboard-shortcut polish and a broad malformed-record matrix.

## Milestone 4: Rapier playback and basic driving

- [x] Add `PlaybackState = ready | preparing | running | paused | error` and legal `play`, `pause` and `reset` transitions to the domain.
- [x] Extend `PhysicsWorld` with preparation, fixed stepping, commands, reset and stamped neutral snapshots.
- [x] Create generic and vehicle bodies from the authored baseline only when Play enters preparation. Use authored scale for collision and body dimensions.
- [x] Step Rapier at `1/60` seconds in its worker and apply stamped transforms to visuals. Reset restores the authored baseline and releases live bodies.
- [x] Add one controlled-agent path for throttle, steering and braking through a validated `DriveCommand` boundary.
- [x] Disable authored transforms while running or paused. Saving during playback writes authored state, not live transforms.

Core acceptance: place a vehicle, Play, drive, Pause and Reset. Verify gravity/contact, basic control, authored-state restoration, stale-snapshot rejection and repeated body cleanup.

Details: [Milestone 4 results](scenario-studio-review.md#step-4-walkthrough-coverage).

Defer: wheel animation, render interpolation polish, multiple control schemes, surface-specific traction, water, detailed metrics and large-agent tuning.

## Milestone 5: JavaScript agent behavior

- [ ] Define engine-neutral `ScriptProgram`, observation, input and command values in the domain-facing script boundary.
- [ ] Add a `ScriptRuntime` port and one JavaScript worker implementation. Give each agent isolated state.
- [ ] Support one `on_step` behavior assigned to authored agents. Validate returned commands before sending them to physics.
- [ ] Add a minimal source editor with syntax/runtime diagnostics and dirty-state protection.
- [ ] Coordinate script preparation, Play/Pause/Reset and generation stamps. Terminate a worker that exceeds its execution budget and keep the scenario recoverable.
- [ ] Persist programs and agent assignments in the versioned scenario record.

Core acceptance: assign a constant-throttle behavior to two agents, run them with independent script state, pause without a command burst, reset and reopen the saved scenario. Verify syntax error, runtime error and execution-budget recovery.

Defer: file import, multiple languages, creator scripts, worker-pool tuning, advanced editor features and large-program management.

## User-testing checkpoint

After Milestone 5, give users the complete loop: open a scene, place agents, save, play, drive and assign a JavaScript behavior.

Classify feedback before changing scope:

- Fix architecture, data integrity, lifecycle and unusable core-flow defects immediately.
- Batch interaction and visual refinements by repeated user friction.
- Promote an extension only when user evidence or a release requirement justifies it.
- Measure performance before optimizing it.

Update the design and the relevant boundary contract when feedback changes behavior. Keep isolated UI refinements out of domain interfaces.

## Deferred extensions

These remain part of the product direction, not the active implementation sequence.

| Former step | Extension | Promotion condition |
| --- | --- | --- |
| 5 | Surface presets and water | Users need terrain-dependent driving or water behavior. |
| 7 | Creator scripts and runtime populations | Users need scripted spawn/despawn after agent behaviors work. |
| 8 | Python and mixed-language scripts | A validated use case requires Python libraries or mixed runtimes. |
| 9 | Distance suspension | Measurements show inactive distant agents cause a target workload to miss its budget. |
| 10 | MuJoCo adapter | A scenario requires MuJoCo behavior that Rapier cannot provide. |
| 11 | Smooth 100-agent playback | Representative saved scenarios exist and profiling identifies concrete bottlenecks. |

Each promoted extension gets its own bounded plan. It must implement the existing domain port or revise that port through an explicit architecture review. Do not scaffold deferred adapters in advance.
