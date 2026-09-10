# WFC Road Generation Improvement Plan

## Status

| Phase | Status | Notes |
| --- | --- | --- |
| 1. Authoritative road metadata | Complete | Reviewed route-road set is explicit; every route variant has directional `road` edges. |
| 2. World planning types | In progress | Implementing deterministic macro-region planning next. |
| 3. Planned concrete WFC | Not started | Requires a completed world plan. |
| 4. Validation and recovery | Not started | Depends on planned concrete WFC. |
| 5. Retire prototype overlay | Not started | Remove only after the replacement is validated. |
| 6. Quality corpus | Not started | Establish once end-to-end generation is stable. |

## Phase 1: authoritative road-edge metadata

**Completed 2026-09-10.**

- The user-supplied set of 36 route-road asset IDs is centralized in [reviewedRoadTopology.ts](../src/wfc/metadata/reviewedRoadTopology.ts). It is authoritative: pack-wide visual scanning does not add or remove members without strong evidence.
- `roadTopology` stores a reviewed shape `kind` and directional `edges`, with `"road"` as the route-edge class.
- The selected set produces 126 tagged rotated variants.
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

**Result:** generation can produce and validate an abstract world plan before selecting any 3D tiles.

## Phase 3: make concrete WFC honor the plan

Replace direct road realization and overlay with constrained local solving:

1. Build a zone-aware palette for each region or internal chunk.
2. Limit route-capable variants to planned corridor cells.
3. Apply portal and corridor requirements through reviewed directional `road` edges.
4. Retain exact physical socket propagation on every neighboring pair.
5. Solve regions/chunks and assemble the world grid.

**Result:** visible roads are selected by WFC itself and physically match their surroundings.

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

**Result:** generation either returns a demonstrably valid world or structured diagnostics. It never silently falls back to unrelated generic fill.

## Phase 5: retire the prototype path

Remove the current competing path:

```text
tile-grid abstract topology
+ generic full-scene fill
+ direct road-object realization
+ overlayRoadTopology(...)
```

Retain the reusable exact socket solver, worker transport, deterministic random derivation, and reviewed metadata.

**Result:** one coherent physical-and-semantic generation path.

## Phase 6: evaluate quality systematically

Create a fixed, multi-scale seed corpus with route-coverage variations. Produce screenshots, topology overlays, final road-component overlays, and machine-readable reports. Start with hard correctness gates; establish empirical asset-diversity, road-density, zone-diversity, and retry baselines before adding soft thresholds.

**Result:** quality is measured across scenes and seeds rather than inferred from a single preview.

## Dependency order

```text
reviewed road-edge truth
→ abstract world plan
→ constrained concrete WFC
→ validation and recovery
→ prototype removal
→ quality baselines
```
