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
