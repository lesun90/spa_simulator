import { describe, expect, test } from "vitest";
import {
  createPlanarPalette,
  solvePlanarWfc,
  type PlanarDirection,
  type PlanarPolicySpec,
  type PlanarWfcVariant
} from "../src/wfc/planarWfc";
import { createRoadTopologyPolicies } from "../src/wfc/roadTopology";

const sockets = { north: "open", east: "open", south: "open", west: "open", top: "top", bottom: "bottom" };
const directions: readonly PlanarDirection[] = ["north", "east", "south", "west"];

function roadVariant(id: string, ports: readonly PlanarDirection[]): PlanarWfcVariant {
  return {
    id,
    assetId: id,
    rotationDegrees: 0,
    sockets,
    weight: 1,
    semanticPorts: Object.fromEntries(ports.map((direction) => [direction, ["road"]]))
  };
}

const roadShapes = [
  roadVariant("north-south", ["north", "south"]),
  roadVariant("east-west", ["east", "west"]),
  roadVariant("north-east", ["north", "east"]),
  roadVariant("north-west", ["north", "west"]),
  roadVariant("south-east", ["south", "east"]),
  roadVariant("south-west", ["south", "west"]),
  roadVariant("north-east-south", ["north", "east", "south"]),
  roadVariant("north-east-south-west", ["north", "east", "south", "west"]),
  roadVariant("empty", [])
];

function constrainedCells(policies: readonly PlanarPolicySpec[]) {
  return policies.filter((policy): policy is Extract<PlanarPolicySpec, { type: "exact-cell-ports" }> => policy.type === "exact-cell-ports");
}

describe("road topology policies", () => {
  test("produces the same topology for the same seed", () => {
    expect(createRoadTopologyPolicies({ width: 7, depth: 7, seed: 42 }, roadShapes)).toEqual(
      createRoadTopologyPolicies({ width: 7, depth: 7, seed: 42 }, roadShapes)
    );
  });

  test("creates a closed topology and lets concrete WFC fill every cell", () => {
    const policies = createRoadTopologyPolicies({ width: 7, depth: 7, seed: 8 }, roadShapes);
    const topology = constrainedCells(policies);
    expect(topology.length).toBeGreaterThanOrEqual(8);

    const result = solvePlanarWfc(createPlanarPalette("roads", 3, 3, roadShapes), {
      width: 7,
      depth: 7,
      seed: 8,
      policies
    });

    expect(result.status).toBe("solved");
    if (result.status === "failed") return;
    for (const topologyCell of topology) {
      const cell = result.cells.find((candidate) => candidate.column === topologyCell.column && candidate.row === topologyCell.row)!;
      for (const port of topologyCell.ports) {
        expect(cell.variant.semanticPorts?.[port.direction]).toContain(port.channel);
      }
    }
  });

  test("uses a three-way or four-way topology shape when concrete assets provide one", () => {
    const policies = createRoadTopologyPolicies({ width: 7, depth: 7, seed: 19 }, roadShapes);
    expect(constrainedCells(policies).some((policy) => policy.ports.length >= 3)).toBe(true);
  });

  test("does not constrain a road topology when no usable road shapes exist", () => {
    expect(createRoadTopologyPolicies({ width: 7, depth: 7, seed: 1 }, [roadVariant("empty", [])])).toEqual([]);
  });

  test("only constrains topology cells, leaving other cells for the concrete fill pass", () => {
    const policies = createRoadTopologyPolicies({ width: 7, depth: 7, seed: 8 }, roadShapes);
    const required = constrainedCells(policies);
    expect(required.length).toBeGreaterThan(0);
    expect(required.length).toBeLessThan(49);
    expect(policies.every((policy) => policy.type === "exact-cell-ports")).toBe(true);
  });

  test("requires the concrete road tile to have exactly the abstract topology ports", () => {
    const policies = createRoadTopologyPolicies({ width: 7, depth: 7, seed: 8 }, roadShapes);
    const result = solvePlanarWfc(createPlanarPalette("roads", 3, 3, roadShapes), {
      width: 7,
      depth: 7,
      seed: 8,
      policies
    });

    expect(result.status).toBe("solved");
    if (result.status === "failed") return;
    for (const policy of constrainedCells(policies)) {
      const variant = result.cells.find((cell) => cell.column === policy.column && cell.row === policy.row)!.variant;
      const actual = directions.filter((direction) => variant.semanticPorts?.[direction]?.includes("road"));
      expect(actual).toEqual(policy.ports.map((port) => port.direction));
    }
  });
});
