# Road Tile WFC Metadata Design

## Goal

Generate metadata for `assets/3d-road-tiles` so the road tile set can later be used by a 3D Wave Function Collapse system.

The generator should avoid manual tagging. It should derive compatibility data from each tile's GLB geometry and visual/material boundary information.

## Scope

This design covers metadata generation only.

It does not implement the WFC scene generator, editor placement UI, or runtime solving behavior.

## Asset Assumptions

- Each road tile occupies exactly one logical WFC cell.
- Cell size and grid rules come from the project, not from generated asset metadata.
- Assets are centered at origin.
- Assets share the same horizontal footprint.
- Assets may have different heights.
- Tiles can stack vertically.
- Tiles can rotate in 90 degree increments for horizontal placement.
- Neighboring tiles must match by geometry continuity and visual continuity.

The current GLB assets use X/Z as horizontal axes and Y as vertical height. Rotation for horizontal road orientation should therefore be applied around Y unless the project coordinate system later defines a different convention.

## Metadata Locations

Per-asset metadata is stored inside each tile's existing `asset.json`.

Collection-level adjacency is stored once at:

```text
assets/3d-road-tiles/wfc-adjacency.json
```

This split keeps asset-local facts portable while avoiding duplicated relationship data. A socket belongs to one tile; adjacency is a relationship between all tile variants.

## Per-Asset Schema

Each `asset.json` keeps its existing fields and gains a generated `wfc` block.

```json
{
  "id": "3d-road-tiles.road-tile-200",
  "label": "Road Tile 200",
  "category": "3d-road-tiles",
  "wfc": {
    "height": 0.45,
    "variants": [
      {
        "variantId": "3d-road-tiles.road-tile-200@r0",
        "rotationDegrees": 0,
        "sockets": {
          "north": "g:road-straight|v:asphalt-stone",
          "east": "g:stone-wall|v:stone",
          "south": "g:road-straight|v:asphalt-stone",
          "west": "g:stone-wall|v:stone",
          "top": "g:flat-road-top|v:asphalt",
          "bottom": "g:flat-bottom|v:none"
        }
      }
    ],
    "diagnostics": []
  }
}
```

### Field Meanings

`wfc.height` is the computed vertical extent of the tile geometry. It is useful for debugging, previewing stacked output, and validating assets, but it does not define cell occupancy.

`wfc.variants` contains the WFC candidates generated from this tile. A tile may produce up to four variants: `0`, `90`, `180`, and `270` degrees. If multiple rotations produce identical socket sets, the generator may emit fewer unique variants and record a diagnostic.

`variantId` uniquely identifies a tile rotation.

`rotationDegrees` is the rotation to apply when instantiating the variant.

`sockets` contains six generated compatibility signatures:

- `north`
- `east`
- `south`
- `west`
- `top`
- `bottom`

Each socket signature combines geometry continuity and visual continuity for that boundary.

`diagnostics` records asset-local warnings, such as empty boundary samples, unusual height, missing GLB, or duplicate rotations.

## Adjacency Schema

`wfc-adjacency.json` is generated from every tile's `asset.json#wfc.variants`.

```json
{
  "version": 1,
  "assetRoot": "assets/3d-road-tiles",
  "generatedFrom": "asset.json#wfc.variants.sockets",
  "adjacency": {
    "3d-road-tiles.road-tile-200@r0": {
      "north": ["3d-road-tiles.road-tile-077@r90"],
      "east": ["3d-road-tiles.road-tile-050@r0"],
      "south": [],
      "west": [],
      "top": [],
      "bottom": []
    }
  },
  "diagnostics": []
}
```

For each variant, each direction lists variant ids allowed in the neighboring cell.

Runtime WFC should load this file as a precomputed compatibility cache. It should not rebuild adjacency every time WFC starts.

## Socket Generation

For each source GLB, the generator should:

1. Load mesh positions, normals, UVs, material assignments, and indices.
2. Compute height from the vertical geometry extent.
3. Extract boundary samples for the six faces of the one-cell tile.
4. Quantize each boundary sample into a deterministic geometry signature.
5. Include material or texture-derived information touching the same boundary.
6. Generate rotated socket sets for `0`, `90`, `180`, and `270` degrees.
7. Write the generated `wfc` block back to the tile's `asset.json`.

The first implementation should use material-aware geometry signatures:

- Geometry continuity: sampled and quantized boundary shape.
- Visual continuity: material names used near the same boundary.
- Match rule: opposite sockets match only when geometry and visual signatures match.

Texture pixel sampling can be added later if material identity is not enough.

## Adjacency Generation

Adjacency generation should be reusable and not tied to road tiles.

The core API should accept variants and a matcher:

```ts
buildAdjacency(variants, matcher)
```

The matcher compares opposite sockets:

```text
north <-> south
east  <-> west
top   <-> bottom
```

The generated adjacency file should be rebuilt whenever assets or socket-generation rules change.

## Proposed Files

Road-tile orchestration:

```text
scripts/generateRoadTileWfcMetadata.ts
```

Reusable WFC metadata utilities:

```text
src/wfc/metadata/socketTypes.ts
src/wfc/metadata/buildAdjacency.ts
```

The script scans `assets/3d-road-tiles`, updates each tile's `asset.json#wfc`, then writes `assets/3d-road-tiles/wfc-adjacency.json`.

## Verification

Start with a limited run:

```bash
npx vite-node scripts/generateRoadTileWfcMetadata.ts --limit 10
```

Verify:

- Each processed tile still preserves existing `asset.json` fields.
- Each emitted variant has six sockets.
- Every adjacency reference points to a valid variant id.
- Diagnostics explain empty, uncertain, or duplicate socket cases.
- The generated adjacency is deterministic across repeated runs.

After the limited run is stable, run against all road tiles.
