# Road Scene Quality Implementation Plan

**Goal:** Generate a physically connected, planned road cycle surrounded by explicit terrain, or leave the current scene intact and explain infeasibility.

**Architecture:** Keep the existing planner, exact-socket solver, worker and result validation. Correct derived socket sampling, constrain the catalog boundary for road scenes, and remove the policy-dropping retry. No overlays, wildcard sockets, new asset geometry or changes to the reviewed road membership.

**Tech stack:** TypeScript, Three.js GLB sampling, Vite worker, existing Vitest suite, Playwright product verification.

**Spec:** User-approved approach and `docs/road-generation-feasibility-investigation.md`.

## Constraints

- Preserve existing uncommitted work; do not commit it or create new unit tests.
- Terrain is explicitly authored, not inferred from the absence of road tags.
- Exact physical socket matching and world-plan validation stay mandatory.
- Requested policies must survive generation; failure must not change scene/history/selection.

## Tasks

- [x] Reproduce with real catalog: update `scripts/verifyWorldPlanCorpus.ts` to default to `discoverAssetCatalog("assets")` and `paletteFromAssets(..., { purpose: "road-scene" })`, retaining `--synthetic` for structural checks. Add the 10×10 seeds 13, 134, 1345. Run `npm run wfc:world-plan:verify` and observe failure before changing production code.
- [x] Correct `scripts/generateRoadTileWfcMetadata.ts`: use triangle containment rather than AABB fill, compare only the boundary-near top row, and use a shared vertical sampling scale for planar side faces instead of each tile's maximum height. Regenerate metadata using `npm run assets:road-wfc`, preserving reviewed route tags. Confirm the corner joins straight roads and roads join grass without changing the exact matcher.
- [x] Extend `src/wfc/sceneLayout.ts` with an opt-in road-scene palette purpose: retain reviewed route variants or explicitly authored `terrain.ground` assets; exclude all other variants. Mark flat grass asset 163 with that semantic role. Generic catalog generation and asset browsing remain unrestricted.
- [x] Update `src/state/EditorState.ts`: construct plan and palette inside the guarded operation; select the road-scene palette when planning roads; perform one constrained solve; report infeasibility without a fallback; clear progress in `finally` on every failure.
- [x] Update the existing editor fallback expectation to assert scene/history/selection preservation. Run the real and synthetic corpora, existing tests and `npm run build:check`.
- [x] Run the real product worker path for all three screenshot seeds, inspect rendered screenshots, and verify failed requests preserve the previous scene. Record measured results and remaining limitations in the investigation and improvement documents.

## Verification outcome

- Real and synthetic corpora: 18/18 solved each, zero backtracks.
- Existing suite: 149/149 passing; build check passes.
- Actual UI button and browser worker: seeds 13, 134, 1345 each produce 100 cells, one solve, no page errors.
- Missing corner, undersized world and conflicting caller policy preserve the scene and clear progress.
- Read-only code review found no blocking issues. The existing failure fixture now remains eligible as terrain so it exercises a constrained-solve rejection rather than an empty palette.
- Existing world-space seam verification exposed 57 partial-footprint models; metadata generation now rejects them as full WFC cells while retaining manual placement.
