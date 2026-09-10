import { describe, expect, test } from "vitest";
import { createWorldPlan } from "../src/wfc/worldPlanner";

describe("world planning", () => {
  const request = { width: 48, depth: 48, seed: 20260910, roadCoverage: 0.5 };

  test("is deterministic", () => {
    expect(createWorldPlan(request)).toEqual(createWorldPlan(request));
  });

  test("partitions the world without gaps or overlaps", () => {
    const plan = createWorldPlan(request);
    const cells = new Set<string>();
    for (const region of plan.graph.regions) {
      for (let row = region.bounds.row; row < region.bounds.row + region.bounds.depth; row += 1) {
        for (let column = region.bounds.column; column < region.bounds.column + region.bounds.width; column += 1) {
          cells.add(`${column},${row}`);
        }
      }
    }

    expect(cells).toHaveLength(request.width * request.depth);
  });

  test("uses the nearest feasible fraction of macro regions for route coverage", () => {
    const plan = createWorldPlan(request);
    const requested = Math.max(4, Math.round(plan.graph.regions.length * request.roadCoverage));
    expect(plan.route.regionIds).toHaveLength(requested % 2 === 0 ? requested : requested - 1);
  });

  test("rounds an odd coverage target to a realizable grid cycle", () => {
    const plan = createWorldPlan({ width: 32, depth: 32, seed: 1, roadCoverage: 0.5 });
    expect(plan.graph.regions).toHaveLength(9);
    expect(plan.route.regionIds).toHaveLength(4);
  });

  test("forms a simple region cycle with reciprocal paired portals", () => {
    const plan = createWorldPlan(request);
    const routeIds = new Set(plan.route.regionIds);
    const portalCounts = new Map<string, number>();

    expect(routeIds.size).toBe(plan.route.regionIds.length);
    expect(plan.route.portals).toHaveLength(plan.route.regionIds.length);
    for (const portal of plan.route.portals) {
      expect(routeIds.has(portal.fromRegionId)).toBe(true);
      expect(routeIds.has(portal.toRegionId)).toBe(true);
      expect(Math.abs(portal.from.column - portal.to.column) + Math.abs(portal.from.row - portal.to.row)).toBe(1);
      expect(opposite(portal.from.direction)).toBe(portal.to.direction);
      portalCounts.set(portal.fromRegionId, (portalCounts.get(portal.fromRegionId) ?? 0) + 1);
      portalCounts.set(portal.toRegionId, (portalCounts.get(portal.toRegionId) ?? 0) + 1);
    }

    expect([...portalCounts.values()]).toEqual(Array(plan.route.regionIds.length).fill(2));
    const nonRoute = plan.graph.regions.filter((region) => !routeIds.has(region.id));
    expect(nonRoute.every((region) => !portalCounts.has(region.id))).toBe(true);
  });

  test("connects each route region's two portals with an internal corridor", () => {
    const plan = createWorldPlan(request);
    const byRegionId = new Map(plan.corridors.map((corridor) => [corridor.regionId, corridor]));
    for (const regionId of plan.route.regionIds) {
      const corridor = byRegionId.get(regionId)!;
      const portalEndpoints = plan.route.portals.flatMap((portal) => [
        ...(portal.fromRegionId === regionId ? [portal.from] : []),
        ...(portal.toRegionId === regionId ? [portal.to] : [])
      ]);
      for (const endpoint of portalEndpoints) {
        const cell = corridor.cells.find((candidate) => candidate.column === endpoint.column && candidate.row === endpoint.row);
        expect(cell?.directions).toContain(endpoint.direction);
      }
      expect(corridor.cells).toHaveLength(new Set(corridor.cells.map((cell) => `${cell.column},${cell.row}`)).size);
    }
  });

  test("keeps portals off long shared-border corners", () => {
    const plan = createWorldPlan(request);
    const byId = new Map(plan.graph.regions.map((region) => [region.id, region]));
    for (const portal of plan.route.portals) {
      for (const [endpoint, regionId] of [[portal.from, portal.fromRegionId], [portal.to, portal.toRegionId]] as const) {
        const region = byId.get(regionId)!;
        if (portal.from.direction === "north" || portal.from.direction === "south") {
          if (region.bounds.width > 2) expect(endpoint.column).toBeGreaterThan(region.bounds.column);
        } else if (region.bounds.depth > 2) {
          expect(endpoint.row).toBeGreaterThan(region.bounds.row);
        }
      }
    }
  });
});

function opposite(direction: "north" | "east" | "south" | "west") {
  return { north: "south", east: "west", south: "north", west: "east" }[direction];
}
