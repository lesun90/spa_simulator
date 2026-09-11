import { describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { compactPaletteMetrics, paletteFromAssets, generateWfcLayout } from "../src/wfc/sceneLayout";

const sockets = { north: "x", east: "x", south: "x", west: "x", top: "top", bottom: "bottom" };
function asset(id: string, defaultWeight: number, variantWeight?: number): AssetCatalogEntry {
  return { id, label: id, category: "tiles", source: "shared", implementation: "glb", wfc: { height: 1, defaultWeight, diagnostics: [], variants: [{ variantId: `${id}@r0`, rotationDegrees: 0, sockets, weight: variantWeight }] } };
}

describe("WFC palette construction", () => {
  test("includes every compatible asset and resolves asset and variant weights", () => {
    const palette = paletteFromAssets("catalog", [asset("first", 3, 4), asset("second", 9)]);
    expect(palette.variants).toEqual([
      expect.objectContaining({ id: "first@r0", weight: 4 }),
      expect.objectContaining({ id: "second@r0", weight: 9 })
    ]);
  });

  test("can restrict the catalog to one asset category", () => {
    const tiles = asset("tile", 1);
    const props = asset("prop", 1);
    props.category = "props";

    expect(paletteFromAssets("tiles", [tiles, props], { category: "tiles" }).variants.map((variant) => variant.assetId)).toEqual(["tile"]);
  });

  test("keeps palette compaction small and free of verbose socket strings", () => {
    const palette = paletteFromAssets("catalog", [asset("basic", 3)]);
    expect(compactPaletteMetrics(palette)).toEqual({ bytes: 40, distinctSocketIds: 1 });
  });

  test("uses reviewed per-variant road topology tags instead of scanning sockets", () => {
    const tagged = asset("road", 1);
    tagged.category = "3d-road-tiles";
    tagged.wfc!.variants[0].roadTopology = { kind: "corner", edges: { north: "road", east: "road" } };
    const palette = paletteFromAssets("catalog", [tagged]);

    expect(palette.variants[0].semanticPorts).toEqual({ north: ["road"], east: ["road"] });
  });

  test("does not infer road ports from untagged socket text", () => {
    const untagged = asset("road", 1);
    untagged.category = "3d-road-tiles";
    untagged.wfc!.variants[0].sockets = { ...sockets, north: "asphalt" };
    const palette = paletteFromAssets("catalog", [untagged]);

    expect(palette.variants[0].semanticPorts).toBeUndefined();
  });
});

describe("WFC scene object provenance", () => {
  test("records the solved cell coordinate, variant, and seed for later environment export", () => {
    const tile = asset("tile", 1);

    const result = generateWfcLayout([tile], { width: 2, depth: 1, seed: 7, tileWidth: 3, tileDepth: 3 });

    expect(result.status).toBe("solved");
    if (result.status !== "solved") throw new Error("expected a solved result");
    expect(result.objects.map((object) => object.generated)).toEqual([
      { pipeline: "wfc", stage: "structural", column: 0, row: 0, variantId: "tile@r0", seed: 7 },
      { pipeline: "wfc", stage: "structural", column: 1, row: 0, variantId: "tile@r0", seed: 7 }
    ]);
  });
});
