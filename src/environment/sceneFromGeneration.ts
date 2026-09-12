import { defaultSurfaceAppearance, DEFAULT_BACKGROUND_COLOR, DEFAULT_GROUND_COLOR, type Scene, type SceneObject } from "../editor-core/scene";
import { DEFAULT_WFC_TILE_SIZE, type GenerateWfcLayoutRequest } from "../wfc/sceneLayout";
import type { GenerateWfcSceneResult } from "../wfc/sceneGenerator";

type SolvedGeneration = Extract<GenerateWfcSceneResult, { status: "solved" }>;

/** Fabricates a minimal editable Scene from a headless generation so buildSceneRecipe has a Scene to consume. */
export function sceneFromGeneration(result: SolvedGeneration, request: GenerateWfcLayoutRequest): Scene {
  const tileWidth = request.tileWidth ?? DEFAULT_WFC_TILE_SIZE;
  const tileDepth = request.tileDepth ?? DEFAULT_WFC_TILE_SIZE;
  return {
    id: `cli-${result.seed}`,
    name: `cli-${result.seed}`,
    description: "",
    grid: { cellSize: tileWidth, width: request.width * tileWidth, depth: request.depth * tileDepth },
    background: defaultSurfaceAppearance(DEFAULT_BACKGROUND_COLOR),
    ground: defaultSurfaceAppearance(DEFAULT_GROUND_COLOR),
    objects: result.objects as SceneObject[]
  };
}
