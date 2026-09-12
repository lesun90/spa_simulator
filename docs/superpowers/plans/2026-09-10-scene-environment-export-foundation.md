# Scene Environment Export — Foundation (Shared Generator + Package Domain Model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the WFC scene-generation orchestration into a component the editor and a future CLI can both call, teach WFC-generated objects to remember their own grid coordinate and variant, and define the version-1 environment package domain model (scene recipe, manifest types, a deterministic manifest encoder, and a package validator) — all pure TypeScript with no GLB writing, no geometry compiling, and no rendering.

**Architecture:** This is the first of several plans implementing `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`. It builds the data layer everything else sits on: a `generateWfcScene` function that both the editor and the later Node CLI adapter call (Task 2), richer WFC provenance so cell identity survives a save/load round-trip (Task 1), and a new `src/environment/` module holding the package's domain types, a scene→recipe mapper, a manifest encoder, and a package validator (Tasks 3–5). A later plan adds the geometry compiler that turns a `SceneRecipe` plus the asset catalog into `environment.glb`; this plan produces everything upstream and downstream of that step.

**Tech Stack:** TypeScript, Vitest, Node's built-in `node:crypto` (SHA-256), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`

## Global Constraints

- Both package files use fixed names `environment.glb` and `environment.json`, format `"steerlab-environment"`, `formatVersion: 1`.
- WFC placement must retain cell coordinates and variant IDs in generated-object provenance; existing saved scenes can lack those fields and must be recoverable from exact grid-aligned transforms and asset ID + rotation.
- The manifest encoder sorts arrays and object keys by stable identifiers and never writes timestamps, so re-exporting identical content produces byte-identical JSON.
- The compiler and manifest code (everything under `src/environment/`) must not depend on editor state, HUD types, or browser APIs — Node- and browser-safe TypeScript only.
- The shared scene generator must remain independent of UI concerns (progress reporting, cancellation, history, selection, notices stay in `EditorState`).

---

## File Structure

- **Modify** `src/editor-core/scene.ts` — add `column`, `row`, `variantId`, `seed` to `GeneratedObjectProvenance`.
- **Modify** `src/wfc/sceneLayout.ts` — populate the new provenance fields when building WFC scene objects.
- **Create** `src/wfc/sceneGenerator.ts` — `generateWfcScene`, the shared orchestration function.
- **Modify** `src/state/EditorState.ts` — `generateWfcLayout` delegates to `generateWfcScene`.
- **Create** `src/environment/types.ts` — `SceneRecipe` and the version-1 `EnvironmentManifest` domain types.
- **Create** `src/environment/sceneRecipe.ts` — `buildSceneRecipe(scene, assets)`.
- **Create** `src/environment/manifestEncoder.ts` — `sha256Hex`, `encodeManifest`, `canonicalJson`.
- **Create** `src/environment/glb.ts` — `readGlbInfo`, a minimal GLB header/JSON-chunk reader.
- **Create** `src/environment/packageValidator.ts` — `validateEnvironmentPackage(manifestJson, glbBytes)`.
- **Test** `tests/sceneLayout.test.ts` — extend with provenance assertions (Task 1).
- **Test** `tests/sceneGenerator.test.ts` — new (Task 2).
- **Test** `tests/environmentSceneRecipe.test.ts` — new (Task 3).
- **Test** `tests/environmentManifestEncoder.test.ts` — new (Task 4).
- **Test** `tests/environmentPackageValidator.test.ts` — new (Task 5).

---

### Task 1: WFC objects remember their cell coordinate, variant, and seed

**Files:**
- Modify: `src/editor-core/scene.ts`
- Modify: `src/wfc/sceneLayout.ts:62` (the `sceneObjectsFromSolvedCells` function)
- Test: `tests/sceneLayout.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GeneratedObjectProvenance` gains `column?: number`, `row?: number`, `variantId?: string`, `seed?: number`. Task 3's recipe builder reads these fields directly instead of needing recovery for scenes generated after this change.

- [ ] **Step 1: Write the failing test**

Add to `tests/sceneLayout.test.ts` (it already imports `compactPaletteMetrics, paletteFromAssets` from `../src/wfc/sceneLayout`; add `generateWfcLayout` to that import):

```typescript
describe("WFC scene object provenance", () => {
  test("records the solved cell coordinate, variant, and seed for later environment export", () => {
    const tile = asset("tile", 1);

    const result = generateWfcLayout([tile], { width: 2, depth: 1, seed: 7, tileWidth: 3, tileDepth: 3 });

    expect(result.status).toBe("solved");
    if (result.status !== "solved") throw new Error("expected a solved result");
    expect(result.objects.map((object) => object.generated)).toEqual([
      { pipeline: "wfc", stage: "structural", column: 0, row: 0, variantId: "tile@r0", seed: 7 },
      { pipeline: "wfc", stage: "structural", column: 1, row: 0, variantId: "tile@r0", seed: 7 }
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sceneLayout.test.ts`
Expected: FAIL — the `generated` objects only contain `{ pipeline: "wfc", stage: "structural" }`, missing `column`/`row`/`variantId`/`seed`.

- [ ] **Step 3: Write minimal implementation**

In `src/editor-core/scene.ts`, extend the interface:

```typescript
export interface GeneratedObjectProvenance {
  pipeline: "wfc" | "environment";
  stage: string;
  /** WFC-only: the solved grid coordinate, variant, and seed, so environment export can read cell identity directly instead of recovering it from the transform. */
  column?: number;
  row?: number;
  variantId?: string;
  seed?: number;
}
```

In `src/wfc/sceneLayout.ts`, update `sceneObjectsFromSolvedCells` (the function backing both `sceneObjectsFromWfcResult` and `previewObjectsFromWfcProgress`/`previewObjectsFromCompactCells`) to populate the new fields:

```typescript
function sceneObjectsFromSolvedCells(cells: readonly { column: number; row: number; variant: PlanarWfcVariant }[], seed: number, request: GenerateWfcLayoutRequest, palette: PlanarWfcPalette): SceneObject[] {
  return cells.map((cell) => ({
    id: `wfc-preview-${cell.column}-${cell.row}`,
    assetId: cell.variant.assetId,
    name: `${GENERATED_WFC_NAME_PREFIX} ${seed} [${cell.column}, ${cell.row}]`,
    position: { x: (cell.column - (request.width - 1) / 2) * palette.tileWidth, y: 0, z: (cell.row - (request.depth - 1) / 2) * palette.tileDepth },
    rotationY: (cell.variant.rotationDegrees * Math.PI) / 180,
    scale: palette.tileWidth / DEFAULT_WFC_TILE_SIZE,
    generated: { pipeline: "wfc", stage: "structural", column: cell.column, row: cell.row, variantId: cell.variant.id, seed }
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sceneLayout.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite to confirm nothing else asserted the old provenance shape**

Run: `npx vitest run`
Expected: PASS (no test asserted exact equality on `generated` before this change)

- [ ] **Step 6: Commit**

```bash
git add src/editor-core/scene.ts src/wfc/sceneLayout.ts tests/sceneLayout.test.ts
git commit -m "feat: record WFC cell coordinate, variant, and seed in object provenance"
```

---

### Task 2: Extract the shared scene generator

**Files:**
- Create: `src/wfc/sceneGenerator.ts`
- Modify: `src/state/EditorState.ts:261-303` (`generateWfcLayout`)
- Test: `tests/sceneGenerator.test.ts`

**Interfaces:**
- Consumes: `paletteFromAssets`, `sceneObjectsFromWfcResult`, `solvePlanarWfcInWorker`, `GenerateWfcLayoutRequest`, `WfcGenerationProgress`, `WfcWorkerFactory` from `src/wfc/sceneLayout.ts`; `createWorldPlan` from `src/wfc/worldPlanner.ts`; `validateWorldPlanResult` from `src/wfc/worldPlanPolicies.ts`; `AssetCatalogEntry` from `src/editor-core/assets.ts`.
- Produces: `generateWfcScene(assets, request, options?): Promise<GenerateWfcSceneResult>` where
  `GenerateWfcSceneResult = { status: "solved"; seed: number; roadScene: boolean; objects: readonly SceneObject[]; palette: PlanarWfcPalette; decisions: number; backtracks: number } | { status: "failed"; seed: number; roadScene: boolean; diagnostics: readonly string[] }`.
  `GenerateWfcSceneOptions = { onProgress?(progress: WfcGenerationProgress): void; workerFactory?: WfcWorkerFactory; signal?: AbortSignal }`.
  A later CLI plan calls this same function from Node with no `workerFactory`, relying on `solvePlanarWfcInWorker`'s existing `typeof Worker === "undefined"` in-process fallback.

- [ ] **Step 1: Write the failing test**

Create `tests/sceneGenerator.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import type { WfcMetadata } from "../src/wfc/metadata/socketTypes";
import { generateWfcScene } from "../src/wfc/sceneGenerator";

describe("generateWfcScene", () => {
  test("solves a plain (non-road) catalog and returns scaled, connected scene objects", async () => {
    const assets: AssetCatalogEntry[] = [
      asset({ id: "tiles.a", category: "tiles", wfc: wfc("tiles.a") }),
      asset({ id: "tiles.b", category: "tiles", wfc: wfc("tiles.b") })
    ];

    const result = await generateWfcScene(assets, { width: 3, depth: 2, seed: 12, tileWidth: 6, tileDepth: 6 });

    expect(result.status).toBe("solved");
    if (result.status !== "solved") throw new Error("expected a solved result");
    expect(result.roadScene).toBe(false);
    expect(result.objects).toHaveLength(6);
    expect(result.objects.every((object) => object.scale === 2)).toBe(true);
  });

  test("reports road-scene infeasibility instead of throwing when the route plan cannot be satisfied", async () => {
    const assets: AssetCatalogEntry[] = [
      asset({ id: "roads.only", category: "3d-road-tiles", wfc: wfc("roads.only"), semantics: { roles: ["terrain.ground"], sockets: {} } })
    ];

    const result = await generateWfcScene(assets, { width: 4, depth: 4, seed: 12, tileWidth: 3, tileDepth: 3 });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("expected a failed result");
    expect(result.roadScene).toBe(true);
    expect(result.diagnostics[0]).toBeTruthy();
  });
});

function asset(patch: Partial<AssetCatalogEntry>): AssetCatalogEntry {
  return {
    id: patch.id ?? "props.cone",
    label: patch.label ?? "Asset",
    category: patch.category ?? "props",
    tags: patch.tags,
    source: patch.source ?? "shared",
    implementation: patch.implementation ?? "placeholder",
    wfc: patch.wfc,
    semantics: patch.semantics
  };
}

function wfc(assetId: string): WfcMetadata {
  return {
    height: 1,
    diagnostics: [],
    variants: [
      {
        variantId: `${assetId}@r0`,
        rotationDegrees: 0,
        sockets: { north: "road", east: "road", south: "road", west: "road", top: "top", bottom: "bottom" }
      }
    ]
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sceneGenerator.test.ts`
Expected: FAIL with "Cannot find module '../src/wfc/sceneGenerator'"

- [ ] **Step 3: Write minimal implementation**

Create `src/wfc/sceneGenerator.ts`:

```typescript
import type { AssetCatalogEntry } from "../editor-core/assets";
import type { SceneObject } from "../editor-core/scene";
import type { PlanarWfcPalette } from "./planarWfc";
import {
  paletteFromAssets,
  sceneObjectsFromWfcResult,
  solvePlanarWfcInWorker,
  type GenerateWfcLayoutRequest,
  type WfcGenerationProgress,
  type WfcWorkerFactory
} from "./sceneLayout";
import type { WorldPlan } from "./worldPlan";
import { createWorldPlan } from "./worldPlanner";
import { validateWorldPlanResult } from "./worldPlanPolicies";

export type GenerateWfcSceneResult =
  | { status: "solved"; seed: number; roadScene: boolean; objects: readonly SceneObject[]; palette: PlanarWfcPalette; decisions: number; backtracks: number }
  | { status: "failed"; seed: number; roadScene: boolean; diagnostics: readonly string[] };

export interface GenerateWfcSceneOptions {
  onProgress?(progress: WfcGenerationProgress): void;
  workerFactory?: WfcWorkerFactory;
  signal?: AbortSignal;
}

/**
 * Owns catalog selection, road-scene detection, world-plan creation, WFC solving, and
 * solved-cell conversion. The browser editor calls this with progress reporting; a Node CLI
 * adapter can call it with no `workerFactory`, relying on `solvePlanarWfcInWorker`'s in-process
 * fallback, so both produce the same ordered scene recipe for the same seed, dimensions, cell
 * size, and asset catalog.
 */
export async function generateWfcScene(
  assets: readonly AssetCatalogEntry[],
  request: GenerateWfcLayoutRequest,
  options: GenerateWfcSceneOptions = {}
): Promise<GenerateWfcSceneResult> {
  const roadScene = assets.some((asset) => asset.category === "3d-road-tiles");
  let worldPlan: WorldPlan | undefined = roadScene
    ? createWorldPlan({ width: request.width, depth: request.depth, seed: request.seed, roadCoverage: 0.5, scenic: true })
    : undefined;
  const palette = paletteFromAssets("shared-assets", assets, {
    tileWidth: request.tileWidth,
    tileDepth: request.tileDepth,
    purpose: roadScene ? "road-scene" : undefined
  });

  try {
    const solved = await solvePlanarWfcInWorker(palette, request, {
      worldPlan,
      onWorldPlan: (plan) => { worldPlan = plan; },
      onProgress: options.onProgress,
      workerFactory: options.workerFactory,
      signal: options.signal
    });
    const validationDiagnostics = worldPlan ? validateWorldPlanResult(worldPlan, palette, solved) : [];
    const result = sceneObjectsFromWfcResult(solved, request, palette);
    const objects = result.status === "solved" && !validationDiagnostics.length ? result.objects : [];

    if (!objects.length) {
      const diagnostic = validationDiagnostics[0] ?? (result.status === "failed" ? result.diagnostics[0] ?? "WFC generation failed" : "WFC generation failed");
      return { status: "failed", seed: request.seed, roadScene, diagnostics: [diagnostic] };
    }

    return {
      status: "solved",
      seed: request.seed,
      roadScene,
      objects,
      palette,
      decisions: result.status === "solved" ? result.decisions : 0,
      backtracks: result.status === "solved" ? result.backtracks : 0
    };
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : "WFC generation failed";
    return { status: "failed", seed: request.seed, roadScene, diagnostics: [diagnostic] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sceneGenerator.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor `EditorState.generateWfcLayout` to delegate**

In `src/state/EditorState.ts`, replace the imports of `createWorldPlan`, `validateWorldPlanResult`, `paletteFromAssets`, and `solvePlanarWfcInWorker` with an import of `generateWfcScene` from `../wfc/sceneGenerator` (keep the `GenerateWfcLayoutRequest`, `WfcGenerationProgress`, and `isGeneratedWfcObject` imports from `../wfc/sceneLayout`), and replace the method body:

```typescript
async generateWfcLayout(request: GenerateWfcLayoutRequest) {
  if (!this.history || !this.scene || this.wfcProgress) {
    if (!this.history || !this.scene) this.setNotice("Open a scene before generating a layout");
    return;
  }

  this.setWfcProgress({ status: "building-palette" });
  try {
    const result = await generateWfcScene(this.assets, request, {
      onProgress: (progress) => this.setWfcProgress(progress)
    });
    if (result.status === "failed") {
      const diagnostic = result.diagnostics[0] ?? "WFC generation failed";
      this.setNotice(result.roadScene ? `Road scene infeasible (seed ${result.seed}): ${diagnostic}` : diagnostic);
      return;
    }
    this.setWfcProgress({ status: "placing", cells: result.objects.length });
    this.history = executeCommand(this.history, replaceGeneratedLayoutCommand(result.objects, isGeneratedWfcObject));
    this.selectedObjectId = result.objects[0]?.id ?? null;
    this.emit("scene", "selection");
    this.setNotice(`Generated ${result.objects.length} tiles (seed ${result.seed})`);
  } finally {
    this.setWfcProgress(null);
  }
}
```

- [ ] **Step 6: Run the editor state and generator suites to confirm identical behavior**

Run: `npx vitest run tests/editorState.test.ts tests/sceneGenerator.test.ts`
Expected: PASS — `tests/editorState.test.ts` still asserts "Generated 6 tiles" and "Road scene infeasible" exactly as before.

- [ ] **Step 7: Run the full suite and the TypeScript build check**

Run: `npx vitest run && npm run build`
Expected: PASS with no unused-import errors in `EditorState.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/wfc/sceneGenerator.ts src/state/EditorState.ts tests/sceneGenerator.test.ts
git commit -m "refactor: extract shared WFC scene generator from EditorState"
```

---

### Task 3: Scene recipe domain type and builder

**Files:**
- Create: `src/environment/types.ts` (recipe portion — the manifest portion is added in Task 4)
- Create: `src/environment/sceneRecipe.ts`
- Test: `tests/environmentSceneRecipe.test.ts`

**Interfaces:**
- Consumes: `Scene`, `SceneObject` from `src/editor-core/scene.ts`; `AssetCatalogEntry` from `src/editor-core/assets.ts`.
- Produces: `SceneRecipe`, `RecipeCell`, `RecipeObject`, `RecipeGround`, `GenerationRun`, `Transform`, `Vector3` types; `buildSceneRecipe(scene: Scene, assets: readonly AssetCatalogEntry[]): SceneRecipe`. Task 4's manifest builder (a later plan) turns cells/objects into manifest records by adding chunk assignment and asset content hashes — it will import these exact type names.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentSceneRecipe.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { createScene, type Scene, type SceneObject } from "../src/editor-core/scene";
import { buildSceneRecipe } from "../src/environment/sceneRecipe";

describe("buildSceneRecipe", () => {
  test("splits WFC-generated objects into cells and everything else into objects", () => {
    const scene = sceneWith([
      wfcObject({ id: "cell-0-0", assetId: "tiles.a", column: 0, row: 0, x: -1.5, z: 0, seed: 9, variantId: "tiles.a@r0" }),
      manualObject({ id: "manual-1", assetId: "props.cone", x: 4, z: 4 })
    ], { width: 3, depth: 3, cellSize: 3 });
    const assets = [tileAsset("tiles.a"), propAsset("props.cone")];

    const recipe = buildSceneRecipe(scene, assets);

    expect(recipe.grid).toEqual({ width: 1, depth: 1, cellSize: 3, origin: { x: -1.5, y: 0, z: -1.5 } });
    expect(recipe.cells).toEqual([
      {
        id: "cell-0-0",
        column: 0,
        row: 0,
        transform: { position: { x: -1.5, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.a",
        variantId: "tiles.a@r0",
        semanticRoles: ["road.surface"],
        sourceLayer: "scene",
        recovered: false
      }
    ]);
    expect(recipe.objects).toEqual([
      {
        id: "manual-1",
        name: "manual-1",
        transform: { position: { x: 4, y: 0, z: 4 }, rotationY: 0, scale: 1 },
        sourceAssetId: "props.cone",
        semanticRoles: [],
        sourceLayer: "scene"
      }
    ]);
    expect(recipe.generationRuns).toEqual([{ seed: 9, width: 1, depth: 1, cellSize: 3 }]);
    expect(recipe.diagnostics).toEqual([]);
  });

  test("recovers coordinate and variant for a WFC object saved before provenance carried them", () => {
    const scene = sceneWith(
      [legacyWfcObject({ id: "legacy-1-0", assetId: "tiles.a", x: 0, z: -3, rotationDegrees: 90 })],
      { width: 9, depth: 9, cellSize: 3 }
    );
    const assets = [tileAsset("tiles.a")];

    const recipe = buildSceneRecipe(scene, assets);

    expect(recipe.cells).toHaveLength(1);
    expect(recipe.cells[0]).toMatchObject({ column: 1, row: 0, variantId: "tiles.a@r90", recovered: true });
    expect(recipe.diagnostics).toEqual([]);
  });

  test("reports a diagnostic and falls back to a plain object when recovery cannot align to the grid", () => {
    const scene = sceneWith(
      [legacyWfcObject({ id: "off-grid", assetId: "tiles.a", x: 0.4, z: 0, rotationDegrees: 0 })],
      { width: 3, depth: 3, cellSize: 3 }
    );
    const assets = [tileAsset("tiles.a")];

    const recipe = buildSceneRecipe(scene, assets);

    expect(recipe.cells).toEqual([]);
    expect(recipe.objects.map((object) => object.id)).toEqual(["off-grid"]);
    expect(recipe.diagnostics).toEqual(["Could not recover a grid-aligned cell coordinate for object off-grid; exported as a plain object."]);
  });
});

function sceneWith(objects: SceneObject[], grid: { width: number; depth: number; cellSize: number }): Scene {
  return { ...createScene("Recipe fixture"), grid, objects };
}

function wfcObject(options: { id: string; assetId: string; column: number; row: number; x: number; z: number; seed: number; variantId: string }): SceneObject {
  return {
    id: options.id,
    assetId: options.assetId,
    name: options.id,
    position: { x: options.x, y: 0, z: options.z },
    rotationY: 0,
    scale: 1,
    generated: { pipeline: "wfc", stage: "structural", column: options.column, row: options.row, variantId: options.variantId, seed: options.seed }
  };
}

function legacyWfcObject(options: { id: string; assetId: string; x: number; z: number; rotationDegrees: number }): SceneObject {
  return {
    id: options.id,
    assetId: options.assetId,
    name: options.id,
    position: { x: options.x, y: 0, z: options.z },
    rotationY: (options.rotationDegrees * Math.PI) / 180,
    scale: 1,
    generated: { pipeline: "wfc", stage: "structural" }
  };
}

function manualObject(options: { id: string; assetId: string; x: number; z: number }): SceneObject {
  return { id: options.id, assetId: options.assetId, name: options.id, position: { x: options.x, y: 0, z: options.z }, rotationY: 0, scale: 1 };
}

function tileAsset(id: string): AssetCatalogEntry {
  return {
    id,
    label: id,
    category: "3d-road-tiles",
    source: "shared",
    implementation: "glb",
    semantics: { roles: ["road.surface"], sockets: {} },
    wfc: {
      height: 1,
      diagnostics: [],
      variants: [
        { variantId: `${id}@r0`, rotationDegrees: 0, sockets: { north: "road", east: "road", south: "road", west: "road", top: "top", bottom: "bottom" } },
        { variantId: `${id}@r90`, rotationDegrees: 90, sockets: { north: "road", east: "road", south: "road", west: "road", top: "top", bottom: "bottom" } }
      ]
    }
  };
}

function propAsset(id: string): AssetCatalogEntry {
  return { id, label: id, category: "props", source: "shared", implementation: "placeholder" };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentSceneRecipe.test.ts`
Expected: FAIL with "Cannot find module '../src/environment/sceneRecipe'"

- [ ] **Step 3: Write minimal implementation**

Create `src/environment/types.ts`:

```typescript
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vector3;
  rotationY: number;
  scale: number;
}

export interface WorldBounds {
  min: Vector3;
  max: Vector3;
}

export interface GenerationRun {
  seed: number;
  width: number;
  depth: number;
  cellSize: number;
}

export type RecipeSourceLayer = "base" | "scene";

export interface RecipeCell {
  id: string;
  column: number;
  row: number;
  transform: Transform;
  sourceAssetId: string;
  variantId?: string;
  semanticRoles: readonly string[];
  sourceLayer: RecipeSourceLayer;
  /** True when column/row/variant were recovered from the transform instead of read from provenance. */
  recovered: boolean;
}

export interface RecipeObject {
  id: string;
  name: string;
  transform: Transform;
  sourceAssetId: string;
  semanticRoles: readonly string[];
  sourceLayer: RecipeSourceLayer;
}

export interface RecipeGround {
  appearance: { type: "color" | "texture"; color: string; textureUrl: string | null };
}

export interface SceneRecipe {
  grid: { width: number; depth: number; cellSize: number; origin: Vector3 };
  generationRuns: readonly GenerationRun[];
  cells: readonly RecipeCell[];
  objects: readonly RecipeObject[];
  ground: RecipeGround;
  diagnostics: readonly string[];
}
```

Create `src/environment/sceneRecipe.ts`:

```typescript
import type { AssetCatalogEntry } from "../editor-core/assets";
import type { Scene, SceneObject } from "../editor-core/scene";
import type { GenerationRun, RecipeCell, RecipeObject, SceneRecipe } from "./types";

const EPSILON = 1e-4;

export function buildSceneRecipe(scene: Scene, assets: readonly AssetCatalogEntry[]): SceneRecipe {
  const width = Math.round(scene.grid.width / scene.grid.cellSize);
  const depth = Math.round(scene.grid.depth / scene.grid.cellSize);
  const cellSize = scene.grid.cellSize;
  const grid = { width, depth, cellSize };
  const origin = { x: -scene.grid.width / 2, y: 0, z: -scene.grid.depth / 2 };
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const diagnostics: string[] = [];
  const cells: RecipeCell[] = [];
  const objects: RecipeObject[] = [];

  for (const object of scene.objects) {
    const cell = object.generated?.pipeline === "wfc" ? recipeCellFromObject(object, grid, assetsById, diagnostics) : undefined;
    if (cell) {
      cells.push(cell);
    } else {
      objects.push(recipeObjectFromObject(object, assetsById));
    }
  }

  return {
    grid: { ...grid, origin },
    generationRuns: generationRunsFromScene(scene, grid),
    cells,
    objects,
    ground: { appearance: { ...scene.ground } },
    diagnostics
  };
}

function recipeCellFromObject(
  object: SceneObject,
  grid: { width: number; depth: number; cellSize: number },
  assetsById: Map<string, AssetCatalogEntry>,
  diagnostics: string[]
): RecipeCell | undefined {
  const provenance = object.generated!;
  const hasStoredCoordinate = provenance.column !== undefined && provenance.row !== undefined;
  const coordinate = hasStoredCoordinate ? { column: provenance.column!, row: provenance.row! } : recoverCoordinate(object.position, grid);

  if (!coordinate) {
    diagnostics.push(`Could not recover a grid-aligned cell coordinate for object ${object.id}; exported as a plain object.`);
    return undefined;
  }

  const asset = assetsById.get(object.assetId);
  const variantId = provenance.variantId ?? recoverVariantId(object, asset, diagnostics);

  return {
    id: object.id,
    column: coordinate.column,
    row: coordinate.row,
    transform: { position: { ...object.position }, rotationY: object.rotationY, scale: object.scale },
    sourceAssetId: object.assetId,
    variantId,
    semanticRoles: asset?.semantics?.roles ?? [],
    sourceLayer: "scene",
    recovered: !hasStoredCoordinate
  };
}

function recoverCoordinate(position: SceneObject["position"], grid: { width: number; depth: number; cellSize: number }) {
  const column = Math.round(position.x / grid.cellSize + (grid.width - 1) / 2);
  const row = Math.round(position.z / grid.cellSize + (grid.depth - 1) / 2);
  const expectedX = (column - (grid.width - 1) / 2) * grid.cellSize;
  const expectedZ = (row - (grid.depth - 1) / 2) * grid.cellSize;
  if (Math.abs(position.x - expectedX) > EPSILON || Math.abs(position.z - expectedZ) > EPSILON) return undefined;
  return { column, row };
}

function recoverVariantId(object: SceneObject, asset: AssetCatalogEntry | undefined, diagnostics: string[]): string | undefined {
  const rotationDegrees = normalizeRotationDegrees(object.rotationY);
  const matches = (asset?.wfc?.variants ?? []).filter((variant) => variant.rotationDegrees === rotationDegrees);
  if (matches.length === 1) return matches[0].variantId;
  if (matches.length > 1) diagnostics.push(`Ambiguous WFC variant for object ${object.id}: ${matches.length} variants of ${object.assetId} share rotation ${rotationDegrees}.`);
  else diagnostics.push(`No WFC variant of ${object.assetId} matches object ${object.id} at rotation ${rotationDegrees}.`);
  return undefined;
}

function normalizeRotationDegrees(rotationY: number) {
  const degrees = Math.round((rotationY * 180) / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

function recipeObjectFromObject(object: SceneObject, assetsById: Map<string, AssetCatalogEntry>): RecipeObject {
  return {
    id: object.id,
    name: object.name,
    transform: { position: { ...object.position }, rotationY: object.rotationY, scale: object.scale },
    sourceAssetId: object.assetId,
    semanticRoles: assetsById.get(object.assetId)?.semantics?.roles ?? [],
    sourceLayer: "scene"
  };
}

function generationRunsFromScene(scene: Scene, grid: { width: number; depth: number; cellSize: number }): readonly GenerationRun[] {
  const seeds = new Set(
    scene.objects
      .map((object) => (object.generated?.pipeline === "wfc" ? object.generated.seed : undefined))
      .filter((seed): seed is number => seed !== undefined)
  );
  return [...seeds].sort((a, b) => a - b).map((seed) => ({ seed, ...grid }));
}
```

Note: the recovery diagnostic for `recoverVariantId` only fires for objects that already passed coordinate recovery, so the "off-grid" test case never reaches it — that object short-circuits on the coordinate check first, matching the third test's single diagnostic.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentSceneRecipe.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/environment/types.ts src/environment/sceneRecipe.ts tests/environmentSceneRecipe.test.ts
git commit -m "feat: add scene recipe domain type and Scene-to-recipe builder"
```

---

### Task 4: Environment manifest types, SHA-256 hashing, and deterministic encoding

**Files:**
- Modify: `src/environment/types.ts` (add the manifest portion)
- Create: `src/environment/manifestEncoder.ts`
- Test: `tests/environmentManifestEncoder.test.ts`

**Interfaces:**
- Consumes: `RecipeSourceLayer`, `Transform`, `WorldBounds`, `Vector3`, `GenerationRun` from `./types` (Task 3).
- Produces: `EnvironmentManifest` and its nested record types (`EnvironmentManifestModel`, `EnvironmentManifestGrid`, `EnvironmentManifestProvenance`, `EnvironmentManifestBuild`, `EnvironmentManifestChunk`, `EnvironmentManifestAsset`, `EnvironmentManifestCell`, `EnvironmentManifestObject`, `EnvironmentManifestGround`, `EnvironmentManifestNavigationNode`, `EnvironmentManifestNavigationEdge`); `sha256Hex(data: Uint8Array): string`; `encodeManifest(manifest: EnvironmentManifest): EnvironmentManifest`; `canonicalJson(value: unknown): string`. Task 5's validator and a later plan's geometry compiler both import `EnvironmentManifest` and its nested types from here.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentManifestEncoder.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { canonicalJson, encodeManifest, sha256Hex } from "../src/environment/manifestEncoder";
import type { EnvironmentManifest } from "../src/environment/types";

describe("sha256Hex", () => {
  test("matches the known SHA-256 of the empty buffer", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85");
  });
});

describe("encodeManifest", () => {
  test("sorts every identifier-keyed array so reordered input produces the same encoded manifest", () => {
    const manifestA = fixtureManifest({ order: ["b", "a"] });
    const manifestB = fixtureManifest({ order: ["a", "b"] });

    expect(encodeManifest(manifestA)).toEqual(encodeManifest(manifestB));
  });

  test("sorts diagnostics", () => {
    const manifest = fixtureManifest({ order: ["a", "b"] });
    manifest.diagnostics = ["zebra", "aardvark"];

    expect(encodeManifest(manifest).diagnostics).toEqual(["aardvark", "zebra"]);
  });
});

describe("canonicalJson", () => {
  test("produces identical output regardless of source key order", () => {
    const first = canonicalJson({ b: 1, a: 2 });
    const second = canonicalJson({ a: 2, b: 1 });

    expect(first).toBe(second);
    expect(first).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });

  test("sorts keys inside nested objects and arrays", () => {
    expect(canonicalJson({ items: [{ z: 1, a: 2 }] })).toBe('{\n  "items": [\n    {\n      "a": 2,\n      "z": 1\n    }\n  ]\n}');
  });
});

function fixtureManifest(options: { order: readonly string[] }): EnvironmentManifest {
  const [first, second] = options.order;
  return {
    format: "steerlab-environment",
    formatVersion: 1,
    model: { file: "environment.glb", sha256: "hash", rootNode: "SteerlabEnvironment", upAxis: "Y", unitsPerMeter: 1 },
    grid: { width: 1, depth: 1, cellSize: 1, origin: { x: 0, y: 0, z: 0 }, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } },
    provenance: { source: "cli", generatorVersion: "0.1.0", generationRuns: [] },
    build: { chunkSize: 10, removeInternalSeamFaces: false },
    chunks: [first, second].map((id) => ({ id, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } })),
    assets: [],
    cells: [],
    objects: [],
    ground: null,
    navigation: { nodes: [], edges: [] },
    diagnostics: []
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentManifestEncoder.test.ts`
Expected: FAIL with "Cannot find module '../src/environment/manifestEncoder'"

- [ ] **Step 3: Write minimal implementation**

Append to `src/environment/types.ts`:

```typescript
export interface EnvironmentManifestModel {
  file: "environment.glb";
  sha256: string;
  rootNode: "SteerlabEnvironment";
  upAxis: "Y";
  unitsPerMeter: number;
}

export interface EnvironmentManifestGrid {
  width: number;
  depth: number;
  cellSize: number;
  origin: Vector3;
  bounds: WorldBounds;
}

export interface EnvironmentManifestProvenance {
  source: "editor" | "cli";
  generatorVersion: string;
  generationRuns: readonly GenerationRun[];
}

export interface EnvironmentManifestBuild {
  chunkSize: number;
  removeInternalSeamFaces: boolean;
}

export interface EnvironmentManifestChunk {
  id: string;
  bounds: WorldBounds;
}

export interface EnvironmentManifestAsset {
  id: string;
  label: string;
  category: string;
  contentHash: string;
  semanticRoles: readonly string[];
}

export interface EnvironmentManifestCell {
  id: string;
  column: number;
  row: number;
  transform: Transform;
  bounds: WorldBounds;
  sourceAssetId: string;
  assetContentHash?: string;
  variantId?: string;
  semanticRoles: readonly string[];
  chunkId: string;
  sourceLayer: RecipeSourceLayer;
}

export interface EnvironmentManifestObject {
  id: string;
  name: string;
  transform: Transform;
  bounds: WorldBounds;
  sourceAssetId: string;
  assetContentHash?: string;
  semanticRoles: readonly string[];
  chunkId: string;
  sourceLayer: RecipeSourceLayer;
}

export interface EnvironmentManifestGround {
  bounds: WorldBounds;
  material: { color: string; textureUrl: string | null };
  chunkIds: readonly string[];
}

export interface EnvironmentManifestNavigationNode {
  id: string;
  cellId: string;
  position: Vector3;
  channels: readonly string[];
  featureTags: readonly string[];
}

export interface EnvironmentManifestNavigationEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  direction: "north" | "east" | "south" | "west";
  channel: string;
  cost: number;
  bidirectional: boolean;
}

export interface EnvironmentManifest {
  format: "steerlab-environment";
  formatVersion: 1;
  model: EnvironmentManifestModel;
  grid: EnvironmentManifestGrid;
  provenance: EnvironmentManifestProvenance;
  build: EnvironmentManifestBuild;
  chunks: readonly EnvironmentManifestChunk[];
  assets: readonly EnvironmentManifestAsset[];
  cells: readonly EnvironmentManifestCell[];
  objects: readonly EnvironmentManifestObject[];
  ground: EnvironmentManifestGround | null;
  navigation: { nodes: readonly EnvironmentManifestNavigationNode[]; edges: readonly EnvironmentManifestNavigationEdge[] };
  diagnostics: readonly string[];
}
```

Create `src/environment/manifestEncoder.ts`:

```typescript
import { createHash } from "node:crypto";
import type { EnvironmentManifest } from "./types";

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Sorts every identifier-keyed array so re-exporting the same logical content produces the same manifest. */
export function encodeManifest(manifest: EnvironmentManifest): EnvironmentManifest {
  return {
    ...manifest,
    chunks: sortById(manifest.chunks),
    assets: sortById(manifest.assets),
    cells: sortById(manifest.cells),
    objects: sortById(manifest.objects),
    navigation: {
      nodes: sortById(manifest.navigation.nodes),
      edges: sortById(manifest.navigation.edges)
    },
    diagnostics: [...manifest.diagnostics].sort()
  };
}

/** Deterministic JSON with alphabetically sorted object keys, so byte-for-byte diffs reflect real content changes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortById<T extends { id: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortKeys(entry)]));
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentManifestEncoder.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/environment/types.ts src/environment/manifestEncoder.ts tests/environmentManifestEncoder.test.ts
git commit -m "feat: add environment manifest types and deterministic encoder"
```

---

### Task 5: GLB reader and package validator

**Files:**
- Create: `src/environment/glb.ts`
- Create: `src/environment/packageValidator.ts`
- Test: `tests/environmentPackageValidator.test.ts`

**Interfaces:**
- Consumes: `EnvironmentManifest` and nested types from `./types` (Task 4); `sha256Hex` from `./manifestEncoder` (Task 4); `ValidationResult` from `../editor-core/validation.ts` (existing `{ valid: boolean; diagnostics: string[] }` shape, reused for consistency with `validateSceneJson`/`validateSceneForSave`).
- Produces: `readGlbInfo(bytes: Uint8Array): { valid: boolean; nodeNames?: readonly string[]; error?: string }`; `validateEnvironmentPackage(manifestJson: unknown, glbBytes: Uint8Array): ValidationResult`. A later plan's import API route calls `validateEnvironmentPackage` before committing an uploaded package.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentPackageValidator.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { sha256Hex } from "../src/environment/manifestEncoder";
import { validateEnvironmentPackage } from "../src/environment/packageValidator";
import type { EnvironmentManifest } from "../src/environment/types";

describe("validateEnvironmentPackage", () => {
  test("accepts a well-formed manifest whose GLB hash and root node match", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result).toEqual({ valid: true, diagnostics: [] });
  });

  test("rejects a GLB that does not match the recorded hash", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest("0".repeat(64));

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("environment.glb does not match the hash recorded in the manifest.");
  });

  test("rejects a GLB missing the manifest's root node", () => {
    const glb = buildGlb({ nodes: [{ name: "SomethingElse" }] });
    const manifest = fixtureManifest(sha256Hex(glb));

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("environment.glb does not contain the root node named in the manifest.");
  });

  test("rejects a cell that references an unknown chunk and asset", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.cells = [
      {
        id: "cell-1",
        column: 0,
        row: 0,
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
        sourceAssetId: "missing.asset",
        semanticRoles: [],
        chunkId: "missing-chunk",
        sourceLayer: "scene"
      }
    ];

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        "Cell cell-1 references unknown chunk missing-chunk.",
        "Cell cell-1 references unknown asset missing.asset."
      ])
    );
  });

  test("rejects a cell placed outside the grid bounds", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.chunks = [{ id: "chunk-0", bounds: manifest.grid.bounds }];
    manifest.assets = [{ id: "tiles.a", label: "Tile A", category: "tiles", contentHash: "hash", semanticRoles: [] }];
    manifest.cells = [
      {
        id: "cell-1",
        column: 99,
        row: 0,
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        bounds: manifest.grid.bounds,
        sourceAssetId: "tiles.a",
        semanticRoles: [],
        chunkId: "chunk-0",
        sourceLayer: "scene"
      }
    ];

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Cell cell-1 coordinate (99, 0) is outside the grid bounds.");
  });

  test("rejects a navigation edge with an unknown endpoint", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.navigation = {
      nodes: [{ id: "node-1", cellId: "cell-1", position: { x: 0, y: 0, z: 0 }, channels: ["road"], featureTags: [] }],
      edges: [{ id: "edge-1", fromNodeId: "node-1", toNodeId: "node-missing", direction: "north", channel: "road", cost: 1, bidirectional: true }]
    };

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Navigation edge edge-1 references unknown node node-missing.");
  });

  test("rejects a GLB with corrupt magic bytes", () => {
    const manifest = fixtureManifest("0".repeat(64));

    const result = validateEnvironmentPackage(manifest, Buffer.from([1, 2, 3, 4]));

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("GLB is smaller than a valid header.");
  });
});

function fixtureManifest(sha256: string): EnvironmentManifest {
  return {
    format: "steerlab-environment",
    formatVersion: 1,
    model: { file: "environment.glb", sha256, rootNode: "SteerlabEnvironment", upAxis: "Y", unitsPerMeter: 1 },
    grid: { width: 1, depth: 1, cellSize: 1, origin: { x: 0, y: 0, z: 0 }, bounds: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } } },
    provenance: { source: "cli", generatorVersion: "0.1.0", generationRuns: [] },
    build: { chunkSize: 10, removeInternalSeamFaces: false },
    chunks: [],
    assets: [],
    cells: [],
    objects: [],
    ground: null,
    navigation: { nodes: [], edges: [] },
    diagnostics: []
  };
}

function buildGlb(json: unknown): Buffer {
  const jsonText = JSON.stringify(json);
  const padded = jsonText + " ".repeat((4 - (jsonText.length % 4)) % 4);
  const jsonBytes = Buffer.from(padded, "utf8");
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonBytes.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunkHeader, jsonBytes]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentPackageValidator.test.ts`
Expected: FAIL with "Cannot find module '../src/environment/packageValidator'"

- [ ] **Step 3: Write minimal implementation**

Create `src/environment/glb.ts`:

```typescript
const GLB_MAGIC = 0x46546c67; // "glTF", little-endian
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON", little-endian

export interface GlbInfo {
  valid: boolean;
  nodeNames?: readonly string[];
  error?: string;
}

/** Reads only the GLB header and JSON chunk — enough to validate identity and node names without a full glTF parser. */
export function readGlbInfo(bytes: Uint8Array): GlbInfo {
  if (bytes.length < 20) return { valid: false, error: "GLB is smaller than a valid header." };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return { valid: false, error: "GLB magic bytes are missing." };

  const totalLength = view.getUint32(8, true);
  if (totalLength !== bytes.length) return { valid: false, error: "GLB header length does not match the file size." };

  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== JSON_CHUNK_TYPE) return { valid: false, error: "GLB does not start with a JSON chunk." };

  let json: { nodes?: { name?: string }[] };
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength)));
  } catch {
    return { valid: false, error: "GLB JSON chunk is not valid JSON." };
  }

  const nodeNames = (json.nodes ?? []).map((node) => node.name).filter((name): name is string => typeof name === "string");
  return { valid: true, nodeNames };
}
```

Create `src/environment/packageValidator.ts`:

```typescript
import type { ValidationResult } from "../editor-core/validation";
import { readGlbInfo } from "./glb";
import { sha256Hex } from "./manifestEncoder";
import type { EnvironmentManifest, EnvironmentManifestCell, EnvironmentManifestObject, Vector3, WorldBounds } from "./types";

export function validateEnvironmentPackage(manifestJson: unknown, glbBytes: Uint8Array): ValidationResult {
  const diagnostics: string[] = [];
  const manifest = manifestJson as Partial<EnvironmentManifest> | null;

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, diagnostics: ["environment.json must be an object."] };
  }
  if (manifest.format !== "steerlab-environment") diagnostics.push("Unsupported package format.");
  if (manifest.formatVersion !== 1) diagnostics.push("Unsupported package format version.");
  if (!manifest.model || manifest.model.file !== "environment.glb") diagnostics.push("Manifest model.file must be environment.glb.");

  const glbInfo = readGlbInfo(glbBytes);
  if (!glbInfo.valid) diagnostics.push(glbInfo.error ?? "environment.glb is not a valid GLB file.");
  if (manifest.model && glbInfo.valid && manifest.model.sha256 !== sha256Hex(glbBytes)) {
    diagnostics.push("environment.glb does not match the hash recorded in the manifest.");
  }
  if (glbInfo.valid && manifest.model && !new Set(glbInfo.nodeNames).has(manifest.model.rootNode)) {
    diagnostics.push("environment.glb does not contain the root node named in the manifest.");
  }

  if (!manifest.grid || !isPositiveNumber(manifest.grid.cellSize) || !isPositiveNumber(manifest.grid.width) || !isPositiveNumber(manifest.grid.depth)) {
    diagnostics.push("Manifest grid must define positive width, depth, and cellSize.");
  }
  if (manifest.grid && !isValidBounds(manifest.grid.bounds)) {
    diagnostics.push("Manifest grid bounds must be finite with min not exceeding max on every axis.");
  }

  const chunkIds = idSet(manifest.chunks, diagnostics, "chunk");
  const assetIds = idSet(manifest.assets, diagnostics, "asset");
  const cellIds = idSet(manifest.cells, diagnostics, "cell");
  idSet(manifest.objects, diagnostics, "object");
  const nodeIds = idSet(manifest.navigation?.nodes, diagnostics, "navigation node");

  for (const cell of manifest.cells ?? []) {
    validatePlacedRecord(cell, "Cell", diagnostics);
    if (manifest.grid && (cell.column < 0 || cell.column >= manifest.grid.width || cell.row < 0 || cell.row >= manifest.grid.depth)) {
      diagnostics.push(`Cell ${cell.id} coordinate (${cell.column}, ${cell.row}) is outside the grid bounds.`);
    }
    if (!chunkIds.has(cell.chunkId)) diagnostics.push(`Cell ${cell.id} references unknown chunk ${cell.chunkId}.`);
    if (!assetIds.has(cell.sourceAssetId)) diagnostics.push(`Cell ${cell.id} references unknown asset ${cell.sourceAssetId}.`);
  }

  for (const object of manifest.objects ?? []) {
    validatePlacedRecord(object, "Object", diagnostics);
    if (!chunkIds.has(object.chunkId)) diagnostics.push(`Object ${object.id} references unknown chunk ${object.chunkId}.`);
    if (!assetIds.has(object.sourceAssetId)) diagnostics.push(`Object ${object.id} references unknown asset ${object.sourceAssetId}.`);
  }

  for (const node of manifest.navigation?.nodes ?? []) {
    if (!cellIds.has(node.cellId)) diagnostics.push(`Navigation node ${node.id} references unknown cell ${node.cellId}.`);
  }

  for (const edge of manifest.navigation?.edges ?? []) {
    if (!nodeIds.has(edge.fromNodeId)) diagnostics.push(`Navigation edge ${edge.id} references unknown node ${edge.fromNodeId}.`);
    if (!nodeIds.has(edge.toNodeId)) diagnostics.push(`Navigation edge ${edge.id} references unknown node ${edge.toNodeId}.`);
    if (!isFiniteNumber(edge.cost) || edge.cost < 0) diagnostics.push(`Navigation edge ${edge.id} must have a non-negative finite cost.`);
    if (typeof edge.channel !== "string" || !edge.channel) diagnostics.push(`Navigation edge ${edge.id} requires a channel.`);
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

function idSet(items: readonly { id: string }[] | undefined, diagnostics: string[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items ?? []) {
    if (ids.has(item.id)) diagnostics.push(`Duplicate ${label} ID ${item.id}.`);
    ids.add(item.id);
  }
  return ids;
}

function validatePlacedRecord(record: EnvironmentManifestCell | EnvironmentManifestObject, label: string, diagnostics: string[]) {
  const transform = record.transform;
  if (!transform || !isFiniteVector(transform.position) || !isFiniteNumber(transform.rotationY) || !isFiniteNumber(transform.scale) || transform.scale <= 0) {
    diagnostics.push(`${label} ${record.id} has an invalid transform.`);
  }
}

function isFiniteVector(value: Vector3 | undefined): value is Vector3 {
  return !!value && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

function isValidBounds(bounds: WorldBounds | undefined): boolean {
  if (!bounds || !isFiniteVector(bounds.min) || !isFiniteVector(bounds.max)) return false;
  return bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y && bounds.min.z <= bounds.max.z;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentPackageValidator.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/environment/glb.ts src/environment/packageValidator.ts tests/environmentPackageValidator.test.ts
git commit -m "feat: add GLB reader and environment package validator"
```

---

## What this plan does not cover

Per the spec's architecture, these stay out of scope for this plan and belong to later plans:

- The geometry compiler (asset resolution, flattening, instancing, merging, welding, seam removal, GLB writing).
- Assembling a full `EnvironmentManifest` from a real `SceneRecipe` plus compiled geometry (chunk assignment, per-record `bounds`, `assetContentHash`, the `assets` table, navigation graph construction).
- The `npm run scene:export` CLI script.
- Vite API routes, scene-owned package storage, and the `Scene` model's environment reference.
- The Project panel's Export/Import controls and the locked environment world feature.
