import { solvePlanarWfc, type PlanarWfcPalette, type PlanarWfcRequest } from "./planarWfc";
import type { PlanarSolver, SolverOptions } from "./solverPort";
import { prepareSolvePlan } from "./solvePlanning";

export class InProcessSolver implements PlanarSolver {
  // Deliberately synchronous planning/solving; no progress forwarding or cancellation polling.
  solve(palette: PlanarWfcPalette, request: PlanarWfcRequest, options: SolverOptions = {}) {
    const prepared = prepareSolvePlan(palette, request, options);
    if (prepared.plan) options.onWorldPlan?.(prepared.plan);
    return Promise.resolve(solvePlanarWfc(palette, prepared.request));
  }
}
