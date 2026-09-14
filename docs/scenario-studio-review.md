# Scenario Studio review

Step 1 completed in `98cf824`, reviewed **2026-09-14**. [Design](scenario-studio-design.md) · [Progress/tasks](scenario-studio-implementation-plan.md)

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
| `verifyScenarioStudio.ts` | Real preview/plugin on 4174; temporary copies of sample/scene2 and vehicle source plus exported root/groundless/empty/invalid/long-name fixtures. Normal clicks/keys, observed canvas text/network and active-display comparisons; no injected application state. Removes temporary fixtures. Writes 14 screenshots/JSON to `/tmp/scenario-studio-review`; override `SCENARIO_REVIEW_ARTIFACT_DIR`. |
| `verifyApplicationWorkflows.ts` | Instrumented development browser on 5198, isolated persistence. Output `/tmp/lean-modular-workflows`; override `WORKFLOW_ARTIFACT_DIR`. Optional `WORKFLOW_BASELINE` supplies historical observations for byte comparison; the removed historical fixture is not required for actual product checks. |
| `verifyResourceLifecycle.ts` | Instrumented development/GPU ownership probe on 5199, isolated persistence. Output `/tmp/lean-modular-lifecycle`; override `LIFECYCLE_ARTIFACT_DIR`. |

Copy artifacts: `docker compose cp app:/tmp/scenario-studio-review ./scenario-studio-review-artifacts`. Later persistence reviews must use a separate `STEERLAB_SCENARIOS_DIR`.

## Step 1 walkthrough coverage

1. Default green ground, orbit/zoom/reset; search `SaMpLe`, select without replacing, named zero-agent warning, Cancel/Escape/backdrop preservation, confirm actual geometry, unchanged-reference no-op.
2. No-match filter and independent retained candidate/active state; `ScEnE2` search survives Refresh. Cancel then confirm replacement.
3. Change a selected fixture's manifest: old identity rejected, current scene retained; Refresh/retry succeeds. Invalid package disabled; empty geometry fails without replacing; raised-box import with manifest ground record adds no fallback surface.
4. Desktop/narrow long-name warning and contained long search; root discovery/source route; added/removed fixtures; rapid hover/filter/refresh/resize. Screenshots confirm generated previews and actual geometry.
5. Both studios/viewer regressions; repeated disposal, pending loads, stale/pruned thumbnail work, failed live-slot reuse and idempotent handles.

## Results and evidence

Chromium **151.0.7922.34**, SwiftShader, **1366 × 900** and **390 × 844**. Functional evidence only; no hardware FPS/100-agent acceptance or historical GLB byte-equivalence claim.

| Check | Recorded result |
| --- | --- |
| Docker build/check and review build | TypeScript + Vite passed. |
| Built-client walkthrough | 14 groups passed; six manifest requests; zero browser errors. |
| Application workflows | Editing, save/reopen, undo/redo, WFC, export/import/failure preservation, both studios/viewer passed; zero browser errors. Historical comparison not requested. |
| Lifecycle | Three cycles per app/viewer left zero listeners/frames; zero late thumbnail renders; pruning retained replacement; five failed loads released slots; held handles stayed distinct after duplicate disposal. |
| Existing regressions | 18 tests across three files passed; no new unit tests. |
| UI detector / whitespace | No findings. |

JSON: [built client](scenario-studio-review/scenario-observations.json), [application](scenario-studio-review/application-observations.json), [lifecycle](scenario-studio-review/lifecycle-observations.json).

Screenshots: [confirmation](scenario-studio-review/named-confirmation.png), [sample](scenario-studio-review/sample-loaded.png), [groundless](scenario-studio-review/groundless.png), [narrow confirmation](scenario-studio-review/narrow-confirmation.png), [narrow search](scenario-studio-review/narrow-search.png).

Current cache/editor limits are recorded once in [current implementation](scenario-studio-design.md#current-implementation). Future feature walkthroughs are in their plan steps; add only new results and evidence here.
