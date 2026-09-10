import { discoverAssetCatalog } from "../server/assetCatalog";
import { paletteFromAssets } from "../src/wfc/sceneLayout";
import { createPlanarPalette, directionOffset, oppositeDirection, solvePlanarWfc, type PlanarWfcVariant, type SolvedPlanarCell } from "../src/wfc/planarWfc";
import { policiesFromWorldPlan, validateWorldPlanResult } from "../src/wfc/worldPlanPolicies";
import { reportWorldPlan } from "../src/wfc/worldPlanReport";
import { createWorldPlan } from "../src/wfc/worldPlanner";
import { planScenicWorld } from "../src/wfc/scenicWorldPlan";

const corpus = [
  { width: 10, depth: 10, roadCoverage: 0.5, seeds: [13, 134, 1345] },
  { width: 16, depth: 16, roadCoverage: 1, seeds: [1, 17, 42] },
  { width: 24, depth: 24, roadCoverage: 1, seeds: [3, 19, 99] },
  { width: 32, depth: 32, roadCoverage: 0.5, seeds: [7, 23, 101] },
  { width: 40, depth: 40, roadCoverage: 0.5, seeds: [3, 17, 42] },
  { width: 50, depth: 50, roadCoverage: 0.5, seeds: [11, 29, 211] },
  { width: 100, depth: 100, roadCoverage: 0.5, seeds: [13, 31, 307] },
  { width: 10, depth: 32, roadCoverage: 0.5, seeds: [4] },
  { width: 32, depth: 10, roadCoverage: 0.5, seeds: [4] },
  { width: 12, depth: 40, roadCoverage: 0.5, seeds: [17] }
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
const synthetic = process.argv.includes("--synthetic");
const palette = synthetic
  ? createPlanarPalette("world-plan-corpus", 1, 1, variants)
  : paletteFromAssets("road-scene-corpus", await discoverAssetCatalog("assets"), { tileWidth: 1, tileDepth: 1, purpose: "road-scene" });
const reports = corpus.flatMap((entry) => entry.seeds.map((seed) => verify({ ...entry, seed })));
console.log(JSON.stringify(reports, null, 2));

function verify(request: { width: number; depth: number; roadCoverage: number; seed: number }) {
  const primaryPlan = createWorldPlan({ ...request, scenic: !synthetic });
  const plan = synthetic ? primaryPlan : planScenicWorld(primaryPlan, palette, request.seed);
  const result = solvePlanarWfc(palette, {
    width: request.width,
    depth: request.depth,
    seed: request.seed,
    maxBacktracks: request.width * request.depth * 32,
    policies: [...policiesFromWorldPlan(plan), { type: "connected-channel", id: "connected-roads", channel: "road" }]
  });
  const diagnostics = validateWorldPlanResult(plan, palette, result);
  if (diagnostics.length) throw new Error(`seed ${request.seed}: ${diagnostics.join(" ")}`);
  if (result.status !== "solved") throw new Error(`seed ${request.seed}: no concrete world`);
  const waterFeatures = synthetic ? {} : verifyScenicConnections(result.cells, request);
  const roadCells = result.cells.filter((cell) => directions.some((direction) => cell.variant.semanticPorts?.[direction]?.includes("road")));
  if (!roadCells.length) throw new Error(`seed ${request.seed}: no road generated`);
  if (!synthetic && result.cells.some((cell) => !roadCells.includes(cell) && !cell.variant.roles?.includes("terrain.ground"))) {
    throw new Error(`seed ${request.seed}: non-route cell is not reviewed terrain`);
  }
  const count = (...numbers: string[]) => result.cells.filter((cell) => numbers.some((number) => cell.variant.assetId === `3d-road-tiles.road-tile-${number}`)).length;
  const scenery = { ...waterFeatures, broadCurves: count("144"), bends: count("153"), shore: result.cells.filter((cell) => cell.variant.roles?.includes("terrain.shore")).length, plainWater: count("001"), tJunctions: count("027"), fourWayJunctions: count("034"), crosswalks: count("025"), ramps: count("154", "161", "165", "171", "180"), bridges: count("197", "207"), overpasses: count("194"), water: result.cells.filter((cell) => cell.variant.roles?.includes("terrain.water")).length, elevatedTerrain: result.cells.filter((cell) => cell.variant.roles?.includes("terrain.elevated")).length };
  if (!synthetic && request.width >= 16 && request.depth >= 16 && (!scenery.water || !scenery.elevatedTerrain)) throw new Error(`seed ${request.seed}: missing scenic feature ${JSON.stringify(scenery)}`);

  if (!synthetic && request.width === 24 && request.depth === 24 && request.seed === 3 && !scenery.overpasses) throw new Error("Known-feasible 24x24 overpass scene lost tile 194");
  if (!synthetic && request.width >= 16 && request.depth >= 16 && !scenery.broadCurves) throw new Error(`seed ${request.seed}: no broad four-tile curves`);
  if (!synthetic && ["041", "147", "156"].some((id) => count(id) !== scenery.broadCurves)) throw new Error(`seed ${request.seed}: incomplete broad-curve assembly`);
  const xs = roadCells.map((cell) => cell.column), ys = roadCells.map((cell) => cell.row);
  const coverage = { width: Math.max(...xs) - Math.min(...xs) + 1, depth: Math.max(...ys) - Math.min(...ys) + 1,
    quadrants: [0, 1, 2, 3].map((quadrant) => roadCells.filter((cell) => (cell.column >= request.width / 2 ? 1 : 0) + (cell.row >= request.depth / 2 ? 2 : 0) === quadrant).length) };
  if (!synthetic && request.width === 40 && request.depth === 40) {
    if (coverage.width < 30 || coverage.depth < 30 || coverage.quadrants.some((count) => count < 20)) throw new Error(`seed ${request.seed}: roads remain concentrated in part of the map: ${JSON.stringify(coverage)}`);
    if ((scenery.bridgeSpans ?? 0) < 2 || scenery.overpasses < 2) throw new Error(`seed ${request.seed}: large-map crossings did not scale: ${JSON.stringify(scenery)}`);
  }

  return { catalog: synthetic ? "synthetic" : "real", variants: palette.variants.length, roadCells: roadCells.length, coverage, scenery, ...reportWorldPlan(plan, result) };
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

/** Integration assertions over the real authored catalog, not mocked tiles. */
function verifyScenicConnections(cells: readonly SolvedPlanarCell[], bounds: { width: number; depth: number; seed: number }) {
  if (cells.some((cell) => /road-tile-(168|264)$/.test(cell.variant.assetId))) throw new Error(`seed ${bounds.seed}: excluded tiles 168/264 must not be generated`);
  const key = (cell: { column: number; row: number }) => `${cell.column},${cell.row}`;
  const byCell = new Map(cells.map((cell) => [key(cell), cell]));
  const water = cells.filter((cell) => directions.some((direction) => cell.variant.semanticPorts?.[direction]?.includes("water")));
  if (water.some((cell) => /tile-(215|242|244|176)$/.test(cell.variant.assetId))) throw new Error(`seed ${bounds.seed}: river tiles must not be generated`);
  const unseen = new Map(water.map((cell) => [key(cell), cell]));
  let lakes = 0, standaloneLakes = 0, bridgeSpans = 0;
  while (unseen.size) {
    lakes++;
    const component = [unseen.values().next().value!];
    let size = 0, openWater = 0;
    for (let index = 0; index < component.length; index++) {
      const cell = component[index];
      if (!unseen.delete(key(cell))) continue;
      size++;
      if (cell.variant.assetId.endsWith("road-tile-001")) openWater++;
      for (const direction of directions) {
        if (!cell.variant.semanticPorts?.[direction]?.includes("water")) continue;
        const delta = directionOffset[direction];
        const next = byCell.get(key({ column: cell.column + delta.column, row: cell.row + delta.row }));
        if (!next) throw new Error(`seed ${bounds.seed}: lake water escapes the scene boundary at ${key(cell)}`);
        if (!next.variant.semanticPorts?.[oppositeDirection[direction]]?.includes("water")) throw new Error(`seed ${bounds.seed}: broken water edge at ${key(cell)}`);
        if (unseen.has(key(next))) component.push(next);
      }
    }
    if (size <= 8 || !openWater) throw new Error(`seed ${bounds.seed}: lake is a disconnected puddle or has no open-water core`);
    if (!component.some((cell) => cell.variant.roles?.includes("road.bridge"))) standaloneLakes++;
  }
  const elevated = new Map(cells.filter((cell) => cell.variant.roles?.includes("road.elevated")).map((cell) => [key(cell), cell]));
  while (elevated.size) {
    const component = [elevated.values().next().value!];
    const rampEnds = new Set<string>();
    let length = 0;
    for (let index = 0; index < component.length; index++) {
      const cell = component[index];
      if (!elevated.delete(key(cell))) continue;
      length++;
      for (const direction of directions) {
        if (!cell.variant.semanticPorts?.[direction]?.includes("road")) continue;
        const delta = directionOffset[direction];
        const next = byCell.get(key({ column: cell.column + delta.column, row: cell.row + delta.row }));
        if (!next?.variant.semanticPorts?.[oppositeDirection[direction]]?.includes("road")) continue;
        if (elevated.has(key(next))) component.push(next);
        if (next.variant.roles?.includes("road.ramp")) rampEnds.add(key(next));
      }
    }
    if (length < 2 || rampEnds.size !== 2) throw new Error(`seed ${bounds.seed}: elevated span needs at least two deck tiles and two ramps`);
    if (component.some((cell) => cell.variant.roles?.includes("road.bridge"))) bridgeSpans++;
  }
  return { lakes, standaloneLakes, bridgeSpans };
}
