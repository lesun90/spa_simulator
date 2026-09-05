import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("3d-road-tiles assets", () => {
  test("road tile 148 is centered on the X/Z origin", async () => {
    const bounds = await readGlbPositionBounds("assets/3d-road-tiles/road-tile-148/road-tile-148.glb");

    expect(bounds.min.x).toBeCloseTo(-1.5, 5);
    expect(bounds.max.x).toBeCloseTo(1.5, 5);
    expect(bounds.min.z).toBeCloseTo(-1.5, 5);
    expect(bounds.max.z).toBeCloseTo(1.5, 5);
  });
});

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
