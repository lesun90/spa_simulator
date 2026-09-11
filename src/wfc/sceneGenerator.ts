import type { AssetCatalogEntry } from "../editor-core/assets";
import type { SceneObject } from "../editor-core/scene";
import type { PlanarWfcPalette } from "./planarWfc";
import {
  paletteFromAssets,
  sceneObjectsFromWfcResult,
  solvePlanarWfcInWorker,
  type GenerateWfcLayoutRequest,
  type WfcGenerationProgress,
  type WfcWorkerFactory
} from "./sceneLayout";
import type { WorldPlan } from "./worldPlan";
import { createWorldPlan } from "./worldPlanner";
import { validateWorldPlanResult } from "./worldPlanPolicies";

export type GenerateWfcSceneResult =
  | { status: "solved"; seed: number; roadScene: boolean; objects: readonly SceneObject[]; palette: PlanarWfcPalette; decisions: number; backtracks: number }
  | { status: "failed"; seed: number; roadScene: boolean; diagnostics: readonly string[] };

export interface GenerateWfcSceneOptions {
  onProgress?(progress: WfcGenerationProgress): void;
  workerFactory?: WfcWorkerFactory;
  signal?: AbortSignal;
}

/**
 * Owns catalog selection, road-scene detection, world-plan creation, WFC solving, and
 * solved-cell conversion. The browser editor calls this with progress reporting; a Node CLI
 * adapter can call it with no `workerFactory`, relying on `solvePlanarWfcInWorker`'s in-process
 * fallback, so both produce the same ordered scene recipe for the same seed, dimensions, cell
 * size, and asset catalog.
 */
export async function generateWfcScene(
  assets: readonly AssetCatalogEntry[],
  request: GenerateWfcLayoutRequest,
  options: GenerateWfcSceneOptions = {}
): Promise<GenerateWfcSceneResult> {
  const roadScene = assets.some((asset) => asset.category === "3d-road-tiles");
  let worldPlan: WorldPlan | undefined = roadScene
    ? createWorldPlan({ width: request.width, depth: request.depth, seed: request.seed, roadCoverage: 0.5, scenic: true })
    : undefined;
  const palette = paletteFromAssets("shared-assets", assets, {
    tileWidth: request.tileWidth,
    tileDepth: request.tileDepth,
    purpose: roadScene ? "road-scene" : undefined
  });

  try {
    const solved = await solvePlanarWfcInWorker(palette, request, {
      worldPlan,
      onWorldPlan: (plan) => { worldPlan = plan; },
      onProgress: options.onProgress,
      workerFactory: options.workerFactory,
      signal: options.signal
    });
    const validationDiagnostics = worldPlan ? validateWorldPlanResult(worldPlan, palette, solved) : [];
    const result = sceneObjectsFromWfcResult(solved, request, palette);
    const objects = result.status === "solved" && !validationDiagnostics.length ? result.objects : [];

    if (!objects.length) {
      const diagnostic = validationDiagnostics[0] ?? (result.status === "failed" ? result.diagnostics[0] ?? "WFC generation failed" : "WFC generation failed");
      return { status: "failed", seed: request.seed, roadScene, diagnostics: [diagnostic] };
    }

    return {
      status: "solved",
      seed: request.seed,
      roadScene,
      objects,
      palette,
      decisions: result.status === "solved" ? result.decisions : 0,
      backtracks: result.status === "solved" ? result.backtracks : 0
    };
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : "WFC generation failed";
    return { status: "failed", seed: request.seed, roadScene, diagnostics: [diagnostic] };
  }
}
