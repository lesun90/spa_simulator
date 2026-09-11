import { describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import type { WfcMetadata } from "../src/wfc/metadata/socketTypes";
import { generateWfcScene } from "../src/wfc/sceneGenerator";

describe("generateWfcScene", () => {
  test("solves a plain (non-road) catalog and returns scaled, connected scene objects", async () => {
    const assets: AssetCatalogEntry[] = [
      asset({ id: "tiles.a", category: "tiles", wfc: wfc("tiles.a") }),
      asset({ id: "tiles.b", category: "tiles", wfc: wfc("tiles.b") })
    ];

    const result = await generateWfcScene(assets, { width: 3, depth: 2, seed: 12, tileWidth: 6, tileDepth: 6 });

    expect(result.status).toBe("solved");
    if (result.status !== "solved") throw new Error("expected a solved result");
    expect(result.roadScene).toBe(false);
    expect(result.objects).toHaveLength(6);
    expect(result.objects.every((object) => object.scale === 2)).toBe(true);
  });

  test("reports road-scene infeasibility instead of throwing when the route plan cannot be satisfied", async () => {
    const assets: AssetCatalogEntry[] = [
      asset({ id: "roads.only", category: "3d-road-tiles", wfc: wfc("roads.only"), semantics: { roles: ["terrain.ground"], sockets: {} } })
    ];

    const result = await generateWfcScene(assets, { width: 4, depth: 4, seed: 12, tileWidth: 3, tileDepth: 3 });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("expected a failed result");
    expect(result.roadScene).toBe(true);
    expect(result.diagnostics[0]).toBeTruthy();
  });

  test("resolves to a failed result instead of rejecting when world-plan creation throws synchronously", async () => {
    const assets: AssetCatalogEntry[] = [
      asset({ id: "roads.only", category: "3d-road-tiles", wfc: wfc("roads.only"), semantics: { roles: ["terrain.ground"], sockets: {} } })
    ];

    // width/depth below createWorldPlan's minimum of 4 tiles makes it throw synchronously
    // before the WFC solve ever starts.
    const result = await generateWfcScene(assets, { width: 3, depth: 3, seed: 12, tileWidth: 3, tileDepth: 3 });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("expected a failed result");
    expect(result.roadScene).toBe(true);
    expect(result.diagnostics[0]).toBe("World width and depth must be integers of at least 4 tiles.");
  });
});

function asset(patch: Partial<AssetCatalogEntry>): AssetCatalogEntry {
  return {
    id: patch.id ?? "props.cone",
    label: patch.label ?? "Asset",
    category: patch.category ?? "props",
    tags: patch.tags,
    source: patch.source ?? "shared",
    implementation: patch.implementation ?? "placeholder",
    wfc: patch.wfc,
    semantics: patch.semantics
  };
}

function wfc(assetId: string): WfcMetadata {
  return {
    height: 1,
    diagnostics: [],
    variants: [
      {
        variantId: `${assetId}@r0`,
        rotationDegrees: 0,
        sockets: { north: "road", east: "road", south: "road", west: "road", top: "top", bottom: "bottom" }
      }
    ]
  };
}
