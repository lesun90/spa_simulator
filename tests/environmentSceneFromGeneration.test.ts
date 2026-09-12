import { describe, expect, test } from "vitest";
import { DEFAULT_GROUND_COLOR } from "../src/editor-core/scene";
import { sceneFromGeneration } from "../src/environment/sceneFromGeneration";
import type { GenerateWfcSceneResult } from "../src/wfc/sceneGenerator";

describe("sceneFromGeneration", () => {
  test("builds a Scene whose grid is world-sized from the request's cell size, with the CLI's default ground", () => {
    const result: Extract<GenerateWfcSceneResult, { status: "solved" }> = {
      status: "solved",
      seed: 42,
      roadScene: false,
      objects: [
        { id: "wfc-0-0", assetId: "tiles.a", name: "tile", position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 }
      ],
      palette: { tileWidth: 3, tileDepth: 3 } as never,
      decisions: 1,
      backtracks: 0
    };

    const scene = sceneFromGeneration(result, { width: 4, depth: 5, seed: 42, tileWidth: 3, tileDepth: 3 });

    expect(scene.grid).toEqual({ cellSize: 3, width: 12, depth: 15 });
    expect(scene.ground).toEqual({ type: "color", color: DEFAULT_GROUND_COLOR, textureUrl: null });
    expect(scene.objects).toBe(result.objects);
    expect(scene.name).toBe("cli-42");
  });
});
