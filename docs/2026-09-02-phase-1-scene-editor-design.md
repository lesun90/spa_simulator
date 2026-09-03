# Phase 1 Scene Editor Design

**Status:** Approved

## Goal

Build a browser-based visual scene editor for composing and reviewing autonomous-vehicle simulation scenes. Phase 1 establishes a grid-based authoring workflow and a shared asset-review system. Physics, WASM, workers, simulation playback, and vehicle behavior are out of scope.

## Architecture

- **TypeScript** provides the application shell, editor state, and domain orchestration.
- **Three.js** provides the complete realtime visual engine and in-canvas editor UI: docked layout, menus, scene collection, toolbar, hierarchy, inspector, asset browser, import dialogs, keyboard shortcuts, viewport rendering, camera controls, grid rendering, asset instances, pointer picking, selection visuals, transform gizmos, and placement ghosts.
- A local **development server** scans and watches source-controlled shared assets, exposes the normalized catalog to the browser, and reads and writes user-owned scene files.
- Scene domain types and commands are framework-independent. Three.js renders and presents editor state but never owns persistent scene data.

## Editor Workspace

Use a docked-studio layout:

- Top menubar for file, edit, view, and scene actions.
- Mode-first toolbar for Select, Move, Rotate, Scale, Grid, Place, and Erase.
- Left panel for scene collection and hierarchy.
- Centre Three.js viewport.
- Right inspector for selected-object properties and asset details.
- Bottom asset browser for catalog search, category filtering, previews, and drag/drop.

Selection is the default mode. A visible active-tool state and keyboard shortcuts make modes discoverable. Dedicated road and terrain authoring mechanics are deferred, but the toolbar and hierarchy retain extension points for them.

## Scene Collection and Persistence

Scenes are user-created data, not repository source code.

- Store scenes outside the source repository in an editor-managed user-data location.
- Store every scene as one readable JSON file.
- Do not create `project.json` or another collection index.
- List the scene collection by enumerating the user-data scene files.
- Support create, open, rename, duplicate, and delete.
- Require confirmation before deleting a scene.
- Save atomically.

Each scene contains a stable ID, display name, square-grid definition, environment settings when introduced, and object instances.

```json
{
  "id": "4c3b8ae4-9873-4ca5-a69c-b716b876ae90",
  "name": "Downtown",
  "grid": { "cellSize": 1, "width": 100, "depth": 100 },
  "objects": [
    {
      "id": "obj_01",
      "assetId": "vegetation.oak",
      "position": { "x": 12.5, "y": 0, "z": 8.5 },
      "rotationY": 0,
      "scale": 1
    }
  ]
}
```

Scene JSON never stores model paths or Three.js object data.

## Shared Asset Library

All scenes share one source-controlled asset root. Asset data stays colocated in one folder per asset.

```text
assets/
  vegetation/
    oak/
      oak.js
      oak.glb
      oak.png
  props/
    street-light/
      street-light.js
      street-light.glb
      street-light.png
```

The development server recursively discovers asset folders and watches them for changes.

- The directory path supplies the default stable ID, such as `vegetation.oak`.
- `.js`, `.glb`, and `.png` are each optional.
- When an asset folder contains a trusted project-local `.js` ES module, that module is the primary implementation.
- A `.glb` is used as the visual implementation only when no `.js` module exists.
- A `.png` is the asset-browser thumbnail when available. Otherwise the editor generates a preview.
- A module can create procedural Three.js objects and load colocated resources.
- Metadata defaults from directory and filename, while a module may override label, category, tags, and other catalog fields.

Trusted asset modules follow this contract:

```ts
export const metadata = {
  id: "vegetation.oak",
  label: "Oak tree",
  category: "vegetation",
  tags: ["tree", "deciduous"]
}

export async function createAsset({ THREE, directoryUrl, modelUrl }) {
  return new THREE.Group()
}
```

Asset modules are trusted developer-authored code. Arbitrary browser-dropped JavaScript is not executed. Module-load failures are isolated to the relevant catalog entry and viewport instance.

## Asset Review and Import

The asset browser shows shared catalog entries and clearly marked temporary session imports.

- Users can search, filter by category, inspect thumbnails, read metadata, and see diagnostics.
- Dragging an asset begins placement in the viewport.
- The server refreshes the browser catalog after shared assets are added or changed.
- Users can drop supported declarative Three.js assets for rapid review.

At import time, offer two paths:

1. **Review temporarily**: create a session-only catalog entry. It disappears at session end.
2. **Add to shared library**: copy files into the shared asset root for all scenes.

For shared imports, auto-fill and allow editing of category, folder name, label, and stable asset ID before confirmation. Never overwrite an existing asset file without explicit confirmation. A saved scene cannot reference a temporary asset. The editor blocks such a save and directs the user to add the asset to the shared library or remove it.

## Placement and Editing

### Placement flow

1. A user drags an asset into the viewport.
2. A ghost follows the pointer over the ground plane.
3. The user chooses **Snap** or **Free** for that placement action.
4. A click confirms the new instance.
5. `Escape` cancels without creating a command.

Placement mode is not derived from asset metadata.

- **Snap** resolves the object origin to the nearest square-grid cell centre.
- **Free** uses the current ground-plane cursor location.
- Both modes set `Y = 0`.
- Height editing and terrain-conforming placement are deferred.

### Selection and properties

- Clicking an instance in the viewport or hierarchy selects it.
- The inspector edits `X`, `Z`, yaw rotation, and uniform scale.
- `Y` remains fixed at `0` in Phase 1.
- Selected instances can be deleted or duplicated.
- The hierarchy has logical layers and visibility controls.
- Viewport transform controls and inspector edits mutate the same domain model through commands.

### Undo and redo

All persistent scene edits are commands, including placement, delete, duplicate, and property changes.

- `Ctrl/Cmd+Z` undoes.
- `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` redo.
- A new edit after undo clears redo history.
- Placement previews are not commands until confirmed.
- History is in memory for the active editing session and is not saved in scene JSON.

## Data Boundaries

### Domain layer

The framework-independent domain layer defines:

- `Scene`, `GridDefinition`, and `SceneObject`.
- `AssetCatalogEntry`.
- Grid coordinate resolution.
- Scene commands and undo/redo history.
- Scene JSON validation.

It depends on neither UI framework APIs, DOM APIs, nor Three.js.

### Three.js UI and viewport layer

Three.js renders the workspace, docked layout, HUD controls, and viewport as one in-canvas interface. It translates pointer, keyboard, and control interactions into domain commands. It returns normalized ground-plane pointer positions and picked instance IDs. It does not access the filesystem or persist scene state.

### Development-server layer

The development server owns filesystem access:

- Shared asset discovery, catalog normalization, and file watching.
- Serving asset resources and trusted project-local modules.
- Temporary import staging and confirmed shared-library copies.
- User-data scene collection CRUD.
- Scene JSON validation and atomic persistence.

## Validation and Error Handling

- Validate scene JSON, asset IDs, duplicate asset IDs, and supported import data.
- Report missing required module exports and invalid asset modules in the asset browser.
- Preserve unresolved scene instances as placeholders with diagnostics so the scene remains openable.
- Keep failed asset loading isolated. One bad asset must not crash the application or viewport.
- Preserve original imported files when import fails.
- Do not expose filesystem stack traces to the browser.

## Testing

### Unit tests

- Square-cell centre snapping and free ground-plane resolution.
- Command execution, undo, redo, and redo-branch invalidation.
- Scene JSON serialization and diagnostics.
- Recursive asset-folder discovery.
- Module-primary and GLB-fallback resolution.
- Duplicate catalog ID detection.
- Temporary-asset save prevention.

### Integration tests

- Scene create, open, rename, duplicate, and delete.
- Catalog refresh after shared-asset changes.
- Placement ghost start, Snap or Free selection, click confirmation, and `Escape` cancellation.
- Viewport and hierarchy selection synchronisation.
- Inspector transform changes.
- Temporary review import and confirmed shared-library import.

### Browser validation

- Docked layout at supported viewport sizes.
- Keyboard shortcuts and focus handling.
- Broken module and missing asset errors remain isolated.
- Confirmed overwrite behaviour and delete confirmation.

## Phase 1 Exclusions

- Physics, WASM, Web Workers, simulation playback, and autonomous vehicles.
- Road drawing or generation.
- Terrain painting, elevation, and terrain conforming.
- Interactive vertical placement.
- Model conversion, texture authoring, and mesh editing.
- Collaboration, cloud sync, and persistent undo history.
