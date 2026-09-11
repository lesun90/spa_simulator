import { discoverAssetCatalog } from "../server/assetCatalog";
import { paletteFromAssets } from "../src/wfc/sceneLayout";
import { createPlanarPalette, directionOffset, oppositeDirection, solvePlanarWfc, type PlanarWfcVariant, type SolvedPlanarCell } from "../src/wfc/planarWfc";
import { policiesFromWorldPlan, validateWorldPlanResult } from "../src/wfc/worldPlanPolicies";
import { reportWorldPlan } from "../src/wfc/worldPlanReport";
import { createWorldPlan } from "../src/wfc/worldPlanner";
import { planScenicWorld } from "../src/wfc/scenicWorldPlan";
import { planRoundabout } from "../src/wfc/scenicRoundaboutPlan";

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
if (!synthetic) for (let mask = 1; mask < 16; mask++) {
  const exits = directions.filter((_, index) => mask & (1 << index));
  const cells = planRoundabout(exits, palette, mask);
  if (cells.length !== 9) throw new Error(`Roundabout cannot support exits ${exits.join(", ")}`);
  verifyRoundabouts(cells);
}
const reports = corpus.flatMap((entry) => entry.seeds.map((seed) => verify({ ...entry, seed })));
if (!synthetic) {
  for (const id of ["150", "141", "187", "188", "197", "207", "231"]) {
    if (!reports.some((report) => (report.scenery.tileCounts[id] ?? 0) > 0)) throw new Error(`Corpus never generated requested tile ${id}`);
  }
  for (const entrances of [1, 2, 3, 4]) {
    if (!reports.some((report) => (report.scenery.roundaboutEntrances?.[entrances - 1] ?? 0) > 0)) throw new Error(`Corpus never generated a ${entrances}-entrance roundabout`);
  }
}
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
  const scenery = { ...waterFeatures, tileCounts: Object.fromEntries(["150", "141", "187", "188", "197", "207", "231"].map((id) => [id, count(id)])), broadCurves: count("144"), bends: count("153"), shore: result.cells.filter((cell) => cell.variant.roles?.includes("terrain.shore")).length, plainWater: count("001"), tJunctions: count("150"), fourWayJunctions: count("141"), crosswalks: count("025"), ramps: count("154", "161", "165", "171", "180"), bridges: count("197", "207", "187", "188"), lowBridges: count("187", "188"), roundabouts: count("039"), overpasses: count("194"), water: result.cells.filter((cell) => cell.variant.roles?.includes("terrain.water")).length, elevatedTerrain: result.cells.filter((cell) => cell.variant.roles?.includes("terrain.elevated")).length };
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
  if (cells.some((cell) => /road-tile-(027|034|168|264)$/.test(cell.variant.assetId))) throw new Error(`seed ${bounds.seed}: excluded tiles 027/034/168/264 must not be generated`);
  const key = (cell: { column: number; row: number }) => `${cell.column},${cell.row}`;
  const byCell = new Map(cells.map((cell) => [key(cell), cell]));
  const roundaboutEntrances = verifyRoundabouts(cells);
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
  const lowDecks = new Map(cells.filter((cell) => /road-tile-(187|188)$/.test(cell.variant.assetId)).map((cell) => [key(cell), cell]));
  let lowBridgeSpans = 0;
  while (lowDecks.size) {
    lowBridgeSpans++;
    const component = [lowDecks.values().next().value!];
    const approaches = new Set<string>();
    for (let index = 0; index < component.length; index++) {
      const cell = component[index];
      if (!lowDecks.delete(key(cell))) continue;
      for (const direction of directions) {
        if (!cell.variant.semanticPorts?.[direction]?.includes("road")) continue;
        const delta = directionOffset[direction];
        const next = byCell.get(key({ column: cell.column + delta.column, row: cell.row + delta.row }));
        if (!next) throw new Error("Low bridge has no road approach");
        if (lowDecks.has(key(next))) component.push(next);
        else if (/road-tile-(162|025)$/.test(next.variant.assetId)) approaches.add(key(next));
      }
    }
    if (approaches.size !== 2) throw new Error("Low bridge must have two flat road approaches");
  }
  const mountainPasses = cells.filter((cell) => cell.variant.assetId.endsWith("road-tile-231") && directions.some((direction) => {
    if (!cell.variant.semanticPorts?.[direction]?.includes("road")) return false;
    const delta = directionOffset[direction];
    return byCell.get(key({ column: cell.column + delta.column, row: cell.row + delta.row }))?.variant.assetId.endsWith("road-tile-231");
  })).length / 2;
  if (bounds.width >= 16 && bounds.depth >= 16 && !mountainPasses) throw new Error(`seed ${bounds.seed}: no mountain pass through terrain`);
  return { lakes, standaloneLakes, bridgeSpans: bridgeSpans + lowBridgeSpans, lowBridgeSpans, mountainPasses, roundaboutEntrances };
}

function verifyRoundabouts(cells: readonly SolvedPlanarCell[]) {
  const byCell = new Map(cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
  const assembled = new Set<string>();
  const entrances = [0, 0, 0, 0];
  for (const island of cells.filter((cell) => cell.variant.assetId.endsWith("road-tile-039"))) {
    let exits = 0;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const key = `${island.column + x},${island.row + y}`;
      const cell = byCell.get(key);
      const id = cell?.variant.assetId.slice(-3);
      if (assembled.has(key) || (x && y ? id !== "049" : x || y ? id !== "043" && id !== "048" : id !== "039")) throw new Error(`Incomplete roundabout at ${key}`);
      assembled.add(key);
      if (id === "043") exits++;
      for (const direction of ["north", "east"] as const) {
        const delta = directionOffset[direction];
        const next = byCell.get(`${island.column + x + delta.column},${island.row + y + delta.row}`);
        if (next && !palette.adjacency[cell!.variant.id][direction].includes(next.variant.id)) throw new Error(`Roundabout seam mismatch at ${key}`);
      }
    }
    if (exits < 1 || exits > 4) throw new Error("Roundabout needs one to four entrances");
    entrances[exits - 1]++;
  }
  if (cells.some((cell) => /road-tile-(043|048|049)$/.test(cell.variant.assetId) && !assembled.has(`${cell.column},${cell.row}`))) throw new Error("Unassembled roundabout tile");
  return entrances;
}
