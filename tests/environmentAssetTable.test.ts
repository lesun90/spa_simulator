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
