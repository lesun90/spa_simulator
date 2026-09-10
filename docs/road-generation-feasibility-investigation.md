# Road Generation Feasibility Investigation

**Date:** 2026-09-10

## Reported symptoms

The generated scenes exhibit two visibly different failures:

1. Some generated layouts contain no road.
2. Other layouts are dominated by repeated parallel asphalt strips, disconnected pavement, and unrelated intersections or roundabouts.

The investigation is reproducible with:

```text
npx vite-node scripts/diagnoseRoadCatalog.ts
```

## Catalog evidence

The current catalog contains:

```text
539 catalog assets
1,052 WFC variants
126 reviewed road variants
926 untagged variants from the 3d-road-tiles pack
```

The active palette includes all WFC-enabled catalog variants. At present those variants all originate in the `3d-road-tiles` pack.

## Root causes

### Planned road turns are physically infeasible

The world planner creates Manhattan corridors, so a route normally requires corners as well as straight segments.

For the reproduced 10×10, seed `1345` world:

| Required road shape | Semantic candidates | Candidates with compatible road neighbors |
| --- | ---: | ---: |
| East-west straight | 46 | 46 |
| North-south straight | 46 | 46 |
| Each corner orientation | 1 | 0 |

Every required corner orientation maps to a rotation of:

```text
3d-road-tiles.road-tile-153
```

That asset has reviewed semantic `road` edges, but its exact physical socket strings do not match the road-facing sockets of any reviewed road tile. It cannot join another reviewed road tile through either of its road edges.

Consequently, a planned route containing a corner reaches a WFC contradiction before the solver can select a complete concrete road network.

### The fallback produces roadless scenes

When the constrained route solve fails, [EditorState.ts](../src/state/EditorState.ts) currently retries without the world-plan policies.

Removing those policies also removes:

- exact road requirements on planned corridor cells;
- road exclusion from all other cells;
- validation against the planned route.

The retry can therefore solve successfully while containing no road. This behavior explains roadless generated scenes.

### Unconstrained WFC uses a road pack as world fill

The unrestricted palette contains only WFC-enabled `3d-road-tiles` assets. Therefore unrestricted WFC is not choosing terrain with a small number of planned road tiles. It fills every cell with a member of the road asset pack.

Exact socket matching only ensures physical seams are compatible. It does not express whether an asset is semantically appropriate for generic terrain. This causes the repeated asphalt stripes, unrelated intersections, and fragmented pavement shown in the reported screenshots.

## Conclusion

This is not a seed-selection or tile-weight problem. It is an architectural catalog and palette-boundary problem:

```text
World plan requires turn tiles
+ reviewed corner tile has no physical road-to-road connection
+ fallback discards road requirements
+ generic fill palette contains road-pack assets only
```

## Required correction

Road scene generation requires all of the following before it can be considered production-ready:

```text
connectable reviewed turn assets
+ route-only road palette
+ distinct non-route terrain/zone palette
+ no unconstrained fallback for a requested road scene
```

Until these prerequisites exist, a failed road-constrained solve should report an infeasible route with diagnostics rather than silently generate an unrelated roadless or all-road-tile scene.

## Resolution — 2026-09-10

The evidence above records the **pre-fix catalog**. Further model-level investigation found that tile 153 itself is usable: the generated sockets falsely rejected its physically matching road ends.

### Corrected socket derivation

Three exporter defects prevented the intended connections:

- Rasterization accepted a triangle's whole bounding rectangle, painting grass/curb/asphalt samples outside the triangle. It now uses triangle containment only.
- Comparing two rows inside each tile required corner and straight interiors to be identical. Only the boundary-near row is now compared; curved interiors are allowed to differ.
- Side faces were normalized to each model's maximum height. A grass boundary was stretched differently on a road tile with a raised curb than on flat grass. Side sampling now uses the shared tile-footprint scale and absolute model elevation.

An existing world-space seam check also exposed partial models being normalized into full-cell sockets. The exporter now leaves 57 non-3×3 assets available for manual placement but excludes them from WFC. No GLB geometry or reviewed road membership was changed.

Regenerated metadata and adjacency now contain 845 generic variants. The same 36 reviewed road assets produce 121 route variants after symmetric rotations are deduplicated. Every required corner orientation has a road-compatible candidate.

### Road-scene palette and failure behavior

- The road-scene palette contains 121 reviewed road variants and one explicitly authored `terrain.ground` variant: flat grass tile 163. Lack of a road tag is **not** sufficient to qualify as terrain.
- Existing world-plan policies require exact road directions on the corridor and exclude road variants everywhere else. Exact physical socket matching remains mandatory.
- Generation performs one constrained worker solve, followed by world-plan validation. It never retries without the requested policies.
- On an infeasible route or invalid dimensions, the previous scene, history and selection remain intact; progress and preview are cleared. Diagnostics identify the failing policy/cell when the solver provides that information.

### Verification

```sh
# Real catalog by default; includes the reported screenshot seeds.
npm run wfc:world-plan:verify
# Retain the independent structural-planner corpus.
npm run wfc:world-plan:verify -- --synthetic
npm run assets:road-wfc:verify
npx vitest run --exclude '.claude/**'
npm run build:check
```

Both corpora solve all 18 scenes, spanning 10×10 through 100×100, with zero backtracks. The existing 149 tests pass, including transformed GLB seam checks. The production build passes.

In-browser checks enter each seed and click **Generate layout** in the actual UI, using the real catalog, models and worker in an isolated scene without saving to the user's scene store:

| Seed | Cells | Road cells | Grass cells | Worker solves |
| --- | ---: | ---: | ---: | ---: |
| 13 | 100 | 18 | 82 | 1 |
| 134 | 100 | 22 | 78 | 1 |
| 1345 | 100 | 18 | 82 | 1 |

Removing corner tile 153, requesting a 3×3 road world, and adding a caller policy that prohibits roads each produce a diagnostic while preserving the prior scene, history and selection. Browser checks reported no page errors.

Rendered results: [seed 13](road-quality-seed-13.png), [seed 134](road-quality-seed-134.png), [seed 1345](road-quality-seed-1345.png).

### Remaining scope

This establishes a connected road-and-grass baseline, not a finished multi-biome environment generator. Park, built and water zone-specific palettes, richer scenery, plan-level recovery and visual-diversity thresholds remain future work. The sampler is discrete; exact matching of sampled sockets is not a proof for every possible geometric detail in arbitrary imported models.
