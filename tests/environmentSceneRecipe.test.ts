import { describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { createScene, type Scene, type SceneObject } from "../src/editor-core/scene";
import { buildSceneRecipe } from "../src/environment/sceneRecipe";

describe("buildSceneRecipe", () => {
  test("splits WFC-generated objects into cells and everything else into objects", () => {
    const scene = sceneWith([
      wfcObject({ id: "cell-0-0", assetId: "tiles.a", column: 0, row: 0, x: -1.5, z: 0, seed: 9, variantId: "tiles.a@r0" }),
      manualObject({ id: "manual-1", assetId: "props.cone", x: 4, z: 4 })
    ], { width: 3, depth: 3, cellSize: 3 });
    const assets = [tileAsset("tiles.a"), propAsset("props.cone")];

    const recipe = buildSceneRecipe(scene, assets);

    expect(recipe.grid).toEqual({ width: 1, depth: 1, cellSize: 3, origin: { x: -1.5, y: 0, z: -1.5 } });
    expect(recipe.cells).toEqual([
      {
        id: "cell-0-0",
        column: 0,
        row: 0,
        transform: { position: { x: -1.5, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.a",
        variantId: "tiles.a@r0",
        semanticRoles: ["road.surface"],
        sourceLayer: "scene",
        recovered: false
      }
    ]);
    expect(recipe.objects).toEqual([
      {
        id: "manual-1",
        name: "manual-1",
        transform: { position: { x: 4, y: 0, z: 4 }, rotationY: 0, scale: 1 },
        sourceAssetId: "props.cone",
        semanticRoles: [],
        sourceLayer: "scene"
      }
    ]);
    expect(recipe.generationRuns).toEqual([{ seed: 9, width: 1, depth: 1, cellSize: 3 }]);
    expect(recipe.diagnostics).toEqual([]);
  });

  test("recovers coordinate and variant for a WFC object saved before provenance carried them", () => {
    const scene = sceneWith(
      [legacyWfcObject({ id: "legacy-1-0", assetId: "tiles.a", x: 0, z: -3, rotationDegrees: 90 })],
      { width: 9, depth: 9, cellSize: 3 }
    );
    const assets = [tileAsset("tiles.a")];

    const recipe = buildSceneRecipe(scene, assets);

    expect(recipe.cells).toHaveLength(1);
    expect(recipe.cells[0]).toMatchObject({ column: 1, row: 0, variantId: "tiles.a@r90", recovered: true });
    expect(recipe.diagnostics).toEqual([]);
  });

  test("reports a diagnostic and falls back to a plain object when recovery cannot align to the grid", () => {
    const scene = sceneWith(
      [legacyWfcObject({ id: "off-grid", assetId: "tiles.a", x: 0.4, z: 0, rotationDegrees: 0 })],
      { width: 3, depth: 3, cellSize: 3 }
    );
    const assets = [tileAsset("tiles.a")];

    const recipe = buildSceneRecipe(scene, assets);

    expect(recipe.cells).toEqual([]);
    expect(recipe.objects.map((object) => object.id)).toEqual(["off-grid"]);
    expect(recipe.diagnostics).toEqual(["Could not recover a grid-aligned cell coordinate for object off-grid; exported as a plain object."]);
  });
});

function sceneWith(objects: SceneObject[], grid: { width: number; depth: number; cellSize: number }): Scene {
  return { ...createScene("Recipe fixture"), grid, objects };
}

function wfcObject(options: { id: string; assetId: string; column: number; row: number; x: number; z: number; seed: number; variantId: string }): SceneObject {
  return {
    id: options.id,
    assetId: options.assetId,
    name: options.id,
    position: { x: options.x, y: 0, z: options.z },
    rotationY: 0,
    scale: 1,
    generated: { pipeline: "wfc", stage: "structural", column: options.column, row: options.row, variantId: options.variantId, seed: options.seed }
  };
}

function legacyWfcObject(options: { id: string; assetId: string; x: number; z: number; rotationDegrees: number }): SceneObject {
  return {
    id: options.id,
    assetId: options.assetId,
    name: options.id,
    position: { x: options.x, y: 0, z: options.z },
    rotationY: (options.rotationDegrees * Math.PI) / 180,
    scale: 1,
    generated: { pipeline: "wfc", stage: "structural" }
  };
}

function manualObject(options: { id: string; assetId: string; x: number; z: number }): SceneObject {
  return { id: options.id, assetId: options.assetId, name: options.id, position: { x: options.x, y: 0, z: options.z }, rotationY: 0, scale: 1 };
}

function tileAsset(id: string): AssetCatalogEntry {
  return {
    id,
    label: id,
    category: "3d-road-tiles",
    source: "shared",
    implementation: "glb",
    semantics: { roles: ["road.surface"], sockets: {} },
    wfc: {
      height: 1,
      diagnostics: [],
      variants: [
        { variantId: `${id}@r0`, rotationDegrees: 0, sockets: { north: "road", east: "road", south: "road", west: "road", top: "top", bottom: "bottom" } },
        { variantId: `${id}@r90`, rotationDegrees: 90, sockets: { north: "road", east: "road", south: "road", west: "road", top: "top", bottom: "bottom" } }
      ]
    }
  };
}

function propAsset(id: string): AssetCatalogEntry {
  return { id, label: id, category: "props", source: "shared", implementation: "placeholder" };
}
