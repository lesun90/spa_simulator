import type { PlanarDirection } from "./planarWfc";
import type { GridCell, LocalCorridorPlan, MacroRegion, MacroRegionGraph, PlannedRoadCell, RegionZoneRole, RoadPortal, WorldBounds, WorldPlan } from "./worldPlan";

export interface CreateWorldPlanRequest extends WorldBounds {
  seed: number;
  /** Fraction of macro regions visited by the primary route. */
  roadCoverage: number;
  maxRegionsPerAxis?: number;
}

const zones: readonly RegionZoneRole[] = ["terrain", "park", "built", "water"];
const oppositeDirection: Record<PlanarDirection, PlanarDirection> = {
  north: "south",
  east: "west",
  south: "north",
  west: "east"
};

/** Builds a deterministic, bounded world plan before concrete tile selection. */
export function createWorldPlan(request: CreateWorldPlanRequest): WorldPlan {
  assertRequest(request);
  const columns = regionCount(request.width, request.maxRegionsPerAxis);
  const rows = regionCount(request.depth, request.maxRegionsPerAxis);
  const columnWidths = partitionLength(request.width, columns);
  const rowDepths = partitionLength(request.depth, rows);
  const regions = createRegions(columns, rows, columnWidths, rowDepths, request.seed);
  const graph = createGraph(regions);
  const routeIds = selectRoute(graph, request.seed, request.roadCoverage);
  const portals = createPortals(routeIds, graph, request.seed);

  return {
    bounds: { width: request.width, depth: request.depth },
    graph,
    route: { regionIds: routeIds, portals },
    corridors: createCorridors(routeIds, graph, portals)
  };
}

function assertRequest(request: CreateWorldPlanRequest) {
  if (!Number.isInteger(request.width) || !Number.isInteger(request.depth) || request.width < 4 || request.depth < 4) {
    throw new Error("World width and depth must be integers of at least 4 tiles.");
  }
  if (!Number.isFinite(request.roadCoverage) || request.roadCoverage <= 0 || request.roadCoverage > 1) {
    throw new Error("Road coverage must be greater than 0 and at most 1.");
  }
}

function regionCount(length: number, maximum = 8) {
  return Math.min(maximum, Math.max(2, Math.ceil(length / 12)));
}

function partitionLength(length: number, parts: number) {
  const base = Math.floor(length / parts);
  const remainder = length % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function createRegions(columns: number, rows: number, widths: readonly number[], depths: readonly number[], seed: number): readonly MacroRegion[] {
  const regions: MacroRegion[] = [];
  let originRow = 0;
  for (let row = 0; row < rows; row += 1) {
    let originColumn = 0;
    for (let column = 0; column < columns; column += 1) {
      regions.push({
        id: `region-${column}-${row}`,
        column,
        row,
        bounds: { column: originColumn, row: originRow, width: widths[column]!, depth: depths[row]! },
        zone: zones[stableIndex(seed, column, row, zones.length)]!
      });
      originColumn += widths[column]!;
    }
    originRow += depths[row]!;
  }
  return regions;
}

function createGraph(regions: readonly MacroRegion[]): MacroRegionGraph {
  const byCoordinate = new Map(regions.map((region) => [`${region.column},${region.row}`, region]));
  return {
    regions,
    neighbors: Object.fromEntries(regions.map((region) => [region.id, [
      byCoordinate.get(`${region.column},${region.row + 1}`),
      byCoordinate.get(`${region.column + 1},${region.row}`),
      byCoordinate.get(`${region.column},${region.row - 1}`),
      byCoordinate.get(`${region.column - 1},${region.row}`)
    ].filter((neighbor): neighbor is MacroRegion => Boolean(neighbor)).map((neighbor) => neighbor.id)]))
  };
}

function selectRoute(graph: MacroRegionGraph, seed: number, coverage: number) {
  const requested = Math.max(4, Math.min(graph.regions.length, Math.round(graph.regions.length * coverage)));
  // The macro graph is orthogonal and therefore bipartite: every simple cycle has an even size.
  // Choose the nearest feasible cycle size rather than failing a valid coverage request such as 50% of 9 regions.
  const target = requested % 2 === 0 ? requested : requested - 1;
  const ordered = [...graph.regions].sort((a, b) => stableIndex(seed, a.column, a.row, 1_000) - stableIndex(seed, b.column, b.row, 1_000));
  for (const start of ordered) {
    const route = findCycle(graph, start.id, target);
    if (route) return route;
  }
  throw new Error(`Cannot create a primary route with ${target} regions.`);
}

function findCycle(graph: MacroRegionGraph, startId: string, target: number) {
  const visit = (route: readonly string[]): readonly string[] | undefined => {
    const current = route.at(-1)!;
    if (route.length === target) return graph.neighbors[current]!.includes(startId) ? route : undefined;
    for (const neighbor of graph.neighbors[current]!) {
      if (route.includes(neighbor)) continue;
      const found = visit([...route, neighbor]);
      if (found) return found;
    }
    return undefined;
  };
  return visit([startId]);
}

function createCorridors(route: readonly string[], graph: MacroRegionGraph, portals: readonly RoadPortal[]): readonly LocalCorridorPlan[] {
  const byId = new Map(graph.regions.map((region) => [region.id, region]));
  return route.map((regionId) => {
    const endpoints = portals.flatMap((portal) => {
      if (portal.fromRegionId === regionId) return [portal.from];
      if (portal.toRegionId === regionId) return [portal.to];
      return [];
    });
    const region = byId.get(regionId)!;
    if (endpoints.length !== 2) throw new Error(`${regionId} must have exactly two primary route portals.`);
    return { regionId, cells: corridorCells(region, endpoints[0]!, endpoints[1]!) };
  });
}

function corridorCells(region: MacroRegion, start: GridCell & { direction: PlanarDirection }, end: GridCell & { direction: PlanarDirection }): readonly PlannedRoadCell[] {
  const cells = [start, ...manhattanPath(start, end)];
  const unique = new Map(cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
  const output: PlannedRoadCell[] = [];
  for (const cell of unique.values()) {
    const directions = [start, end].filter((endpoint) => endpoint.column === cell.column && endpoint.row === cell.row).map((endpoint) => endpoint.direction);
    for (const neighbor of cells) {
      const direction = directionFrom(cell, neighbor);
      if (direction && !directions.includes(direction)) directions.push(direction);
    }
    if (cell.column < region.bounds.column || cell.column >= region.bounds.column + region.bounds.width || cell.row < region.bounds.row || cell.row >= region.bounds.row + region.bounds.depth) {
      throw new Error(`Corridor leaves ${region.id}.`);
    }
    output.push({ column: cell.column, row: cell.row, directions: [...new Set(directions)].sort() as PlanarDirection[] });
  }
  return output;
}

function manhattanPath(start: GridCell, end: GridCell): readonly GridCell[] {
  const output: GridCell[] = [];
  let column = start.column;
  let row = start.row;
  while (column !== end.column) {
    column += Math.sign(end.column - column);
    output.push({ column, row });
  }
  while (row !== end.row) {
    row += Math.sign(end.row - row);
    output.push({ column, row });
  }
  return output;
}

function directionFrom(source: GridCell, target: GridCell): PlanarDirection | undefined {
  if (target.column === source.column && target.row === source.row + 1) return "north";
  if (target.column === source.column + 1 && target.row === source.row) return "east";
  if (target.column === source.column && target.row === source.row - 1) return "south";
  if (target.column === source.column - 1 && target.row === source.row) return "west";
  return undefined;
}

function createPortals(route: readonly string[], graph: MacroRegionGraph, seed: number): readonly RoadPortal[] {
  const byId = new Map(graph.regions.map((region) => [region.id, region]));
  return route.map((regionId, index) => {
    const from = byId.get(regionId)!;
    const to = byId.get(route[(index + 1) % route.length]!)!;
    return createPortal(from, to, index, seed);
  });
}

function createPortal(fromRegion: MacroRegion, toRegion: MacroRegion, index: number, seed: number): RoadPortal {
  const direction = directionBetween(fromRegion, toRegion);
  const from = portalCell(fromRegion, direction, seed, index);
  const to = portalCell(toRegion, oppositeDirection[direction], seed, index);
  return {
    id: `portal-${fromRegion.id}-${toRegion.id}`,
    fromRegionId: fromRegion.id,
    toRegionId: toRegion.id,
    from: { ...from, direction },
    to: { ...to, direction: oppositeDirection[direction] }
  };
}

function directionBetween(from: MacroRegion, to: MacroRegion): PlanarDirection {
  if (to.column === from.column && to.row === from.row + 1) return "north";
  if (to.column === from.column + 1 && to.row === from.row) return "east";
  if (to.column === from.column && to.row === from.row - 1) return "south";
  if (to.column === from.column - 1 && to.row === from.row) return "west";
  throw new Error(`Regions ${from.id} and ${to.id} do not share a border.`);
}

function portalCell(region: MacroRegion, direction: PlanarDirection, seed: number, index: number): GridCell {
  const across = direction === "north" || direction === "south" ? region.bounds.width : region.bounds.depth;
  const offset = safeBorderOffset(across, seed, index);
  if (direction === "north") return { column: region.bounds.column + offset, row: region.bounds.row + region.bounds.depth - 1 };
  if (direction === "east") return { column: region.bounds.column + region.bounds.width - 1, row: region.bounds.row + offset };
  if (direction === "south") return { column: region.bounds.column + offset, row: region.bounds.row };
  return { column: region.bounds.column, row: region.bounds.row + offset };
}

function safeBorderOffset(length: number, seed: number, index: number) {
  if (length <= 2) return Math.floor(length / 2);
  return 1 + stableIndex(seed, index, length, length - 2);
}

function stableIndex(seed: number, first: number, second: number, length: number) {
  let value = (seed ^ Math.imul(first + 1, 0x9e3779b9) ^ Math.imul(second + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  return (value >>> 0) % length;
}
