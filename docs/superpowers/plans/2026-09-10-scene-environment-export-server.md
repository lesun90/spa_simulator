# Scene Environment Export — Server Persistence and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the editor export the current scene through the Vite dev API (compile server-side, fetch the manifest JSON and GLB binary separately) and import an uploaded package (stage the two files, validate, commit atomically), with the `Scene` model tracking which package it owns and scene duplication/deletion keeping the package directory in sync.

**Architecture:** This is the fourth of several plans implementing `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`. It depends on `compileEnvironmentPackage` (`src/environment/compiler.ts`, compiler plan), `validateEnvironmentPackage`/`canonicalJson` (foundation plan), and `buildSceneRecipe` (foundation plan) — verify these exist before starting. It follows `server/viteApiPlugin.ts`'s existing style exactly: routing stays a sequence of `if` blocks inside one `server.middlewares.use` handler with no router library, and all meaningful logic is factored into small, separately-exported, unit-tested functions (mirroring how `validateSceneSaveRequest` is already exported out of the middleware today) — the middleware wiring itself stays thin and, like the rest of `viteApiPlugin.ts`, is not directly unit tested (there is no existing `viteApiPlugin.test.ts` in this codebase; coverage lives at the module level, e.g. `tests/sceneStore.test.ts`).

**Tech Stack:** TypeScript, Node's `node:fs/promises`/`node:crypto`, Vitest, the existing hand-rolled Vite middleware (no new HTTP framework).

**Spec:** `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`

## Global Constraints

- Both package files use fixed names `environment.glb` and `environment.json` (unchanged).
- The client uploads the manifest JSON and the GLB as **separate payloads**, so a large GLB never incurs base64 overhead — two POST bodies, not one multipart or base64-embedded request.
- Import stages both files first, validates the pair, and only then commits — a failed upload or validation leaves the prior package (if any) in place; a scene owns at most one environment package at a time, and importing a new one replaces the prior one after validation.
- Environment replacement uses a temporary directory and atomic rename (`server/sceneStore.ts:58-61`'s temp-file-then-rename idiom, applied at the directory level).
- Scene duplication copies the immutable package into the duplicate's directory; scene deletion removes its package directory.
- Package files live under a scene-owned environment directory beside the current scene store; they do not appear in the shared asset catalog.
- New route handler logic is factored into plain, `Scene`/`Buffer`-in-`Buffer`/JSON-out functions that don't touch `IncomingMessage`/`ServerResponse` directly, so it can be unit tested the way `validateSceneSaveRequest` already is — only the routing `if` blocks in `viteApiPlugin.ts` touch the raw request/response.

---

## File Structure

- **Modify** `src/editor-core/scene.ts` — add `SceneEnvironmentReference`, `Scene.environment`, backfill in `normalizeScene`.
- **Modify** `server/sceneStore.ts` — export `safeId` (currently private) for reuse.
- **Create** `server/environmentPackageStore.ts` — `createEnvironmentPackageStore`.
- **Create** `server/environmentRoutes.ts` — `createEnvironmentExportCache`, `createEnvironmentImportStaging`.
- **Modify** `server/viteApiPlugin.ts` — add the export/import routes, a binary response helper, and wire package copy/remove into the existing duplicate/delete routes.
- **Modify** `src/api/client.ts` — add `exportEnvironmentRequest`, `fetchExportedEnvironmentModel`, `uploadEnvironmentManifestRequest`, `uploadEnvironmentModelRequest`, `commitEnvironmentImportRequest`.
- **Test** `tests/sceneEnvironmentReference.test.ts`, `tests/environmentPackageStore.test.ts`, `tests/environmentRoutesExport.test.ts`, `tests/environmentRoutesImport.test.ts` — all new.

---

### Task 1: `Scene` gains an optional environment reference

**Files:**
- Modify: `src/editor-core/scene.ts`
- Test: `tests/sceneEnvironmentReference.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SceneEnvironmentReference = { sha256: string; manifestVersion: number }`; `Scene.environment: SceneEnvironmentReference | null`; `isSceneEnvironmentReference(value: unknown): value is SceneEnvironmentReference`. Task 4 (import commit) writes this field; the locked-environment editor-UI plan reads it to know whether to load a package on scene open.

- [ ] **Step 1: Write the failing test**

Create `tests/sceneEnvironmentReference.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { createScene, isSceneEnvironmentReference, normalizeScene } from "../src/editor-core/scene";

describe("Scene.environment", () => {
  test("createScene defaults environment to null", () => {
    expect(createScene("Test").environment).toBeNull();
  });

  test("normalizeScene backfills a missing environment field to null", () => {
    const legacy = { ...createScene("Test") } as { environment?: unknown };
    delete legacy.environment;

    expect(normalizeScene(legacy as never).environment).toBeNull();
  });

  test("normalizeScene keeps a valid environment reference and discards a malformed one", () => {
    const withReference = { ...createScene("Test"), environment: { sha256: "a".repeat(64), manifestVersion: 1 } };
    expect(normalizeScene(withReference).environment).toEqual({ sha256: "a".repeat(64), manifestVersion: 1 });

    const withMalformed = { ...createScene("Test"), environment: { sha256: 123 } };
    expect(normalizeScene(withMalformed as never).environment).toBeNull();
  });
});

describe("isSceneEnvironmentReference", () => {
  test("accepts a well-formed reference and rejects everything else", () => {
    expect(isSceneEnvironmentReference({ sha256: "a".repeat(64), manifestVersion: 1 })).toBe(true);
    expect(isSceneEnvironmentReference(null)).toBe(false);
    expect(isSceneEnvironmentReference({ sha256: "a".repeat(64) })).toBe(false);
    expect(isSceneEnvironmentReference({ manifestVersion: 1 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sceneEnvironmentReference.test.ts`
Expected: FAIL — `isSceneEnvironmentReference` is not exported, and `Scene.environment` does not exist

- [ ] **Step 3: Write minimal implementation**

In `src/editor-core/scene.ts`, add:

```typescript
export interface SceneEnvironmentReference {
  sha256: string;
  manifestVersion: number;
}

export function isSceneEnvironmentReference(value: unknown): value is SceneEnvironmentReference {
  const reference = value as Partial<SceneEnvironmentReference> | undefined;
  if (!reference || typeof reference !== "object") return false;
  return typeof reference.sha256 === "string" && typeof reference.manifestVersion === "number";
}
```

Extend `Scene`:

```typescript
export interface Scene {
  id: string;
  name: string;
  description: string;
  grid: GridDefinition;
  background: SurfaceAppearance;
  ground: SurfaceAppearance;
  objects: SceneObject[];
  environment: SceneEnvironmentReference | null;
}
```

Update `createScene` to include `environment: null`, and update `normalizeScene` to backfill it:

```typescript
export function normalizeScene(scene: Scene): Scene {
  const names = objectDisplayNames(scene.objects);
  return {
    ...scene,
    description: typeof scene.description === "string" ? scene.description : "",
    background: isSurfaceAppearance(scene.background) ? scene.background : defaultSurfaceAppearance(DEFAULT_BACKGROUND_COLOR),
    ground: isSurfaceAppearance(scene.ground) ? scene.ground : defaultSurfaceAppearance(DEFAULT_GROUND_COLOR),
    environment: isSceneEnvironmentReference(scene.environment) ? scene.environment : null,
    objects: scene.objects.map((object) => ({
      ...object,
      name: typeof object.name === "string" && object.name.trim() ? object.name : names.get(object.id) ?? assetSlug(object.assetId),
      position: normalizeObjectPosition(object.position)
    }))
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sceneEnvironmentReference.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS (watch for any test fixture that builds a `Scene` object literal without `environment` — TypeScript's structural typing will flag these; add `environment: null` to each)

- [ ] **Step 6: Commit**

```bash
git add src/editor-core/scene.ts tests/sceneEnvironmentReference.test.ts
git commit -m "feat: add optional environment package reference to Scene"
```

---

### Task 2: Scene-owned environment package storage

**Files:**
- Modify: `server/sceneStore.ts` (export `safeId`)
- Create: `server/environmentPackageStore.ts`
- Modify: `server/viteApiPlugin.ts` (wire copy/remove into the existing duplicate/delete routes)
- Test: `tests/environmentPackageStore.test.ts`

**Interfaces:**
- Consumes: `safeId` from `./sceneStore` (exported by this task).
- Produces: `createEnvironmentPackageStore(sceneRoot: string)` returning `{ read(sceneId): Promise<{ manifest: string; glb: Buffer } | null>; replace(sceneId, manifestJson: string, glb: Buffer): Promise<void>; copy(fromSceneId, toSceneId): Promise<void>; remove(sceneId): Promise<void> }`. Task 3's export cache doesn't touch this store (export is ephemeral, in-memory); Task 4's import commit calls `replace`; the duplicate/delete routes call `copy`/`remove`.

- [ ] **Step 1: Export `safeId`**

In `server/sceneStore.ts`, change `function safeId(id: string)` to `export function safeId(id: string)` — no behavior change, just visibility, so `environmentPackageStore.ts` reuses the exact same directory-naming rule instead of duplicating it (per the project's reuse-over-duplication convention).

- [ ] **Step 2: Write the failing test**

Create `tests/environmentPackageStore.test.ts`:

```typescript
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEnvironmentPackageStore } from "../server/environmentPackageStore";

describe("createEnvironmentPackageStore", () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("read returns null when no package has been written for the scene", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);

    expect(await store.read("scene-1")).toBeNull();
  });

  test("replace writes both files, and read returns them back", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);

    await store.replace("scene-1", '{"format":"steerlab-environment"}', Buffer.from([1, 2, 3]));
    const read = await store.read("scene-1");

    expect(read?.manifest).toBe('{"format":"steerlab-environment"}');
    expect(read?.glb).toEqual(Buffer.from([1, 2, 3]));
  });

  test("replace atomically swaps an existing package for a new one", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);
    await store.replace("scene-1", "old-manifest", Buffer.from("old"));

    await store.replace("scene-1", "new-manifest", Buffer.from("new"));

    const read = await store.read("scene-1");
    expect(read?.manifest).toBe("new-manifest");
    expect(read?.glb.toString()).toBe("new");
  });

  test("copy duplicates a scene's package under a new scene ID", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);
    await store.replace("scene-1", "manifest", Buffer.from("glb"));

    await store.copy("scene-1", "scene-2");

    expect(await store.read("scene-2")).toEqual({ manifest: "manifest", glb: Buffer.from("glb") });
    expect(await store.read("scene-1")).toEqual({ manifest: "manifest", glb: Buffer.from("glb") });
  });

  test("copy is a no-op when the source scene has no package", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);

    await store.copy("scene-1", "scene-2");

    expect(await store.read("scene-2")).toBeNull();
  });

  test("remove deletes a scene's package directory", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);
    await store.replace("scene-1", "manifest", Buffer.from("glb"));

    await store.remove("scene-1");

    expect(await store.read("scene-1")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/environmentPackageStore.test.ts`
Expected: FAIL — "Cannot find module '../server/environmentPackageStore'"

- [ ] **Step 4: Write minimal implementation**

Create `server/environmentPackageStore.ts`:

```typescript
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeId } from "./sceneStore";

export function createEnvironmentPackageStore(sceneRoot: string) {
  const dirFor = (sceneId: string) => join(sceneRoot, `${safeId(sceneId)}.environment`);

  return {
    async read(sceneId: string): Promise<{ manifest: string; glb: Buffer } | null> {
      const dir = dirFor(sceneId);
      try {
        const [manifest, glb] = await Promise.all([readFile(join(dir, "environment.json"), "utf8"), readFile(join(dir, "environment.glb"))]);
        return { manifest, glb };
      } catch {
        return null;
      }
    },

    async replace(sceneId: string, manifestJson: string, glb: Buffer): Promise<void> {
      const dir = dirFor(sceneId);
      const stagingDir = `${dir}.staging-${Date.now()}`;
      await mkdir(stagingDir, { recursive: true });
      await writeFile(join(stagingDir, "environment.json"), manifestJson, "utf8");
      await writeFile(join(stagingDir, "environment.glb"), glb);
      await rm(dir, { recursive: true, force: true });
      await rename(stagingDir, dir);
    },

    async copy(fromSceneId: string, toSceneId: string): Promise<void> {
      const from = dirFor(fromSceneId);
      const existing = await this.read(fromSceneId);
      if (!existing) return;
      await cp(from, dirFor(toSceneId), { recursive: true });
    },

    async remove(sceneId: string): Promise<void> {
      await rm(dirFor(sceneId), { recursive: true, force: true });
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/environmentPackageStore.test.ts`
Expected: PASS

- [ ] **Step 6: Wire copy/remove into scene duplication and deletion**

In `server/viteApiPlugin.ts`, construct the store alongside the existing `sceneStore` and use it in the duplicate/delete routes:

```typescript
import { createEnvironmentPackageStore } from "./environmentPackageStore";
// ...
const environmentStore = createEnvironmentPackageStore(sceneRoot);
```

Change the duplicate route body from `return sendJson(response, { scene: await store.duplicate(...) }, 201);` to:

```typescript
if (duplicateMatch && method === "POST") {
  const sourceId = decodeURIComponent(duplicateMatch[1]);
  const duplicated = await store.duplicate(sourceId);
  await environmentStore.copy(sourceId, duplicated.id);
  return sendJson(response, { scene: duplicated }, 201);
}
```

Change the delete route body from `await store.delete(id); response.statusCode = 204; response.end(); return;` to:

```typescript
if (method === "DELETE") {
  await store.delete(id);
  await environmentStore.remove(id);
  response.statusCode = 204;
  response.end();
  return;
}
```

- [ ] **Step 7: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/sceneStore.ts server/environmentPackageStore.ts server/viteApiPlugin.ts tests/environmentPackageStore.test.ts
git commit -m "feat: add scene-owned environment package storage, wired into duplicate/delete"
```

---

### Task 3: Export routes — compile server-side, serve manifest and model separately

**Files:**
- Create: `server/environmentRoutes.ts` (export portion — import portion is added in Task 4)
- Modify: `server/viteApiPlugin.ts`
- Test: `tests/environmentRoutesExport.test.ts`

**Interfaces:**
- Consumes: `compileEnvironmentPackage` from `../src/environment/compiler` (compiler plan); `buildSceneRecipe` from `../src/environment/sceneRecipe` (foundation plan); `Scene` from `../src/editor-core/scene`; `AssetCatalogEntry` from `../src/editor-core/assets`.
- Produces: `ExportEnvironmentOptions = { chunkSize: number; removeSeamFaces: boolean }`; `ExportEnvironmentResult = { status: "ok"; exportId: string; manifest: EnvironmentManifest; metrics: EnvironmentCompileMetrics } | { status: "error"; message: string }`; `createEnvironmentExportCache()` returning `{ compile(scene, assets, assetRoot, options): Promise<ExportEnvironmentResult>; model(exportId: string): Uint8Array | undefined }`. `viteApiPlugin.ts` constructs one cache per server instance (module-scoped inside `steerlabApiPlugin()`, alongside `store`) and wires two routes to it.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentRoutesExport.test.ts`:

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { createScene } from "../src/editor-core/scene";
import { createEnvironmentExportCache } from "../server/environmentRoutes";

describe("createEnvironmentExportCache", () => {
  let assetRoot: string;

  afterEach(async () => {
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  test("compiles the given scene and caches the GLB under a fresh export ID", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-export-assets-"));
    const assets: AssetCatalogEntry[] = [];
    const scene = createScene("Export test");
    const cache = createEnvironmentExportCache();

    const result = await cache.compile(scene, assets, assetRoot, { chunkSize: 10, removeSeamFaces: false });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.manifest.format).toBe("steerlab-environment");
    expect(cache.model(result.exportId)).toBeInstanceOf(Uint8Array);
  });

  test("returns an error result naming the failure instead of throwing", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-export-assets-"));
    const scene = {
      ...createScene("Export test"),
      objects: [{ id: "o-1", assetId: "missing.asset", name: "o-1", position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 }]
    };
    const cache = createEnvironmentExportCache();

    const result = await cache.compile(scene, [], assetRoot, { chunkSize: 10, removeSeamFaces: false });

    expect(result).toEqual({ status: "error", message: "Asset missing.asset is not present in the catalog." });
  });

  test("evicts the previous export for the same scene when a new one is compiled", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-export-assets-"));
    const scene = createScene("Export test");
    const cache = createEnvironmentExportCache();

    const first = await cache.compile(scene, [], assetRoot, { chunkSize: 10, removeSeamFaces: false });
    const second = await cache.compile(scene, [], assetRoot, { chunkSize: 10, removeSeamFaces: false });

    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected ok");
    expect(cache.model(first.exportId)).toBeUndefined();
    expect(cache.model(second.exportId)).toBeInstanceOf(Uint8Array);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentRoutesExport.test.ts`
Expected: FAIL — "Cannot find module '../server/environmentRoutes'"

- [ ] **Step 3: Write minimal implementation**

Create `server/environmentRoutes.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import type { Scene } from "../src/editor-core/scene";
import { compileEnvironmentPackage, type EnvironmentCompileMetrics } from "../src/environment/compiler";
import { buildSceneRecipe } from "../src/environment/sceneRecipe";
import type { EnvironmentManifest } from "../src/environment/types";

const GENERATOR_VERSION = "0.1.0";

export interface ExportEnvironmentOptions {
  chunkSize: number;
  removeSeamFaces: boolean;
}

export type ExportEnvironmentResult =
  | { status: "ok"; exportId: string; manifest: EnvironmentManifest; metrics: EnvironmentCompileMetrics }
  | { status: "error"; message: string };

/** Compiles a scene server-side and holds its GLB in memory under a fresh export ID, so the client can fetch the manifest (JSON response) and the model (a later binary GET) as separate payloads. */
export function createEnvironmentExportCache() {
  const glbByExportId = new Map<string, Uint8Array>();
  const exportIdBySceneId = new Map<string, string>();

  return {
    async compile(
      scene: Scene,
      assets: readonly AssetCatalogEntry[],
      assetRoot: string,
      options: ExportEnvironmentOptions
    ): Promise<ExportEnvironmentResult> {
      const recipe = buildSceneRecipe(scene, assets);
      const compiled = await compileEnvironmentPackage(recipe, assets, {
        chunkSize: options.chunkSize,
        removeInternalSeamFaces: options.removeSeamFaces,
        assetRoot,
        source: "editor",
        generatorVersion: GENERATOR_VERSION
      });
      if ("status" in compiled) return { status: "error", message: compiled.diagnostics[0] ?? "Environment export failed." };

      const previousExportId = exportIdBySceneId.get(scene.id);
      if (previousExportId) glbByExportId.delete(previousExportId);
      const exportId = randomUUID();
      glbByExportId.set(exportId, compiled.glb);
      exportIdBySceneId.set(scene.id, exportId);

      return { status: "ok", exportId, manifest: compiled.manifest, metrics: compiled.metrics };
    },

    model(exportId: string): Uint8Array | undefined {
      return glbByExportId.get(exportId);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentRoutesExport.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the export routes into the middleware**

In `server/viteApiPlugin.ts`, add imports and a module-scoped cache:

```typescript
import { createEnvironmentExportCache } from "./environmentRoutes";
// ...
const environmentExports = createEnvironmentExportCache();
```

Add a binary response helper alongside `sendJson`:

```typescript
function sendBinary(response: { statusCode: number; setHeader(name: string, value: string): void; end(body?: Buffer): void }, bytes: Uint8Array, contentType: string) {
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  response.end(Buffer.from(bytes));
}
```

Add two routes inside the existing `try` block, after the scene-duplicate route:

```typescript
const exportMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/export$/);
if (exportMatch && method === "POST") {
  const body = await readJson<{ scene: Scene; options: { chunkSize: number; removeSeamFaces: boolean } }>(request);
  const catalog = await discoverAssetCatalog(assetRoot);
  const result = await environmentExports.compile(body.scene, catalog, assetRoot, body.options);
  if (result.status === "error") return sendJson(response, { error: result.message }, 400);
  return sendJson(response, { exportId: result.exportId, manifest: result.manifest, metrics: result.metrics });
}

const exportModelMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/export\/([^/]+)\/model$/);
if (exportModelMatch && method === "GET") {
  const glb = environmentExports.model(decodeURIComponent(exportModelMatch[2]));
  if (!glb) return sendJson(response, { error: "Not found" }, 404);
  return sendBinary(response, glb, "model/gltf-binary");
}
```

- [ ] **Step 6: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/environmentRoutes.ts server/viteApiPlugin.ts tests/environmentRoutesExport.test.ts
git commit -m "feat: add environment export API routes (compile, then serve manifest and model separately)"
```

---

### Task 4: Import routes — stage, validate, commit

**Files:**
- Modify: `server/environmentRoutes.ts` (add the import-staging portion)
- Modify: `server/viteApiPlugin.ts`
- Test: `tests/environmentRoutesImport.test.ts`

**Interfaces:**
- Consumes: `validateEnvironmentPackage` from `../src/environment/packageValidator` (foundation plan); `safeId` from `./sceneStore` (Task 2); `createEnvironmentPackageStore` from `./environmentPackageStore` (Task 2).
- Produces: `createEnvironmentImportStaging(sceneRoot: string)` returning `{ stageManifest(sceneId, manifestJson: string): Promise<void>; stageModel(sceneId, glb: Buffer): Promise<void>; commit(sceneId, environmentStore): Promise<{ status: "ok"; sha256: string; manifestVersion: number } | { status: "error"; diagnostics: string[] }> }`. `viteApiPlugin.ts` wires three routes to this (stage manifest, stage model, commit) and, on a successful commit, patches the persisted scene's `environment` field via `store.save`.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentRoutesImport.test.ts`:

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEnvironmentImportStaging } from "../server/environmentRoutes";
import { createEnvironmentPackageStore } from "../server/environmentPackageStore";
import { sha256Hex } from "../src/environment/manifestEncoder";

describe("createEnvironmentImportStaging", () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("commit fails when only one of the two files has been staged", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-import-"));
    const staging = createEnvironmentImportStaging(root);
    const environmentStore = createEnvironmentPackageStore(root);
    await staging.stageManifest("scene-1", "{}");

    const result = await staging.commit("scene-1", environmentStore);

    expect(result).toEqual({ status: "error", diagnostics: ["Both environment.json and environment.glb must be uploaded before committing."] });
  });

  test("commit rejects an invalid pair and leaves no committed package", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-import-"));
    const staging = createEnvironmentImportStaging(root);
    const environmentStore = createEnvironmentPackageStore(root);
    await staging.stageManifest("scene-1", JSON.stringify({ format: "wrong-format" }));
    await staging.stageModel("scene-1", Buffer.from([1, 2, 3]));

    const result = await staging.commit("scene-1", environmentStore);

    expect(result.status).toBe("error");
    expect(await environmentStore.read("scene-1")).toBeNull();
  });

  test("commit accepts a valid pair, replaces the store, and clears staging", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-import-"));
    const staging = createEnvironmentImportStaging(root);
    const environmentStore = createEnvironmentPackageStore(root);
    const glb = buildMinimalGlb();
    const manifest = minimalManifest(sha256Hex(glb));
    await staging.stageManifest("scene-1", JSON.stringify(manifest));
    await staging.stageModel("scene-1", glb);

    const result = await staging.commit("scene-1", environmentStore);

    expect(result).toEqual({ status: "ok", sha256: manifest.model.sha256, manifestVersion: 1 });
    expect(await environmentStore.read("scene-1")).toEqual({ manifest: JSON.stringify(manifest), glb });
  });
});

function buildMinimalGlb(): Buffer {
  const json = JSON.stringify({ nodes: [{ name: "SteerlabEnvironment" }] });
  const padded = json + " ".repeat((4 - (json.length % 4)) % 4);
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

function minimalManifest(sha256: string) {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentRoutesImport.test.ts`
Expected: FAIL — `createEnvironmentImportStaging` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `server/environmentRoutes.ts`:

```typescript
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateEnvironmentPackage } from "../src/environment/packageValidator";
import { safeId } from "./sceneStore";
import type { createEnvironmentPackageStore } from "./environmentPackageStore";

export type CommitEnvironmentImportResult = { status: "ok"; sha256: string; manifestVersion: number } | { status: "error"; diagnostics: string[] };

/** Stages an uploaded manifest and model as two separate payloads, then validates and commits them as one unit. */
export function createEnvironmentImportStaging(sceneRoot: string) {
  const stagingDir = (sceneId: string) => join(sceneRoot, `${safeId(sceneId)}.environment.staging`);

  return {
    async stageManifest(sceneId: string, manifestJson: string): Promise<void> {
      const dir = stagingDir(sceneId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "environment.json"), manifestJson, "utf8");
    },

    async stageModel(sceneId: string, glb: Buffer): Promise<void> {
      const dir = stagingDir(sceneId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "environment.glb"), glb);
    },

    async commit(sceneId: string, environmentStore: ReturnType<typeof createEnvironmentPackageStore>): Promise<CommitEnvironmentImportResult> {
      const dir = stagingDir(sceneId);
      let manifestJson: string;
      let glb: Buffer;
      try {
        [manifestJson, glb] = await Promise.all([readFile(join(dir, "environment.json"), "utf8"), readFile(join(dir, "environment.glb"))]);
      } catch {
        return { status: "error", diagnostics: ["Both environment.json and environment.glb must be uploaded before committing."] };
      }

      let manifestValue: unknown;
      try {
        manifestValue = JSON.parse(manifestJson);
      } catch {
        return { status: "error", diagnostics: ["environment.json is not valid JSON."] };
      }

      const validation = validateEnvironmentPackage(manifestValue, glb);
      if (!validation.valid) return { status: "error", diagnostics: validation.diagnostics };

      await environmentStore.replace(sceneId, manifestJson, glb);
      await rm(dir, { recursive: true, force: true });

      const manifest = manifestValue as { model: { sha256: string }; formatVersion: number };
      return { status: "ok", sha256: manifest.model.sha256, manifestVersion: manifest.formatVersion };
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentRoutesImport.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the import routes into the middleware**

In `server/viteApiPlugin.ts`, add the staging instance:

```typescript
import { createEnvironmentImportStaging } from "./environmentRoutes";
// ...
const environmentImports = createEnvironmentImportStaging(sceneRoot);
```

Add a raw-body byte reader alongside `readJson` (binary uploads aren't JSON):

```typescript
async function readBuffer(request: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
```

Add three routes after the export routes:

```typescript
const importManifestMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/import\/manifest$/);
if (importManifestMatch && method === "POST") {
  const id = decodeURIComponent(importManifestMatch[1]);
  await environmentImports.stageManifest(id, (await readBuffer(request)).toString("utf8"));
  response.statusCode = 204;
  response.end();
  return;
}

const importModelMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/import\/model$/);
if (importModelMatch && method === "POST") {
  const id = decodeURIComponent(importModelMatch[1]);
  await environmentImports.stageModel(id, await readBuffer(request));
  response.statusCode = 204;
  response.end();
  return;
}

const importCommitMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/import\/commit$/);
if (importCommitMatch && method === "POST") {
  const id = decodeURIComponent(importCommitMatch[1]);
  const result = await environmentImports.commit(id, environmentStore);
  if (result.status === "error") return sendJson(response, { error: result.diagnostics.join(" ") }, 400);
  const scene = await store.open(id);
  const updated = await store.save({ ...scene, environment: { sha256: result.sha256, manifestVersion: result.manifestVersion } });
  return sendJson(response, { scene: updated });
}
```

- [ ] **Step 6: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/environmentRoutes.ts server/viteApiPlugin.ts tests/environmentRoutesImport.test.ts
git commit -m "feat: add environment import API routes (stage, validate, commit)"
```

---

### Task 5: Client API wrappers

**Files:**
- Modify: `src/api/client.ts`

**Interfaces:**
- Consumes: the routes from Tasks 3-4.
- Produces: `exportEnvironmentRequest(scene: Scene, options: { chunkSize: number; removeSeamFaces: boolean }): Promise<{ exportId: string; manifest: EnvironmentManifest; metrics: EnvironmentCompileMetrics }>`; `fetchExportedEnvironmentModel(sceneId: string, exportId: string): Promise<Uint8Array>`; `uploadEnvironmentManifestRequest(sceneId: string, manifestJson: string): Promise<void>`; `uploadEnvironmentModelRequest(sceneId: string, glb: Uint8Array): Promise<void>`; `commitEnvironmentImportRequest(sceneId: string): Promise<Scene>`. A later editor-UI plan's `EditorState.exportEnvironment`/`importEnvironment` call these directly — no test is added here since `src/api/client.ts`'s existing functions have no dedicated unit tests either (they're thin `fetch` wrappers, exercised indirectly through `EditorState` tests); this task is code-only.

- [ ] **Step 1: Add the export wrappers**

In `src/api/client.ts`, add imports for `EnvironmentCompileMetrics` and `EnvironmentManifest` from `../environment/compiler` and `../environment/types`, then:

```typescript
export async function exportEnvironmentRequest(scene: Scene, options: { chunkSize: number; removeSeamFaces: boolean }) {
  return request<{ exportId: string; manifest: EnvironmentManifest; metrics: EnvironmentCompileMetrics }>(
    `/api/scenes/${encodeURIComponent(scene.id)}/environment/export`,
    { method: "POST", body: JSON.stringify({ scene, options }) }
  );
}

export async function fetchExportedEnvironmentModel(sceneId: string, exportId: string): Promise<Uint8Array> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/environment/export/${encodeURIComponent(exportId)}/model`);
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
```

- [ ] **Step 2: Add the import wrappers**

```typescript
export async function uploadEnvironmentManifestRequest(sceneId: string, manifestJson: string): Promise<void> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/environment/import/manifest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: manifestJson
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
}

export async function uploadEnvironmentModelRequest(sceneId: string, glb: Uint8Array): Promise<void> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/environment/import/model`, {
    method: "POST",
    headers: { "Content-Type": "model/gltf-binary" },
    body: glb
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
}

export async function commitEnvironmentImportRequest(sceneId: string): Promise<Scene> {
  return (await request<{ scene: Scene }>(`/api/scenes/${encodeURIComponent(sceneId)}/environment/import/commit`, { method: "POST" })).scene;
}
```

Note: `uploadEnvironmentManifestRequest`/`uploadEnvironmentModelRequest` call `fetch` directly instead of the shared `request<T>()` helper, because `request<T>()` always sends `Content-Type: application/json` and always parses the response as JSON — both wrong for a raw-binary/raw-text upload whose successful response is `204 No Content`.

- [ ] **Step 3: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/api/client.ts
git commit -m "feat: add client API wrappers for environment export/import"
```

---

### Task 6: Serve the committed package for reloading on scene open

**Files:**
- Modify: `server/viteApiPlugin.ts`
- Modify: `src/api/client.ts`

**Interfaces:**
- Consumes: `environmentStore.read(sceneId)` from Task 2.
- Produces: `GET /api/scenes/:id/environment` returning `{ manifest: EnvironmentManifest | null }`; `GET /api/scenes/:id/environment/model` returning the committed GLB bytes (404 if none); client wrappers `fetchCommittedEnvironmentManifest(sceneId): Promise<EnvironmentManifest | null>` and `fetchCommittedEnvironmentModel(sceneId): Promise<Uint8Array>`. The editor-UI plan's locked-environment feature calls these on scene open, whereas Task 3's export routes only ever serve a package the client just compiled in the current session — a scene reopened later (or in a different browser tab) has no in-memory export to fetch, only the committed one on disk.

- [ ] **Step 1: Add the routes**

In `server/viteApiPlugin.ts`, add after the existing environment routes:

```typescript
const committedManifestMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment$/);
if (committedManifestMatch && method === "GET") {
  const committed = await environmentStore.read(decodeURIComponent(committedManifestMatch[1]));
  return sendJson(response, { manifest: committed ? JSON.parse(committed.manifest) : null });
}

const committedModelMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/model$/);
if (committedModelMatch && method === "GET") {
  const committed = await environmentStore.read(decodeURIComponent(committedModelMatch[1]));
  if (!committed) return sendJson(response, { error: "Not found" }, 404);
  return sendBinary(response, committed.glb, "model/gltf-binary");
}
```

Place these **before** the generic `/api/scenes/:id` routes' regex matching, or ensure the `/environment` and `/environment/...` suffixes are checked first — the existing `sceneMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)$/)` pattern only matches a bare scene ID with no further path segments, so it will not collide with `/api/scenes/:id/environment`; no reordering is actually required, but keep the environment routes grouped together for readability.

- [ ] **Step 2: Add the client wrappers**

In `src/api/client.ts`:

```typescript
export async function fetchCommittedEnvironmentManifest(sceneId: string): Promise<EnvironmentManifest | null> {
  return (await request<{ manifest: EnvironmentManifest | null }>(`/api/scenes/${encodeURIComponent(sceneId)}/environment`)).manifest;
}

export async function fetchCommittedEnvironmentModel(sceneId: string): Promise<Uint8Array> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/environment/model`);
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
```

- [ ] **Step 3: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/viteApiPlugin.ts src/api/client.ts
git commit -m "feat: serve the committed environment package for reloading on scene open"
```

---

## What this plan does not cover

- The Project panel's Export/Import UI, `EditorState.exportEnvironment`/`importEnvironment`, the File System Access API integration, and the locked environment world feature — a separate editor-UI plan.
- Package composition (re-exporting with a previously attached environment) — deferred by the compiler plan; the export route here always compiles the given scene as a fresh package.
