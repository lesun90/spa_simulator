import { createPlanarPalette, solvePlanarWfc, type PlanarWfcVariant } from "../src/wfc/planarWfc";
import { policiesFromWorldPlan, validateWorldPlanResult } from "../src/wfc/worldPlanPolicies";
import { reportWorldPlan } from "../src/wfc/worldPlanReport";
import { createWorldPlan } from "../src/wfc/worldPlanner";

const corpus = [
  { width: 16, depth: 16, roadCoverage: 1, seeds: [1, 17, 42] },
  { width: 24, depth: 24, roadCoverage: 1, seeds: [3, 19, 99] },
  { width: 32, depth: 32, roadCoverage: 0.5, seeds: [7, 23, 101] },
  { width: 50, depth: 50, roadCoverage: 0.5, seeds: [11, 29, 211] },
  { width: 100, depth: 100, roadCoverage: 0.5, seeds: [13, 31, 307] }
] as const;

const directions = ["north", "east", "south", "west"] as const;
const variants: readonly PlanarWfcVariant[] = [
  routeVariant("empty", []),
  routeVariant("north-south", ["north", "south"]),
  routeVariant("east-west", ["east", "west"]),
  routeVariant("north-east", ["north", "east"]),
  routeVariant("north-west", ["north", "west"]),
  routeVariant("south-east", ["south", "east"]),
  routeVariant("south-west", ["south", "west"])
];
const palette = createPlanarPalette("world-plan-corpus", 1, 1, variants);
const reports = corpus.flatMap((entry) => entry.seeds.map((seed) => verify({ ...entry, seed })));
console.log(JSON.stringify(reports, null, 2));

function verify(request: { width: number; depth: number; roadCoverage: number; seed: number }) {
  const plan = createWorldPlan(request);
  const result = solvePlanarWfc(palette, {
    width: request.width,
    depth: request.depth,
    seed: request.seed,
    maxBacktracks: request.width * request.depth * 32,
    policies: policiesFromWorldPlan(plan)
  });
  const diagnostics = validateWorldPlanResult(plan, palette, result);
  if (diagnostics.length) throw new Error(`seed ${request.seed}: ${diagnostics.join(" ")}`);
  return reportWorldPlan(plan, result);
}

function routeVariant(id: string, roadDirections: readonly (typeof directions)[number][]): PlanarWfcVariant {
  return {
    id,
    assetId: id,
    rotationDegrees: 0,
    weight: 1,
    sockets: Object.fromEntries([
      ...directions.map((direction) => [direction, roadDirections.includes(direction) ? "road" : "ground"]),
      ["top", "top"],
      ["bottom", "bottom"]
    ]) as PlanarWfcVariant["sockets"],
    semanticPorts: Object.fromEntries(roadDirections.map((direction) => [direction, ["road"]]))
  };
}
