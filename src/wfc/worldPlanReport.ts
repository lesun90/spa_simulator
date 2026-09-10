import type { PlanarWfcResult } from "./planarWfc";
import type { WorldPlan } from "./worldPlan";

export interface WorldPlanReport {
  seed: number;
  world: { width: number; depth: number };
  macroRegionCount: number;
  routeRegionCount: number;
  routeCoverage: number;
  portalCount: number;
  corridorCellCount: number;
  solver: { status: PlanarWfcResult["status"]; decisions?: number; backtracks?: number };
}

/** Produces a serializable quality record without coupling world planning to UI or I/O. */
export function reportWorldPlan(plan: WorldPlan, result: PlanarWfcResult): WorldPlanReport {
  const macroRegionCount = plan.graph.regions.length;
  return {
    seed: result.seed,
    world: plan.bounds,
    macroRegionCount,
    routeRegionCount: plan.route.regionIds.length,
    routeCoverage: plan.route.regionIds.length / macroRegionCount,
    portalCount: plan.route.portals.length,
    corridorCellCount: plan.corridors.reduce((count, corridor) => count + corridor.cells.length, 0),
    solver: result.status === "solved"
      ? { status: result.status, decisions: result.decisions, backtracks: result.backtracks }
      : { status: result.status }
  };
}
