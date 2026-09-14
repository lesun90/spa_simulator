import type { PlanarWfcPalette, PlanarWfcRequest } from "./planarWfc";
import type { SolverOptions } from "./solverPort";
import { planScenicWorld } from "./scenicWorldPlan";
import { policiesFromWorldPlan } from "./worldPlanPolicies";

/** Deterministic plan completion and policy order shared by both execution adapters. */
export function prepareSolvePlan(palette: PlanarWfcPalette, request: PlanarWfcRequest, options: SolverOptions) {
  const plan = options.worldPlan && (options.scenicRecipe === null
    ? options.worldPlan : planScenicWorld(options.worldPlan, palette, request.seed, options.scenicRecipe));
  return { plan, request: { ...request, policies: [...(request.policies ?? []), ...(plan ? policiesFromWorldPlan(plan) : [])] } };
}
