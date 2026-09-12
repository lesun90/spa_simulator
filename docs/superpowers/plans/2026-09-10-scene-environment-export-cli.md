# Scene Environment Export — CLI Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run scene:export` — a headless CLI that generates a WFC scene and compiles it straight to an `environment.glb` + `environment.json` package, using the exact same `generateWfcScene` and `compileEnvironmentPackage` the editor uses, so GUI and CLI produce the same ordered scene recipe for the same seed/dimensions/cell size/catalog.

**Architecture:** This is the third of several plans implementing `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`. It depends on `generateWfcScene` (`src/wfc/sceneGenerator.ts`, foundation plan), `buildSceneRecipe` (`src/environment/sceneRecipe.ts`, foundation plan), and `compileEnvironmentPackage` (`src/environment/compiler.ts`, compiler plan) — verify all three exist before starting. This plan's only new production code is: a pure function that fabricates a minimal headless `Scene` from a generation result (so `buildSceneRecipe` has something to consume without a real editor session), argv parsing/validation, staged file writing, and the orchestration + entry point that wires it all together. It follows this repo's existing CLI convention exactly (`scripts/buildAssetFolder.ts` + `scripts/importAssets.ts`): a testable logic module plus a thin `process.argv`/`process.exit`-touching entry point run via `vite-node`.

**Tech Stack:** TypeScript, `vite-node` (already the project's CLI runner — see `package.json`'s `assets:*` scripts), Vitest, Node's `node:fs/promises`.

**Spec:** `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`

## Global Constraints

- Required CLI arguments: `--width`/`--depth` or `--size` (mutually exclusive with the pair), `--cell-size`, `--seed`, `--output`.
- Optional CLI arguments and their defaults: `--chunk-size` (10), `--remove-seam-faces` (false), `--asset-root` (`./assets`), `--force` (false, permits replacing the two known output files).
- Width and depth: integers from 1 through 100. Cell size: must exceed zero. Seed: an unsigned 32-bit integer. Chunk size: zero or a positive integer.
- Without `--force`, the CLI rejects an output directory that already contains `environment.glb` or `environment.json`, and never removes unrelated files in that directory.
- On success, the CLI prints cell, object, chunk, mesh, instance, draw-call estimate, triangle, removed-face, file-size, seed, and elapsed-time metrics. On failure, it prints one specific diagnostic, removes any staging files, and exits with a nonzero status (`process.exitCode = 1`, matching `scripts/importAssets.ts`'s convention — never `process.exit(1)` inside testable logic).
- Follows the existing script-pair convention: a `runCli`-style function that stays unit-testable without touching `process`, plus a thin entry-point file that parses `process.argv` and sets `process.exitCode` on failure.

---

## File Structure

- **Create** `src/environment/sceneFromGeneration.ts` — `sceneFromGeneration`.
- **Create** `scripts/exportEnvironmentCli.ts` — `parseExportArgs`, `runExportCli`, file-staging helpers.
- **Create** `scripts/exportEnvironment.ts` — thin entry point (mirrors `scripts/importAssets.ts`).
- **Modify** `package.json` — add the `scene:export` script.
- **Test** `tests/environmentSceneFromGeneration.test.ts`, `tests/exportEnvironmentCli.test.ts` — both new.

---

### Task 1: Fabricate a headless `Scene` from a generation result

**Files:**
- Create: `src/environment/sceneFromGeneration.ts`
- Test: `tests/environmentSceneFromGeneration.test.ts`

**Interfaces:**
- Consumes: `Scene`, `createScene`, `DEFAULT_GROUND_COLOR`, `defaultSurfaceAppearance` from `../editor-core/scene`; the `"solved"` branch of `GenerateWfcSceneResult` and `GenerateWfcLayoutRequest` from `../wfc/sceneGenerator`/`../wfc/sceneLayout`.
- Produces: `sceneFromGeneration(result: Extract<GenerateWfcSceneResult, { status: "solved" }>, request: GenerateWfcLayoutRequest): Scene`. Task 4 (`runExportCli`) calls this immediately after a successful `generateWfcScene`, then passes the result straight to `buildSceneRecipe`.

- [ ] **Step 1: Write the failing test**

Create `tests/environmentSceneFromGeneration.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { DEFAULT_GROUND_COLOR } from "../src/editor-core/scene";
import { sceneFromGeneration } from "../src/environment/sceneFromGeneration";
import type { GenerateWfcSceneResult } from "../src/wfc/sceneGenerator";

describe("sceneFromGeneration", () => {
  test("builds a Scene whose grid is world-sized from the request's cell size, with the CLI's default ground", () => {
    const result: Extract<GenerateWfcSceneResult, { status: "solved" }> = {
      status: "solved",
      seed: 42,
      roadScene: false,
      objects: [
        { id: "wfc-0-0", assetId: "tiles.a", name: "tile", position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 }
      ],
      palette: { tileWidth: 3, tileDepth: 3 } as never,
      decisions: 1,
      backtracks: 0
    };

    const scene = sceneFromGeneration(result, { width: 4, depth: 5, seed: 42, tileWidth: 3, tileDepth: 3 });

    expect(scene.grid).toEqual({ cellSize: 3, width: 12, depth: 15 });
    expect(scene.ground).toEqual({ type: "color", color: DEFAULT_GROUND_COLOR, textureUrl: null });
    expect(scene.objects).toBe(result.objects);
    expect(scene.name).toBe("cli-42");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/environmentSceneFromGeneration.test.ts`
Expected: FAIL — "Cannot find module '../src/environment/sceneFromGeneration'"

- [ ] **Step 3: Write minimal implementation**

Create `src/environment/sceneFromGeneration.ts`:

```typescript
import { createId, defaultSurfaceAppearance, DEFAULT_BACKGROUND_COLOR, DEFAULT_GROUND_COLOR, type Scene } from "../editor-core/scene";
import type { GenerateWfcLayoutRequest } from "../wfc/sceneLayout";
import type { GenerateWfcSceneResult } from "../wfc/sceneGenerator";

type SolvedGeneration = Extract<GenerateWfcSceneResult, { status: "solved" }>;

/** Fabricates a minimal editable Scene from a headless generation so buildSceneRecipe has a Scene to consume. */
export function sceneFromGeneration(result: SolvedGeneration, request: GenerateWfcLayoutRequest): Scene {
  return {
    id: createId("scene"),
    name: `cli-${result.seed}`,
    description: "",
    grid: { cellSize: request.tileWidth, width: request.width * request.tileWidth, depth: request.depth * request.tileDepth },
    background: defaultSurfaceAppearance(DEFAULT_BACKGROUND_COLOR),
    ground: defaultSurfaceAppearance(DEFAULT_GROUND_COLOR),
    objects: result.objects
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/environmentSceneFromGeneration.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/environment/sceneFromGeneration.ts tests/environmentSceneFromGeneration.test.ts
git commit -m "feat: build a headless Scene from a CLI WFC generation result"
```

---

### Task 2: Argument parsing and validation

**Files:**
- Create: `scripts/exportEnvironmentCli.ts` (argument-parsing portion only — orchestration is added in Task 4)
- Test: `tests/exportEnvironmentCli.test.ts` (argument-parsing portion only)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ExportCliOptions = { width: number; depth: number; cellSize: number; seed: number; chunkSize: number; output: string; removeSeamFaces: boolean; assetRoot: string; force: boolean }`; `parseExportArgs(argv: string[]): ExportCliOptions`, throwing `Error` with a specific message on any invalid combination. Task 4's `runExportCli` calls this first.

- [ ] **Step 1: Write the failing test**

Create `tests/exportEnvironmentCli.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { parseExportArgs } from "../scripts/exportEnvironmentCli";

describe("parseExportArgs", () => {
  test("parses required arguments with documented defaults", () => {
    const options = parseExportArgs(["--width", "10", "--depth", "20", "--cell-size", "2", "--seed", "5", "--output", "./out"]);

    expect(options).toEqual({
      width: 10,
      depth: 20,
      cellSize: 2,
      seed: 5,
      output: "./out",
      chunkSize: 10,
      removeSeamFaces: false,
      assetRoot: "./assets",
      force: false
    });
  });

  test("--size is square shorthand for --width and --depth", () => {
    const options = parseExportArgs(["--size", "50", "--cell-size", "1", "--seed", "1", "--output", "./out"]);

    expect(options.width).toBe(50);
    expect(options.depth).toBe(50);
  });

  test("rejects mixing --size with --width or --depth", () => {
    expect(() => parseExportArgs(["--size", "50", "--width", "10", "--cell-size", "1", "--seed", "1", "--output", "./out"])).toThrow(
      "--size cannot be combined with --width or --depth"
    );
  });

  test("rejects width or depth outside 1-100", () => {
    expect(() => parseExportArgs(["--width", "101", "--depth", "10", "--cell-size", "1", "--seed", "1", "--output", "./out"])).toThrow(
      "--width must be an integer from 1 through 100"
    );
  });

  test("rejects a non-positive cell size", () => {
    expect(() => parseExportArgs(["--width", "10", "--depth", "10", "--cell-size", "0", "--seed", "1", "--output", "./out"])).toThrow(
      "--cell-size must be greater than zero"
    );
  });

  test("rejects a seed outside unsigned 32-bit range", () => {
    expect(() => parseExportArgs(["--width", "10", "--depth", "10", "--cell-size", "1", "--seed", "-1", "--output", "./out"])).toThrow(
      "--seed must be an unsigned 32-bit integer"
    );
  });

  test("rejects a negative chunk size", () => {
    expect(() =>
      parseExportArgs(["--width", "10", "--depth", "10", "--cell-size", "1", "--seed", "1", "--output", "./out", "--chunk-size", "-1"])
    ).toThrow("--chunk-size must be zero or a positive integer");
  });

  test("requires --output", () => {
    expect(() => parseExportArgs(["--width", "10", "--depth", "10", "--cell-size", "1", "--seed", "1"])).toThrow("--output is required");
  });

  test("sets --remove-seam-faces and --force as boolean flags", () => {
    const options = parseExportArgs([
      "--width", "10", "--depth", "10", "--cell-size", "1", "--seed", "1", "--output", "./out", "--remove-seam-faces", "--force"
    ]);

    expect(options.removeSeamFaces).toBe(true);
    expect(options.force).toBe(true);
  });

  test("rejects an unknown option", () => {
    expect(() => parseExportArgs(["--bogus"])).toThrow("Unknown option: --bogus");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/exportEnvironmentCli.test.ts`
Expected: FAIL — "Cannot find module '../scripts/exportEnvironmentCli'"

- [ ] **Step 3: Write minimal implementation**

Create `scripts/exportEnvironmentCli.ts`:

```typescript
export interface ExportCliOptions {
  width: number;
  depth: number;
  cellSize: number;
  seed: number;
  chunkSize: number;
  output: string;
  removeSeamFaces: boolean;
  assetRoot: string;
  force: boolean;
}

export function parseExportArgs(argv: string[]): ExportCliOptions {
  let width: number | undefined;
  let depth: number | undefined;
  let size: number | undefined;
  let cellSize: number | undefined;
  let seed: number | undefined;
  let output: string | undefined;
  let chunkSize = 10;
  let removeSeamFaces = false;
  let assetRoot = "./assets";
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case "--width":
        width = Number.parseInt(next(), 10);
        break;
      case "--depth":
        depth = Number.parseInt(next(), 10);
        break;
      case "--size":
        size = Number.parseInt(next(), 10);
        break;
      case "--cell-size":
        cellSize = Number.parseFloat(next());
        break;
      case "--seed":
        seed = Number.parseInt(next(), 10);
        break;
      case "--chunk-size":
        chunkSize = Number.parseInt(next(), 10);
        break;
      case "--output":
        output = next();
        break;
      case "--asset-root":
        assetRoot = next();
        break;
      case "--remove-seam-faces":
        removeSeamFaces = true;
        break;
      case "--force":
        force = true;
        break;
      case "--help":
        printExportHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (size !== undefined && (width !== undefined || depth !== undefined)) {
    throw new Error("--size cannot be combined with --width or --depth");
  }
  const resolvedWidth = size ?? width;
  const resolvedDepth = size ?? depth;
  if (!isIntegerInRange(resolvedWidth, 1, 100)) throw new Error("--width must be an integer from 1 through 100");
  if (!isIntegerInRange(resolvedDepth, 1, 100)) throw new Error("--depth must be an integer from 1 through 100");
  if (!(typeof cellSize === "number" && Number.isFinite(cellSize) && cellSize > 0)) throw new Error("--cell-size must be greater than zero");
  if (!isIntegerInRange(seed, 0, 0xffffffff)) throw new Error("--seed must be an unsigned 32-bit integer");
  if (!isIntegerInRange(chunkSize, 0, Number.MAX_SAFE_INTEGER)) throw new Error("--chunk-size must be zero or a positive integer");
  if (!output) throw new Error("--output is required");

  return { width: resolvedWidth, depth: resolvedDepth, cellSize, seed: seed!, chunkSize, output, removeSeamFaces, assetRoot, force };
}

function isIntegerInRange(value: number | undefined, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function printExportHelp() {
  console.log(`Usage:
  npm run scene:export -- --width 100 --depth 100 --cell-size 1 --seed 12345 --output ./exports/city-12345 [--chunk-size 10] [--remove-seam-faces] [--asset-root ./assets] [--force]
  npm run scene:export -- --size 100 --cell-size 1 --seed 12345 --output ./exports/city-12345
`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/exportEnvironmentCli.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/exportEnvironmentCli.ts tests/exportEnvironmentCli.test.ts
git commit -m "feat: add scene:export CLI argument parsing and validation"
```

---

### Task 3: Staged package file writing

**Files:**
- Modify: `scripts/exportEnvironmentCli.ts` (add the writing helper alongside the parsing code from Task 2)
- Test: `tests/exportEnvironmentCli.test.ts` (extend)

**Interfaces:**
- Consumes: Node's `node:fs/promises` (`mkdir`, `mkdtemp`, `writeFile`, `rename`, `rm`, `stat`).
- Produces: `writePackageFiles(outputDir: string, manifestJson: string, glb: Uint8Array, force: boolean): Promise<void>`, throwing when the output directory already contains either fixed filename and `force` is false. Task 4's `runExportCli` calls this after a successful compile, and on any thrown error re-throws after this function's own `finally` has already removed its staging directory (so the CLI's outer catch never has to clean up staging itself).

- [ ] **Step 1: Write the failing test**

Add to `tests/exportEnvironmentCli.test.ts`:

```typescript
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseExportArgs, writePackageFiles } from "../scripts/exportEnvironmentCli";

describe("writePackageFiles", () => {
  let outputDir: string;

  afterEach(async () => {
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
  });

  test("writes both fixed-name files into a fresh output directory, leaving no staging directory behind", async () => {
    outputDir = await mkdtemp(join(tmpdir(), "steerlab-export-"));
    await rm(outputDir, { recursive: true, force: true });

    await writePackageFiles(outputDir, '{"format":"steerlab-environment"}', new Uint8Array([1, 2, 3]), false);

    expect(await readFile(join(outputDir, "environment.json"), "utf8")).toBe('{"format":"steerlab-environment"}');
    expect(await readFile(join(outputDir, "environment.glb"))).toEqual(Buffer.from([1, 2, 3]));
    const remaining = await readdir(outputDir);
    expect(remaining.sort()).toEqual(["environment.glb", "environment.json"]);
  });

  test("rejects an existing package without --force, and leaves the existing files untouched", async () => {
    outputDir = await mkdtemp(join(tmpdir(), "steerlab-export-"));
    await writeFile(join(outputDir, "environment.json"), "old-manifest");

    await expect(writePackageFiles(outputDir, "new-manifest", new Uint8Array(), false)).rejects.toThrow(
      "Output directory already contains an environment package; pass --force to replace it."
    );
    expect(await readFile(join(outputDir, "environment.json"), "utf8")).toBe("old-manifest");
  });

  test("replaces an existing package when --force is set", async () => {
    outputDir = await mkdtemp(join(tmpdir(), "steerlab-export-"));
    await writeFile(join(outputDir, "environment.json"), "old-manifest");
    await writeFile(join(outputDir, "environment.glb"), "old-glb");

    await writePackageFiles(outputDir, "new-manifest", new Uint8Array([9]), true);

    expect(await readFile(join(outputDir, "environment.json"), "utf8")).toBe("new-manifest");
    expect(await readFile(join(outputDir, "environment.glb"))).toEqual(Buffer.from([9]));
  });

  test("does not remove unrelated files already in the output directory", async () => {
    outputDir = await mkdtemp(join(tmpdir(), "steerlab-export-"));
    await writeFile(join(outputDir, "notes.txt"), "keep me");

    await writePackageFiles(outputDir, "manifest", new Uint8Array(), false);

    expect(await readFile(join(outputDir, "notes.txt"), "utf8")).toBe("keep me");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/exportEnvironmentCli.test.ts`
Expected: FAIL — `writePackageFiles` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/exportEnvironmentCli.ts`:

```typescript
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writePackageFiles(outputDir: string, manifestJson: string, glb: Uint8Array, force: boolean): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const manifestPath = join(outputDir, "environment.json");
  const glbPath = join(outputDir, "environment.glb");

  if (!force) {
    const existing = await readdir(outputDir);
    if (existing.includes("environment.json") || existing.includes("environment.glb")) {
      throw new Error("Output directory already contains an environment package; pass --force to replace it.");
    }
  }

  const stagingDir = await mkdtemp(join(outputDir, ".environment-export-"));
  try {
    await writeFile(join(stagingDir, "environment.json"), manifestJson, "utf8");
    await writeFile(join(stagingDir, "environment.glb"), glb);
    await rename(join(stagingDir, "environment.json"), manifestPath);
    await rename(join(stagingDir, "environment.glb"), glbPath);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
```

(Move the `import { mkdir, ... } from "node:fs/promises"` line to the top of the file alongside the existing imports rather than leaving it mid-file — this snippet shows the addition in isolation.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/exportEnvironmentCli.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/exportEnvironmentCli.ts tests/exportEnvironmentCli.test.ts
git commit -m "feat: write scene:export package files through a staging directory"
```

---

### Task 4: CLI orchestration

**Files:**
- Modify: `scripts/exportEnvironmentCli.ts` (add `runExportCli`)
- Test: `tests/exportEnvironmentCli.test.ts` (extend)

**Interfaces:**
- Consumes: `discoverAssetCatalog` from `../server/assetCatalog`; `generateWfcScene` from `../src/wfc/sceneGenerator`; `sceneFromGeneration` from `../src/environment/sceneFromGeneration` (Task 1); `buildSceneRecipe` from `../src/environment/sceneRecipe` (foundation plan); `compileEnvironmentPackage` from `../src/environment/compiler` (compiler plan); `canonicalJson` from `../src/environment/manifestEncoder` (foundation plan); `parseExportArgs`, `writePackageFiles` (this file, Tasks 2-3).
- Produces: `runExportCli(argv: string[]): Promise<void>`, throwing `Error` on any failure (generation failure, missing/unsupported assets, compile failure, write failure) with a message suitable for printing directly — the entry point (Task 5) is the only place that catches it. On success it `console.log`s the metrics line and resolves.

- [ ] **Step 1: Write the failing test**

Add to `tests/exportEnvironmentCli.test.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { runExportCli } from "../scripts/exportEnvironmentCli";

describe("runExportCli", () => {
  let outputDir: string;
  let assetRoot: string;

  afterEach(async () => {
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  test("generates a small scene and writes a valid package, printing metrics", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-cli-assets-"));
    await mkdir(join(assetRoot, "props", "cone"), { recursive: true });
    // A bare asset.json is not enough: discoverAssetFolders only registers a directory containing a
    // .js/.glb/.png file, and paletteFromAssets needs a non-empty, self-tileable wfc.variants entry
    // (all four sides sharing one socket type) for solvePlanarWfc to find any valid palette at all.
    await writeFile(join(assetRoot, "props", "cone", "cone.png"), "");
    await writeFile(
      join(assetRoot, "props", "cone", "asset.json"),
      JSON.stringify({
        id: "props.cone",
        label: "Cone",
        category: "props",
        wfc: {
          height: 1,
          diagnostics: [],
          variants: [
            { variantId: "props.cone@r0", rotationDegrees: 0, sockets: { north: "road", east: "road", south: "road", west: "road", top: "top", bottom: "bottom" } }
          ]
        }
      })
    );
    outputDir = join(await mkdtemp(join(tmpdir(), "steerlab-cli-out-")), "package");

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message: string) => logs.push(message);
    try {
      await runExportCli(["--width", "2", "--depth", "1", "--cell-size", "3", "--seed", "7", "--output", outputDir, "--asset-root", assetRoot]);
    } finally {
      console.log = originalLog;
    }

    const manifest = JSON.parse(await readFile(join(outputDir, "environment.json"), "utf8"));
    expect(manifest.format).toBe("steerlab-environment");
    expect(logs.some((line) => line.includes("seed 7"))).toBe(true);
  });

  test("throws a specific diagnostic and leaves no output when generation fails", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-cli-assets-"));
    outputDir = join(await mkdtemp(join(tmpdir(), "steerlab-cli-out-")), "package");

    await expect(
      runExportCli(["--width", "2", "--depth", "1", "--cell-size", "3", "--seed", "7", "--output", outputDir, "--asset-root", assetRoot])
    ).rejects.toThrow();
    await expect(readFile(join(outputDir, "environment.json"), "utf8")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/exportEnvironmentCli.test.ts`
Expected: FAIL — `runExportCli` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/exportEnvironmentCli.ts`:

```typescript
import { discoverAssetCatalog } from "../server/assetCatalog";
import { compileEnvironmentPackage } from "../src/environment/compiler";
import { canonicalJson } from "../src/environment/manifestEncoder";
import { buildSceneRecipe } from "../src/environment/sceneRecipe";
import { sceneFromGeneration } from "../src/environment/sceneFromGeneration";
import { generateWfcScene } from "../src/wfc/sceneGenerator";

const GENERATOR_VERSION = "0.1.0";

export async function runExportCli(argv: string[]): Promise<void> {
  const options = parseExportArgs(argv);
  const assets = await discoverAssetCatalog(options.assetRoot);

  const request = { width: options.width, depth: options.depth, seed: options.seed, tileWidth: options.cellSize, tileDepth: options.cellSize };
  const generation = await generateWfcScene(assets, request);
  if (generation.status === "failed") {
    throw new Error(generation.roadScene ? `Road scene infeasible (seed ${options.seed}): ${generation.diagnostics[0]}` : generation.diagnostics[0]);
  }

  const scene = sceneFromGeneration(generation, request);
  const recipe = buildSceneRecipe(scene, assets);

  const compiled = await compileEnvironmentPackage(recipe, assets, {
    chunkSize: options.chunkSize,
    removeInternalSeamFaces: options.removeSeamFaces,
    assetRoot: options.assetRoot,
    source: "cli",
    generatorVersion: GENERATOR_VERSION
  });
  if ("status" in compiled) throw new Error(compiled.diagnostics[0]);

  await writePackageFiles(options.output, canonicalJson(compiled.manifest), compiled.glb, options.force);

  console.log(
    [
      `cells=${compiled.metrics.cellCount}`,
      `objects=${compiled.metrics.objectCount}`,
      `chunks=${compiled.metrics.chunkCount}`,
      `meshes=${compiled.metrics.meshCount}`,
      `instancedMeshes=${compiled.metrics.instancedMeshCount}`,
      `drawCallEstimate=${compiled.metrics.meshCount + compiled.metrics.instancedMeshCount}`,
      `triangles=${compiled.metrics.triangleCount}`,
      `removedSeamTriangles=${compiled.metrics.removedSeamTriangleCount}`,
      `glbBytes=${compiled.metrics.glbByteLength}`,
      `seed ${options.seed}`,
      `elapsedMs=${compiled.metrics.elapsedMs}`
    ].join(" ")
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/exportEnvironmentCli.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/exportEnvironmentCli.ts tests/exportEnvironmentCli.test.ts
git commit -m "feat: wire scene:export orchestration (generate, compile, write, report metrics)"
```

---

### Task 5: Entry point and package script

**Files:**
- Create: `scripts/exportEnvironment.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runExportCli` from `./exportEnvironmentCli` (Task 4).
- Produces: the `npm run scene:export` command.

- [ ] **Step 1: Create the entry point**

Create `scripts/exportEnvironment.ts` (mirrors `scripts/importAssets.ts` exactly):

```typescript
import { runExportCli } from "./exportEnvironmentCli";

runExportCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the package script**

In `package.json`, add to `"scripts"` (alongside the other `assets:*`/`wfc:*` entries):

```json
"scene:export": "vite-node scripts/exportEnvironment.ts"
```

- [ ] **Step 3: Manually verify the CLI end-to-end against the real asset catalog**

Run: `npm run scene:export -- --width 4 --depth 4 --cell-size 1 --seed 1 --output /tmp/steerlab-export-check --force`
Expected: exits 0, prints a metrics line, and `/tmp/steerlab-export-check/environment.glb` + `environment.json` exist. (If the real catalog has no non-road assets that solve a plain 4x4 grid, add `--asset-root` pointing at a small fixture directory instead — the point of this step is confirming the wired-together CLI runs against real `discoverAssetCatalog` output, not synthetic fixtures.)

- [ ] **Step 4: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/exportEnvironment.ts package.json
git commit -m "feat: add npm run scene:export entry point"
```

---

## What this plan does not cover

- The editor's own Export/Import UI and the API routes it calls (a separate server plan) — this CLI never talks to the Vite dev server; it runs the same generation/compile pipeline standalone.
- Package composition (re-exporting with a previously attached environment) — the CLI never has an attached environment, so this doesn't apply here, but the compiler itself defers it (see the compiler plan).
