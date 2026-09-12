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
    // The implementation visits each adjacent pair once via a canonical "north or east" direction
    // preference (see navigationGraph.ts), so for a north/south pair the edge is reported from the
    // higher-row cell (whose matching port faces north) to the lower-row cell. This is also the
    // behavior independently verified for the rotated fixture below; bidirectional: true means the
    // from/to labeling carries no semantic weight for graph traversal.
    expect(graph.edges[0]).toMatchObject({ fromNodeId: "nav_c-0-1", toNodeId: "nav_c-0-0", channel: "road", bidirectional: true });
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

  test("rotates authored ports to world-facing directions before matching adjacent cells", () => {
    // Both cells share one asset whose only authored (rotation-0) port faces "east". Neither
    // cell is placed at rotation 0, so this only produces an edge if the rotation is actually
    // applied before matching — a rotation-unaware implementation (or one that accidentally
    // rotates the wrong way) would find no connecting ports here.
    const assets: AssetCatalogEntry[] = [
      {
        id: "tiles.corner",
        label: "Corner",
        category: "3d-road-tiles",
        source: "shared",
        implementation: "glb",
        semantics: { roles: [], sockets: { east: { type: "road" } } }
      }
    ];
    const cells: EnvironmentManifestCell[] = [
      cellFixture({ id: "c-0-0", column: 0, row: 0, rotationY: Math.PI / 2, assetId: "tiles.corner" }), // authored east -> world south
      cellFixture({ id: "c-0-1", column: 0, row: 1, rotationY: (3 * Math.PI) / 2, assetId: "tiles.corner" }) // authored east -> world north
    ];

    const graph = buildNavigationGraph(cells, recipeStub(), assets);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ fromNodeId: "nav_c-0-1", toNodeId: "nav_c-0-0", direction: "north", channel: "road", bidirectional: true });
  });
});

function cellFixture(options: { id: string; column: number; row: number; rotationY?: number; assetId?: string }): EnvironmentManifestCell {
  return {
    id: options.id,
    column: options.column,
    row: options.row,
    transform: { position: { x: options.column, y: 0, z: options.row }, rotationY: options.rotationY ?? 0, scale: 1 },
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    sourceAssetId: options.assetId ?? "tiles.straight",
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
