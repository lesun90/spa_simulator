import { directionOffset, oppositeDirection, planarDirections, SeededRandom, solvePlanarWfc, type PlanarDirection, type PlanarPolicySpec, type PlanarWfcPalette, type PlanarWfcVariant } from "./planarWfc";
import { planLake } from "./scenicWaterPlan";
import type { GridCell, PlannedRoadCell, WorldPlan } from "./worldPlan";

const tileId = (number: string) => `3d-road-tiles.road-tile-${number}`;
const key = (cell: GridCell) => `${cell.column},${cell.row}`;
const move = (cell: GridCell, direction: PlanarDirection): GridCell => ({ column: cell.column + directionOffset[direction].column, row: cell.row + directionOffset[direction].row });
const ports = (variant: PlanarWfcVariant) => planarDirections.filter((direction) => variant.semanticPorts?.[direction]?.includes("road"));
const samePorts = (a: readonly PlanarDirection[], b: readonly PlanarDirection[]) => a.length === b.length && a.every((direction) => b.includes(direction));

/** Enrich the accepted primary cycle without relaxing its road or seam constraints. */
export function planScenicWorld(plan: WorldPlan, palette: PlanarWfcPalette, seed: number): WorldPlan {
  return new ScenicPlan(plan, palette, new SeededRandom(seed)).build();
}

class ScenicPlan {
  private readonly roads = new Map<string, PlannedRoadCell>();
  private readonly tiles = new Map<string, GridCell & { variantIds: readonly string[] }>();
  private readonly occupied = new Set<string>();
  private readonly ground: PlanarWfcVariant | undefined;

  constructor(private readonly plan: WorldPlan, private readonly palette: PlanarWfcPalette, private readonly random: SeededRandom) {
    for (const corridor of plan.corridors) for (const cell of corridor.cells) this.roads.set(key(cell), { ...cell, directions: [...cell.directions] });
    this.ground = palette.variants.find((variant) => variant.assetId === tileId("163"));
  }

  build(): WorldPlan {
    if (!this.ground) throw new Error("Scenic road generation requires reviewed ground tile 163.");
    this.addStreets(1);
    const lake = planLake(this.plan.bounds, this.roads, this.palette, this.random);
    if (!lake.length) throw new Error("Could not fit an enclosed lake and high bridge in this road plan. Try a larger scene or another seed.");
    for (const cell of lake) {
      // Ordinary flat cells can still receive streets; reserve every actual
      // shoreline, bank, slope and elevated road before adding chords.
      if (["163", "162", "153"].some((id) => cell.variant.assetId === tileId(id))) continue;
      this.pin(cell, [cell.variant]);
      this.occupied.add(key(cell));
    }
    this.addStreets();
    this.junctions();
    this.overpasses();
    this.bendRoads();
    const featureCount = Math.max(1, Math.min(12, Math.floor(this.plan.bounds.width * this.plan.bounds.depth / 180)));

    this.terrainFeatures(featureCount);

    // Unplanned terrain stays ground. Variety comes from connected, bounded
    // features, not independent random water/slope cells that consume the world.
    const ordinaryRoads = new Set(["162", "031", "153"].map(tileId));
    for (let row = 0; row < this.plan.bounds.depth; row++) for (let column = 0; column < this.plan.bounds.width; column++) {
      const cell = { column, row };
      if (this.tiles.has(key(cell))) continue;
      const road = this.roads.get(key(cell));
      this.pin(cell, road
        ? this.palette.variants.filter((variant) => ordinaryRoads.has(variant.assetId) && samePorts(ports(variant), road.directions))
        : [this.ground]);
    }
    const corridors = this.plan.graph.regions.map((region) => ({ regionId: region.id, cells: [...this.roads.values()].filter((cell) =>
      cell.column >= region.bounds.column && cell.column < region.bounds.column + region.bounds.width && cell.row >= region.bounds.row && cell.row < region.bounds.row + region.bounds.depth
    ) })).filter((corridor) => corridor.cells.length);
    return { ...this.plan, corridors, tiles: [...this.tiles.values()] };
  }

  private shuffled<T>(values: readonly T[]): T[] {
    const output = [...values];
    for (let index = output.length - 1; index > 0; index--) {
      const other = this.random.nextInt(index + 1);
      [output[index], output[other]] = [output[other], output[index]];
    }
    return output;
  }

  private addStreets(limit = 6) {
    let placed = 0;
    const axes = this.shuffled(["east", "north"] as const);
    const roadCells = [...this.roads.values()];
    const minColumn = Math.min(...roadCells.map((cell) => cell.column)), maxColumn = Math.max(...roadCells.map((cell) => cell.column));
    const minRow = Math.min(...roadCells.map((cell) => cell.row)), maxRow = Math.max(...roadCells.map((cell) => cell.row));
    for (const axis of [...axes, ...axes, ...axes]) {
      const perpendicular = axis === "east" ? ["north", "south"] as const : ["east", "west"] as const;
      const candidates: GridCell[][] = [];
      for (const start of this.roads.values()) {
        if (!this.canJunction(start, perpendicular)) continue;
        const path: GridCell[] = [start];
        for (let next = move(start, axis); this.inside(next); next = move(next, axis)) {
          if (this.occupied.has(key(next))) break;
          path.push(next);
          const road = this.roads.get(key(next));
          if (!road) continue;
          if (!this.canJunction(road, perpendicular)) break;
          const intersections = path.flatMap((cell, index) => this.roads.has(key(cell)) ? [index] : []);
          // Validate new/new junction spacing too, not just existing junctions:
          // each center needs one straight crosswalk cell on every approach.
          if (path.length >= 7 && intersections.every((index, position) => position === 0 || index - intersections[position - 1] >= 3)) candidates.push([...path]);
          // Continue through a perpendicular street to allow a four-way crossing.
        }
      }
      const clearance = (path: GridCell[]) => axis === "east" ? Math.min(path[0].row - minRow, maxRow - path[0].row) : Math.min(path[0].column - minColumn, maxColumn - path[0].column);
      const path = this.shuffled(candidates).sort((a, b) => b.length - a.length || (limit === 1 ? clearance(b) - clearance(a) : 0))[0];
      if (!path) continue;
      for (let index = 0; index < path.length; index++) {
        const cell = path[index];
        const directions = new Set(this.roads.get(key(cell))?.directions ?? []);
        if (index > 0) directions.add(oppositeDirection[axis]);
        if (index < path.length - 1) directions.add(axis);
        this.roads.set(key(cell), { ...cell, directions: [...directions] });
      }
      if (++placed >= limit) return;
    }
  }

  private canJunction(cell: PlannedRoadCell, perpendicular: readonly PlanarDirection[]) {
    if ([cell, ...planarDirections.map((direction) => move(cell, direction))].some((position) => this.occupied.has(key(position)))) return false;
    if (!samePorts(cell.directions, perpendicular)) return false;
    if (!perpendicular.every((direction) => samePorts(this.roads.get(key(move(cell, direction)))?.directions ?? [], perpendicular))) return false;
    return [...this.roads.values()].every((other) => other.directions.length < 3 || Math.abs(other.column - cell.column) + Math.abs(other.row - cell.row) >= 3);
  }

  private junctions() {
    for (const cell of this.roads.values()) {
      if (cell.directions.length < 3) continue;
      this.pin(cell, this.palette.variants.filter((variant) => variant.assetId === tileId(cell.directions.length === 4 ? "034" : "027") && samePorts(ports(variant), cell.directions)));
      for (const direction of cell.directions) {
        const neighbor = move(cell, direction);
        this.pin(neighbor, this.palette.variants.filter((variant) => variant.assetId === tileId("025") && samePorts(ports(variant), [direction, oppositeDirection[direction]])));
      }
    }
  }

  private overpasses() {
    const candidates = this.shuffled([...this.roads.values()].filter((cell) => cell.directions.length === 4));
    for (const center of candidates) for (const transpose of this.shuffled([false, true])) {
      const width = transpose ? 7 : 5, depth = transpose ? 5 : 7;
      const origin = { column: center.column - Math.floor(width / 2), row: center.row - Math.floor(depth / 2) };
      const removed = [center, ...planarDirections.map((direction) => move(center, direction))].map((cell) => this.tiles.get(key(cell))).filter((cell) => cell !== undefined);
      for (const cell of removed) this.tiles.delete(key(cell));
      const success = this.patch(origin, width, depth, ["025", "162", "154", "161", "165", "171", "180", "164", "170", "191", "231", "194", "163", "036", "037", "140", "151", "152", "012"], { cell: center, ids: ["194"] }, (cell, variant) => {
        const along = transpose ? cell.column - center.column : cell.row - center.row;
        const across = transpose ? cell.row - center.row : cell.column - center.column;
        const id = variant.assetId.split("road-tile-")[1];
        if (across === 0 && along === 0) return variant.rotationDegrees === (transpose ? 90 : 0);
        if (across === 0 && Math.abs(along) === 1) return id === "164" || id === "170";
        if (across === 0 && Math.abs(along) === 2) return ["154", "161", "165", "171", "180"].includes(id);
        if (along === 0 && Math.abs(across) === 1) return id === "191" || id === "231";
        return !ports(variant).length || id === "162" || id === "025";
      });
      if (success) return;
      for (const cell of removed) this.tiles.set(key(cell), cell);
    }
  }

  private bendRoads() {
    const portalPorts = new Map<string, Set<PlanarDirection>>();
    for (const portal of this.plan.route.portals) for (const cell of [portal.from, portal.to]) {
      const required = portalPorts.get(key(cell)) ?? new Set<PlanarDirection>();
      required.add(cell.direction);
      portalPorts.set(key(cell), required);
    }
    const target = Math.max(1, Math.min(28, Math.floor(this.plan.bounds.width * this.plan.bounds.depth / 110)));
    let placed = 0;
    for (const start of this.shuffled([...this.roads.values()])) for (const axis of this.shuffled(["north", "east"] as const)) {
      if (placed >= target) return;
      const original = [start, move(start, axis), move(move(start, axis), axis)];
      if (!original.every((cell) => samePorts(this.roads.get(key(cell))?.directions ?? [], [axis, oppositeDirection[axis]]) && !this.tiles.has(key(cell)))) continue;
      if (portalPorts.has(key(original[1]))) continue;
      const sides = axis === "north" ? ["east", "west"] as const : ["north", "south"] as const;
      for (const side of this.shuffled(sides)) {
        const detour = original.map((cell) => move(cell, side));
        if (detour.some((cell) => !this.inside(cell) || this.roads.has(key(cell)) || this.tiles.has(key(cell)))) continue;
        const first = [oppositeDirection[axis], side], last = [axis, side];
        if ([...portalPorts.get(key(original[0])) ?? []].some((direction) => !first.includes(direction)) || [...portalPorts.get(key(original[2])) ?? []].some((direction) => !last.includes(direction))) continue;
        // Replace one straight segment with a four-bend offset. Its two outside
        // connections (including primary-route portals) remain unchanged.
        this.roads.delete(key(original[1]));
        this.roads.set(key(original[0]), { ...original[0], directions: first });
        this.roads.set(key(original[2]), { ...original[2], directions: last });
        this.roads.set(key(detour[0]), { ...detour[0], directions: [oppositeDirection[side], axis] });
        this.roads.set(key(detour[1]), { ...detour[1], directions: [axis, oppositeDirection[axis]] });
        this.roads.set(key(detour[2]), { ...detour[2], directions: [oppositeDirection[axis], oppositeDirection[side]] });
        placed++;
        break;
      }
    }
  }

  private terrainFeatures(count: number) {
    let placed = 0;
    const area = this.plan.bounds.width * this.plan.bounds.depth;
    const preferredSize = Math.min(11, Math.max(3, Math.floor(Math.sqrt(area / count) * 0.35) | 1));
    for (const size of [...new Set([preferredSize, 3, 2])]) {
      const candidates: GridCell[] = [];
      for (let row = 0; row <= this.plan.bounds.depth - size; row++) for (let column = 0; column <= this.plan.bounds.width - size; column++) candidates.push({ column, row });
      for (const origin of this.shuffled(candidates)) {
        if (placed >= count) return;
        const cells = Array.from({ length: size * size }, (_, index) => ({ column: origin.column + index % size, row: origin.row + Math.floor(index / size) }));
        if (cells.some((cell) => this.roads.has(key(cell)) || this.tiles.has(key(cell)))) continue;
        const ids = ["163", "036", "037", "140", "151", "152", "012"];
        const anchor = { column: origin.column + (size >= 3 ? Math.floor(size / 2) : 0), row: origin.row + (size >= 3 ? Math.floor(size / 2) : 0) };
        if (this.patch(origin, size, size, ids, { cell: anchor, ids: [size >= 3 ? "036" : "140"], core: size > 3 })) placed++;
      }
    }
  }

  private patch(origin: GridCell, width: number, depth: number, numbers: readonly string[], anchor: { cell: GridCell; ids: readonly string[]; core?: boolean }, accepts?: (cell: GridCell, variant: PlanarWfcVariant) => boolean): boolean {
    if (!this.inside(origin) || !this.inside({ column: origin.column + width - 1, row: origin.row + depth - 1 })) return false;
    const ids = new Set(numbers.map(tileId));
    const variants = this.palette.variants.filter((variant) => ids.has(variant.assetId));
    const anchorIds = new Set(anchor.ids.map(tileId));
    const policies: PlanarPolicySpec[] = [];
    for (let row = 0; row < depth; row++) for (let column = 0; column < width; column++) {
      const cell = { column: origin.column + column, row: origin.row + row };
      if (this.occupied.has(key(cell))) return false;
      const road = this.roads.get(key(cell));
      const existing = this.tiles.get(key(cell));
      const allowed = variants.filter((variant) => {
        if (!samePorts(ports(variant), road?.directions ?? [])) return false;
        if (accepts && !accepts(cell, variant)) return false;
        if (existing && !existing.variantIds.includes(variant.id)) return false;
        const core = anchor.core && column > 0 && row > 0 && column < width - 1 && row < depth - 1;
        if ((core || key(cell) === key(anchor.cell)) && !anchorIds.has(variant.assetId)) return false;
        for (const direction of planarDirections) {
          const neighbor = move({ column, row }, direction);
          if (neighbor.column >= 0 && neighbor.column < width && neighbor.row >= 0 && neighbor.row < depth) continue;
          // Features return to ordinary grass/road at their perimeter, so a
          // successful local solve cannot impose extra terrain on its neighbors.
          const reference = road?.directions.includes(direction)
            ? this.palette.variants.find((candidate) => candidate.assetId === tileId("162") && ports(candidate).includes(direction))
            : this.ground;
          if (!reference || variant.sockets[direction] !== reference.sockets[direction]) return false;
        }
        return true;
      });
      if (!allowed.length) return false;
      policies.push({ type: "cell-variants", id: `feature-${column}-${row}`, column, row, variantIds: allowed.map((variant) => variant.id) });
    }
    const variantIds = new Set(variants.map((variant) => variant.id));
    const localPalette = { ...this.palette, variants, adjacency: Object.fromEntries(variants.map((variant) => [variant.id, Object.fromEntries(planarDirections.map((direction) => [direction, this.palette.adjacency[variant.id][direction].filter((id) => variantIds.has(id))])) as Record<PlanarDirection, string[]>])) } as PlanarWfcPalette;
    const result = solvePlanarWfc(localPalette, { width, depth, seed: this.random.nextInt(0xffffffff), maxBacktracks: 256, policies });
    if (result.status !== "solved") return false;
    for (const cell of result.cells) {
      const position = { column: origin.column + cell.column, row: origin.row + cell.row };
      this.pin(position, [cell.variant]);
      this.occupied.add(key(position));
    }
    return true;
  }

  private pin(cell: GridCell, variants: readonly PlanarWfcVariant[]) {
    const existing = this.tiles.get(key(cell));
    const variantIds = variants.map((variant) => variant.id).filter((id) => !existing || existing.variantIds.includes(id));
    if (!variantIds.length) throw new Error(`No reviewed tile can fulfill scenery at ${key(cell)}.`);
    this.tiles.set(key(cell), { column: cell.column, row: cell.row, variantIds });
  }

  private inside(cell: GridCell) {
    return cell.column >= 0 && cell.column < this.plan.bounds.width && cell.row >= 0 && cell.row < this.plan.bounds.depth;
  }
}
