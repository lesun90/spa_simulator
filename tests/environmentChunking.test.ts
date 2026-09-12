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
    expect([...assignment.groundChunkIds].sort()).toEqual(["chunk_0_0", "chunk_1_0"]);
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
