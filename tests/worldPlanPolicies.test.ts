import { describe, expect, test } from "vitest";
import { createPlanarPalette, solvePlanarWfc, type PlanarWfcVariant } from "../src/wfc/planarWfc";
import { policiesFromWorldPlan, validateWorldPlanResult } from "../src/wfc/worldPlanPolicies";
import { createWorldPlan } from "../src/wfc/worldPlanner";

const sockets = (road: readonly string[]) => ({
  north: road.includes("north") ? "road" : "ground",
  east: road.includes("east") ? "road" : "ground",
  south: road.includes("south") ? "road" : "ground",
  west: road.includes("west") ? "road" : "ground",
  top: "top",
  bottom: "bottom"
});

const variant = (id: string, roads: readonly string[]): PlanarWfcVariant => ({
  id,
  assetId: id,
  rotationDegrees: 0,
  sockets: sockets(roads),
  weight: 1,
  semanticPorts: Object.fromEntries(roads.map((direction) => [direction, ["road"]]))
});

const variants = [
  variant("empty", []),
  variant("north-south", ["north", "south"]),
  variant("east-west", ["east", "west"]),
  variant("north-east", ["north", "east"]),
  variant("north-west", ["north", "west"]),
  variant("south-east", ["south", "east"]),
  variant("south-west", ["south", "west"])
];

describe("world-plan WFC policies", () => {
  test("permits road ports only on the planned route corridor", () => {
    const plan = createWorldPlan({ width: 24, depth: 24, seed: 1, roadCoverage: 1 });
    const palette = createPlanarPalette("test", 1, 1, variants);
    const result = solvePlanarWfc(palette, {
      width: plan.bounds.width,
      depth: plan.bounds.depth,
      seed: 1,
      maxBacktracks: 20_000,
      policies: policiesFromWorldPlan(plan)
    });

    expect(result.status).toBe("solved");
    if (result.status !== "solved") return;
    const planned = new Map(plan.corridors.flatMap((corridor) => corridor.cells.map((cell) => [`${cell.column},${cell.row}`, cell.directions] as const)));
    for (const cell of result.cells) {
      const roads = Object.entries(cell.variant.semanticPorts ?? {}).filter(([, channels]) => channels?.includes("road")).map(([direction]) => direction).sort();
      expect(roads).toEqual([...(planned.get(`${cell.column},${cell.row}`) ?? [])].sort());
    }
    expect(validateWorldPlanResult(plan, palette, result)).toEqual([]);
  });

  test("reports a concrete result that violates the planned road edges", () => {
    const plan = createWorldPlan({ width: 24, depth: 24, seed: 1, roadCoverage: 1 });
    const palette = createPlanarPalette("test", 1, 1, variants);
    const result = solvePlanarWfc(palette, { width: 24, depth: 24, seed: 1 });

    expect(validateWorldPlanResult(plan, palette, result)).not.toEqual([]);
  });
});
