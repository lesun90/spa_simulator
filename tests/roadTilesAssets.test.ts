import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { arePlanarNeighborsCompatible, createPlanarPalette, solvePlanarWfc } from "../src/wfc/planarWfc";
import { sceneObjectsFromWfcResult } from "../src/wfc/sceneLayout";
import type { RoadTopologyKind, WfcMetadata } from "../src/wfc/metadata/socketTypes";
import { reviewedRoadTopologyKinds } from "../src/wfc/metadata/reviewedRoadTopology";
import { findRoadBoundsSeamMismatches } from "./support/roadWfcSeamHarness";

describe("3d-road-tiles assets", () => {
  test("road tile 148 is centered on the X/Z origin", async () => {
    const bounds = await readGlbPositionBounds("assets/3d-road-tiles/road-tile-148/road-tile-148.glb");

    expect(bounds.min.x).toBeCloseTo(-1.5, 5);
    expect(bounds.max.x).toBeCloseTo(1.5, 5);
    expect(bounds.min.z).toBeCloseTo(-1.5, 5);
    expect(bounds.max.z).toBeCloseTo(1.5, 5);
  });

  test("the catalog includes every road asset with complete WFC sockets", async () => {
    const { variants, completeAssets } = await readRoadVariants();
    expect(variants.length).toBeGreaterThanOrEqual(completeAssets);
    expect(new Set(variants.map((variant) => variant.assetId)).size).toBe(completeAssets);
  });

  test("only the reviewed route assets carry valid road-edge metadata", async () => {
    const folders = (await readdir("assets/3d-road-tiles", { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const observed: Record<string, RoadTopologyKind | undefined> = {};

    for (const folder of folders) {
      const id = folder.name.slice(-3);
      const metadata = JSON.parse(await readFile(join("assets/3d-road-tiles", folder.name, "asset.json"), "utf8")) as { wfc?: WfcMetadata };
      const tags = (metadata.wfc?.variants ?? []).flatMap((variant) => variant.roadTopology ? [variant.roadTopology] : []);
      if (!tags.length) continue;
      observed[id] = tags[0]!.kind;
      expect(tags).toHaveLength(metadata.wfc?.variants.length ?? 0);
      for (const tag of tags) {
        expect(tag.kind).toBe(reviewedRoadTopologyKinds[id]);
        expect(Object.keys(tag.edges)).toHaveLength(edgeCountFor(tag.kind));
        expect(Object.values(tag.edges)).toEqual(Array(Object.keys(tag.edges).length).fill("road"));
      }
    }

    expect(observed).toEqual(reviewedRoadTopologyKinds);
  });

  test("reference road pack solves only socket-compatible seams", async () => {
    const { variants } = await readRoadVariants();
    const result = solvePlanarWfc(createPlanarPalette("reference-roads", 3, 3, variants), {
      width: 6,
      depth: 6,
      seed: 20260909,
      maxBacktracks: 10_000
    });

    expect(result.status).toBe("solved");
    if (result.status !== "solved") return;
    const palette = createPlanarPalette("reference-roads", 3, 3, variants);
    const byPosition = new Map(result.cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
    for (const cell of result.cells) {
      for (const [direction, column, row] of [["east", cell.column + 1, cell.row], ["north", cell.column, cell.row + 1]] as const) {
        const neighbor = byPosition.get(`${column},${row}`);
        if (neighbor) expect(arePlanarNeighborsCompatible(palette, cell.variant.id, direction, neighbor.variant.id)).toBe(true);
      }
    }
  }, 15_000);

  test("solved road layouts share transformed world-space seam planes", async () => {
    const { variants } = await readRoadVariants();
    const palette = createPlanarPalette("road-bounds", 3, 3, variants);
    const result = solvePlanarWfc(palette, { width: 4, depth: 4, seed: 20260909 });
    expect(result.status).toBe("solved");
    if (result.status !== "solved") return;
    const layout = sceneObjectsFromWfcResult(result, { width: 4, depth: 4, seed: 20260909 }, palette);
    expect(layout.status).toBe("solved");
    if (layout.status !== "solved") return;

    expect(await findRoadBoundsSeamMismatches(result.cells, layout.objects)).toEqual([]);
  }, 30_000);

  async function readRoadVariants() {
    const folders = (await readdir("assets/3d-road-tiles", { withFileTypes: true })).filter((entry) => entry.isDirectory());
    const assets = await Promise.all(
      folders.map(async (folder) => JSON.parse(await readFile(join("assets/3d-road-tiles", folder.name, "asset.json"), "utf8")) as { id: string; wfc?: WfcMetadata })
    );
    const completeAssets = assets.filter((asset) => asset.wfc?.variants.length && asset.wfc.variants.every((variant) => ["north", "east", "south", "west"].every((direction) => typeof variant.sockets[direction as "north"] === "string" && variant.sockets[direction as "north"].length > 0))).length;
    const variants = assets.flatMap((asset) => {
      const wfc = asset.wfc;
      if (!wfc || !wfc.variants.every((variant) => ["north", "east", "south", "west"].every((direction) => typeof variant.sockets[direction as "north"] === "string" && variant.sockets[direction as "north"].length > 0))) return [];
      return wfc.variants.map((variant) => ({
        id: variant.variantId,
        assetId: asset.id,
        rotationDegrees: variant.rotationDegrees,
        sockets: variant.sockets,
        weight: variant.weight ?? wfc.defaultWeight ?? 1
      }));
    });
    return { variants, completeAssets };
  }
});

function edgeCountFor(kind: RoadTopologyKind) {
  if (kind === "dead-end") return 1;
  if (kind === "t-junction") return 3;
  if (kind === "four-way") return 4;
  return 2;
}

async function readGlbPositionBounds(file: string) {
  const buffer = await readFile(file);
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error("GLB is missing a JSON chunk.");

  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8")) as {
    accessors?: Array<{ type?: string; min?: number[]; max?: number[] }>;
    meshes?: Array<{ primitives?: Array<{ attributes?: { POSITION?: number } }> }>;
  };
  const positionAccessorIndexes = new Set(
    (json.meshes ?? []).flatMap((mesh) => (mesh.primitives ?? []).map((primitive) => primitive.attributes?.POSITION)).filter((index) => index !== undefined)
  );
  const positionBounds = [...positionAccessorIndexes]
    .map((index) => json.accessors?.[index])
    .filter((accessor): accessor is { type?: string; min: number[]; max: number[] } => Boolean(accessor?.min && accessor.max));
  const min = {
    x: Math.min(...positionBounds.map((accessor) => accessor.min![0])),
    z: Math.min(...positionBounds.map((accessor) => accessor.min![2]))
  };
  const max = {
    x: Math.max(...positionBounds.map((accessor) => accessor.max![0])),
    z: Math.max(...positionBounds.map((accessor) => accessor.max![2]))
  };

  return { min, max };
}
