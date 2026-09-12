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
