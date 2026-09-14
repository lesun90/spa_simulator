/** Browser/CLI composition and compatibility facade for scene generation. */
import type { AssetCatalogEntry } from "../editor-core/assets";
import type { GenerateWfcLayoutRequest } from "./sceneLayoutTypes";
import { resolvePackProfile } from "./metadata/packCatalog";
import { CatalogPaletteFactory } from "./catalogPaletteFactory";
import { sceneObjectsFromWfcResult } from "./sceneMapping";
import { selectSolver, type WfcWorkerFactory } from "./solverComposition";
import { createWorldPlan } from "./worldPlanner";
import { validateWorldPlanResult } from "./worldPlanPolicies";
import { SceneGenerationService, type GenerateWfcSceneOptions as ServiceOptions } from "./sceneGenerationService";
export type { GenerateWfcSceneResult } from "./sceneGenerationService";
export interface GenerateWfcSceneOptions extends ServiceOptions { workerFactory?: WfcWorkerFactory }
const palette = new CatalogPaletteFactory();
export function generateWfcScene(assets: readonly AssetCatalogEntry[], request: GenerateWfcLayoutRequest, options: GenerateWfcSceneOptions = {}) {
  return new SceneGenerationService({ palette, resolveProfile: resolvePackProfile, plan: createWorldPlan,
    solver: selectSolver(options.workerFactory), validate: validateWorldPlanResult, map: sceneObjectsFromWfcResult
  }).generate(assets, request, options);
}
