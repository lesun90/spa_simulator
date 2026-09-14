import type { PlanarWfcPalette, PlanarWfcResult } from "./planarWfc";
import type { GenerateWfcLayoutRequest, WfcGenerationProgress } from "./sceneLayoutTypes";
import { previewObjectsFromWfcProgress } from "./sceneMapping";
import { scenicRecipeForPalette } from "./metadata/packCatalog";
import type { SolverOptions, PlanarSolver } from "./solverPort";
export interface SceneSolveOptions extends Omit<SolverOptions, "onProgress" | "cancellation"> {
  onProgress?(progress: WfcGenerationProgress): void;
  signal?: AbortSignal;
}
/** Compatibility application seam: scene previews and browser signals stay outside the port. */
export function solveWithSceneProgress(solver: PlanarSolver, palette: PlanarWfcPalette, request: GenerateWfcLayoutRequest, options: SceneSolveOptions = {}): Promise<PlanarWfcResult> {
  options.onProgress?.({ status: "solving", cells: request.width * request.depth, variants: palette.variants.length, decisions: 0, backtracks: 0, collapsedCells: 0, objects: [] });
  return solver.solve(palette, request, {
    worldPlan: options.worldPlan,
    // Preserve when recipe lookup occurs (after initial progress and only for world planning).
    scenicRecipe: options.worldPlan ? options.scenicRecipe === null ? null : options.scenicRecipe ?? scenicRecipeForPalette(palette) : undefined,
    onWorldPlan: options.onWorldPlan,
    cancellation: options.signal ? { subscribe(cancel) {
      options.signal!.addEventListener("abort", cancel, { once: true });
      return () => options.signal!.removeEventListener("abort", cancel);
    } } : undefined,
    onProgress: (progress) => options.onProgress?.({ status: "solving", cells: request.width * request.depth, variants: palette.variants.length,
      decisions: progress.decisions, backtracks: progress.backtracks, collapsedCells: progress.collapsedCells, checkpoint: progress.checkpoint,
      objects: previewObjectsFromWfcProgress(progress.cells, request.seed, request, palette) })
  });
}
