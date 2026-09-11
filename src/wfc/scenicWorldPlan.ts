import { directionOffset, oppositeDirection, planarDirections, SeededRandom, solvePlanarWfc, type PlanarDirection, type PlanarPolicySpec, type PlanarWfcPalette, type PlanarWfcVariant } from "./planarWfc";
import { planLake, planStandaloneLake } from "./scenicWaterPlan";
import { planRoundabout } from "./scenicRoundaboutPlan";
import type { GridCell, PlannedRoadCell, WorldPlan } from "./worldPlan";

const tileId = (number: string) => `3d-road-tiles.road-tile-${number}`;
const key = (cell: GridCell) => `${cell.column},${cell.row}`;
const move = (cell: GridCell, direction: PlanarDirection): GridCell => ({ column: cell.column + directionOffset[direction].column, row: cell.row + directionOffset[direction].row });
const ports = (variant: PlanarWfcVariant) => planarDirections.filter((direction) => variant.semanticPorts?.[direction]?.includes("road"));
const samePorts = (a: readonly PlanarDirection[], b: readonly PlanarDirection[]) => a.length === b.length && a.every((direction) => b.includes(direction));
const terrainTiles = ["163", "036", "037", "140", "151", "152", "012"] as const;

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
    const area = this.plan.bounds.width * this.plan.bounds.depth;
    this.addStreets(1);
    const earlyBridges = this.bridgeLakes(1);
    this.growStreets();
    this.addStreets(Math.max(2, Math.round(area / 180)));
    this.junctions();
    this.overpasses(Math.max(1, Math.round(area / 500)));
    this.bridgeLakes(Math.max(1, Math.round(area / 450)) - earlyBridges, "low");
    this.roundabouts(Math.max(1, Math.round(area / 350)));
    this.junctions();
    this.bendRoads();
    this.smoothCorners();
    this.mountainPasses(Math.max(1, Math.round(area / 600)));
    for (let index = 0; index < Math.max(1, Math.round(area / 600)); index++) {
      const lake = planStandaloneLake(this.plan.bounds, this.roads, this.palette, this.random, this.occupied);
      if (!lake.length) break;
      for (const cell of lake) {
        if (cell.variant.assetId === this.ground.assetId) continue;
        this.pin(cell, [cell.variant]);
        this.occupied.add(key(cell));
      }
    }
    this.terrainFeatures(Math.max(1, Math.round(area / 160)));

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

  private bridgeLakes(target: number, firstElevation: "high" | "low" = "high") {
    let placed = 0;
    while (placed < target) {
      const elevation = placed % 2 === 0 ? firstElevation : firstElevation === "high" ? "low" : "high";
      let lake = planLake(this.plan.bounds, this.roads, this.palette, this.random, this.occupied, elevation);
      if (!lake.length) lake = planLake(this.plan.bounds, this.roads, this.palette, this.random, this.occupied, elevation === "high" ? "low" : "high");
      if (!lake.length) break;
      for (const cell of lake) {
        // Flat margins may receive streets later; protect shore, banks, ramps
        // and decks before extending the network through the remaining land.
        if (["163", "162", "153", "025", "150", "141"].some((id) => cell.variant.assetId === tileId(id))) continue;
        this.pin(cell, [cell.variant]); this.occupied.add(key(cell));
      }
      placed++;
    }
    return placed;
  }

  /** Sample blocks over the whole world, not only inside the primary loop.
   * Intersecting loops extend the connected network without dangling roads.
   * Rejection enforces buildability, not equal spacing or regional quotas. */
  private growStreets() {
    const { width, depth } = this.plan.bounds;
    const area = width * depth;
    for (let attempt = 0; attempt < area * 8 && this.roads.size < area * 0.24; attempt++) {
      const blockWidth = 5 + this.random.nextInt(Math.max(1, Math.min(15, width - 2) - 4));
      const blockDepth = 5 + this.random.nextInt(Math.max(1, Math.min(15, depth - 2) - 4));
      if (blockWidth > width - 2 || blockDepth > depth - 2) continue;
      let left = 1 + this.random.nextInt(width - blockWidth - 1);
      let bottom = 1 + this.random.nextInt(depth - blockDepth - 1);
      let right = left + blockWidth - 1, top = bottom + blockDepth - 1;
      if (attempt % 2 === 0) {
        // Uniform land samples can lie outside the current network. Attach a
        // loop to the nearest usable street there instead of rejecting every
        // sample in an unvisited district (which biases growth toward towns).
        const target = { column: 1 + this.random.nextInt(width - 2), row: 1 + this.random.nextInt(depth - 2) };
        let distance = Infinity;
        for (const road of this.roads.values()) {
          if (road.directions.length !== 2 || !road.directions.includes(oppositeDirection[road.directions[0]])) continue;
          const vertical = road.directions.includes("north");
          const across = Math.abs(vertical ? road.column - target.column : road.row - target.row);
          const along = Math.abs(vertical ? road.row - target.row : road.column - target.column);
          if (across < 4 || across + along >= distance) continue;
          const span = vertical ? blockDepth : blockWidth;
          const low = (vertical ? road.row : road.column) - Math.floor(span / 2), high = low + span - 1;
          const first = vertical ? { column: road.column, row: low } : { column: low, row: road.row };
          const last = vertical ? { column: road.column, row: high } : { column: high, row: road.row };
          if (!samePorts(this.roads.get(key(first))?.directions ?? [], road.directions) || !samePorts(this.roads.get(key(last))?.directions ?? [], road.directions)) continue;
          distance = across + along;
          [left, right] = vertical ? [Math.min(road.column, target.column), Math.max(road.column, target.column)] : [low, high];
          [bottom, top] = vertical ? [low, high] : [Math.min(road.row, target.row), Math.max(road.row, target.row)];
        }
      }
      const loop = new Map<string, PlannedRoadCell>();
      for (let row = bottom; row <= top; row++) for (let column = left; column <= right; column++) {
        if (column !== left && column !== right && row !== bottom && row !== top) continue;
        const directions: PlanarDirection[] = [];
        if (column === left || column === right) { if (row < top) directions.push("north"); if (row > bottom) directions.push("south"); }
        if (row === bottom || row === top) { if (column < right) directions.push("east"); if (column > left) directions.push("west"); }
        loop.set(`${column},${row}`, { column, row, directions });
      }
      let crossings = 0, valid = true;
      for (const cell of loop.values()) {
        if (this.occupied.has(key(cell))) { valid = false; break; }
        const existing = this.roads.get(key(cell));
        if (!existing) continue;
        // A block can share one of its sides with an existing street. Its two
        // ends become T junctions, allowing growth out of a dense primary loop
        // instead of requiring two unobstructed four-way crossings every time.
        const directions = [...new Set([...existing.directions, ...cell.directions])];
        loop.set(key(cell), { ...cell, directions });
        if (directions.length > existing.directions.length) crossings++;
      }
      if (!valid || crossings < 2) continue;
      const at = (cell: GridCell) => loop.get(key(cell)) ?? this.roads.get(key(cell));
      const junctions = [...this.roads.values(), ...loop.values()].filter((cell) => cell.directions.length >= 3);
      for (const cell of loop.values()) {
        if (cell.directions.length < 3) continue;
        if (planarDirections.some((d) => this.occupied.has(key(move(cell, d))))
          || junctions.some((other) => key(other) !== key(cell) && Math.abs(other.column - cell.column) + Math.abs(other.row - cell.row) < 4)
          || !cell.directions.every((d) => samePorts(at(move(cell, d))?.directions ?? [], [d, oppositeDirection[d]]))) { valid = false; break; }
      }
      if (valid) for (const cell of loop.values()) this.roads.set(key(cell), cell);
    }
  }

  private addStreets(limit: number) {
    let placed = 0;
    const axes = this.shuffled(["east", "north"] as const);
    for (let attempt = 0; attempt < limit * 2; attempt++) {
      const axis = axes[attempt % axes.length];
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
          if (path.length >= 7 && intersections.every((index, position) => position === 0 || index - intersections[position - 1] >= 4)) candidates.push([...path]);
          // Continue through a perpendicular street to allow a four-way crossing.
        }
      }
      // The first connecting street also offers a lake crossing. Sample among
      // sites with enough bank clearance, not a fixed centerline.
      const roomy = limit === 1 ? candidates.filter((path) => path.some((cell) => perpendicular.every((d) => {
        let next = cell;
        for (let offset = 0; offset < 4; offset++) { next = move(next, d); if (!this.inside(next) || this.roads.has(key(next))) return false; }
        return true;
      }))) : [];
      const choices = roomy.length ? roomy : candidates;
      const path = choices.length ? choices[this.random.nextInt(choices.length)] : undefined;
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
    return [...this.roads.values()].every((other) => other.directions.length < 3 || Math.abs(other.column - cell.column) + Math.abs(other.row - cell.row) >= 4);
  }

  private junctions() {
    for (const cell of this.roads.values()) {
      if (cell.directions.length < 3 || this.occupied.has(key(cell))) continue;
      this.pin(cell, this.palette.variants.filter((variant) => variant.assetId === tileId(cell.directions.length === 4 ? "141" : "150") && samePorts(ports(variant), cell.directions)));
      for (const direction of cell.directions) {
        const neighbor = move(cell, direction);
        this.pin(neighbor, this.palette.variants.filter((variant) => variant.assetId === tileId("025") && samePorts(ports(variant), [direction, oppositeDirection[direction]])));
      }
    }
  }

  private roundabouts(target: number) {
    const exitCounts = this.shuffled([1, 2, 3, 4]);
    let placed = 0;
    for (let attempt = 0; attempt < Math.max(4, target * 2) && placed < target; attempt++) {
      const exitCount = exitCounts[attempt % exitCounts.length];
      for (const road of this.shuffled([...this.roads.values()])) {
        if (exitCount !== 1) {
          if (road.directions.length === exitCount && this.placeRoundabout(road, road.directions)) { placed++; break; }
          continue;
        }
        // A single entrance is a connected turning circle at the end of a
        // short spur. Keep one straight approach between it and its T junction.
        if (road.directions.length !== 2 || !road.directions.includes(oppositeDirection[road.directions[0]]) || !this.canJunction(road, road.directions)) continue;
        let success = false;
        for (const direction of this.shuffled(planarDirections.filter((d) => !road.directions.includes(d)))) {
          const approach = move(road, direction);
          const center = move(move(approach, direction), direction);
          if (!this.inside(approach) || this.roads.has(key(approach)) || this.tiles.has(key(approach))) continue;
          if (!this.placeRoundabout(center, [oppositeDirection[direction]], true)) continue;
          this.roads.set(key(approach), { ...approach, directions: [direction, oppositeDirection[direction]] });
          this.roads.set(key(road), { ...road, directions: [...road.directions, direction] });
          success = true; placed++; break;
        }
        if (success) break;
      }
    }
  }

  private placeRoundabout(center: GridCell, exits: readonly PlanarDirection[], spur = false) {
    if (!spur && exits.some((direction) => !samePorts(this.roads.get(key(move(move(center, direction), direction)))?.directions ?? [], [direction, oppositeDirection[direction]]))) return false;
    const positions = Array.from({ length: 9 }, (_, index) => ({ column: center.column - 1 + index % 3, row: center.row - 1 + Math.floor(index / 3) }));
    if (positions.some((cell) => {
      if (!this.inside(cell) || this.occupied.has(key(cell))) return true;
      const outward = exits.find((d) => key(move(center, d)) === key(cell));
      const expected = spur ? [] : key(cell) === key(center) ? exits : outward ? [outward, oppositeDirection[outward]] : [];
      return !samePorts(this.roads.get(key(cell))?.directions ?? [], expected);
    })) return false;
    const assembly = planRoundabout(exits, this.palette, this.random.nextInt(0xffffffff));
    if (!assembly.length) return false;
    const cells = assembly.map((cell) => ({ ...cell, column: center.column - 1 + cell.column, row: center.row - 1 + cell.row }));
    if (cells.some((cell) => planarDirections.some((direction) => {
      const neighbor = move(cell, direction);
      if (positions.some((position) => key(position) === key(neighbor))) return false;
      const pinned = this.tiles.get(key(neighbor));
      return pinned && !pinned.variantIds.some((id) => this.palette.adjacency[cell.variant.id][direction].includes(id));
    }))) return false;
    // Macro-route portals are still commitments after expanding the junction.
    if (this.plan.route.portals.some((portal) => [portal.from, portal.to].some((endpoint) => {
      const cell = cells.find((cell) => key(cell) === key(endpoint));
      return cell && !ports(cell.variant).includes(endpoint.direction);
    }))) return false;
    for (const cell of cells) {
      this.tiles.delete(key(cell));
      this.pin(cell, [cell.variant]); this.occupied.add(key(cell));
      const directions = ports(cell.variant);
      if (directions.length) this.roads.set(key(cell), { column: cell.column, row: cell.row, directions });
      else this.roads.delete(key(cell));
    }
    return true;
  }

  private mountainPasses(target: number) {
    let placed = 0;
    for (const start of this.shuffled([...this.roads.values()])) {
      if (placed >= target) return;
      if (start.directions.length !== 2 || !start.directions.includes(oppositeDirection[start.directions[0]])) continue;
      const vertical = start.directions.includes("north");
      const end = move(start, vertical ? "north" : "east");
      if (!samePorts(this.roads.get(key(end))?.directions ?? [], start.directions)) continue;
      // Two opposing road cuts meet at their high ends; surrounding slopes
      // close the ridge back down to grass on both sides of the roadway.
      const origin = { column: start.column - (vertical ? 2 : 0), row: start.row - (vertical ? 0 : 2) };
      if (this.patch(origin, vertical ? 5 : 2, vertical ? 2 : 5, [...terrainTiles, "231"], { cell: start, ids: ["231"] }, (cell, variant) =>
        variant.assetId === tileId("231") ? key(cell) === key(start) || key(cell) === key(end) : !this.roads.has(key(cell))
      )) placed++;
    }
  }

  private overpasses(target: number) {
    const placed: GridCell[] = [];
    const candidates = this.shuffled([...this.roads.values()].filter((cell) => cell.directions.length === 4));
    for (const center of candidates) for (const transpose of this.shuffled([false, true])) {
      if (placed.length >= target) return;
      if (placed.some((other) => Math.hypot(other.column - center.column, other.row - center.row) < 9)) continue;
      const width = transpose ? 7 : 5, depth = transpose ? 5 : 7;
      const origin = { column: center.column - Math.floor(width / 2), row: center.row - Math.floor(depth / 2) };
      const removed = [center, ...planarDirections.map((direction) => move(center, direction))].map((cell) => this.tiles.get(key(cell))).filter((cell) => cell !== undefined);
      for (const cell of removed) this.tiles.delete(key(cell));
      const success = this.patch(origin, width, depth, ["025", "162", "154", "161", "165", "171", "180", "164", "170", "191", "231", "194", ...terrainTiles], { cell: center, ids: ["194"] }, (cell, variant) => {
        const along = transpose ? cell.column - center.column : cell.row - center.row;
        const across = transpose ? cell.row - center.row : cell.column - center.column;
        const id = variant.assetId.split("road-tile-")[1];
        if (across === 0 && along === 0) return variant.rotationDegrees === (transpose ? 90 : 0);
        if (across === 0 && Math.abs(along) === 1) return id === "164" || id === "170";
        if (across === 0 && Math.abs(along) === 2) return ["154", "161", "165", "171", "180"].includes(id);
        if (along === 0 && Math.abs(across) === 1) return id === "191" || id === "231";
        return !ports(variant).length || id === "162" || id === "025";
      });
      if (success) { placed.push(center); break; }
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
    const target = Math.max(1, Math.floor(this.plan.bounds.width * this.plan.bounds.depth / 500));
    let placed = 0;
    for (const start of this.shuffled([...this.roads.values()])) for (const axis of this.shuffled(["north", "east"] as const)) {
      if (placed >= target) return;
      const original: GridCell[] = [start];
      const length = 7 + this.random.nextInt(3);
      while (original.length < length) original.push(move(original.at(-1)!, axis));
      if (!original.every((cell) => samePorts(this.roads.get(key(cell))?.directions ?? [], [axis, oppositeDirection[axis]]) && !this.tiles.has(key(cell)))) continue;
      if (original.slice(1, -1).some((cell) => portalPorts.has(key(cell)))) continue;
      const sides = axis === "north" ? ["east", "west"] as const : ["north", "south"] as const;
      for (const side of this.shuffled(sides)) {
        const detour: GridCell[] = [];
        let cursor: GridCell = start;
        for (const direction of [...Array<PlanarDirection>(3).fill(side), ...Array<PlanarDirection>(length - 1).fill(axis), ...Array<PlanarDirection>(2).fill(oppositeDirection[side])]) {
          cursor = move(cursor, direction); detour.push(cursor);
        }
        if (detour.some((cell) => !this.inside(cell) || this.roads.has(key(cell)) || this.tiles.has(key(cell)))) continue;
        const path = [start, ...detour, original.at(-1)!];
        const directionsTo = (from: GridCell, to: GridCell) => planarDirections.find((d) => key(move(from, d)) === key(to))!;
        const replacement = path.map((cell, index) => ({ ...cell, directions: [index ? directionsTo(cell, path[index - 1]) : oppositeDirection[axis], index < path.length - 1 ? directionsTo(cell, path[index + 1]) : axis] }));
        if (replacement.some((cell) => [...portalPorts.get(key(cell)) ?? []].some((d) => !cell.directions.includes(d)))) continue;
        // Leave enough room between corners for disjoint broad-curve assemblies.
        for (const cell of original) this.roads.delete(key(cell));
        for (const cell of replacement) this.roads.set(key(cell), cell);
        placed++;
        break;
      }
    }
  }

  private smoothCorners() {
    const rotate = (d: PlanarDirection, turns: number) => planarDirections[(planarDirections.indexOf(d) + turns) % 4];
    const assembly = [
      { id: "041", column: 0, row: -1, before: ["north", "south"] },
      { id: "144", column: 0, row: 0, before: ["east", "south"] },
      { id: "147", column: 1, row: -1, before: [] },
      { id: "156", column: 1, row: 0, before: ["east", "west"] }
    ] as const;
    for (const corner of this.shuffled([...this.roads.values()])) {
      if (corner.directions.length !== 2 || corner.directions.includes(oppositeDirection[corner.directions[0]])) continue;
      for (let turns = 0; turns < 4; turns++) {
        if (!samePorts(corner.directions, [rotate("east", turns), rotate("south", turns)])) continue;
        const cells = assembly.map((part) => {
          let column: number = part.column, row: number = part.row;
          for (let turn = 0; turn < turns; turn++) [column, row] = [row, -column];
          return { column: corner.column + column, row: corner.row + row, before: part.before.map((d) => rotate(d, turns)), variant: this.palette.variants.find((v) => v.assetId === tileId(part.id) && v.rotationDegrees === turns * 90) };
        });
        if (cells.some((cell) => !cell.variant || !this.inside(cell) || this.tiles.has(key(cell)) || !samePorts(this.roads.get(key(cell))?.directions ?? [], cell.before))) continue;
        const byCell = new Map(cells.map((cell) => [key(cell), cell.variant!]));
        const valid = cells.every((cell) => planarDirections.every((d) => {
          const neighbor = move(cell, d);
          const other = byCell.get(key(neighbor)) ?? this.palette.variants.find((v) => v.assetId === tileId(this.roads.has(key(neighbor)) ? "162" : "163") && samePorts(ports(v), this.roads.get(key(neighbor))?.directions ?? []));
          return other && this.palette.adjacency[cell.variant!.id][d].includes(other.id);
        }));
        if (!valid) continue;
        for (const cell of cells) {
          this.pin(cell, [cell.variant!]); this.occupied.add(key(cell));
          this.roads.set(key(cell), { column: cell.column, row: cell.row, directions: ports(cell.variant!) });
        }
      }
    }
  }

  private terrainFeatures(count: number) {
    const ids = terrainTiles;
    // Sample corner elevations once per shared vertex, rather than filling a
    // square core. The authored slopes then agree on both sides of every edge.
    // Reviewed NW, NE, SW, SE elevations. Do not parse geometric socket
    // strings here: worker palettes replace those strings with compact IDs.
    const cornerMasks: Readonly<Record<string, string>> = { "163": "0000", "036": "1111", "037": "1110", "140": "1000", "151": "1000", "152": "1010", "012": "1000" };
    const masks = new Map(this.palette.variants.filter((v) => ids.some((id) => v.assetId === tileId(id))).map((v) => {
      let mask = cornerMasks[v.assetId.split("road-tile-")[1]];
      for (let turn = 0; turn < v.rotationDegrees / 90; turn++) mask = mask[2] + mask[0] + mask[3] + mask[1];
      return [v.id, mask] as const;
    }));
    let placed = 0;
    for (let attempt = 0; attempt < count * 100 && placed < count; attempt++) {
      const width = 2 + this.random.nextInt(Math.min(8, this.plan.bounds.width - 1));
      const depth = 2 + this.random.nextInt(Math.min(7, this.plan.bounds.depth - 1));
      const origin = { column: this.random.nextInt(this.plan.bounds.width - width + 1), row: this.random.nextInt(this.plan.bounds.depth - depth + 1) };
      const cells = Array.from({ length: width * depth }, (_, i) => ({ column: origin.column + i % width, row: origin.row + Math.floor(i / width) }));
      if (cells.some((cell) => this.roads.has(key(cell)) || this.tiles.has(key(cell)))) continue;
      const cx = Math.floor(width / 2), cy = Math.floor(depth / 2);
      const rx = Math.max(0.7, width * (0.18 + this.random.next() * 0.17));
      const ry = Math.max(0.7, depth * (0.18 + this.random.next() * 0.17));
      const lean = (this.random.next() - 0.5) * 1.2;
      const phase = this.random.next() * Math.PI * 2;
      const high = (x: number, y: number) => {
        if (x <= 0 || y <= 0 || x >= width || y >= depth) return "0";
        const dx = (x - cx - lean * (y - cy)) / rx, dy = (y - cy) / ry;
        const edge = 1 + 0.2 * Math.sin(Math.atan2(dy, dx) * 3 + phase);
        return dx * dx + dy * dy < edge ? "1" : "0";
      };
      const desired = new Map(cells.map((cell) => {
        const x = cell.column - origin.column, y = cell.row - origin.row;
        return [key(cell), high(x, y + 1) + high(x + 1, y + 1) + high(x, y) + high(x + 1, y)];
      }));
      if ([...desired.values()].some((mask) => ![...masks.values()].includes(mask))) continue;
      const anchor = { column: origin.column + cx, row: origin.row + cy };
      if (this.patch(origin, width, depth, ids, { cell: anchor, ids: ids.slice(1) }, (cell, variant) => masks.get(variant.id) === desired.get(key(cell)))) placed++;
    }
  }

  private patch(origin: GridCell, width: number, depth: number, numbers: readonly string[], anchor: { cell: GridCell; ids: readonly string[] }, accepts?: (cell: GridCell, variant: PlanarWfcVariant) => boolean): boolean {
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
        if (key(cell) === key(anchor.cell) && !anchorIds.has(variant.assetId)) return false;
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
