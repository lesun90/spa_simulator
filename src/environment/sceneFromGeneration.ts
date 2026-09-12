import { createId, defaultSurfaceAppearance, DEFAULT_BACKGROUND_COLOR, DEFAULT_GROUND_COLOR, type Scene, type SceneObject } from "../editor-core/scene";
import type { GenerateWfcLayoutRequest } from "../wfc/sceneLayout";
import type { GenerateWfcSceneResult } from "../wfc/sceneGenerator";

type SolvedGeneration = Extract<GenerateWfcSceneResult, { status: "solved" }>;

/** Fabricates a minimal editable Scene from a headless generation so buildSceneRecipe has a Scene to consume. */
export function sceneFromGeneration(result: SolvedGeneration, request: GenerateWfcLayoutRequest): Scene {
  return {
    id: createId("scene"),
    name: `cli-${result.seed}`,
    description: "",
    grid: { cellSize: request.tileWidth!, width: request.width * request.tileWidth!, depth: request.depth * request.tileDepth! },
    background: defaultSurfaceAppearance(DEFAULT_BACKGROUND_COLOR),
    ground: defaultSurfaceAppearance(DEFAULT_GROUND_COLOR),
    objects: result.objects as SceneObject[]
  };
}
