# Scene Environment Export — Geometry Compiler and Manifest Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a `SceneRecipe` (from the foundation plan) plus the asset catalog into a real `environment.glb` + a fully-populated `EnvironmentManifest` — resolving catalog assets to Three.js geometry in Node, chunking, instancing, merging, welding, optional seam removal, GLB export, asset content hashing, and navigation-graph construction — behind one orchestration function, `compileEnvironmentPackage`.

**Architecture:** This is the second of several plans implementing `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`. It builds entirely on `src/environment/types.ts`, `sceneRecipe.ts`, `manifestEncoder.ts`, `glb.ts`, and `packageValidator.ts` from `docs/superpowers/plans/2026-09-10-scene-environment-export-foundation.md` (verify those files exist before starting; if not, that plan must run first). Each pipeline stage is its own small module under `src/environment/`, composed by `compiler.ts`. Everything here is Node-safe TypeScript with no editor/HUD/browser dependency, so the same code serves the CLI (a later plan) and the Vite API server (a later plan).

**Tech Stack:** TypeScript, Three.js 0.185 (`GLTFLoader`, `GLTFExporter`, `BufferGeometryUtils` from `three/addons/...`), Vitest, Node's `node:crypto`/`node:fs`.

**Spec:** `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`

## Global Constraints

- Both package files use fixed names `environment.glb` and `environment.json`, format `"steerlab-environment"`, `formatVersion: 1` (unchanged from the foundation plan).
- Code under `src/environment/` must not depend on editor state, HUD types, or browser APIs — Node- and browser-safe TypeScript only. It may depend on `three` and on read-only Node-side modules already used for the same purpose elsewhere (`server/assetCatalog.ts`'s `discoverAssetCatalog`, consumed by later plans, not this one).
- New dependency: **`canvas`** (node-canvas), added to `package.json` dependencies. Three's `GLTFLoader`/`GLTFExporter` call `document.createElement("canvas")` and expect a `HTMLImageElement`-like `Image` global when decoding/encoding embedded texture images; real Node (unlike Vitest's `jsdom` test environment) has neither. `src/environment/nodeGltfShim.ts` (Task 1) polyfills exactly those two globals with `canvas`'s implementations, imported once for its side effect before any `GLTFLoader`/`GLTFExporter` use. This is the one new dependency this plan introduces.
- **Scope boundary — no package composition yet:** this plan compiles a fresh package from a `SceneRecipe` that has no previously-attached environment. Re-exporting a scene that already owns an imported environment (the spec's "Package composition" section: ID-prefixing, flattening an attached GLB's nodes into the new output, preserving its semantic records) is real, separable work and is deferred to a follow-up plan once import (a later plan) exists to produce an attached package in the first place. `compileEnvironmentPackage` in this plan always treats its `SceneRecipe` as the entire output — good enough for first export and for every CLI run (CLI never has an attached environment).
- Instancing/merging groups are always scoped per output chunk (never across chunks), so a chunk's render nodes stay chunk-local for Three.js frustum culling, per spec's "Performance expectations" section.
- Transparent materials are never instanced or merged (spec: "Transparent primitives retain separate ordering-safe meshes when instancing or merging could change blending").

---

## File Structure

- **Create** `src/environment/nodeGltfShim.ts` — polyfills `document`/`Image` for Node-side GLTFLoader/GLTFExporter.
- **Create** `src/environment/assetGeometrySource.ts` — `resolveAssetGeometry`, `unsupportedNodeDiagnostics`.
- **Create** `src/environment/chunking.ts` — `assignChunks`.
- **Create** `src/environment/geometryCompiler.ts` — `compileGeometry`.
- **Create** `src/environment/seamRemoval.ts` — `removeInternalSeamFaces`.
- **Create** `src/environment/glbExporter.ts` — `exportGlb`.
- **Create** `src/environment/assetTable.ts` — `buildAssetTable`.
- **Create** `src/environment/manifestBuilder.ts` — `buildManifestRecords`.
- **Create** `src/environment/navigationGraph.ts` — `buildNavigationGraph`.
- **Create** `src/environment/compiler.ts` — `compileEnvironmentPackage` (the public entry point).
- **Test** `tests/environmentAssetGeometrySource.test.ts`, `tests/environmentChunking.test.ts`, `tests/environmentGeometryCompiler.test.ts`, `tests/environmentSeamRemoval.test.ts`, `tests/environmentGlbExporter.test.ts`, `tests/environmentAssetTable.test.ts`, `tests/environmentManifestBuilder.test.ts`, `tests/environmentNavigationGraph.test.ts`, `tests/environmentCompiler.test.ts` — all new.
- **Modify** `package.json` — add `"canvas"` dependency.

---

### Task 1: Node-compatible asset geometry source

**Files:**
- Create: `src/environment/nodeGltfShim.ts`
- Create: `src/environment/assetGeometrySource.ts`
- Modify: `package.json`
- Test: `tests/environmentAssetGeometrySource.test.ts`

**Interfaces:**
- Consumes: `AssetCatalogEntry` from `src/editor-core/assets.ts`; `createPlaceholder` from `src/engine/AssetManager.ts` (already Node-portable — a `THREE.Group` built with `THREE.BoxGeometry`/`THREE.MeshStandardMaterial`, no DOM).
- Produces: `AssetGeometryResult = { status: "resolved"; object: THREE.Object3D } | { status: "error"; diagnostics: string[] }`; `resolveAssetGeometry(asset: AssetCatalogEntry | undefined, assetId: string, assetRoot: string): Promise<AssetGeometryResult>`; `unsupportedNodeDiagnostics(object: THREE.Object3D, assetId: string): string[]`. Task 3 (`geometryCompiler.ts`) calls `resolveAssetGeometry` once per unique `sourceAssetId` referenced by the recipe.

- [ ] **Step 1: Install the new dependency**

```bash
npm install canvas
```

- [ ] **Step 2: Write the failing test**

Create `tests/environmentAssetGeometrySource.test.ts`:

```typescript
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as THREE from "three";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { resolveAssetGeometry, unsupportedNodeDiagnostics } from "../src/environment/assetGeometrySource";

describe("resolveAssetGeometry", () => {
  let assetRoot: string;

  afterEach(async () => {
    if (assetRoot) await import("node:fs/promises").then((fs) => fs.rm(assetRoot, { recursive: true, force: true }));
  });

  test("reports an error when the asset is missing from the catalog instead of substituting a placeholder", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));

    const result = await resolveAssetGeometry(undefined, "tiles.missing", assetRoot);

    expect(result).toEqual({ status: "error", diagnostics: ["Asset tiles.missing is not present in the catalog."] });
  });

  test("resolves a placeholder-implementation asset to a procedural box, matching the editor's fallback", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const asset: AssetCatalogEntry = { id: "props.cone", label: "Cone", category: "props", source: "shared", implementation: "placeholder" };

    const result = await resolveAssetGeometry(asset, asset.id, assetRoot);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    let meshCount = 0;
    result.object.traverse((node) => {
      if (node instanceof THREE.Mesh) meshCount += 1;
    });
    expect(meshCount).toBe(1);
  });

  test("resolves a module-implementation asset by importing its createAsset export", async () => {
    // Vitest's dev-server module graph refuses to dynamically import() files outside the
    // project root (confirmed: an equivalent fixture under os.tmpdir() fails with "Cannot
    // find module", while the identical fixture under the project root imports fine) — this
    // test's asset root must live inside the repo, unlike the other two tests in this file,
    // which never trigger a dynamic import and so can safely use os.tmpdir().
    assetRoot = await mkdtemp(join(process.cwd(), "tests", ".tmp-assets-"));
    await mkdir(join(assetRoot, "props", "lamp"), { recursive: true });
    await writeFile(
      join(assetRoot, "props", "lamp", "lamp.js"),
      `export const metadata = { id: "props.lamp", label: "Lamp", category: "props" };
export function createAsset({ THREE }) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1), new THREE.MeshStandardMaterial({ color: 0x888888 })));
  return group;
}
`
    );
    const asset: AssetCatalogEntry = {
      id: "props.lamp",
      label: "Lamp",
      category: "props",
      source: "shared",
      implementation: "module",
      moduleUrl: "/assets/props/lamp/lamp.js"
    };

    const result = await resolveAssetGeometry(asset, asset.id, assetRoot);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    let meshCount = 0;
    result.object.traverse((node) => {
      if (node instanceof THREE.Mesh) meshCount += 1;
    });
    expect(meshCount).toBe(1);
  });
});

describe("unsupportedNodeDiagnostics", () => {
  test("flags a skinned mesh by name", () => {
    const bones = [new THREE.Bone()];
    const skeleton = new THREE.Skeleton(bones);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = "rig";
    mesh.bind(skeleton);
    const root = new THREE.Group();
    root.add(mesh);

    expect(unsupportedNodeDiagnostics(root, "characters.walker")).toEqual([
      'Asset characters.walker node "rig" is a skinned mesh, which the environment exporter does not support.'
    ]);
  });

  test("flags a custom shader material by name", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.ShaderMaterial());
    mesh.name = "glow";
    const root = new THREE.Group();
    root.add(mesh);

    expect(unsupportedNodeDiagnostics(root, "fx.glow")).toEqual([
      'Asset fx.glow node "glow" uses a custom shader material, which GLB export cannot represent.'
    ]);
  });

  test("passes a plain static mesh", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const root = new THREE.Group();
    root.add(mesh);

    expect(unsupportedNodeDiagnostics(root, "props.crate")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/environmentAssetGeometrySource.test.ts`
Expected: FAIL — "Cannot find module '../src/environment/assetGeometrySource'"

- [ ] **Step 4: Write minimal implementation**

Create `src/environment/nodeGltfShim.ts`:

```typescript
import { createCanvas, Image } from "canvas";

/**
 * GLTFLoader/GLTFExporter call document.createElement("canvas") and expect an Image global when
 * decoding/encoding embedded texture images. Real Node has neither (unlike Vitest's jsdom test
 * environment) — this polyfills exactly those two hooks with node-canvas's implementations.
 */
if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  (globalThis as { document?: unknown }).document = {
    createElement(tag: string) {
      if (tag === "canvas") return createCanvas(1, 1);
      throw new Error(`document.createElement("${tag}") is not supported in the Node environment compiler.`);
    }
  };
}
if (typeof (globalThis as { Image?: unknown }).Image === "undefined") {
  (globalThis as { Image?: unknown }).Image = Image;
}
```

Create `src/environment/assetGeometrySource.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { createPlaceholder } from "../engine/AssetManager";
import "./nodeGltfShim";

export type AssetGeometryResult = { status: "resolved"; object: THREE.Object3D } | { status: "error"; diagnostics: string[] };

interface AssetModule {
  createAsset?: (context: { THREE: typeof THREE; directoryUrl: string; modelUrl?: string }) => Promise<THREE.Object3D> | THREE.Object3D;
}

/** Resolves a catalog entry to a static Three.js object graph in Node, the way AssetManager does in the browser. */
export async function resolveAssetGeometry(asset: AssetCatalogEntry | undefined, assetId: string, assetRoot: string): Promise<AssetGeometryResult> {
  if (!asset) return { status: "error", diagnostics: [`Asset ${assetId} is not present in the catalog.`] };

  try {
    const object = await loadAssetObject(asset, assetRoot);
    const diagnostics = unsupportedNodeDiagnostics(object, asset.id);
    return diagnostics.length ? { status: "error", diagnostics } : { status: "resolved", object };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", diagnostics: [`Could not resolve asset ${asset.id}: ${message}`] };
  }
}

async function loadAssetObject(asset: AssetCatalogEntry, assetRoot: string): Promise<THREE.Object3D> {
  if (asset.implementation === "glb" && asset.modelUrl) {
    const bytes = await readFile(assetFilePath(assetRoot, asset.modelUrl));
    const loader = new GLTFLoader();
    return await new Promise<THREE.Object3D>((resolve, reject) => {
      loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", (gltf) => resolve(gltf.scene), reject);
    });
  }

  if (asset.implementation === "module" && asset.moduleUrl) {
    const modulePath = assetFilePath(assetRoot, asset.moduleUrl);
    const module = (await import(pathToFileURL(modulePath).href)) as AssetModule;
    if (!module.createAsset) throw new Error(`${asset.moduleUrl} does not export createAsset.`);
    return await module.createAsset({ THREE, directoryUrl: "", modelUrl: asset.modelUrl });
  }

  return createPlaceholder(asset);
}

function assetFilePath(assetRoot: string, url: string): string {
  const relative = decodeURIComponent(url.replace(/^\/assets\//, ""));
  return join(assetRoot, ...relative.split("/"));
}

/** Names the object/asset so the diagnostic can be fixed at the source, per the design's asset-geometry-source contract. */
export function unsupportedNodeDiagnostics(object: THREE.Object3D, assetId: string): string[] {
  const diagnostics: string[] = [];

  object.traverse((node) => {
    const name = node.name || "unnamed";
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
      diagnostics.push(`Asset ${assetId} node "${name}" is a skinned mesh, which the environment exporter does not support.`);
      return;
    }
    if (!(node instanceof THREE.Mesh)) return;

    const positionMorphs = (node.geometry as THREE.BufferGeometry).morphAttributes?.position;
    if (positionMorphs && positionMorphs.length > 0) {
      diagnostics.push(`Asset ${assetId} node "${name}" has morph targets, which the environment exporter does not support.`);
    }

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material instanceof THREE.ShaderMaterial || material instanceof THREE.RawShaderMaterial) {
        diagnostics.push(`Asset ${assetId} node "${name}" uses a custom shader material, which GLB export cannot represent.`);
      }
    }
  });

  return diagnostics;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/environmentAssetGeometrySource.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/environment/nodeGltfShim.ts src/environment/assetGeometrySource.ts tests/environmentAssetGeometrySource.test.ts
git commit -m "feat: add Node-side asset geometry resolution for environment export"
```

---

### Task 2: Chunk assignment

**Files:**
- Create: `src/environment/chunking.ts`
- Test: `tests/environmentChunking.test.ts`

**Interfaces:**
- Consumes: `SceneRecipe`, `RecipeCell`, `RecipeObject`, `WorldBounds` from `./types` (foundation plan).
- Produces: `ChunkAssignment = { chunks: readonly { id: string; bounds: WorldBounds }[]; cellChunkIds: ReadonlyMap<string, string>; objectChunkIds: ReadonlyMap<string, string>; groundChunkIds: readonly string[] }`; `assignChunks(recipe: SceneRecipe, chunkSize: number): ChunkAssignment`. Tasks 3 (`geometryCompiler.ts`) and 7 (`manifestBuilder.ts`) both consume this directly, so chunk IDs stay identical between the GLB's node names and the manifest's `chunkId` fields.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentChunking.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { assignChunks } from "../src/environment/chunking";
import type { SceneRecipe } from "../src/environment/types";

describe("assignChunks", () => {
  test("groups cells by column/row into chunkSize x chunkSize buckets and objects by world-space center", () => {
    const recipe = recipeFixture({
      grid: { width: 4, depth: 2, cellSize: 1, origin: { x: -2, y: 0, z: -1 } },
      cells: [
        { id: "c-0-0", column: 0, row: 0 },
        { id: "c-1-0", column: 1, row: 0 },
        { id: "c-2-0", column: 2, row: 0 },
        { id: "c-3-1", column: 3, row: 1 }
      ],
      objects: [{ id: "o-1", x: -1.5, z: -0.5 }, { id: "o-2", x: 1.5, z: 0.5 }]
    });

    const assignment = assignChunks(recipe, 2);

    expect(assignment.cellChunkIds.get("c-0-0")).toBe("chunk_0_0");
    expect(assignment.cellChunkIds.get("c-1-0")).toBe("chunk_0_0");
    expect(assignment.cellChunkIds.get("c-2-0")).toBe("chunk_1_0");
    expect(assignment.cellChunkIds.get("c-3-1")).toBe("chunk_1_0");
    expect(assignment.objectChunkIds.get("o-1")).toBe("chunk_0_0");
    expect(assignment.objectChunkIds.get("o-2")).toBe("chunk_1_0");
    expect(assignment.chunks.map((chunk) => chunk.id).sort()).toEqual(["chunk_0_0", "chunk_1_0"]);
    expect(assignment.groundChunkIds.sort()).toEqual(["chunk_0_0", "chunk_1_0"]);
  });

  test("chunkSize 0 puts every record into a single chunk", () => {
    const recipe = recipeFixture({
      grid: { width: 4, depth: 2, cellSize: 1, origin: { x: -2, y: 0, z: -1 } },
      cells: [{ id: "c-0-0", column: 0, row: 0 }, { id: "c-3-1", column: 3, row: 1 }],
      objects: [{ id: "o-1", x: 10, z: 10 }]
    });

    const assignment = assignChunks(recipe, 0);

    expect(assignment.chunks).toHaveLength(1);
    expect(assignment.chunks[0].id).toBe("chunk_0_0");
    expect(assignment.cellChunkIds.get("c-0-0")).toBe("chunk_0_0");
    expect(assignment.cellChunkIds.get("c-3-1")).toBe("chunk_0_0");
    expect(assignment.objectChunkIds.get("o-1")).toBe("chunk_0_0");
  });

  test("a chunk's bounds cover every record center-assigned to it, including a full cell footprint", () => {
    const recipe = recipeFixture({
      grid: { width: 2, depth: 1, cellSize: 2, origin: { x: -2, y: 0, z: -1 } },
      cells: [{ id: "c-0-0", column: 0, row: 0 }],
      objects: []
    });

    const assignment = assignChunks(recipe, 10);

    const bounds = assignment.chunks[0].bounds;
    expect(bounds.min.x).toBeLessThanOrEqual(-2);
    expect(bounds.max.x).toBeGreaterThanOrEqual(0);
  });
});

function recipeFixture(options: {
  grid: SceneRecipe["grid"];
  cells: { id: string; column: number; row: number }[];
  objects: { id: string; x: number; z: number }[];
}): SceneRecipe {
  return {
    grid: options.grid,
    generationRuns: [],
    cells: options.cells.map((cell) => ({
      id: cell.id,
      column: cell.column,
      row: cell.row,
      transform: {
        position: {
          x: options.grid.origin.x + (cell.column + 0.5) * options.grid.cellSize,
          y: 0,
          z: options.grid.origin.z + (cell.row + 0.5) * options.grid.cellSize
        },
        rotationY: 0,
        scale: 1
      },
      sourceAssetId: "tiles.a",
      semanticRoles: [],
      sourceLayer: "scene",
      recovered: false
    })),
    objects: options.objects.map((object) => ({
      id: object.id,
      name: object.id,
      transform: { position: { x: object.x, y: 0, z: object.z }, rotationY: 0, scale: 1 },
      sourceAssetId: "props.cone",
      semanticRoles: [],
      sourceLayer: "scene"
    })),
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentChunking.test.ts`
Expected: FAIL — "Cannot find module '../src/environment/chunking'"

- [ ] **Step 3: Write minimal implementation**

Create `src/environment/chunking.ts`:

```typescript
import type { RecipeCell, RecipeObject, SceneRecipe, WorldBounds } from "./types";

export interface ChunkAssignment {
  chunks: readonly { id: string; bounds: WorldBounds }[];
  cellChunkIds: ReadonlyMap<string, string>;
  objectChunkIds: ReadonlyMap<string, string>;
  groundChunkIds: readonly string[];
}

/** Assigns cells by grid coordinate and everything else by world-space center, per the design's chunking rule. */
export function assignChunks(recipe: SceneRecipe, chunkSize: number): ChunkAssignment {
  const { grid } = recipe;
  const chunkCellSpan = chunkSize > 0 ? chunkSize : Math.max(grid.width, grid.depth, 1);
  const chunkWorldSpan = chunkCellSpan * grid.cellSize;
  const bounds = new Map<string, { min: [number, number]; max: [number, number] }>();
  const cellChunkIds = new Map<string, string>();
  const objectChunkIds = new Map<string, string>();

  function chunkIdForCoordinate(cx: number, cz: number): string {
    return `chunk_${cx}_${cz}`;
  }

  function expandBounds(id: string, minX: number, minZ: number, maxX: number, maxZ: number) {
    const existing = bounds.get(id);
    if (!existing) {
      bounds.set(id, { min: [minX, minZ], max: [maxX, maxZ] });
      return;
    }
    existing.min[0] = Math.min(existing.min[0], minX);
    existing.min[1] = Math.min(existing.min[1], minZ);
    existing.max[0] = Math.max(existing.max[0], maxX);
    existing.max[1] = Math.max(existing.max[1], maxZ);
  }

  for (const cell of recipe.cells) {
    const cx = chunkSize > 0 ? Math.floor(cell.column / chunkSize) : 0;
    const cz = chunkSize > 0 ? Math.floor(cell.row / chunkSize) : 0;
    const id = chunkIdForCoordinate(cx, cz);
    cellChunkIds.set(cell.id, id);
    const minX = grid.origin.x + cell.column * grid.cellSize;
    const minZ = grid.origin.z + cell.row * grid.cellSize;
    expandBounds(id, minX, minZ, minX + grid.cellSize, minZ + grid.cellSize);
  }

  for (const object of recipe.objects) {
    const localX = object.transform.position.x - grid.origin.x;
    const localZ = object.transform.position.z - grid.origin.z;
    const cx = chunkSize > 0 ? Math.floor(localX / chunkWorldSpan) : 0;
    const cz = chunkSize > 0 ? Math.floor(localZ / chunkWorldSpan) : 0;
    const id = chunkIdForCoordinate(cx, cz);
    objectChunkIds.set(object.id, id);
    expandBounds(id, object.transform.position.x, object.transform.position.z, object.transform.position.x, object.transform.position.z);
  }

  const groundChunkIds = groundChunkIdsForGrid(grid, chunkCellSpan, chunkWorldSpan, chunkIdForCoordinate, expandBounds);

  const chunks = [...bounds.entries()].map(([id, box]) => ({
    id,
    bounds: { min: { x: box.min[0], y: 0, z: box.min[1] }, max: { x: box.max[0], y: 0, z: box.max[1] } }
  }));

  return { chunks, cellChunkIds, objectChunkIds, groundChunkIds };
}

function groundChunkIdsForGrid(
  grid: SceneRecipe["grid"],
  chunkCellSpan: number,
  chunkWorldSpan: number,
  chunkIdForCoordinate: (cx: number, cz: number) => string,
  expandBounds: (id: string, minX: number, minZ: number, maxX: number, maxZ: number) => void
): string[] {
  const columnsPerChunk = chunkCellSpan;
  const rowsPerChunk = chunkCellSpan;
  const chunkColumns = Math.ceil(grid.width / columnsPerChunk);
  const chunkRows = Math.ceil(grid.depth / rowsPerChunk);
  const ids: string[] = [];

  for (let cz = 0; cz < chunkRows; cz += 1) {
    for (let cx = 0; cx < chunkColumns; cx += 1) {
      const id = chunkIdForCoordinate(cx, cz);
      ids.push(id);
      const minX = grid.origin.x + cx * chunkWorldSpan;
      const minZ = grid.origin.z + cz * chunkWorldSpan;
      const maxX = Math.min(minX + chunkWorldSpan, grid.origin.x + grid.width * grid.cellSize);
      const maxZ = Math.min(minZ + chunkWorldSpan, grid.origin.z + grid.depth * grid.cellSize);
      expandBounds(id, minX, minZ, maxX, maxZ);
    }
  }

  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentChunking.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/environment/chunking.ts tests/environmentChunking.test.ts
git commit -m "feat: add spatial chunk assignment for environment export"
```

---

### Task 3: Geometry compiler — flatten, instance, merge

**Files:**
- Create: `src/environment/geometryCompiler.ts`
- Test: `tests/environmentGeometryCompiler.test.ts`

**Interfaces:**
- Consumes: `SceneRecipe`, `RecipeCell`, `RecipeObject` from `./types`; `AssetCatalogEntry` from `../editor-core/assets`; `resolveAssetGeometry` from `./assetGeometrySource` (Task 1); `ChunkAssignment` from `./chunking` (Task 2); `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`.
- Produces: `CompiledGeometry = { root: THREE.Group; diagnostics: readonly string[]; stats: { meshCount: number; instancedMeshCount: number; triangleCount: number } }`; `compileGeometry(recipe: SceneRecipe, assets: readonly AssetCatalogEntry[], chunkAssignment: ChunkAssignment, assetRoot: string): Promise<CompiledGeometry>`. Task 4 (seam removal) runs on `root` before Task 5 (GLB export) reads it; Task 7 (manifest builder) reads `stats` for diagnostics/metrics.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentGeometryCompiler.test.ts`:

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as THREE from "three";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { assignChunks } from "../src/environment/chunking";
import { compileGeometry } from "../src/environment/geometryCompiler";
import type { SceneRecipe } from "../src/environment/types";

describe("compileGeometry", () => {
  let assetRoot: string;

  afterEach(async () => {
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  test("instances repeated placeholder placements of the same asset within a chunk into one InstancedMesh", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const assets: AssetCatalogEntry[] = [{ id: "props.cone", label: "Cone", category: "props", source: "shared", implementation: "placeholder" }];
    const recipe = recipeWithObjects([
      { id: "o-1", x: 0, z: 0 },
      { id: "o-2", x: 2, z: 0 },
      { id: "o-3", x: 4, z: 0 }
    ]);
    const chunkAssignment = assignChunks(recipe, 0);

    const compiled = await compileGeometry(recipe, assets, chunkAssignment, assetRoot);

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.stats.instancedMeshCount).toBe(1);
    expect(compiled.stats.meshCount).toBe(1);
    let instancedMesh: THREE.InstancedMesh | null = null;
    compiled.root.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) instancedMesh = node;
    });
    expect(instancedMesh).not.toBeNull();
    expect((instancedMesh as unknown as THREE.InstancedMesh).count).toBe(3);
  });

  test("merges a single placement per chunk instead of instancing it", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const assets: AssetCatalogEntry[] = [{ id: "props.cone", label: "Cone", category: "props", source: "shared", implementation: "placeholder" }];
    const recipe = recipeWithObjects([{ id: "o-1", x: 0, z: 0 }]);
    const chunkAssignment = assignChunks(recipe, 0);

    const compiled = await compileGeometry(recipe, assets, chunkAssignment, assetRoot);

    expect(compiled.stats.instancedMeshCount).toBe(0);
    expect(compiled.stats.meshCount).toBe(1);
  });

  test("keeps geometry in separate chunk groups even when the same asset repeats across chunks", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const assets: AssetCatalogEntry[] = [{ id: "props.cone", label: "Cone", category: "props", source: "shared", implementation: "placeholder" }];
    const recipe = recipeWithObjects([
      { id: "o-1", x: 0, z: 0 },
      { id: "o-2", x: 100, z: 0 }
    ]);
    const chunkAssignment = assignChunks(recipe, 1);

    const compiled = await compileGeometry(recipe, assets, chunkAssignment, assetRoot);

    expect(compiled.root.children.length).toBeGreaterThanOrEqual(2);
    expect(compiled.stats.instancedMeshCount + compiled.stats.meshCount).toBeGreaterThanOrEqual(2);
  });

  test("collects a diagnostic naming the object and asset when an asset cannot be resolved, and stops", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const recipe = recipeWithObjects([{ id: "o-1", x: 0, z: 0 }]);
    const chunkAssignment = assignChunks(recipe, 0);

    const compiled = await compileGeometry(recipe, [], chunkAssignment, assetRoot);

    expect(compiled.diagnostics).toEqual(["Asset props.cone is not present in the catalog."]);
  });
});

function recipeWithObjects(objects: { id: string; x: number; z: number }[]): SceneRecipe {
  return {
    grid: { width: 10, depth: 10, cellSize: 1, origin: { x: -5, y: 0, z: -5 } },
    generationRuns: [],
    cells: [],
    objects: objects.map((object) => ({
      id: object.id,
      name: object.id,
      transform: { position: { x: object.x, y: 0, z: object.z }, rotationY: 0, scale: 1 },
      sourceAssetId: "props.cone",
      semanticRoles: [],
      sourceLayer: "scene"
    })),
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentGeometryCompiler.test.ts`
Expected: FAIL — "Cannot find module '../src/environment/geometryCompiler'"

- [ ] **Step 3: Write minimal implementation**

Create `src/environment/geometryCompiler.ts`:

```typescript
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { resolveAssetGeometry } from "./assetGeometrySource";
import type { ChunkAssignment } from "./chunking";
import type { RecipeCell, RecipeObject, SceneRecipe } from "./types";

export interface CompiledGeometry {
  root: THREE.Group;
  diagnostics: readonly string[];
  stats: { meshCount: number; instancedMeshCount: number; triangleCount: number };
}

interface FlattenedPrimitive {
  chunkId: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  transparent: boolean;
}

/** Resolves each referenced asset once, bakes every record's world transform, then instances/merges per chunk. */
export async function compileGeometry(
  recipe: SceneRecipe,
  assets: readonly AssetCatalogEntry[],
  chunkAssignment: ChunkAssignment,
  assetRoot: string
): Promise<CompiledGeometry> {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const referencedAssetIds = new Set([...recipe.cells.map((cell) => cell.sourceAssetId), ...recipe.objects.map((object) => object.sourceAssetId)]);

  const templates = new Map<string, THREE.Object3D>();
  const diagnostics: string[] = [];
  for (const assetId of referencedAssetIds) {
    const result = await resolveAssetGeometry(assetsById.get(assetId), assetId, assetRoot);
    if (result.status === "error") {
      diagnostics.push(...result.diagnostics);
      continue;
    }
    templates.set(assetId, result.object);
  }
  if (diagnostics.length) return { root: new THREE.Group(), diagnostics, stats: { meshCount: 0, instancedMeshCount: 0, triangleCount: 0 } };

  const primitives: FlattenedPrimitive[] = [
    ...recipe.cells.flatMap((cell) => flattenRecord(cell, chunkAssignment.cellChunkIds.get(cell.id)!, templates.get(cell.sourceAssetId)!)),
    ...recipe.objects.flatMap((object) => flattenRecord(object, chunkAssignment.objectChunkIds.get(object.id)!, templates.get(object.sourceAssetId)!))
  ];

  const root = new THREE.Group();
  root.name = "SteerlabEnvironment";
  let meshCount = 0;
  let instancedMeshCount = 0;
  let triangleCount = 0;

  const byChunk = groupBy(primitives, (primitive) => primitive.chunkId);
  for (const [chunkId, chunkPrimitives] of byChunk) {
    const chunkGroup = new THREE.Group();
    chunkGroup.name = chunkId;
    root.add(chunkGroup);

    const byGeometryMaterial = groupBy(chunkPrimitives, (primitive) => `${primitive.geometry.uuid}::${primitive.material.uuid}`);
    for (const group of byGeometryMaterial.values()) {
      const { geometry, material, transparent } = group[0];
      const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;

      if (group.length > 1 && !transparent) {
        const instanced = new THREE.InstancedMesh(geometry, material, group.length);
        group.forEach((primitive, index) => instanced.setMatrixAt(index, primitive.matrix));
        instanced.instanceMatrix.needsUpdate = true;
        chunkGroup.add(instanced);
        instancedMeshCount += 1;
        triangleCount += triangles * group.length;
      } else if (group.length > 1) {
        for (const primitive of group) {
          const mesh = new THREE.Mesh(primitive.geometry, primitive.material);
          mesh.applyMatrix4(primitive.matrix);
          chunkGroup.add(mesh);
          meshCount += 1;
          triangleCount += triangles;
        }
      } else {
        const primitive = group[0];
        const mesh = new THREE.Mesh(primitive.geometry, primitive.material);
        mesh.applyMatrix4(primitive.matrix);
        chunkGroup.add(mesh);
        meshCount += 1;
        triangleCount += triangles;
      }
    }
  }

  mergeCompatibleSingletons(root);

  return { root, diagnostics: [], stats: { meshCount, instancedMeshCount, triangleCount } };
}

function flattenRecord(record: RecipeCell | RecipeObject, chunkId: string, template: THREE.Object3D): FlattenedPrimitive[] {
  const instance = template.clone(true);
  instance.position.set(record.transform.position.x, record.transform.position.y, record.transform.position.z);
  instance.rotation.set(0, record.transform.rotationY, 0);
  instance.scale.setScalar(record.transform.scale);
  instance.updateMatrixWorld(true);

  const primitives: FlattenedPrimitive[] = [];
  instance.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      primitives.push({
        chunkId,
        geometry: node.geometry,
        material,
        matrix: node.matrixWorld.clone(),
        transparent: material.transparent
      });
    }
  });
  return primitives;
}

/** Merges same-chunk, same-material singleton meshes (groups of exactly one) into fewer draw calls, skipping transparents. */
function mergeCompatibleSingletons(root: THREE.Group) {
  for (const chunkGroup of root.children) {
    const singletons = chunkGroup.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && !child.material.transparent
    );
    const byMaterial = groupBy(singletons, (mesh) => (Array.isArray(mesh.material) ? mesh.material.map((m) => m.uuid).join(",") : mesh.material.uuid));

    for (const meshes of byMaterial.values()) {
      if (meshes.length < 2) continue;
      const bakedGeometries = meshes.map((mesh) => {
        const baked = mesh.geometry.clone();
        baked.applyMatrix4(mesh.matrix);
        return baked;
      });
      const merged = mergeGeometries(bakedGeometries, false);
      if (!merged) continue;
      for (const mesh of meshes) chunkGroup.remove(mesh);
      const mergedMesh = new THREE.Mesh(merged, meshes[0].material);
      chunkGroup.add(mergedMesh);
    }
  }
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const group = groups.get(groupKey);
    if (group) group.push(item);
    else groups.set(groupKey, [item]);
  }
  return groups;
}
```

Note: the merge step reduces the mesh count in `chunkGroup.children` but the plan's `meshCount`/`instancedMeshCount` stats are computed before merging (they describe the pre-merge grouping decision, i.e. how many singleton vs. instanced groups the instancing pass produced) — Task 7's manifest builder recomputes final per-chunk node counts by walking `compiled.root` directly for accurate export metrics, so this stat is only used for the "collects a diagnostic" and "instances repeated placements" test assertions above, not for the CLI's final printed metrics (Task 8 in the CLI plan recomputes those from the exported GLB).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentGeometryCompiler.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/environment/geometryCompiler.ts tests/environmentGeometryCompiler.test.ts
git commit -m "feat: add geometry flatten/instance/merge compiler stage"
```

---

### Task 4: Seam-face removal pass

**Files:**
- Create: `src/environment/seamRemoval.ts`
- Test: `tests/environmentSeamRemoval.test.ts`

**Interfaces:**
- Consumes: `THREE.Group` (a compiled root before instancing — see note below); `SceneRecipe`; `ChunkAssignment` is not needed here (seam matching is purely geometric, cell-adjacency comes from `recipe.cells`).
- Produces: `SeamRemovalResult = { removedTriangleCount: number; removedVertexCount: number }`; `removeInternalSeamFaces(cellMeshesByCellId: ReadonlyMap<string, THREE.Mesh[]>, recipe: SceneRecipe): SeamRemovalResult` — mutates the passed meshes' geometries in place. Task 8 (`compiler.ts`) calls this **before** Task 3's `compileGeometry` grouping step, on the per-cell flattened meshes, per the design's stage ordering ("Apply the seam-removal pass" is stage 3, before "Group repeated primitives" is stage 6). To keep Task 3 self-contained and testable without a seam dependency, this task exposes seam removal as a standalone function over an explicit `cellMeshesByCellId` map that Task 8's orchestrator builds by calling the same per-record flattening `compileGeometry` uses internally — Task 8 restructures `geometryCompiler.ts` minimally (Step 5 below) to expose that intermediate map.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentSeamRemoval.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { removeInternalSeamFaces } from "../src/environment/seamRemoval";
import type { SceneRecipe } from "../src/environment/types";

describe("removeInternalSeamFaces", () => {
  test("removes a matching pair of opposite triangles on the shared boundary between north/east-adjacent cells", () => {
    const recipe = recipeWithAdjacentCells();
    const westMesh = boxMesh({ x: 0, z: 0 });
    const eastMesh = boxMesh({ x: 1, z: 0 });
    const cellMeshesByCellId = new Map([
      ["c-0-0", [westMesh]],
      ["c-1-0", [eastMesh]]
    ]);
    const trianglesBefore = triangleCount(westMesh) + triangleCount(eastMesh);

    const result = removeInternalSeamFaces(cellMeshesByCellId, recipe);

    expect(result.removedTriangleCount).toBeGreaterThan(0);
    expect(triangleCount(westMesh) + triangleCount(eastMesh)).toBeLessThan(trianglesBefore);
  });

  test("leaves triangles alone when cells are not grid-adjacent", () => {
    const recipe = recipeWithFarCells();
    const meshA = boxMesh({ x: 0, z: 0 });
    const meshB = boxMesh({ x: 10, z: 0 });
    const cellMeshesByCellId = new Map([
      ["c-0-0", [meshA]],
      ["c-9-0", [meshB]]
    ]);
    const trianglesBefore = triangleCount(meshA) + triangleCount(meshB);

    const result = removeInternalSeamFaces(cellMeshesByCellId, recipe);

    expect(result.removedTriangleCount).toBe(0);
    expect(triangleCount(meshA) + triangleCount(meshB)).toBe(trianglesBefore);
  });

  test("does not touch a transparent material's geometry", () => {
    const recipe = recipeWithAdjacentCells();
    const westMesh = boxMesh({ x: 0, z: 0 }, { transparent: true });
    const eastMesh = boxMesh({ x: 1, z: 0 }, { transparent: true });
    const cellMeshesByCellId = new Map([
      ["c-0-0", [westMesh]],
      ["c-1-0", [eastMesh]]
    ]);

    const result = removeInternalSeamFaces(cellMeshesByCellId, recipe);

    expect(result.removedTriangleCount).toBe(0);
  });
});

function boxMesh(center: { x: number; z: number }, materialOptions: THREE.MeshStandardMaterialParameters = {}): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(center.x, 0.5, center.z);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(materialOptions));
  mesh.updateMatrixWorld(true);
  return mesh;
}

function triangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

function recipeWithAdjacentCells(): SceneRecipe {
  return recipeWithCells([
    { id: "c-0-0", column: 0, row: 0 },
    { id: "c-1-0", column: 1, row: 0 }
  ]);
}

function recipeWithFarCells(): SceneRecipe {
  return recipeWithCells([
    { id: "c-0-0", column: 0, row: 0 },
    { id: "c-9-0", column: 9, row: 0 }
  ]);
}

function recipeWithCells(cells: { id: string; column: number; row: number }[]): SceneRecipe {
  return {
    grid: { width: 10, depth: 1, cellSize: 1, origin: { x: 0, y: 0, z: 0 } },
    generationRuns: [],
    cells: cells.map((cell) => ({
      id: cell.id,
      column: cell.column,
      row: cell.row,
      transform: { position: { x: cell.column, y: 0, z: cell.row }, rotationY: 0, scale: 1 },
      sourceAssetId: "tiles.a",
      semanticRoles: [],
      sourceLayer: "scene",
      recovered: false
    })),
    objects: [],
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentSeamRemoval.test.ts`
Expected: FAIL — "Cannot find module '../src/environment/seamRemoval'"

- [ ] **Step 3: Write minimal implementation**

Create `src/environment/seamRemoval.ts`:

```typescript
import * as THREE from "three";
import type { RecipeCell, SceneRecipe } from "./types";

export interface SeamRemovalResult {
  removedTriangleCount: number;
  removedVertexCount: number;
}

const EPSILON = 1e-3;

/**
 * Removes matching opposite-facing triangle pairs on the shared vertical boundary between
 * grid-adjacent cells (north/east pairs only, so each seam is visited once). Only opaque, static,
 * fully-overlapping side faces qualify — top/bottom faces, the ground, transparent materials, and
 * partial overlaps are left untouched, per the design's seam-removal contract.
 */
export function removeInternalSeamFaces(cellMeshesByCellId: ReadonlyMap<string, THREE.Mesh[]>, recipe: SceneRecipe): SeamRemovalResult {
  const cellsByCoordinate = new Map(recipe.cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
  let removedTriangleCount = 0;
  let removedVertexCount = 0;

  for (const cell of recipe.cells) {
    for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
      const neighbor = cellsByCoordinate.get(`${cell.column + dc},${cell.row + dr}`);
      if (!neighbor) continue;

      const cellMeshes = (cellMeshesByCellId.get(cell.id) ?? []).filter((mesh) => !isTransparent(mesh));
      const neighborMeshes = (cellMeshesByCellId.get(neighbor.id) ?? []).filter((mesh) => !isTransparent(mesh));
      const boundaryX = midpointX(cell, neighbor, recipe.grid.cellSize, dc);
      const boundaryZ = midpointZ(cell, neighbor, recipe.grid.cellSize, dr);

      for (const cellMesh of cellMeshes) {
        for (const neighborMesh of neighborMeshes) {
          const result = removeMatchingTrianglePairs(cellMesh, neighborMesh, boundaryX, boundaryZ, recipe.grid.cellSize);
          removedTriangleCount += result.removedTriangleCount;
          removedVertexCount += result.removedVertexCount;
        }
      }
    }
  }

  return { removedTriangleCount, removedVertexCount };
}

function isTransparent(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((material) => material.transparent);
}

function midpointX(cell: RecipeCell, neighbor: RecipeCell, cellSize: number, dc: number): number | null {
  return dc === 1 ? (cell.transform.position.x + neighbor.transform.position.x) / 2 : null;
}

function midpointZ(cell: RecipeCell, neighbor: RecipeCell, cellSize: number, dr: number): number | null {
  return dr === 1 ? (cell.transform.position.z + neighbor.transform.position.z) / 2 : null;
}

function removeMatchingTrianglePairs(
  meshA: THREE.Mesh,
  meshB: THREE.Mesh,
  boundaryX: number | null,
  boundaryZ: number | null,
  cellSize: number
): SeamRemovalResult {
  const trianglesA = boundaryTriangles(meshA, boundaryX, boundaryZ, cellSize);
  const trianglesB = boundaryTriangles(meshB, boundaryX, boundaryZ, cellSize);
  const removeA = new Set<number>();
  const removeB = new Set<number>();

  for (const triangleA of trianglesA) {
    for (const triangleB of trianglesB) {
      if (removeB.has(triangleB.index)) continue;
      if (trianglesMatch(triangleA, triangleB)) {
        removeA.add(triangleA.index);
        removeB.add(triangleB.index);
        break;
      }
    }
  }

  const removedFromA = removeTriangles(meshA, removeA);
  const removedFromB = removeTriangles(meshB, removeB);
  return {
    removedTriangleCount: removeA.size + removeB.size,
    removedVertexCount: removedFromA + removedFromB
  };
}

interface BoundaryTriangle {
  index: number;
  vertices: THREE.Vector3[];
  normal: THREE.Vector3;
}

function boundaryTriangles(mesh: THREE.Mesh, boundaryX: number | null, boundaryZ: number | null, cellSize: number): BoundaryTriangle[] {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const triangles: BoundaryTriangle[] = [];

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const [ia, ib, ic] = index
      ? [index.getX(triangleIndex * 3), index.getX(triangleIndex * 3 + 1), index.getX(triangleIndex * 3 + 2)]
      : [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2];
    const vertices = [ia, ib, ic].map((vertexIndex) => new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld));

    const onBoundary = vertices.every(
      (vertex) => (boundaryX === null || Math.abs(vertex.x - boundaryX) < EPSILON * cellSize) && (boundaryZ === null || Math.abs(vertex.z - boundaryZ) < EPSILON * cellSize)
    );
    if (!onBoundary) continue;

    const normal = new THREE.Triangle(vertices[0], vertices[1], vertices[2]).getNormal(new THREE.Vector3());
    if (Math.abs(normal.y) > 0.1) continue; // side faces only, not top/bottom

    triangles.push({ index: triangleIndex, vertices, normal });
  }

  return triangles;
}

function trianglesMatch(a: BoundaryTriangle, b: BoundaryTriangle): boolean {
  const oppositeNormals = a.normal.dot(b.normal) < -0.99;
  if (!oppositeNormals) return false;

  const unmatched = [...b.vertices];
  for (const vertex of a.vertices) {
    const matchIndex = unmatched.findIndex((candidate) => candidate.distanceTo(vertex) < EPSILON);
    if (matchIndex === -1) return false;
    unmatched.splice(matchIndex, 1);
  }
  return unmatched.length === 0;
}

function removeTriangles(mesh: THREE.Mesh, triangleIndices: Set<number>): number {
  if (!triangleIndices.size) return 0;
  const geometry = mesh.geometry;
  const index = geometry.index;
  if (!index) return 0;

  const keptIndices: number[] = [];
  const totalTriangles = index.count / 3;
  for (let triangleIndex = 0; triangleIndex < totalTriangles; triangleIndex += 1) {
    if (triangleIndices.has(triangleIndex)) continue;
    keptIndices.push(index.getX(triangleIndex * 3), index.getX(triangleIndex * 3 + 1), index.getX(triangleIndex * 3 + 2));
  }
  geometry.setIndex(keptIndices);
  return triangleIndices.size * 3;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentSeamRemoval.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/environment/seamRemoval.ts tests/environmentSeamRemoval.test.ts
git commit -m "feat: add optional internal seam-face removal pass"
```

---

### Task 5: GLB export

**Files:**
- Create: `src/environment/glbExporter.ts`
- Test: `tests/environmentGlbExporter.test.ts`

**Interfaces:**
- Consumes: `THREE.Group` (the compiled root from Task 3, named `"SteerlabEnvironment"`); `readGlbInfo` from `./glb` (foundation plan) for the round-trip assertion in the test.
- Produces: `exportGlb(root: THREE.Object3D): Promise<Uint8Array>`. Task 8 (`compiler.ts`) calls this last, after seam removal.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentGlbExporter.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { exportGlb } from "../src/environment/glbExporter";
import { readGlbInfo } from "../src/environment/glb";

describe("exportGlb", () => {
  test("exports a named root with a mesh child as a valid GLB whose root node name round-trips", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x7d8aa2 })));

    const glb = await exportGlb(root);

    const info = readGlbInfo(glb);
    expect(info.valid).toBe(true);
    expect(info.nodeNames).toContain("SteerlabEnvironment");
  });

  test("exports an InstancedMesh child without throwing", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 2);
    instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
    instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0));
    root.add(instanced);

    const glb = await exportGlb(root);

    expect(readGlbInfo(glb).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentGlbExporter.test.ts`
Expected: FAIL — "Cannot find module '../src/environment/glbExporter'"

- [ ] **Step 3: Write minimal implementation**

Create `src/environment/glbExporter.ts`:

```typescript
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import "./nodeGltfShim";

/** Exports a compiled environment root (named "SteerlabEnvironment") as binary GLB bytes. */
export function exportGlb(root: THREE.Object3D): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => resolve(new Uint8Array(result as ArrayBuffer)),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, embedImages: true }
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentGlbExporter.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/environment/glbExporter.ts tests/environmentGlbExporter.test.ts
git commit -m "feat: add GLB export for compiled environment geometry"
```

---

### Task 6: Asset table with content hashing

**Files:**
- Create: `src/environment/assetTable.ts`
- Test: `tests/environmentAssetTable.test.ts`

**Interfaces:**
- Consumes: `AssetCatalogEntry` from `../editor-core/assets`; `SceneRecipe` from `./types`; `sha256Hex` from `./manifestEncoder` (foundation plan).
- Produces: `buildAssetTable(recipe: SceneRecipe, assets: readonly AssetCatalogEntry[], assetRoot: string): Promise<EnvironmentManifestAsset[]>`. Task 7 (`manifestBuilder.ts`) merges this table's `contentHash` into each cell/object record's `assetContentHash`.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentAssetTable.test.ts`:

```typescript
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { buildAssetTable } from "../src/environment/assetTable";
import { sha256Hex } from "../src/environment/manifestEncoder";
import type { SceneRecipe } from "../src/environment/types";

describe("buildAssetTable", () => {
  let assetRoot: string;

  afterEach(async () => {
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  test("hashes a GLB asset's file bytes and snapshots its label/category/roles", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    await mkdir(join(assetRoot, "tiles", "a"), { recursive: true });
    const glbBytes = Buffer.from([1, 2, 3, 4]);
    await writeFile(join(assetRoot, "tiles", "a", "a.glb"), glbBytes);
    const assets: AssetCatalogEntry[] = [
      {
        id: "tiles.a",
        label: "Tile A",
        category: "tiles",
        source: "shared",
        implementation: "glb",
        modelUrl: "/assets/tiles/a/a.glb",
        semantics: { roles: ["road.surface"], sockets: {} }
      }
    ];
    const recipe = recipeReferencing(["tiles.a"]);

    const table = await buildAssetTable(recipe, assets, assetRoot);

    expect(table).toEqual([
      { id: "tiles.a", label: "Tile A", category: "tiles", contentHash: sha256Hex(glbBytes), semanticRoles: ["road.surface"] }
    ]);
  });

  test("hashes a module asset's source text", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    await mkdir(join(assetRoot, "props", "lamp"), { recursive: true });
    const source = "export function createAsset() {}\n";
    await writeFile(join(assetRoot, "props", "lamp", "lamp.js"), source);
    const assets: AssetCatalogEntry[] = [
      { id: "props.lamp", label: "Lamp", category: "props", source: "shared", implementation: "module", moduleUrl: "/assets/props/lamp/lamp.js" }
    ];
    const recipe = recipeReferencing(["props.lamp"]);

    const table = await buildAssetTable(recipe, assets, assetRoot);

    expect(table[0].contentHash).toBe(sha256Hex(Buffer.from(source, "utf8")));
  });

  test("only includes assets actually referenced by the recipe, sorted by id", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const assets: AssetCatalogEntry[] = [
      { id: "props.b", label: "B", category: "props", source: "shared", implementation: "placeholder" },
      { id: "props.a", label: "A", category: "props", source: "shared", implementation: "placeholder" },
      { id: "props.unused", label: "Unused", category: "props", source: "shared", implementation: "placeholder" }
    ];
    const recipe = recipeReferencing(["props.b", "props.a"]);

    const table = await buildAssetTable(recipe, assets, assetRoot);

    expect(table.map((entry) => entry.id)).toEqual(["props.a", "props.b"]);
  });
});

function recipeReferencing(assetIds: string[]): SceneRecipe {
  return {
    grid: { width: 1, depth: 1, cellSize: 1, origin: { x: 0, y: 0, z: 0 } },
    generationRuns: [],
    cells: [],
    objects: assetIds.map((assetId, index) => ({
      id: `o-${index}`,
      name: `o-${index}`,
      transform: { position: { x: index, y: 0, z: 0 }, rotationY: 0, scale: 1 },
      sourceAssetId: assetId,
      semanticRoles: [],
      sourceLayer: "scene" as const
    })),
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentAssetTable.test.ts`
Expected: FAIL — "Cannot find module '../src/environment/assetTable'"

- [ ] **Step 3: Write minimal implementation**

Create `src/environment/assetTable.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { sha256Hex } from "./manifestEncoder";
import type { EnvironmentManifestAsset, SceneRecipe } from "./types";

/** Snapshots every asset referenced by the recipe, hashed by its source file bytes so the snapshot stays stable if the live catalog changes. */
export async function buildAssetTable(recipe: SceneRecipe, assets: readonly AssetCatalogEntry[], assetRoot: string): Promise<EnvironmentManifestAsset[]> {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const referencedIds = new Set([...recipe.cells.map((cell) => cell.sourceAssetId), ...recipe.objects.map((object) => object.sourceAssetId)]);

  const entries = await Promise.all(
    [...referencedIds].map(async (id) => {
      const asset = assetsById.get(id);
      if (!asset) throw new Error(`Asset ${id} is not present in the catalog.`);
      return {
        id: asset.id,
        label: asset.label,
        category: asset.category,
        contentHash: await contentHashForAsset(asset, assetRoot),
        semanticRoles: asset.semantics?.roles ?? []
      };
    })
  );

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

async function contentHashForAsset(asset: AssetCatalogEntry, assetRoot: string): Promise<string> {
  if (asset.implementation === "glb" && asset.modelUrl) return sha256Hex(await readFile(assetFilePath(assetRoot, asset.modelUrl)));
  if (asset.implementation === "module" && asset.moduleUrl) return sha256Hex(await readFile(assetFilePath(assetRoot, asset.moduleUrl)));
  return sha256Hex(Buffer.from(`placeholder:${asset.id}`, "utf8"));
}

function assetFilePath(assetRoot: string, url: string): string {
  const relative = decodeURIComponent(url.replace(/^\/assets\//, ""));
  return join(assetRoot, ...relative.split("/"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentAssetTable.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/environment/assetTable.ts tests/environmentAssetTable.test.ts
git commit -m "feat: add asset table with content hashing for environment export"
```

---

### Task 7: Manifest record assembly and navigation graph

**Files:**
- Create: `src/environment/manifestBuilder.ts`
- Create: `src/environment/navigationGraph.ts`
- Test: `tests/environmentManifestBuilder.test.ts`
- Test: `tests/environmentNavigationGraph.test.ts`

**Interfaces:**
- Consumes: `SceneRecipe`, `RecipeCell`, `RecipeObject`, `EnvironmentManifestCell`, `EnvironmentManifestObject`, `EnvironmentManifestGround`, `EnvironmentManifestAsset`, `EnvironmentManifestNavigationNode`, `EnvironmentManifestNavigationEdge`, `WorldBounds` from `./types`; `ChunkAssignment` from `./chunking` (Task 2); `AssetCatalogEntry`, `AssetSemantics` from `../editor-core/assets`/`../wfc/metadata/socketTypes`.
- Produces: `buildManifestRecords(recipe: SceneRecipe, chunkAssignment: ChunkAssignment, assetTable: readonly EnvironmentManifestAsset[]): { cells: EnvironmentManifestCell[]; objects: EnvironmentManifestObject[]; ground: EnvironmentManifestGround | null }`; `buildNavigationGraph(cells: readonly EnvironmentManifestCell[], recipe: SceneRecipe, assets: readonly AssetCatalogEntry[]): { nodes: EnvironmentManifestNavigationNode[]; edges: EnvironmentManifestNavigationEdge[] }`. Task 8 (`compiler.ts`) calls both, in that order (navigation nodes reference the cells `buildManifestRecords` just produced). `buildManifestRecords` takes no `assets` parameter — every field it needs (`semanticRoles`, `variantId`, etc.) is already on the `RecipeCell`/`RecipeObject` records themselves; only the navigation graph needs live catalog lookups (rotated socket data), which is why `buildNavigationGraph` alone takes `assets`.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentManifestBuilder.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { assignChunks } from "../src/environment/chunking";
import { buildManifestRecords } from "../src/environment/manifestBuilder";
import type { SceneRecipe } from "../src/environment/types";

describe("buildManifestRecords", () => {
  test("produces a manifest cell with world bounds, chunk ID, and asset content hash", () => {
    const recipe = recipeFixture();
    const chunkAssignment = assignChunks(recipe, 0);
    const assetTable = [{ id: "tiles.a", label: "Tile A", category: "tiles", contentHash: "hash-a", semanticRoles: ["road.surface"] }];

    const result = buildManifestRecords(recipe, chunkAssignment, assetTable);

    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]).toMatchObject({
      id: "c-0-0",
      column: 0,
      row: 0,
      sourceAssetId: "tiles.a",
      assetContentHash: "hash-a",
      semanticRoles: ["road.surface"],
      chunkId: "chunk_0_0",
      sourceLayer: "scene"
    });
    expect(result.cells[0].bounds.min.x).toBeLessThanOrEqual(result.cells[0].transform.position.x);
    expect(result.cells[0].bounds.max.x).toBeGreaterThanOrEqual(result.cells[0].transform.position.x);
  });

  test("produces ground bounds covering the whole grid and referencing every chunk", () => {
    const recipe = recipeFixture();
    const chunkAssignment = assignChunks(recipe, 0);

    const result = buildManifestRecords(recipe, chunkAssignment, []);

    expect(result.ground).not.toBeNull();
    expect(result.ground?.chunkIds).toEqual(["chunk_0_0"]);
    expect(result.ground?.material.color).toBe("#050608");
  });
});

function recipeFixture(): SceneRecipe {
  return {
    grid: { width: 1, depth: 1, cellSize: 1, origin: { x: -0.5, y: 0, z: -0.5 } },
    generationRuns: [],
    cells: [
      {
        id: "c-0-0",
        column: 0,
        row: 0,
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.a",
        semanticRoles: ["road.surface"],
        sourceLayer: "scene",
        recovered: false
      }
    ],
    objects: [],
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentManifestBuilder.test.ts`
Expected: FAIL — "Cannot find module '../src/environment/manifestBuilder'"

- [ ] **Step 3: Write minimal implementation**

Create `src/environment/manifestBuilder.ts`:

```typescript
import type { ChunkAssignment } from "./chunking";
import type {
  EnvironmentManifestAsset,
  EnvironmentManifestCell,
  EnvironmentManifestGround,
  EnvironmentManifestObject,
  RecipeCell,
  RecipeObject,
  SceneRecipe,
  WorldBounds
} from "./types";

const HALF_FOOTPRINT = 0.5;

export interface ManifestRecordsResult {
  cells: EnvironmentManifestCell[];
  objects: EnvironmentManifestObject[];
  ground: EnvironmentManifestGround | null;
}

/** Assembles per-record manifest fields (bounds, chunk ID, asset content hash) that a bare SceneRecipe doesn't carry. */
export function buildManifestRecords(
  recipe: SceneRecipe,
  chunkAssignment: ChunkAssignment,
  assetTable: readonly EnvironmentManifestAsset[]
): ManifestRecordsResult {
  const contentHashById = new Map(assetTable.map((asset) => [asset.id, asset.contentHash]));

  const cells = recipe.cells.map((cell) => manifestCell(cell, recipe.grid.cellSize, chunkAssignment, contentHashById));
  const objects = recipe.objects.map((object) => manifestObject(object, chunkAssignment, contentHashById));
  const ground = buildGroundRecord(recipe, chunkAssignment);

  return { cells, objects, ground };
}

function manifestCell(
  cell: RecipeCell,
  cellSize: number,
  chunkAssignment: ChunkAssignment,
  contentHashById: ReadonlyMap<string, string>
): EnvironmentManifestCell {
  const half = (cellSize * cell.transform.scale) / 2;
  return {
    id: cell.id,
    column: cell.column,
    row: cell.row,
    transform: cell.transform,
    bounds: boundsAround(cell.transform.position, half, half),
    sourceAssetId: cell.sourceAssetId,
    assetContentHash: contentHashById.get(cell.sourceAssetId),
    variantId: cell.variantId,
    semanticRoles: cell.semanticRoles,
    chunkId: chunkAssignment.cellChunkIds.get(cell.id)!,
    sourceLayer: cell.sourceLayer
  };
}

function manifestObject(object: RecipeObject, chunkAssignment: ChunkAssignment, contentHashById: ReadonlyMap<string, string>): EnvironmentManifestObject {
  const half = HALF_FOOTPRINT * object.transform.scale;
  return {
    id: object.id,
    name: object.name,
    transform: object.transform,
    bounds: boundsAround(object.transform.position, half, half),
    sourceAssetId: object.sourceAssetId,
    assetContentHash: contentHashById.get(object.sourceAssetId),
    semanticRoles: object.semanticRoles,
    chunkId: chunkAssignment.objectChunkIds.get(object.id)!,
    sourceLayer: object.sourceLayer
  };
}

function boundsAround(position: { x: number; y: number; z: number }, halfX: number, halfZ: number): WorldBounds {
  return {
    min: { x: position.x - halfX, y: position.y, z: position.z - halfZ },
    max: { x: position.x + halfX, y: position.y + halfX * 2, z: position.z + halfZ }
  };
}

function buildGroundRecord(recipe: SceneRecipe, chunkAssignment: ChunkAssignment): EnvironmentManifestGround | null {
  const { grid } = recipe;
  return {
    bounds: {
      min: { x: grid.origin.x, y: 0, z: grid.origin.z },
      max: { x: grid.origin.x + grid.width * grid.cellSize, y: 0, z: grid.origin.z + grid.depth * grid.cellSize }
    },
    material: { color: recipe.ground.appearance.color, textureUrl: recipe.ground.appearance.textureUrl },
    chunkIds: chunkAssignment.groundChunkIds
  };
}
```

Create `src/environment/navigationGraph.ts`:

```typescript
import type { AssetCatalogEntry } from "../editor-core/assets";
import type { WfcDirection, WfcPlanarDirection } from "../wfc/metadata/socketTypes";
import { oppositeDirections } from "../wfc/metadata/socketTypes";
import type { EnvironmentManifestCell, EnvironmentManifestNavigationEdge, EnvironmentManifestNavigationNode, SceneRecipe } from "./types";

const PLANAR_DIRECTIONS: readonly WfcPlanarDirection[] = ["north", "east", "south", "west"];
const DIRECTION_OFFSETS: Record<WfcPlanarDirection, { column: number; row: number }> = {
  north: { column: 0, row: -1 },
  south: { column: 0, row: 1 },
  east: { column: 1, row: 0 },
  west: { column: -1, row: 0 }
};

export interface NavigationGraph {
  nodes: EnvironmentManifestNavigationNode[];
  edges: EnvironmentManifestNavigationEdge[];
}

/** Builds one navigation node per cell and a road edge between adjacent cells whose rotated ports both carry "road". */
export function buildNavigationGraph(cells: readonly EnvironmentManifestCell[], _recipe: SceneRecipe, assets: readonly AssetCatalogEntry[]): NavigationGraph {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const cellsByCoordinate = new Map(cells.map((cell) => [`${cell.column},${cell.row}`, cell]));

  const nodes: EnvironmentManifestNavigationNode[] = cells.map((cell) => ({
    id: `nav_${cell.id}`,
    cellId: cell.id,
    position: cell.transform.position,
    channels: roadChannelsForCell(cell, assetsById),
    featureTags: []
  }));

  const edges: EnvironmentManifestNavigationEdge[] = [];
  for (const cell of cells) {
    for (const direction of PLANAR_DIRECTIONS) {
      if (!hasRotatedPort(cell, direction, assetsById)) continue;
      const offset = DIRECTION_OFFSETS[direction];
      const neighbor = cellsByCoordinate.get(`${cell.column + offset.column},${cell.row + offset.row}`);
      if (!neighbor) continue;
      const oppositeDirection = oppositeDirections[direction] as WfcPlanarDirection;
      if (!hasRotatedPort(neighbor, oppositeDirection, assetsById)) continue;
      if (direction !== "north" && direction !== "east") continue; // visit each pair once

      edges.push({
        id: `nav_edge_${cell.id}_${neighbor.id}`,
        fromNodeId: `nav_${cell.id}`,
        toNodeId: `nav_${neighbor.id}`,
        direction,
        channel: "road",
        cost: distance(cell.transform.position, neighbor.transform.position),
        bidirectional: true
      });
    }
  }

  return { nodes, edges };
}

function roadChannelsForCell(cell: EnvironmentManifestCell, assetsById: ReadonlyMap<string, AssetCatalogEntry>): string[] {
  const sockets = assetsById.get(cell.sourceAssetId)?.semantics?.sockets ?? {};
  const channels = new Set<string>();
  for (const socket of Object.values(sockets)) {
    if (socket?.type) channels.add(socket.type);
  }
  return [...channels];
}

/** A cell's raw socket map is authored at rotation 0; rotate the direction being queried backward by the cell's placed rotation to read the un-rotated socket. */
function hasRotatedPort(cell: EnvironmentManifestCell, direction: WfcPlanarDirection, assetsById: ReadonlyMap<string, AssetCatalogEntry>): boolean {
  const asset = assetsById.get(cell.sourceAssetId);
  if (!asset?.semantics) return false;
  const rotationSteps = Math.round(cell.transform.rotationY / (Math.PI / 2)) % 4;
  const sourceDirection = rotateDirection(direction, (4 - ((rotationSteps % 4) + 4) % 4) % 4);
  return asset.semantics.sockets[sourceDirection]?.type === "road";
}

function rotateDirection(direction: WfcPlanarDirection, steps: number): WfcPlanarDirection {
  const order: WfcPlanarDirection[] = ["north", "east", "south", "west"];
  const index = (order.indexOf(direction) + steps) % order.length;
  return order[index];
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
```

- [ ] **Step 4: Write the failing navigation-graph test**

Create `tests/environmentNavigationGraph.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { buildNavigationGraph } from "../src/environment/navigationGraph";
import type { EnvironmentManifestCell } from "../src/environment/types";

describe("buildNavigationGraph", () => {
  test("creates one node per cell and a bidirectional edge between adjacent cells whose ports both carry road", () => {
    const assets: AssetCatalogEntry[] = [
      {
        id: "tiles.straight",
        label: "Straight",
        category: "3d-road-tiles",
        source: "shared",
        implementation: "glb",
        semantics: { roles: [], sockets: { north: { type: "road" }, south: { type: "road" } } }
      }
    ];
    const cells: EnvironmentManifestCell[] = [
      cellFixture({ id: "c-0-0", column: 0, row: 0 }),
      cellFixture({ id: "c-0-1", column: 0, row: 1 })
    ];

    const graph = buildNavigationGraph(cells, recipeStub(), assets);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ fromNodeId: "nav_c-0-0", toNodeId: "nav_c-0-1", channel: "road", bidirectional: true });
  });

  test("creates no edge when a neighbor's opposing port does not carry road", () => {
    const assets: AssetCatalogEntry[] = [
      {
        id: "tiles.deadend",
        label: "Dead end",
        category: "3d-road-tiles",
        source: "shared",
        implementation: "glb",
        semantics: { roles: [], sockets: { north: { type: "road" } } }
      }
    ];
    const cells: EnvironmentManifestCell[] = [
      cellFixture({ id: "c-0-0", column: 0, row: 0 }),
      cellFixture({ id: "c-0-1", column: 0, row: 1 })
    ];

    const graph = buildNavigationGraph(cells, recipeStub(), assets);

    expect(graph.edges).toEqual([]);
  });
});

function cellFixture(options: { id: string; column: number; row: number }): EnvironmentManifestCell {
  return {
    id: options.id,
    column: options.column,
    row: options.row,
    transform: { position: { x: options.column, y: 0, z: options.row }, rotationY: 0, scale: 1 },
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    sourceAssetId: "tiles.straight",
    semanticRoles: [],
    chunkId: "chunk_0_0",
    sourceLayer: "scene"
  };
}

function recipeStub() {
  return {
    grid: { width: 1, depth: 2, cellSize: 1, origin: { x: 0, y: 0, z: 0 } },
    generationRuns: [],
    cells: [],
    objects: [],
    ground: { appearance: { type: "color" as const, color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
```

- [ ] **Step 5: Run both tests to verify they fail, then pass**

Run: `npx vitest run tests/environmentManifestBuilder.test.ts tests/environmentNavigationGraph.test.ts`
Expected: first FAIL with "Cannot find module", then re-run after Step 3's files exist to see PASS

- [ ] **Step 6: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/environment/manifestBuilder.ts src/environment/navigationGraph.ts tests/environmentManifestBuilder.test.ts tests/environmentNavigationGraph.test.ts
git commit -m "feat: assemble manifest cell/object/ground records and the navigation graph"
```

---

### Task 8: Top-level orchestrator — `compileEnvironmentPackage`

**Files:**
- Create: `src/environment/compiler.ts`
- Modify: `src/environment/geometryCompiler.ts` (expose the per-cell flattened-mesh map so seam removal can run between flattening and grouping)
- Test: `tests/environmentCompiler.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7, plus `buildSceneRecipe` is NOT called here — callers (CLI, server, later plans) build the `SceneRecipe` themselves and pass it in; `encodeManifest`, `canonicalJson`, `sha256Hex` from `./manifestEncoder` (foundation plan).
- Produces: `CompileEnvironmentOptions = { chunkSize: number; removeInternalSeamFaces: boolean; assetRoot: string; source: "editor" | "cli"; generatorVersion: string }`; `EnvironmentCompileMetrics = { cellCount: number; objectCount: number; chunkCount: number; meshCount: number; instancedMeshCount: number; triangleCount: number; removedSeamTriangleCount: number; glbByteLength: number; elapsedMs: number }`; `CompileEnvironmentResult = { manifest: EnvironmentManifest; glb: Uint8Array; metrics: EnvironmentCompileMetrics } | { status: "failed"; diagnostics: readonly string[] }`; `compileEnvironmentPackage(recipe: SceneRecipe, assets: readonly AssetCatalogEntry[], options: CompileEnvironmentOptions): Promise<CompileEnvironmentResult>`. The CLI plan and the server plan both call this one function.

- [ ] **Step 1: Restructure `geometryCompiler.ts` to expose per-cell flattened meshes**

Modify `src/environment/geometryCompiler.ts` so resolution+flattening (stages 1-2) and grouping (stages 3-4) are two separately callable functions, with `flattenRecord` changed to return both the primitive records and the live meshes backing them (seam removal, in Task 4, mutates a mesh's `geometry` in place — since each `FlattenedPrimitive.geometry` is the *same object reference* as its mesh's `geometry`, a mutation is visible to both without any copying step). Replace the file's exported surface and the body of `flattenRecord` with:

```typescript
export interface FlattenedRecords {
  cellMeshesByCellId: Map<string, THREE.Mesh[]>;
  primitivesByRecordId: Map<string, FlattenedPrimitive[]>;
  diagnostics: readonly string[];
}

/** Stage 1-2: resolve every referenced asset once, then bake each record's world transform into standalone meshes. */
export async function flattenRecords(
  recipe: SceneRecipe,
  assets: readonly AssetCatalogEntry[],
  chunkAssignment: ChunkAssignment,
  assetRoot: string
): Promise<FlattenedRecords> {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const referencedAssetIds = new Set([...recipe.cells.map((cell) => cell.sourceAssetId), ...recipe.objects.map((object) => object.sourceAssetId)]);

  const templates = new Map<string, THREE.Object3D>();
  const diagnostics: string[] = [];
  for (const assetId of referencedAssetIds) {
    const result = await resolveAssetGeometry(assetsById.get(assetId), assetId, assetRoot);
    if (result.status === "error") diagnostics.push(...result.diagnostics);
    else templates.set(assetId, result.object);
  }
  if (diagnostics.length) return { cellMeshesByCellId: new Map(), primitivesByRecordId: new Map(), diagnostics };

  const cellMeshesByCellId = new Map<string, THREE.Mesh[]>();
  const primitivesByRecordId = new Map<string, FlattenedPrimitive[]>();

  for (const cell of recipe.cells) {
    const { meshes, primitives } = flattenRecord(cell, chunkAssignment.cellChunkIds.get(cell.id)!, templates.get(cell.sourceAssetId)!);
    cellMeshesByCellId.set(cell.id, meshes);
    primitivesByRecordId.set(cell.id, primitives);
  }
  for (const object of recipe.objects) {
    const { primitives } = flattenRecord(object, chunkAssignment.objectChunkIds.get(object.id)!, templates.get(object.sourceAssetId)!);
    primitivesByRecordId.set(object.id, primitives);
  }

  return { cellMeshesByCellId, primitivesByRecordId, diagnostics: [] };
}

/** Stage 3-4 (post seam-removal): instances/merges already-flattened primitives into render nodes, scoped per chunk. */
export function groupPrimitives(primitivesByRecordId: ReadonlyMap<string, FlattenedPrimitive[]>): CompiledGeometry {
  const primitives = [...primitivesByRecordId.values()].flat();
  const root = new THREE.Group();
  root.name = "SteerlabEnvironment";
  let meshCount = 0;
  let instancedMeshCount = 0;
  let triangleCount = 0;

  const byChunk = groupBy(primitives, (primitive) => primitive.chunkId);
  for (const [chunkId, chunkPrimitives] of byChunk) {
    const chunkGroup = new THREE.Group();
    chunkGroup.name = chunkId;
    root.add(chunkGroup);

    const byGeometryMaterial = groupBy(chunkPrimitives, (primitive) => `${primitive.geometry.uuid}::${primitive.material.uuid}`);
    for (const group of byGeometryMaterial.values()) {
      const { geometry, material, transparent } = group[0];
      const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;

      if (group.length > 1 && !transparent) {
        const instanced = new THREE.InstancedMesh(geometry, material, group.length);
        group.forEach((primitive, index) => instanced.setMatrixAt(index, primitive.matrix));
        instanced.instanceMatrix.needsUpdate = true;
        chunkGroup.add(instanced);
        instancedMeshCount += 1;
        triangleCount += triangles * group.length;
      } else {
        for (const primitive of group) {
          const mesh = new THREE.Mesh(primitive.geometry, primitive.material);
          mesh.applyMatrix4(primitive.matrix);
          chunkGroup.add(mesh);
          meshCount += 1;
          triangleCount += triangles;
        }
      }
    }
  }

  mergeCompatibleSingletons(root);
  return { root, diagnostics: [], stats: { meshCount, instancedMeshCount, triangleCount } };
}

/** Convenience wrapper kept for Task 3's existing tests: resolves, flattens, and groups in one call, with no seam-removal step in between. */
export async function compileGeometry(
  recipe: SceneRecipe,
  assets: readonly AssetCatalogEntry[],
  chunkAssignment: ChunkAssignment,
  assetRoot: string
): Promise<CompiledGeometry> {
  const flattened = await flattenRecords(recipe, assets, chunkAssignment, assetRoot);
  if (flattened.diagnostics.length) return { root: new THREE.Group(), diagnostics: flattened.diagnostics, stats: { meshCount: 0, instancedMeshCount: 0, triangleCount: 0 } };
  return groupPrimitives(flattened.primitivesByRecordId);
}
```

Change `flattenRecord`'s return type and body to produce both the primitives and their backing meshes:

```typescript
function flattenRecord(record: RecipeCell | RecipeObject, chunkId: string, template: THREE.Object3D): { meshes: THREE.Mesh[]; primitives: FlattenedPrimitive[] } {
  const instance = template.clone(true);
  instance.position.set(record.transform.position.x, record.transform.position.y, record.transform.position.z);
  instance.rotation.set(0, record.transform.rotationY, 0);
  instance.scale.setScalar(record.transform.scale);
  instance.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  const primitives: FlattenedPrimitive[] = [];
  instance.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    meshes.push(node);
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      primitives.push({ chunkId, geometry: node.geometry, material, matrix: node.matrixWorld.clone(), transparent: material.transparent });
    }
  });
  return { meshes, primitives };
}
```

Delete the old standalone `compileGeometry` function body (the one written in Task 3) — it's now the thin wrapper above — and remove the now-unused inline grouping loop that used to live directly inside it, since that logic moved into `groupPrimitives`.

Note on seam removal and re-reading geometry: after `removeInternalSeamFaces` mutates `mesh.geometry` (via `geometry.setIndex(...)`, which mutates the existing `BufferGeometry` instance rather than replacing it), the `FlattenedPrimitive.geometry` reference the orchestrator already holds still points at the same, now-updated `BufferGeometry` — no re-sync step is needed between seam removal and `groupPrimitives`.

- [ ] **Step 2: Run Task 3's existing tests to confirm the refactor didn't break them**

Run: `npx vitest run tests/environmentGeometryCompiler.test.ts`
Expected: PASS (no behavior change, only an exposed seam between flatten and group)

- [ ] **Step 3: Write the failing orchestrator test**

Create `tests/environmentCompiler.test.ts`:

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { compileEnvironmentPackage } from "../src/environment/compiler";
import { readGlbInfo } from "../src/environment/glb";
import { validateEnvironmentPackage } from "../src/environment/packageValidator";
import type { SceneRecipe } from "../src/environment/types";

describe("compileEnvironmentPackage", () => {
  let assetRoot: string;

  afterEach(async () => {
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  test("compiles a recipe into a manifest + GLB pair that pass validateEnvironmentPackage", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const assets: AssetCatalogEntry[] = [{ id: "tiles.a", label: "Tile A", category: "tiles", source: "shared", implementation: "placeholder" }];
    const recipe = recipeFixture();

    const result = await compileEnvironmentPackage(recipe, assets, {
      chunkSize: 10,
      removeInternalSeamFaces: false,
      assetRoot,
      source: "cli",
      generatorVersion: "0.1.0"
    });

    if ("status" in result) throw new Error(`expected success, got diagnostics: ${result.diagnostics.join(", ")}`);
    expect(result.manifest.format).toBe("steerlab-environment");
    expect(result.manifest.model.sha256).toBeTruthy();
    expect(readGlbInfo(result.glb).valid).toBe(true);
    const validation = validateEnvironmentPackage(result.manifest, result.glb);
    expect(validation).toEqual({ valid: true, diagnostics: [] });
    expect(result.metrics.cellCount).toBe(2);
    expect(result.metrics.glbByteLength).toBe(result.glb.byteLength);
  });

  test("returns a failed result naming the missing asset instead of throwing", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const recipe = recipeFixture();

    const result = await compileEnvironmentPackage(recipe, [], {
      chunkSize: 10,
      removeInternalSeamFaces: false,
      assetRoot,
      source: "cli",
      generatorVersion: "0.1.0"
    });

    expect(result).toEqual({ status: "failed", diagnostics: ["Asset tiles.a is not present in the catalog."] });
  });
});

function recipeFixture(): SceneRecipe {
  return {
    grid: { width: 2, depth: 1, cellSize: 1, origin: { x: -1, y: 0, z: -0.5 } },
    generationRuns: [{ seed: 1, width: 2, depth: 1, cellSize: 1 }],
    cells: [
      {
        id: "c-0-0",
        column: 0,
        row: 0,
        transform: { position: { x: -0.5, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.a",
        semanticRoles: [],
        sourceLayer: "scene",
        recovered: false
      },
      {
        id: "c-1-0",
        column: 1,
        row: 0,
        transform: { position: { x: 0.5, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.a",
        semanticRoles: [],
        sourceLayer: "scene",
        recovered: false
      }
    ],
    objects: [],
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/environmentCompiler.test.ts`
Expected: FAIL — "Cannot find module '../src/environment/compiler'"

- [ ] **Step 5: Write minimal implementation**

Create `src/environment/compiler.ts`:

```typescript
import type { AssetCatalogEntry } from "../editor-core/assets";
import { assignChunks } from "./chunking";
import { buildAssetTable } from "./assetTable";
import { exportGlb } from "./glbExporter";
import { flattenRecords, groupPrimitives } from "./geometryCompiler";
import { encodeManifest, sha256Hex } from "./manifestEncoder";
import { buildManifestRecords } from "./manifestBuilder";
import { buildNavigationGraph } from "./navigationGraph";
import { removeInternalSeamFaces } from "./seamRemoval";
import type { EnvironmentManifest, SceneRecipe } from "./types";

export interface CompileEnvironmentOptions {
  chunkSize: number;
  removeInternalSeamFaces: boolean;
  assetRoot: string;
  source: "editor" | "cli";
  generatorVersion: string;
}

export interface EnvironmentCompileMetrics {
  cellCount: number;
  objectCount: number;
  chunkCount: number;
  meshCount: number;
  instancedMeshCount: number;
  triangleCount: number;
  removedSeamTriangleCount: number;
  glbByteLength: number;
  elapsedMs: number;
}

export type CompileEnvironmentResult =
  | { manifest: EnvironmentManifest; glb: Uint8Array; metrics: EnvironmentCompileMetrics }
  | { status: "failed"; diagnostics: readonly string[] };

export async function compileEnvironmentPackage(
  recipe: SceneRecipe,
  assets: readonly AssetCatalogEntry[],
  options: CompileEnvironmentOptions
): Promise<CompileEnvironmentResult> {
  const startedAt = Date.now();
  const chunkAssignment = assignChunks(recipe, options.chunkSize);

  const flattened = await flattenRecords(recipe, assets, chunkAssignment, options.assetRoot);
  if (flattened.diagnostics.length) return { status: "failed", diagnostics: flattened.diagnostics };

  const seamResult = options.removeInternalSeamFaces
    ? removeInternalSeamFaces(flattened.cellMeshesByCellId, recipe)
    : { removedTriangleCount: 0, removedVertexCount: 0 };

  const compiled = groupPrimitives(flattened.primitivesByRecordId);
  const glb = await exportGlb(compiled.root);

  let assetTable;
  try {
    assetTable = await buildAssetTable(recipe, assets, options.assetRoot);
  } catch (error) {
    return { status: "failed", diagnostics: [error instanceof Error ? error.message : String(error)] };
  }

  const { cells, objects, ground } = buildManifestRecords(recipe, chunkAssignment, assetTable);
  const navigation = buildNavigationGraph(cells, recipe, assets);

  const manifest: EnvironmentManifest = encodeManifest({
    format: "steerlab-environment",
    formatVersion: 1,
    model: { file: "environment.glb", sha256: sha256Hex(glb), rootNode: "SteerlabEnvironment", upAxis: "Y", unitsPerMeter: 1 },
    grid: {
      width: recipe.grid.width,
      depth: recipe.grid.depth,
      cellSize: recipe.grid.cellSize,
      origin: recipe.grid.origin,
      bounds: {
        min: { x: recipe.grid.origin.x, y: 0, z: recipe.grid.origin.z },
        max: { x: recipe.grid.origin.x + recipe.grid.width * recipe.grid.cellSize, y: 4, z: recipe.grid.origin.z + recipe.grid.depth * recipe.grid.cellSize }
      }
    },
    provenance: { source: options.source, generatorVersion: options.generatorVersion, generationRuns: recipe.generationRuns },
    build: { chunkSize: options.chunkSize, removeInternalSeamFaces: options.removeInternalSeamFaces },
    chunks: chunkAssignment.chunks,
    assets: assetTable,
    cells,
    objects,
    ground,
    navigation,
    diagnostics: recipe.diagnostics
  });

  return {
    manifest,
    glb,
    metrics: {
      cellCount: recipe.cells.length,
      objectCount: recipe.objects.length,
      chunkCount: chunkAssignment.chunks.length,
      meshCount: compiled.stats.meshCount,
      instancedMeshCount: compiled.stats.instancedMeshCount,
      triangleCount: compiled.stats.triangleCount,
      removedSeamTriangleCount: seamResult.removedTriangleCount,
      glbByteLength: glb.byteLength,
      elapsedMs: Date.now() - startedAt
    }
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/environmentCompiler.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/environment/compiler.ts src/environment/geometryCompiler.ts tests/environmentCompiler.test.ts
git commit -m "feat: add compileEnvironmentPackage orchestrator wiring the full compiler pipeline"
```

---

## What this plan does not cover

Per the spec's architecture, these stay out of scope for this plan and belong to later plans:

- Package composition — re-exporting a scene that already owns an attached (imported) environment package, merging its flattened GLB nodes and semantic records into a fresh export with ID prefixing (spec's "Package composition" section). `compileEnvironmentPackage` here always compiles a `SceneRecipe` as the entire package.
- The `npm run scene:export` CLI script and its argument parsing.
- Vite API routes, scene-owned package storage, and the `Scene` model's environment reference.
- The Project panel's Export/Import controls and the locked environment world feature.
