import type { PlanarWfcPalette, PlanarWfcRequest, PlanarWfcResult, PlanarWfcProgress } from "./planarWfc";
import type { WorldPlan } from "./worldPlan";
import type { ScenicRecipe } from "./metadata/packTypes";

/** Only observes future cancellation, matching the existing execution contract. */
export interface SolverCancellation {
  subscribe(cancel: () => void): () => void;
}
export interface SolverOptions {
  onProgress?(progress: PlanarWfcProgress): void;
  cancellation?: SolverCancellation;
  worldPlan?: WorldPlan;
  scenicRecipe?: ScenicRecipe | null;
  onWorldPlan?(plan: WorldPlan): void;
}
/** Implementations may block before returning; no local retry is implied. */
export interface PlanarSolver {
  solve(palette: PlanarWfcPalette, request: PlanarWfcRequest, options?: SolverOptions): Promise<PlanarWfcResult>;
}
