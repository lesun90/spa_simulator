# Scenario Studio review

Steps 1–3 completed in `98cf824`, `b5a5000` and `0eca7da`; the Step 4 playback and driving milestone is reviewed in the working tree through **2026-09-15**. [Design](scenario-studio-design.md) · [Progress/tasks](scenario-studio-implementation-plan.md)

## Run review

Keep development on port 5173. Open the built client at <http://localhost:4173/scenario_studio> using a separate container; Ctrl+C stops it:

```bash
docker compose run --rm --no-deps -p 127.0.0.1:4173:4173 app sh -c 'npm run review:build && npm run review:serve'
```

Build output is `/tmp/steerlab-review-dist` inside that container. Existing-container `review:build`/`review:serve` also work, but Compose publishes only 5173, so port 4173 then requires an internal browser. Preview shares Scenario Studio APIs/source routes; verify Scene Studio's editor on development. This is local review, not deployment.

Run repeatable checks inside the app container:

```bash
docker compose exec -T app npm run review:build
docker compose exec -T app npx --no-install vite-node scripts/verifyScenarioStudio.ts
docker compose exec -T app npx --no-install vite-node scripts/verifyApplicationWorkflows.ts
docker compose exec -T app npx --no-install vite-node scripts/verifyResourceLifecycle.ts
docker compose exec -T app npm run build:check
docker compose exec -T app npm test -- --run --maxWorkers=1 --minWorkers=1 tests/interactionSystem.test.ts tests/assetBrowserLayout.test.ts tests/disposeObject.test.ts
git diff --check
```

Missing browser dependencies: run `npx --no-install playwright install --with-deps chromium` inside Docker. Do not install on the host or add unit tests.

| Probe | Setup and artifacts (container paths) |
| --- | --- |
| `verifyScenarioStudio.ts` | Real preview/plugin on 4174; temporary scene and agent fixtures, including malformed/duplicate agents and water/steep placement surfaces. Normal clicks/keys, observed canvas text/network and active-display comparisons; no injected application state. Removes temporary fixtures. Writes screenshots/JSON to `/tmp/scenario-studio-review`; override `SCENARIO_REVIEW_ARTIFACT_DIR`. |
| `verifyApplicationWorkflows.ts` | Instrumented development browser on 5198, isolated persistence. Output `/tmp/lean-modular-workflows`; override `WORKFLOW_ARTIFACT_DIR`. Optional `WORKFLOW_BASELINE` supplies historical observations for byte comparison; the removed historical fixture is not required for actual product checks. |
| `verifyResourceLifecycle.ts` | Instrumented development/GPU ownership probe on 5199, isolated persistence. Output `/tmp/lean-modular-lifecycle`; override `LIFECYCLE_ARTIFACT_DIR`. |

Copy artifacts: `docker compose cp app:/tmp/scenario-studio-review ./scenario-studio-review-artifacts`. Later persistence reviews must use a separate `STEERLAB_SCENARIOS_DIR`.

## Step 1 walkthrough coverage

1. Default green ground, orbit/zoom/reset; search `SaMpLe`, select without replacing, named zero-agent warning, Cancel/Escape/backdrop preservation, confirm actual geometry, unchanged-reference no-op.
2. No-match filter and independent retained candidate/active state; `ScEnE2` search survives Refresh. Cancel then confirm replacement.
3. Change a selected fixture's manifest: old identity rejected, current scene retained; Refresh/retry succeeds. Invalid package disabled; empty geometry fails without replacing; raised-box import with manifest ground record adds no fallback surface.
4. Desktop/narrow long-name warning and contained long search; root discovery/source route; added/removed fixtures; rapid hover/filter/refresh/resize. Screenshots confirm generated previews and actual geometry.
5. Both studios/viewer regressions; repeated disposal, pending loads, stale/pruned thumbnail work, failed live-slot reuse and idempotent handles.

## Step 2 walkthrough coverage

1. Agent-only API discovers Compact and Coupe with preserved source URLs and meter-scale metadata; duplicate IDs and malformed metadata remain visible but unavailable.
2. Independent Agents search/selection and New Agent drafts; normal drag/drop produces a placement ghost and commits both vehicle types at their asset scale.
3. Existing Agent selection, 45° transform apply, duplication and deletion; overlap, water-over-solid and 50° support are rejected with visible diagnostics. A bridge deck above water accepts placement; outside drop and Escape use the placement-cancellation path.
4. Failed empty-geometry replacement preserves two agents. Cancel/Escape/backdrop preserve them and the warning uses plural grammar; successful replacement clears the population and the next warning reports zero agents.
5. Rapier runs in one dedicated worker behind the neutral registry/world contract. Imported transformed triangles provide support, non-supporting water blocks fall-through, and the default collider exists only for the null scene.

## Step 3 walkthrough coverage

1. The compact viewport toolbar exposes an editable scenario name plus New, Open and Save at desktop and narrow widths, with visible saved/dirty/progress/error status.
2. A new scenario retains two normally placed authored agents through Save, workspace mutation and Open. The saved version, identity, name, Rapier engine key, asset references and authored snapshots are recovered through product controls.
3. Scenario files live under an isolated `STEERLAB_SCENARIOS_DIR`. The server rejects malformed numeric data and preserves the prior file; writes use unique temporary files and atomic rename.
4. Open validates record shape/version and resolves current scene and agent hashes before it changes physics, presentations, population or the document. A malformed response leaves the current named two-agent workspace recoverable.
5. A failed Save leaves both the current dirty document and prior saved file intact; retry succeeds. New and dirty Open use native discard confirmation, and dirty navigation registers the browser unload safeguard.

## Step 4 walkthrough coverage

1. Play/Pause/Reset controls sit beside New/Open/Save in the compact toolbar, with a Ready/Preparing/Running/Paused/Playback error status line and Play relabeled Resume from a paused run.
2. Play snapshots the authored population, builds one dynamic Rapier body per agent from its authored pose and scale (query-only authoring colliders are removed first so they cannot collide with the live bodies), and starts the single `inputEligible` agent as the controlled vehicle.
3. On the default open ground, holding W/A/S/D (or the arrow keys, with Space as brake) drives the controlled vehicle through a validated `DriveCommand` boundary: throttle accelerates along its current forward axis with a top speed, steering scales with forward speed and reverses correctly, and lateral grip damping keeps it from skating sideways. Gravity and ground contact apply throughout; the authored snapshot never changes while running.
4. Pause freezes the live transforms in place (confirmed unchanged across a follow-up delay); Resume continues the same run without recreating bodies. Attempting to move, transform, duplicate or delete an agent while running or paused is rejected with "Pause playback and Reset before editing agents."; placement and direct-drag transforms are likewise blocked at the input layer.
5. Reset releases the live bodies, restores the authored transform on every visual instance, recreates the query-only authoring colliders and returns to Ready, where the same edit is immediately accepted again. Two repeated Play/Reset cycles completed with no errors and no leaked bodies. A `stepPlayback` response whose generation no longer matches the session's current run (superseded by a Reset while the call was in flight) is discarded rather than applied.
6. Save during a Running or Paused run continues to serialize only the authored document; live positions never reach the saved record.

### Step 4 evidence

Host-run pass (no Docker container available this session), Chromium **151.0.7922.34** via Playwright, SwiftShader, **1366 × 900**. Milestone gate only; the Docker build, full repository suite and broad browser matrix from the release/hardening gate are still owed on the next formal review pass.

| Check | Recorded result |
| --- | --- |
| `tsc --noEmit` and `vite build` | Passed. |
| Milestone 4 walkthrough (ad hoc Playwright script, not checked in) | Real product controls only: placed a vehicle, clicked Play, held W to drive on the default ground, clicked Pause (position frozen across a delay), attempted an edit while paused (rejected), Resumed, clicked Reset (visual snapshot back to the authored pose, edit accepted again), then ran two more Play/Reset cycles with no errors. Zero browser console errors. |
| Scoped regressions | `tests/interactionSystem.test.ts`, `tests/worldInteraction.test.ts`, `tests/disposeObject.test.ts` (36 tests across the main tree and an existing worktree copy) passed. |
| Shared application workflow regression | `scripts/verifyApplicationWorkflows.ts` passed end to end (Scene Studio, Scenario Studio scene/agent/persistence flows, Asset Viewer); zero browser errors. |
| Resource lifecycle regression | Not run this pass — blocked by a pre-existing root-owned `node_modules/.vite` cache in this sandbox unrelated to this change; rerun in the normal review container. |

An architecture pass confirmed: domain code (`ScenarioSession`, `domain/playback.ts`) still imports no Three.js/Rapier/DOM types; Rapier types stay inside `physics.worker.ts`/`RapierPhysicsWorld.ts`; `AgentTransform`/`PlaybackSnapshot`/`DriveCommand` are plain neutral values crossing the physics boundary; `preparePlayback`/`resetPlayback` are idempotent setters while `stepPlayback`/`driveControlledAgent` are generation-gated against the active run; and Save/authoring guards were verified to read only `ScenarioDocument`'s authored state, never live transforms.

## Results and evidence

Chromium **151.0.7922.34**, SwiftShader, **1366 × 900** and **390 × 844**. Functional evidence only; no hardware FPS/100-agent acceptance or historical GLB byte-equivalence claim.

| Check | Recorded result |
| --- | --- |
| Docker build/check and review build | TypeScript + Vite passed. |
| Built-client walkthrough | Steps 1–3 scene/catalog/placement/persistence groups passed; two-agent reopen plus invalid-save, failed-open and failed-save preservation passed; ten manifest requests; zero browser errors. |
| Application workflows | Editing, save/reopen, undo/redo, WFC, export/import/failure preservation, both studios/viewer passed; zero browser errors. Historical comparison not requested. |
| Lifecycle | Three cycles per app/viewer left zero listeners/frames; zero late thumbnail renders; pruning retained replacement; five failed loads released slots; held handles stayed distinct after duplicate disposal. |
| Existing regressions | Scoped gate: 36 tests across the main tree and an existing worktree copy passed; no new unit tests. The repository-wide run recorded 587 passing tests and five unrelated failures from `.worktrees/scene-environment-export/tests/roadTilesAssets.test.ts`, whose obsolete asset path is absent in that worktree. |
| UI detector / whitespace | No findings. |

JSON: [built client](scenario-studio-review/scenario-observations.json), [application](scenario-studio-review/application-observations.json), [lifecycle](scenario-studio-review/lifecycle-observations.json).

Screenshots: [agent placement](scenario-studio-review/agent-placed.png), [bridge placement](scenario-studio-review/bridge-placement.png), [overlap rejection](scenario-studio-review/overlap-rejected.png), [water rejection](scenario-studio-review/water-rejected.png), [steep rejection](scenario-studio-review/steep-rejected.png), [failed replacement preservation](scenario-studio-review/failed-replacement-preserved.png), [zero-agent warning](scenario-studio-review/zero-agent-warning.png), [confirmation](scenario-studio-review/named-confirmation.png), [sample](scenario-studio-review/sample-loaded.png), [groundless](scenario-studio-review/groundless.png), [narrow confirmation](scenario-studio-review/narrow-confirmation.png), [narrow search](scenario-studio-review/narrow-search.png).

Current cache/editor limits are recorded once in [current implementation](scenario-studio-design.md#current-implementation). Future feature walkthroughs are in their plan steps; add only new results and evidence here.
