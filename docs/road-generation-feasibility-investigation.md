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
