import { describe, expect, test } from "vitest";
import { createPlanarPalette, solvePlanarWfc } from "../src/wfc/planarWfc";
import { reportWorldPlan } from "../src/wfc/worldPlanReport";
import { createWorldPlan } from "../src/wfc/worldPlanner";

describe("world plan reports", () => {
  test("records route coverage and solver metrics", () => {
    const plan = createWorldPlan({ width: 24, depth: 24, seed: 10, roadCoverage: 1 });
    const palette = createPlanarPalette("empty", 1, 1, [{
      id: "empty", assetId: "empty", rotationDegrees: 0, weight: 1,
      sockets: { north: "ground", east: "ground", south: "ground", west: "ground", top: "top", bottom: "bottom" }
    }]);
    const result = solvePlanarWfc(palette, { width: 1, depth: 1, seed: 10 });
    const report = reportWorldPlan(plan, result);

    expect(report).toMatchObject({
      seed: 10,
      world: { width: 24, depth: 24 },
      routeCoverage: 1,
      routeRegionCount: report.macroRegionCount,
      portalCount: report.routeRegionCount,
      solver: { status: "solved" }
    });
    expect(report.corridorCellCount).toBeGreaterThan(0);
  });
});
