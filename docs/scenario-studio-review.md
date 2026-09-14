# Scenario Studio Step 1 review

Review date: 2026-09-14. Scope: published-scene browsing/loading, search, confirmation, preview ownership, and regression checks. Agents, physics, playback, and scenario persistence belong to later steps.

## Open the built client

Keep the existing development app on port 5173. Run a separate review container with its own published port:

```bash
docker compose run --rm --no-deps -p 127.0.0.1:4173:4173 app sh -c 'npm run review:build && npm run review:serve'
```

Open <http://localhost:4173/scenario_studio>. The command builds into `/tmp/steerlab-review-dist` inside that container and uses the same Scenario Studio catalog/package/source middleware as development. Stop the review command with Ctrl+C when finished. The production asset routes remain separate from Vite's hashed `/assets` bundles.

Alternatively, with a browser inside the running Compose app container:

```bash
docker compose exec -T app npm run review:build
docker compose exec -T app npm run review:serve
```

That server is available at `http://127.0.0.1:4173/scenario_studio` inside the container; the existing Compose configuration only publishes port 5173 to the host. Vite preview is for local built-client review. Scene Studio's editor API is verified on its supported development server, not assumed available in preview.

## Repeat the recorded walkthrough

These commands use installed dependencies and Playwright Chromium inside Docker. If browser binaries/libraries are missing, install them in the container with `npx --no-install playwright install --with-deps chromium`.

```bash
docker compose exec -T app npm run review:build
docker compose exec -T app npx --no-install vite-node scripts/verifyScenarioStudio.ts
docker compose exec -T app npx --no-install vite-node scripts/verifyApplicationWorkflows.ts
docker compose exec -T app npx --no-install vite-node scripts/verifyResourceLifecycle.ts
docker compose exec -T app npm run build:check
docker compose exec -T app npm test -- --run --maxWorkers=1 --minWorkers=1 tests/interactionSystem.test.ts tests/assetBrowserLayout.test.ts tests/disposeObject.test.ts
git diff --check
```

`verifyScenarioStudio.ts` starts the real preview plugin on container port 4174 with an injected temporary asset root. It copies the existing `sample`/`scene2` packages and one vehicle source, creates root/groundless/empty/invalid/long-name review packages through the existing GLB exporter, and removes that temporary directory on exit. Catalog changes and stale-content failures modify only those copies. It drives canvas controls with clicks and keystrokes, observes network responses and text drawing, and compares the active-scene display before/after nondestructive actions. It does not inject application state or call domain methods.

The script writes 14 screenshots and `observations.json` to `/tmp/scenario-studio-review` inside the container. Override with `SCENARIO_REVIEW_ARTIFACT_DIR`. Copy them out with:

```bash
docker compose cp app:/tmp/scenario-studio-review ./scenario-studio-review-artifacts
```

The existing workflow and lifecycle probes use isolated Scene Studio persistence and temporary development servers on ports 5198 and 5199. Their artifacts go to `/tmp/lean-modular-workflows` and `/tmp/lean-modular-lifecycle`; override with `WORKFLOW_ARTIFACT_DIR` and `LIFECYCLE_ARTIFACT_DIR`. They instrument application internals for regression/ownership assertions and complement the built-client walkthrough.

The old workflow script referred to a historical refactor baseline that is absent from this repository. Its byte-for-byte GLB comparison now runs only when `WORKFLOW_BASELINE` points to a supplied observations JSON file. All actual editing, save/reopen, export/import, failure-preservation, Scenario Studio, and viewer checks still run without that historical file. This review makes no historical byte-equivalence claim.

## Product walkthrough

1. Open Scenario Studio. The default environment is a green 100 m square with a grid. Orbit, zoom, and use the camera reset button.
2. Search for `SaMpLe`. Click its card: the candidate and inspector change, while the active environment remains default ground. Use Scene opens a dialog naming `sample` and warning that the switch removes zero agents. Cancel, Escape, and clicking the backdrop each preserve the current scene.
3. Confirm with Switch Scene. Actual package geometry replaces the default presentation. Use Scene is disabled for the unchanged active reference. Filter to no matches and back; the active scene and candidate selection are preserved.
4. Search `ScEnE2`, Refresh, and select the remaining card. The query survives Refresh. Cancel replacement, then confirm it. Both published packages remain usable.
5. For isolated review fixtures, change a selected package's manifest before confirming. The server rejects the old content identity; the current scene remains visible. Refresh and retry to load the updated identity.
6. Select the invalid package. Its diagnostic is visible and Use Scene is disabled. Try the empty-geometry package: loading fails and preserves the previous scene.
7. Load the raised-box package, which retains a manifest ground record but has no ground mesh. Only the box appears: no green surface/grid is added. Its card shows the actual model preview.
8. Inspect a long scene name in the confirmation at desktop and 390 × 844. Candidate text is bounded separately from the removal/cancel warning. A long search query scrolls within its text field without covering Refresh. At 1366 × 900, verify the scene inspector and loaded viewport.
9. Discover/load the optional root package. Add/remove an isolated package and Refresh. Repeat hover/filter/refresh/resize; obsolete thumbnail work must not update removed cards.
10. Run the ownership probe. Repeated app disposal removes registered listeners and animation frames. Pending thumbnail requests never render after disposal; pruning preserves a replacement request; failed live-preview loads release their slots; repeated handle disposal is safe.

## Results and evidence

All results below were recorded on 2026-09-14, using Chromium 151.0.7922.34 with SwiftShader, at 1366 × 900 and 390 × 844. The software-rendered browser is functional evidence only; this does not establish the later 100-agent hardware performance requirement.

| Check | Result |
| --- | --- |
| `npm run build:check` and `npm run review:build` in Docker | Passed TypeScript and Vite production builds. |
| `verifyScenarioStudio.ts` | Passed all 14 walkthrough groups; six manifest requests; zero browser errors. |
| `verifyApplicationWorkflows.ts` | Passed edit/save/reopen, undo/redo, WFC generation, export/import and failure preservation, both studios and the viewer; zero browser errors. Historical baseline comparison was not requested. |
| `verifyResourceLifecycle.ts` | Three cycles each for Scene Studio, Scenario Studio and viewer left zero listeners/animation frames. Pending thumbnails produced zero late renders; pruning preserved replacement work; five failed loads released their live slots; simultaneous handles remained distinct after duplicate disposal. |
| Existing interaction/layout/disposal tests | 18 tests passed across three files. No unit tests added. |
| UI detector and diff whitespace checks | No findings. |

Machine-readable evidence: [built-client observations](scenario-studio-review/scenario-observations.json), [application workflows](scenario-studio-review/application-observations.json), and [lifecycle results](scenario-studio-review/lifecycle-observations.json).

Selected screenshots: [named confirmation](scenario-studio-review/named-confirmation.png), [published sample loaded](scenario-studio-review/sample-loaded.png), [groundless package with no fallback](scenario-studio-review/groundless.png), [long-name confirmation at narrow width](scenario-studio-review/narrow-confirmation.png), and [long search contained in its field](scenario-studio-review/narrow-search.png).

## Ownership and current limits

Cards borrow cached thumbnail textures. The thumbnail renderer owns static/live render targets, deduplicates pending static preparation, and invalidates work on pruning/disposal. Scenario Studio owns and releases its model cache at app teardown. Failed previews keep their labeled tile fallback; they do not cause unhandled promise rejections in either studio.

Model templates remain cached for the app session even after catalog entries disappear; static thumbnail targets are pruned when the catalog changes. This is intentional session cache retention, separate from live handles/listeners. Search reuses the existing canvas text field, including its end-of-text editing behavior; it is not the future native multiline script editor. The zero-agent warning is accurate for Step 1, which has no agent population.
