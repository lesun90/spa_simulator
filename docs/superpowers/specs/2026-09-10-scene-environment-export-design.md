# Scene Environment Export, CLI Generation, and Import

Status: Approved design

Date: 2026-09-10

## Purpose

Steerlab needs a static environment package that renders large generated scenes with less CPU and GPU overhead. The package must retain enough logical and semantic data for spatial queries, route construction, surface lookup, intersection detection, and scene reconstruction.

Three entry points share the same package format and compiler:

1. The editor exports the open scene.
2. A CLI generates and exports a scene without starting the GUI.
3. The Project panel imports a package as a locked environment beneath editable simulation objects.

## Goals

- Export `environment.glb` and `environment.json` into one folder.
- Include generated cells, manually placed objects, an attached environment, and the visible ground when present.
- Exclude the background, HUD, editor grid, selection controls, and other editor helpers.
- Reduce object traversal, draw calls, duplicated vertex memory, and offscreen rendering.
- Support grids up to 100 by 100 cells with a cell size as small as 1 world unit.
- Preserve source transforms, asset provenance, cell semantics, and navigation connectivity.
- Produce the same ordered scene recipe from the GUI and CLI for the same seed, dimensions, cell size, and asset catalog.
- Keep imported environments immutable while allowing editable objects on top.

## Non-goals

- The importer will not turn a baked package into editable scene objects.
- The compiler will not infer semantic labels from pixels, textures, or mesh shape.
- The first release will not generate navmeshes, physics collision meshes, LODs, occlusion data, or streamed world sectors.
- The exporter will not preserve animation. It targets static environment geometry.
- The package will not store background color or background textures.

## Key decisions

- Both files use fixed names: `environment.glb` and `environment.json`.
- The default chunk size is 10 cells. A chunk size of 0 creates one spatial chunk.
- The GLB contains one named environment root with one or more renderable children. A single root does not imply a single draw call or mesh.
- The compiler uses GPU instancing for repeated compatible primitives and geometry merging for compatible singleton primitives.
- Seam-face removal remains off by default. Users can enable a conservative exact-match pass.
- The JSON file serves as a versioned semantic scene manifest, not a small export log.
- A scene can own one imported environment package. Importing another package requires confirmation and replaces the prior package after validation.

## Architecture

```text
Editor generation request                 CLI generation request
          |                                        |
          +-------------+--------------------------+
                        |
              Shared scene generator
                        |
                   Scene recipe
                        |
     Editor scene ------+------ Imported environment
                        |
              Environment compiler
                 /             \
        environment.glb    environment.json
                 \             /
                  Package validator
                        |
            Locked environment feature
```

The shared scene generator owns catalog selection, road-scene detection, world-plan creation, WFC solving, and solved-cell conversion. The browser adapter runs the solver in a Worker. The Node adapter runs the same solver in-process. Both adapters return the same domain result.

The environment compiler runs in Node. The editor invokes it through the existing Vite API, and the CLI invokes it as a library. This boundary keeps filesystem asset loading and GLB writing out of editor state and UI code.

The compiler accepts a scene recipe, optional existing package, ground description, asset catalog, and export options. It returns a package result plus metrics. UI, API, and CLI adapters decide where to write the files.

## Domain model and responsibilities

### Scene recipe

The scene recipe represents geometry before baking. It contains:

- Grid dimensions, cell size, origin, and world bounds
- Generation runs and their seeds
- Solved cells with source asset ID, WFC variant ID, grid coordinate, transform, and semantic snapshot
- Non-cell objects with source asset ID, name, transform, semantics, and provenance
- Ground geometry and appearance when present

WFC placement must retain cell coordinates and variant IDs in generated-object provenance. Existing saved scenes can lack those fields. During export, the compiler may recover coordinates from exact grid-aligned transforms and recover a variant from asset ID plus rotation when the match is unambiguous. It records unknown values and a diagnostic when recovery fails.

### Shared scene generator

The generator accepts width, depth, cell size, seed, asset catalog, and generation policy. It enforces a maximum width and depth of 100 cells. It scales catalog tiles from their authored WFC size to the requested cell size.

The existing `EditorState.generateWfcLayout` method will delegate orchestration to this component. The editor keeps progress reporting, cancellation, history commands, selection, and notices. The generator remains independent of those UI concerns.

### Asset geometry source

The compiler resolves catalog asset IDs to static Three.js object graphs. It supports GLB assets and compatible procedural module assets. It reports an error for a missing asset instead of substituting a placeholder.

The source rejects skinned meshes, morph animation, custom shader materials that GLB cannot represent, and other unsupported render nodes. The diagnostic names the object and asset so the user can fix the source.

### Geometry compiler

The geometry compiler performs these stages:

1. Resolve asset templates and apply object transforms.
2. Flatten supported static mesh primitives while preserving GLB-compatible materials and textures.
3. Apply the seam-removal pass when requested.
4. Assign cells by grid coordinate and other geometry by world-space center to spatial chunks.
5. Split the ground into chunk-sized quads so a large ground plane does not defeat culling.
6. Group repeated primitives by geometry and material signature and emit `InstancedMesh` nodes.
7. Merge compatible singleton primitives by material and vertex attribute layout.
8. Weld vertices that match across all relevant attributes. Position-only welding could damage UV and normal seams, so the compiler will not use it.
9. Export one GLB scene under the `SteerlabEnvironment` root.

Transparent primitives retain separate ordering-safe meshes when instancing or merging could change blending. Geometry that crosses a chunk boundary belongs to the chunk containing its center; its full bounds contribute to that chunk's culling bounds.

With `chunkSize = 0`, the compiler creates one spatial chunk and still emits as many render nodes as material and geometry compatibility require.

### Manifest encoder

The encoder sorts arrays and object keys by stable identifiers. It omits timestamps from the package so repeated runs can produce the same logical manifest. The scene persistence layer may store import timestamps outside the package.

The encoder computes SHA-256 hashes for the GLB and referenced source assets. Consumers can render the GLB without the source catalog. Consumers need matching source assets to recreate the original editable logical objects with faces that an optimization pass removed.

### Package validator

The validator checks both files before import. It verifies:

- Fixed filenames, format name, and supported version
- GLB magic bytes and the model hash stored in the manifest
- Finite transforms, positive cell size, valid bounds, and unique IDs
- Cell coordinates within grid bounds
- References between chunks, cells, objects, navigation nodes, and edges
- Referenced GLB node names
- Navigation edges with valid endpoints and compatible channel data

The validator rejects a package as one unit and leaves the current environment unchanged.

### Locked environment feature

A new world feature loads the imported GLB under a dedicated root. It registers no selection or transform interaction. It exposes the manifest through read-only spatial and semantic query functions.

Import adopts the manifest grid for placement and snapping. Existing editable objects keep their world transforms. If the package contains ground geometry, the editor hides the project's visible ground surface and keeps an invisible placement plane aligned to the imported grid. This avoids duplicate coplanar ground while preserving placement raycasts.

## Package contract

`environment.json` uses the following top-level shape. Field names below define the version 1 contract; the final TypeScript types will make each nested record explicit.

```json
{
  "format": "steerlab-environment",
  "formatVersion": 1,
  "model": {
    "file": "environment.glb",
    "sha256": "<sha256>",
    "rootNode": "SteerlabEnvironment",
    "upAxis": "Y",
    "unitsPerMeter": 1
  },
  "grid": {
    "width": 100,
    "depth": 100,
    "cellSize": 1,
    "origin": { "x": -49.5, "y": 0, "z": -49.5 },
    "bounds": {
      "min": { "x": -50, "y": 0, "z": -50 },
      "max": { "x": 50, "y": 4, "z": 50 }
    }
  },
  "provenance": {
    "source": "cli",
    "generatorVersion": "0.1.0",
    "generationRuns": [
      { "seed": 12345, "width": 100, "depth": 100, "cellSize": 1 }
    ]
  },
  "build": {
    "chunkSize": 10,
    "removeInternalSeamFaces": false
  },
  "chunks": [],
  "assets": [],
  "cells": [],
  "objects": [],
  "ground": null,
  "navigation": { "nodes": [], "edges": [] },
  "diagnostics": []
}
```

### Cells

Each cell record contains:

- Stable cell ID, column, and row
- World center, full transform, and axis-aligned world bounds
- Source asset ID, asset content hash, and WFC variant ID when known
- Semantic roles copied from asset metadata
- Directional semantic ports after rotation
- Reviewed road topology kind and edge directions when present
- Derived feature tags whose inputs make the result certain
- Owning chunk ID
- Source layer, either `base` for an attached package or `scene` for current editor content

The manifest keeps unknown semantics unknown. For example, it exports `road.crosswalk` when the asset metadata contains that role. It derives an intersection from reviewed road topology or three or more compatible road ports. It does not inspect textures to guess either property.

Grid origin and cell size let consumers map an X/Z position to a candidate cell without scanning all records. Bounds let consumers confirm the lookup and account for vertical extent.

### Objects

Object records cover manual and other non-cell scene objects. Each record stores the original object ID and name, source asset and hash, transform, world bounds, semantic roles, and chunk ID. Consumers can use roles such as `obstacle.wall` with bounds for coarse spatial checks. Consumers that need triangle-level collision can query the GLB geometry.

### Package composition

Re-export can combine an attached package with current scene content. The compiler prefixes colliding cell, object, chunk, and navigation IDs with their source layer. It keeps overlapping cell records because bridges, overlays, and later scene content can occupy the same grid coordinate. Spatial queries return all matching records and order them by vertical bounds.

The compiler flattens static render nodes from the attached GLB and assigns them to the requested output chunks. It preserves the attached manifest's semantic records and asset snapshots. The seam pass can inspect current source-cell geometry, but it does not attempt to restore or reinterpret faces removed from the attached package.

### Assets

The asset table snapshots the ID, label, category, content hash, semantic roles, sockets, and relevant WFC variant metadata for each referenced asset. The snapshot keeps semantic queries stable if the live catalog changes.

### Ground

The ground record contains its bounds, material description, and chunk references. The compiler includes ground when the editor scene provides it or when CLI generation creates the default scene ground. An attached package that already contains ground suppresses a duplicate project ground during re-export.

### Navigation

The manifest includes an explicit graph and keeps raw cell semantics for other graph builders.

Each node references a cell, world position, semantic channels, and feature tags. Each edge stores endpoint IDs, direction, channel, traversal cost, and whether traversal works in both directions. The first release builds road edges between adjacent cells whose opposing rotated ports both contain the `road` channel. The cost starts with center-to-center distance.

Consumers can identify intersections through topology tags, locate authored crosswalks through roles, or construct a different graph from the cell and port records.

## Seam-face removal

The editor labels the option `Remove internal seam faces`. The CLI exposes `--remove-seam-faces`. Both leave the option off unless the user enables it.

The pass examines side boundaries between grid-adjacent generated cells. It visits north and east pairs to avoid processing a seam twice. The pass removes two triangles only when all of these conditions hold:

- Both triangles belong to opaque, static geometry.
- Both lie on the shared cell boundary within a scale-relative epsilon.
- Their world-space vertices match as an unordered set.
- Their normals oppose each other.
- Their full triangle coverage matches. Partial overlaps remain.

The pass does not process top or bottom faces, the ground, transparent materials, partial overlaps, or uncertain geometry. It records removed triangle and vertex counts in export metrics and manifest diagnostics.

An imported package may already contain optimized geometry. During re-export, the compiler preserves that geometry and its semantic records. It applies the requested seam pass to source cell geometry that remains available in the editable scene. The compiler never claims that it restored faces removed by a prior export.

## Editor flows

### Export

The Project panel contains an `Export Environment` action. The dialog asks for:

- Chunk size, integer, default 10; zero means one spatial chunk
- `Remove internal seam faces`, unchecked by default

The editor sends the current in-memory scene snapshot, attached environment reference, and options to the API. Unsaved editable changes therefore appear in the export. The API compiles into staging files and exposes separate binary and JSON responses. The browser writes both files into a directory selected through the File System Access API. Browsers without that API receive two file downloads.

The export includes the attached locked environment, all editable scene objects, and available ground. It excludes background settings and editor visuals.

### Import

The Project panel contains an `Import Environment` action. A folder picker accepts a directory containing both fixed filenames. The client uploads the JSON and GLB as separate payloads so a large GLB does not incur base64 overhead.

The server stages both files, validates the package, and commits it under the scene's user-data directory. If the scene owns an environment, the editor asks for replacement confirmation before upload. A failed upload or validation leaves the prior package in place.

The editor attaches the package as a locked environment layer. Editable objects remain above it.

### Persistence

The `Scene` model gains an optional environment reference with package hash and manifest version. Package files live under a scene-owned environment directory beside the current scene store. They do not appear in the shared asset catalog.

Scene save preserves the reference. Scene duplication copies the immutable package into the duplicate's directory. Scene deletion removes its package. Environment replacement uses a temporary directory and atomic rename.

## CLI contract

The package adds this script:

```bash
npm run scene:export -- \
  --width 100 \
  --depth 100 \
  --cell-size 1 \
  --seed 12345 \
  --chunk-size 10 \
  --output ./exports/city-12345 \
  --remove-seam-faces
```

Required arguments:

- `--width` and `--depth`, or `--size` as square shorthand
- `--cell-size`
- `--seed`
- `--output`

Optional arguments:

- `--chunk-size`, default 10
- `--remove-seam-faces`, default false
- `--asset-root`, default `./assets`
- `--force`, permits replacement of the two known output files

The CLI rejects mixed `--size` and `--width` or `--depth` arguments. Width and depth accept integers from 1 through 100. Cell size must exceed zero. Seed uses an unsigned 32-bit integer. Chunk size accepts zero or a positive integer.

The command discovers the same asset catalog as the editor, generates the scene recipe, compiles the package, and writes through a staging directory. Without `--force`, it rejects an output directory that contains either package filename. It does not remove unrelated files.

On success, the CLI prints cell, object, chunk, mesh, instance, draw-call estimate, triangle, removed-face, file-size, seed, and elapsed-time metrics. On failure, it prints a specific diagnostic, removes staging files, and exits with a nonzero status.

## Error handling

- Generation failure reports WFC diagnostics and creates no output package.
- Missing or unsupported assets abort export and name each affected asset.
- Invalid chunk size, grid dimensions, cell size, seed, or output path fail before generation.
- A compiler error leaves existing output files intact.
- Import rejects a missing file, unsupported manifest version, hash mismatch, malformed graph, invalid transform, or missing GLB node.
- Import and replacement keep the current environment loaded until the server commits the new package.
- Unknown semantic roles pass through the manifest. Missing required structural fields cause validation failure.
- Editor actions surface the first useful diagnostic in the notice area and make the full diagnostic list available in the export/import dialog.

## Performance expectations

Geometry merging alone copies each tile's vertices into new buffers. The compiler uses instancing as the main optimization for repeated assets. Chunking then lets Three.js cull offscreen regions.

For a 100 by 100 grid with chunk size 10, the GLB contains at most 100 spatial chunk groups before material and geometry subdivision. Three.js can cull each chunk-local render node whose bounds fall outside the camera frustum. The number of render nodes inside a chunk depends on unique geometry, materials, transparency, and seam variants.

The project will compare these metrics against the editable scene:

- Three.js object count
- Render calls and rendered triangles from renderer statistics
- GLB byte size and GPU geometry memory estimate
- Frame time along a repeatable camera path
- Export time and peak process memory

The feature succeeds when a 100 by 100 scene exports and imports without loss of visible geometry or manifest records, and when the baked scene reduces object count and render calls for the reviewed road catalog. Benchmarks will report measured gains instead of enforcing an unsupported FPS target.

## Verification

Project policy asks for product-level verification instead of new unit tests. Implementation verification will include:

1. Run the existing test suite and production build checks.
2. Generate small packages through the CLI with chunk sizes 0 and 10, with seam removal off and on.
3. Generate the same seeded scene in the editor and CLI, then compare ordered cell records, variants, transforms, semantics, and navigation edges.
4. Export a scene containing generated tiles, manual objects, ground, and an attached environment.
5. Import through the Project panel and confirm that the environment cannot be selected, moved, deleted, or renamed.
6. Place and edit simulation objects above the imported environment, then save, reopen, duplicate, replace, and delete the scene.
7. Reject packages with a missing file, modified GLB, unsupported version, invalid graph reference, and invalid transform while preserving the current environment.
8. Run a 100 by 100 export and capture compiler metrics plus renderer statistics along the same camera path before and after import.
9. Inspect reviewed seams with the removal option enabled and confirm that unmatched ramps, elevation changes, transparent surfaces, and partial boundaries retain their faces.

## Expected code boundaries

Implementation should keep changes within these areas:

- WFC generation orchestration and generated provenance
- Environment package types, semantic graph construction, geometry compilation, validation, and Node asset resolution
- CLI command and package script
- Vite API routes and scene-owned package storage
- Scene persistence model and validation
- Project panel export/import controls
- Locked environment world feature and read-only query surface

The compiler and manifest code must not depend on editor state, HUD types, or browser APIs. The UI and CLI must not duplicate generation, geometry optimization, or manifest rules.
