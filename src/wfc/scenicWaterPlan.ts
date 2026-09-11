import { directionOffset, oppositeDirection, planarDirections, solvePlanarWfc, type PlanarDirection, type PlanarPolicySpec, type PlanarWfcPalette, type PlanarWfcVariant, type SeededRandom, type SolvedPlanarCell } from "./planarWfc";
import type { GridCell, PlannedRoadCell, WorldBounds } from "./worldPlan";

const key = (cell: GridCell) => `${cell.column},${cell.row}`;
const number = (variant: PlanarWfcVariant) => variant.assetId.split("road-tile-")[1];
const ports = (variant: PlanarWfcVariant, channel: string) => planarDirections.filter((direction) => variant.semanticPorts?.[direction]?.includes(channel));
const equal = (a: readonly PlanarDirection[], b: readonly PlanarDirection[]) => a.length === b.length && a.every((direction) => b.includes(direction));
const ramps = new Set(["154", "161", "165", "171", "180"]);
const terrain = new Set(["163", "036", "037", "140", "151", "152", "012"]);
// Compare asset numbers, so exclusions cover every rotated variant.
const excludedWaterTiles = new Set(["168", "176", "215", "242", "244", "264"]);
const banks = new Set(["195", "196", "205", "206"]);
const flatApproaches = new Set(["162"]);
const bridgeStyles = [
  { id: "197", approaches: ramps, clearance: 4, coreDistance: 3, minimumSpan: 2, raisedBanks: true },
  { id: "207", approaches: ramps, clearance: 4, coreDistance: 3, minimumSpan: 2, raisedBanks: true },
  { id: "187", approaches: flatApproaches, clearance: 3, coreDistance: 2, minimumSpan: 1, raisedBanks: false },
  { id: "188", approaches: flatApproaches, clearance: 3, coreDistance: 2, minimumSpan: 1, raisedBanks: false }
] as const;

/** A bounded, enclosed lake crossed by a high or low bridge. There are no
 * river corridors or boundary outlets. WFC assembles the rotated shoreline;
 * its perimeter must meet ordinary ground/roads on every side of the patch.
 */
export function planLake(bounds: WorldBounds, roads: ReadonlyMap<string, PlannedRoadCell>, palette: PlanarWfcPalette, random: SeededRandom, occupied: ReadonlySet<string> = new Set(), elevation: "high" | "low" = "high"): readonly SolvedPlanarCell[] {
  const ground = palette.variants.find((v) => number(v) === "163")!;
  const variants = palette.variants.map((variant) => ({ ...variant, weight: variant.weight * (number(variant) === "001" ? 2 : 1) }));
  const localPalette = { ...palette, variants };
  const styles = bridgeStyles.filter((style) => style.raisedBanks === (elevation === "high"));
  const { minimumSpan, clearance } = styles[0];
  const candidates: { start: PlannedRoadCell; transpose: boolean; span: number }[] = [];
  for (const start of roads.values()) for (const transpose of [false, true]) for (const span of [1, 2, 3, 4].filter((span) => span >= minimumSpan)) {
    const along: readonly PlanarDirection[] = transpose ? ["east", "west"] : ["north", "south"];
    const cell = (offset: number) => ({ column: start.column + (transpose ? offset : 0), row: start.row + (transpose ? 0 : offset) });
    if (!Array.from({ length: span + 2 }, (_, index) => roads.get(key(cell(index - 1)))).every((road) => road && equal(road.directions, along))) continue;
    // Abutments need a bank transition and shore on BOTH sides of the deck.
    const across = transpose ? start.row : start.column;
    const acrossSize = transpose ? bounds.depth : bounds.width;
    if (across < clearance || across >= acrossSize - clearance) continue;
    if (Array.from({ length: span + 2 }, (_, index) => cell(index - 1)).some((position) => occupied.has(key(position)))) continue;
    candidates.push({ start, transpose, span });
  }
  for (let i = candidates.length - 1; i > 0; i--) { const j = random.nextInt(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  for (const { start, transpose, span } of candidates.slice(0, 96)) for (const style of (random.nextInt(2) ? styles : [...styles].reverse())) {
    const sx = transpose ? start.row : start.column;
    const sy = transpose ? start.column : start.row;
    const acrossSize = transpose ? bounds.depth : bounds.width;
    const alongSize = transpose ? bounds.width : bounds.depth;
    if (span < style.minimumSpan || sx < style.clearance || sx >= acrossSize - style.clearance) continue;
    const left = sx - style.clearance, right = sx + style.clearance;
    const bottom = Math.max(0, sy - 2), top = Math.min(alongSize - 1, sy + span + 1);
    const position = (x: number, y: number): GridCell => transpose ? { column: y, row: x } : { column: x, row: y };
    const origin = position(left, bottom);
    const width = transpose ? top - bottom + 1 : right - left + 1;
    const depth = transpose ? right - left + 1 : top - bottom + 1;
    const policies: PlanarPolicySpec[] = [];
    let valid = true;
    for (let y = bottom; y <= top && valid; y++) for (let x = left; x <= right; x++) {
      const cell = position(x, y);
      if (occupied.has(key(cell))) { valid = false; break; }
      const road = roads.get(key(cell));
      const deck = x === sx && y >= sy && y < sy + span;
      const approach = x === sx && (y === sy - 1 || y === sy + span);
      const crosswalk = road && planarDirections.some((direction) => {
        const delta = directionOffset[direction];
        return (roads.get(key({ column: cell.column + delta.column, row: cell.row + delta.row }))?.directions.length ?? 0) >= 3;
      });
      const allowed = variants.filter((variant) => {
        const id = number(variant);
        if (!equal(ports(variant, "road"), road?.directions ?? [])) return false;
        if (road) {
          if (deck) { if (id !== style.id) return false; }
          else if (approach) { if (!style.approaches.has(id) || crosswalk) return false; }
          else if (road.directions.length >= 3) { if (id !== (road.directions.length === 4 ? "141" : "150")) return false; }
          else if (crosswalk) { if (id !== "025") return false; }
          else if (id !== "162" && id !== "153") return false;
        } else {
          if (!(terrain.has(id) || variant.roles?.includes("terrain.water")) || excludedWaterTiles.has(id)) return false;
          // Raised bank pieces belong only immediately beside the bridge, not
          // in long canal-like chains across the landscape.
          if (banks.has(id) && (!style.raisedBanks || Math.abs(x - sx) !== 1 || y < sy || y >= sy + span)) return false;
          // An open-water core on both sides of the span makes this a lake,
          // not a chain of bank and shoreline tiles masquerading as one.
          if (Math.abs(x - sx) === style.coreDistance && y === sy + Math.floor(span / 2) && id !== "001") return false;
        }
        for (const direction of planarDirections) {
          const delta = directionOffset[direction];
          const next = { column: cell.column + delta.column, row: cell.row + delta.row };
          if (next.column >= origin.column && next.column < origin.column + width && next.row >= origin.row && next.row < origin.row + depth) continue;
          const reference = road?.directions.includes(direction)
            ? variants.find((v) => number(v) === "162" && ports(v, "road").includes(direction)) : ground;
          if (!reference || variant.sockets[direction] !== reference.sockets[direction]) return false;
        }
        return true;
      });
      if (!allowed.length) { valid = false; break; }
      policies.push({ type: "cell-variants", id: `lake-${x}-${y}`, column: cell.column - origin.column, row: cell.row - origin.row, variantIds: allowed.map((v) => v.id) });
    }
    if (!valid) continue;
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = solvePlanarWfc(localPalette, { width, depth, seed: random.nextInt(0xffffffff), maxBacktracks: 16, policies });
      if (result.status !== "solved") continue;
      const cells = result.cells.map((cell) => ({ ...cell, column: cell.column + origin.column, row: cell.row + origin.row }));
      const lake = retainLake(cells, palette, ground, cells.filter((cell) => cell.variant.roles?.includes("road.bridge")));
      if (lake) return lake;
    }
  }
  return [];
}

/** Independent lakes use the same shoreline catalog and component validation as
 * bridge lakes, but require only a free land parcel, not an existing road. */
export function planStandaloneLake(bounds: WorldBounds, roads: ReadonlyMap<string, PlannedRoadCell>, palette: PlanarWfcPalette, random: SeededRandom, occupied: ReadonlySet<string>): readonly SolvedPlanarCell[] {
  if (Math.min(bounds.width, bounds.depth) < 5) return [];
  const ground = palette.variants.find((v) => number(v) === "163")!;
  const variants = palette.variants.filter((v) => number(v) === "163" || v.roles?.includes("terrain.water") && !ports(v, "road").length && !banks.has(number(v)) && !excludedWaterTiles.has(number(v)));
  for (let attempt = 0; attempt < Math.min(400, bounds.width * bounds.depth); attempt++) {
    const width = 4 + random.nextInt(Math.min(6, bounds.width - 3));
    const depth = 4 + random.nextInt(Math.min(6, bounds.depth - 3));
    const origin = { column: random.nextInt(bounds.width - width + 1), row: random.nextInt(bounds.depth - depth + 1) };
    const positions = Array.from({ length: width * depth }, (_, i) => ({ column: origin.column + i % width, row: origin.row + Math.floor(i / width) }));
    if (positions.some((cell) => occupied.has(key(cell)) || roads.has(key(cell)))) continue;
    const cx = Math.floor(width / 2), cy = Math.floor(depth / 2);
    const policies: PlanarPolicySpec[] = [];
    for (let row = 0; row < depth; row++) for (let column = 0; column < width; column++) {
      const core = column === cx && row === cy;
      const cutCorner = width >= 5 && depth >= 5 && (column === 0 || column === width - 1) && (row === 0 || row === depth - 1);
      const allowed = variants.filter((v) => {
        if (core && number(v) !== "001" || cutCorner && number(v) !== "163") return false;
        return planarDirections.every((d) => {
          const next = { column: column + directionOffset[d].column, row: row + directionOffset[d].row };
          return next.column >= 0 && next.column < width && next.row >= 0 && next.row < depth || v.sockets[d] === ground.sockets[d];
        });
      });
      policies.push({ type: "cell-variants", id: `lake-${column}-${row}`, column, row, variantIds: allowed.map((v) => v.id) });
    }
    const result = solvePlanarWfc(palette, { width, depth, seed: random.nextInt(0xffffffff), maxBacktracks: 32, policies });
    if (result.status !== "solved") continue;
    const cells = result.cells.map((cell) => ({ ...cell, column: cell.column + origin.column, row: cell.row + origin.row }));
    const anchor = cells.find((cell) => cell.column === origin.column + cx && cell.row === origin.row + cy)!;
    const lake = retainLake(cells, palette, ground, [anchor]);
    if (lake) return lake;
  }
  return [];
}

/** Discard incidental disconnected puddles only when replacing them with grass
 * preserves every seam. This avoids searching millions of unrelated dry-tile
 * alternatives just to reject a tiny extra puddle after an otherwise good solve.
 */
function retainLake(cells: readonly SolvedPlanarCell[], palette: PlanarWfcPalette, ground: PlanarWfcVariant, anchors: readonly SolvedPlanarCell[]): readonly SolvedPlanarCell[] | undefined {
  const byCell = new Map(cells.map((cell) => [key(cell), cell]));
  if (!anchors.length) return;
  const seen = new Set<string>();
  const queue = [anchors[0]];
  for (let index = 0; index < queue.length; index++) {
    const cell = queue[index];
    if (seen.has(key(cell))) continue;
    seen.add(key(cell));
    for (const direction of ports(cell.variant, "water")) {
      const delta = directionOffset[direction];
      const next = byCell.get(key({ column: cell.column + delta.column, row: cell.row + delta.row }));
      if (next?.variant.semanticPorts?.[oppositeDirection[direction]]?.includes("water") && !seen.has(key(next))) queue.push(next);
    }
  }
  if (anchors.some((cell) => !seen.has(key(cell))) || seen.size <= 8) return;
  const lake = cells.filter((cell) => seen.has(key(cell)));
  const xs = lake.map((cell) => cell.column), ys = lake.map((cell) => cell.row);
  const width = Math.max(...xs) - Math.min(...xs) + 1, depth = Math.max(...ys) - Math.min(...ys) + 1;
  const plain = lake.filter((cell) => number(cell.variant) === "001").length;
  if (!plain || Math.max(width, depth) > Math.min(width, depth) * 2.5) return;
  const output = cells.map((cell) => ports(cell.variant, "water").length && !seen.has(key(cell)) ? { ...cell, variant: ground } : cell);
  const completed = new Map(output.map((cell) => [key(cell), cell]));
  for (const cell of output) for (const direction of planarDirections) {
    const delta = directionOffset[direction];
    const next = completed.get(key({ column: cell.column + delta.column, row: cell.row + delta.row }));
    if (next && !palette.adjacency[cell.variant.id][direction].includes(next.variant.id)) return;
  }
  return output;
}
