# WFC Road Generation Improvement Plan

## Status

| Phase | Status | Notes |
| --- | --- | --- |
| 1. Authoritative road metadata | Complete | Reviewed route-road set is explicit; every route variant has directional `road` edges. |
| 2. World planning types | Complete | Deterministic macro-region plans, route cycles, paired portals, and corridors are implemented. |
| 3. Planned concrete WFC | Complete | Real-catalog WFC enforces the route, exact physical seams and an explicit road/terrain palette boundary. |
| 4. Validation and recovery | In progress | Final-world plan validation is active; the solver provides bounded backtracking, while plan-level retry escalation remains future work. |
| 5. Retire prototype overlay | Complete | The generation path no longer builds or overlays direct road objects. |
| 6. Quality corpus | Complete for structural validation | 18-scene real-catalog and synthetic corpora pass; screenshot seeds are verified in-browser. Empirical visual thresholds remain future work. |

## Phase 1: authoritative road-edge metadata

**Completed 2026-09-10.**

- The user-supplied set of 36 route-road asset IDs is centralized in [reviewedRoadTopology.ts](../src/wfc/metadata/reviewedRoadTopology.ts). It is authoritative: pack-wide visual scanning does not add or remove members without strong evidence.
- `roadTopology` stores a reviewed shape `kind` and directional `edges`, with `"road"` as the route-edge class.
- The selected set originally produced 126 tagged rotated variants; corrected socket sampling now deduplicates it to 121 while preserving all 36 reviewed assets.
- [retagRoadTopology.ts](../scripts/retagRoadTopology.ts) removes route tags from every other road-tile asset and regenerates the reviewed tags.
- [generateRoadTileWfcMetadata.ts](../scripts/generateRoadTileWfcMetadata.ts) preserves reviewed route metadata when geometric sockets are regenerated.
- Tests prove that only approved assets have route tags, every variant for those assets is tagged, kind edge counts are valid, and the scene palette consumes the reviewed data.

Route-road reference IDs:

```text
025 026 031 032 038 041 043 048
141 142 153 154 156
161 162 164 165 170 171
179 180 181 182 183 184 187 188
191 192 193 194 197 207
217 231 233
```

`187` is eligible as an elevated road section. IDs `155`, `196`, and `198` are excluded.

**Result:** a planned route edge can name a reviewed directional road edge, rather than relying on runtime text inspection such as `"asphalt"`.

## Phase 2: introduce world planning types

Add domain types independent of Three.js, UI, and the WFC solver:

```text
WorldPlan
MacroRegion
MacroRegionGraph
RegionZoneRole
PrimaryRoute
RoadPortal
LocalCorridorPlan
```

Implement deterministic planning:

```text
world bounds
→ bounded macro-region partition
→ adjacency graph
→ requested route-region coverage
→ simple primary cycle
→ paired reciprocal portals
→ zone assignment
→ local corridor paths
```

Rules already agreed:

- Macro regions provide route coverage at world scale; local WFC chunks are an internal implementation detail.
- The macro graph is bounded, initially about 4–8 regions per axis and at most 64 regions.
- Road coverage means the percentage of macro regions visited by the primary route, not percentage of road tiles.
- A primary-route region normally has exactly two portals. The first version plans a simple cycle and does not intentionally require T-junctions or four-way junctions.
- A non-route region has zero portals, excludes road-capable tiles, and may contain terrain, park, built, or water content according to its zone role.
- Each selected route edge creates exactly one reciprocal portal pair on its shared border.
- Portals avoid region corners where possible and are separated deterministically within a region.
- A local plan must join a route region's primary portals through one intended internal road component.

Add pure unit tests for partition validity, deterministic plans, target route coverage, simple-cycle topology, portal reciprocity, and route/non-route portal counts.

**Completed implementation:** [worldPlan.ts](../src/wfc/worldPlan.ts), [worldPlanner.ts](../src/wfc/worldPlanner.ts), and [worldPlanner.test.ts](../tests/worldPlanner.test.ts) implement deterministic partitioning, zone assignment, simple primary cycles, reciprocal portals, and within-region Manhattan corridors.

**Result:** generation produces and validates an abstract world plan before selecting any 3D tiles.

## Phase 3: make concrete WFC honor the plan

Replace direct road realization and overlay with constrained local solving:

1. Build a zone-aware palette for each region or internal chunk.
2. Limit route-capable variants to planned corridor cells.
3. Apply portal and corridor requirements through reviewed directional `road` edges.
4. Retain exact physical socket propagation on every neighboring pair.
5. Solve regions/chunks and assemble the world grid.

**Completed implementation:** [worldPlanPolicies.ts](../src/wfc/worldPlanPolicies.ts) constrains every planned corridor cell to its exact route edges and forbids roads elsewhere. [EditorState.ts](../src/state/EditorState.ts) now supplies those constraints to the ordinary concrete WFC solve. It no longer overlays directly instantiated road objects.

**Result:** visible roads are selected by WFC itself and physically match their surroundings.

### Real-catalog feasibility correction

**Corrected 2026-09-10.** The [investigation](road-generation-feasibility-investigation.md#resolution--2026-09-10) records the original failure and verified correction. The corner asset was usable; incorrect triangle rasterization, interior-strip comparisons and per-model height normalization made its generated sockets incompatible.

Regenerated sockets connect the reviewed road set to explicitly marked flat grass (tile 163). Road scenes admit only reviewed road variants and authored terrain; the plan excludes roads from all non-corridor cells. Partial-footprint models remain manually placeable but are not eligible full-cell WFC tiles. A failed route never falls back to unconstrained fill.

The current fill is a deliberate grass baseline. Separate park, built and water palettes and zone-specific selection remain unimplemented; Phase 3 completion refers to physically connected road realization, not full biome generation.

## Phase 4: validate and recover

Validate the final assembled world in this order:

```text
placement completeness
→ physical seam compatibility
→ portal realization
→ boundary containment
→ local portal connectivity
→ global route-cycle continuity
→ non-route road isolation
```

Recover deterministically from the smallest scope outward:

```text
local solve seed
→ alternate local corridor
→ alternate portal position
→ alternate macro route
→ alternate partition
```

**Completed implementation:** [validateWorldPlanResult](../src/wfc/worldPlanPolicies.ts) checks placement completeness, planned road edges, and physical east/north seams before EditorState accepts a generated layout. A failure is reported instead of falling back to unrelated fill.

**Implemented recovery boundary:** the concrete solver uses deterministic bounded backtracking. Plan-level retries for alternate corridors, portals, routes, and partitions remain future work because a successful alternate plan must preserve the same external request contract and diagnostics.

## Phase 5: retire the prototype path

Remove the current competing path:

```text
tile-grid abstract topology
+ generic full-scene fill
+ direct road-object realization
+ overlayRoadTopology(...)
```

Retain the reusable exact socket solver, worker transport, deterministic random derivation, and reviewed metadata.

**Completed implementation:** [EditorState.ts](../src/state/EditorState.ts) now invokes world planning and uses the plan-derived policies in one concrete solve. The former `createRoadTopologyPolicies`, direct road realization, and `overlayRoadTopology(...)` path are no longer used by layout generation.

**Result:** one coherent physical-and-semantic generation path.

## Phase 6: evaluate quality systematically

Create a fixed, multi-scale seed corpus with route-coverage variations. Produce screenshots, topology overlays, final road-component overlays, and machine-readable reports. Start with hard correctness gates; establish empirical asset-diversity, road-density, zone-diversity, and retry baselines before adding soft thresholds.

**Completed implementation:** planner and policy tests now cover deterministic plans, partition coverage, target route coverage, paired portals, non-route isolation, corridor endpoints, exact planned road constraints, and plan-result validation.

**Completed implementation:** `npm run wfc:world-plan:verify` runs 18 deterministic real-catalog scenes across 10, 16, 24, 32, 50, and 100 tile worlds, including screenshot seeds 13, 134 and 1345. Pass `-- --synthetic` to run the structural reference palette instead. It emits machine-readable reports from [worldPlanReport.ts](../src/wfc/worldPlanReport.ts) with macro-region, route, portal, corridor, and solver metrics.

**Verified:** the three screenshot seeds render connected road cycles with terrain fill through the browser worker, with no page errors. See the investigation for screenshots and failure-preservation checks. **Remaining:** topology overlays and empirical visual-diversity thresholds.

**Result:** structural quality is measured across scenes and seeds rather than inferred from a single preview.

## Dependency order

```text
reviewed road-edge truth
→ abstract world plan
→ constrained concrete WFC
→ validation and recovery
→ prototype removal
→ quality baselines
```
