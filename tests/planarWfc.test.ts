import { describe, expect, test } from "vitest";
import { arePlanarNeighborsCompatible, createPlanarPalette, solvePlanarWfc, type PlanarWfcVariant } from "../src/wfc/planarWfc";
import { sceneObjectsFromWfcResult } from "../src/wfc/sceneLayout";

const sockets = (north: string, east: string, south: string, west: string) => ({ north, east, south, west, top: "top", bottom: "bottom" });

const variants: PlanarWfcVariant[] = [
  { id: "straight-ns", assetId: "tiles.straight", rotationDegrees: 0, weight: 1, sockets: sockets("road", "grass", "road", "grass") },
  { id: "straight-ew", assetId: "tiles.straight", rotationDegrees: 90, weight: 1, sockets: sockets("grass", "road", "grass", "road") },
  { id: "grass", assetId: "tiles.grass", rotationDegrees: 0, weight: 2, sockets: sockets("grass", "grass", "grass", "grass") }
];

const palette = createPlanarPalette("test", 3, 3, variants);

describe("planar WFC", () => {
  test("repeats an exact seeded solution", () => {
    const first = solvePlanarWfc(palette, { width: 6, depth: 5, seed: 481516 });
    const second = solvePlanarWfc(palette, { width: 6, depth: 5, seed: 481516 });

    expect(first).toEqual(second);
  });

  test("returns a fully connected layout", () => {
    const result = solvePlanarWfc(palette, { width: 8, depth: 7, seed: 42 });
    expect(result.status).toBe("solved");
    if (result.status !== "solved") return;

    const byPosition = new Map(result.cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
    for (const cell of result.cells) {
      for (const [direction, column, row] of [
        ["north", cell.column, cell.row + 1],
        ["east", cell.column + 1, cell.row],
        ["south", cell.column, cell.row - 1],
        ["west", cell.column - 1, cell.row]
      ] as const) {
        const neighbor = byPosition.get(`${column},${row}`);
        if (!neighbor) continue;
        expect(arePlanarNeighborsCompatible(palette, cell.variant.id, direction, neighbor.variant.id)).toBe(true);
      }
    }
  });

  test("rejects an empty palette before solving", () => {
    const result = solvePlanarWfc(createPlanarPalette("empty", 3, 3, []), { width: 2, depth: 2, seed: 1 });
    expect(result).toMatchObject({ status: "failed", reason: "invalid-palette" });
  });

  test("keeps asymmetric north and south sockets aligned with rendered Z", () => {
    const asymmetric = createPlanarPalette("asymmetric", 3, 3, [
      { id: "southern", assetId: "tile.south", rotationDegrees: 0, weight: 1, sockets: sockets("join", "east", "south-edge", "west") },
      { id: "northern", assetId: "tile.north", rotationDegrees: 0, weight: 1, sockets: sockets("north-edge", "east", "join", "west") }
    ]);
    const result = solvePlanarWfc(asymmetric, { width: 1, depth: 2, seed: 1 });

    expect(result.status).toBe("solved");
    if (result.status !== "solved") return;
    expect(result.cells.map((cell) => cell.variant.id)).toEqual(["southern", "northern"]);
    expect(arePlanarNeighborsCompatible(asymmetric, "southern", "north", "northern")).toBe(true);
    expect(arePlanarNeighborsCompatible(asymmetric, "northern", "south", "southern")).toBe(true);
    expect(arePlanarNeighborsCompatible(asymmetric, "southern", "south", "northern")).toBe(false);

    const objects = sceneObjectsFromWfcResult(result, { width: 1, depth: 2, seed: 1 }, asymmetric);
    expect(objects.status).toBe("solved");
    if (objects.status === "solved") expect(objects.objects.map((object) => object.position.z)).toEqual([-1.5, 1.5]);
  });

  test("uses deterministic weights and applies semantic policy rejection during search", () => {
    const weighted = createPlanarPalette("weighted", 1, 1, [
      { id: "common", assetId: "common", rotationDegrees: 0, weight: 20, roles: ["terrain"], sockets: sockets("x", "x", "x", "x") },
      { id: "rare", assetId: "rare", rotationDegrees: 0, weight: 1, roles: ["junction"], sockets: sockets("x", "x", "x", "x") }
    ]);
    const first = solvePlanarWfc(weighted, { width: 2, depth: 2, seed: 44 }, { policies: [{ type: "max-role-count", id: "no-junctions", role: "junction", max: 0 }] });
    const second = solvePlanarWfc(weighted, { width: 2, depth: 2, seed: 44 }, { policies: [{ type: "max-role-count", id: "no-junctions", role: "junction", max: 0 }] });
    expect(first).toEqual(second);
    expect(first.status).toBe("solved");
    if (first.status === "solved") expect(first.cells.every((cell) => cell.variant.id === "common")).toBe(true);
  });

  test("biases otherwise equivalent variants by weight across a fixed seed corpus", () => {
    const weighted = createPlanarPalette("weights", 1, 1, [
      { id: "high", assetId: "high", rotationDegrees: 0, weight: 12, sockets: sockets("x", "x", "x", "x") },
      { id: "low", assetId: "low", rotationDegrees: 0, weight: 1, sockets: sockets("x", "x", "x", "x") }
    ]);
    const selections = Array.from({ length: 200 }, (_, seed) => solvePlanarWfc(weighted, { width: 1, depth: 1, seed })).filter((result): result is Extract<typeof result, { status: "solved" }> => result.status === "solved");
    const high = selections.filter((result) => result.cells[0].variant.id === "high").length;
    expect(high).toBeGreaterThan(selections.length * 0.75);
  });
});
