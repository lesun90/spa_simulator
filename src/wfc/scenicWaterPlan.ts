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

/** A bounded, enclosed lake crossed by a multi-tile high bridge. There are no
 * river corridors or boundary outlets. WFC assembles the rotated shoreline;
 * its perimeter must meet ordinary ground/roads on every side of the patch.
 */
export function planLake(bounds: WorldBounds, roads: ReadonlyMap<string, PlannedRoadCell>, palette: PlanarWfcPalette, random: SeededRandom): readonly SolvedPlanarCell[] {
  const ground = palette.variants.find((v) => number(v) === "163")!;
  const variants = palette.variants.map((variant) => ({ ...variant, weight: variant.weight * (number(variant) === "001" ? 0.08 : variant.roles?.includes("terrain.shore") ? 3 : 1) }));
  const localPalette = { ...palette, variants };
  const candidates: { start: PlannedRoadCell; transpose: boolean; span: number }[] = [];
  for (const start of roads.values()) for (const transpose of [false, true]) for (const span of [2, 3, 4]) {
    const along: readonly PlanarDirection[] = transpose ? ["east", "west"] : ["north", "south"];
    const cell = (offset: number) => ({ column: start.column + (transpose ? offset : 0), row: start.row + (transpose ? 0 : offset) });
    if (!Array.from({ length: span + 2 }, (_, index) => roads.get(key(cell(index - 1)))).every((road) => road && equal(road.directions, along))) continue;
    // Abutments need a bank transition and shore on BOTH sides of the deck.
    const across = transpose ? start.row : start.column;
    const acrossSize = transpose ? bounds.depth : bounds.width;
    if (across < 2 || across >= acrossSize - 2) continue;
    candidates.push({ start, transpose, span });
  }
  for (let i = candidates.length - 1; i > 0; i--) { const j = random.nextInt(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  for (const { start, transpose, span } of candidates.slice(0, 96)) for (const bridgeType of (random.nextInt(2) ? ["197", "207"] : ["207", "197"])) {
    const sx = transpose ? start.row : start.column;
    const sy = transpose ? start.column : start.row;
    const acrossSize = transpose ? bounds.depth : bounds.width;
    const alongSize = transpose ? bounds.width : bounds.depth;
    const left = Math.max(0, sx - 4), right = Math.min(acrossSize - 1, sx + 4);
    const bottom = Math.max(0, sy - 2), top = Math.min(alongSize - 1, sy + span + 1);
    const position = (x: number, y: number): GridCell => transpose ? { column: y, row: x } : { column: x, row: y };
    const origin = position(left, bottom);
    const width = transpose ? top - bottom + 1 : right - left + 1;
    const depth = transpose ? right - left + 1 : top - bottom + 1;
    const policies: PlanarPolicySpec[] = [];
    let valid = true;
    for (let y = bottom; y <= top && valid; y++) for (let x = left; x <= right; x++) {
      const cell = position(x, y);
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
          if (deck) { if (id !== bridgeType) return false; }
          else if (approach) { if (!ramps.has(id) || crosswalk) return false; }
          else if (road.directions.length >= 3) { if (id !== (road.directions.length === 4 ? "034" : "027")) return false; }
          else if (crosswalk) { if (id !== "025") return false; }
          else if (id !== "162" && id !== "153") return false;
        } else {
          if (!(terrain.has(id) || variant.roles?.includes("terrain.water")) || excludedWaterTiles.has(id)) return false;
          // Raised bank pieces belong only immediately beside the bridge, not
          // in long canal-like chains across the landscape.
          if (banks.has(id) && (Math.abs(x - sx) !== 1 || y < sy || y >= sy + span)) return false;
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
      const lake = retainBridgedLake(cells, palette, ground);
      if (lake) return lake;
    }
  }
  return [];
}

/** Discard incidental disconnected puddles only when replacing them with grass
 * preserves every seam. This avoids searching millions of unrelated dry-tile
 * alternatives just to reject a tiny extra puddle after an otherwise good solve.
 */
function retainBridgedLake(cells: readonly SolvedPlanarCell[], palette: PlanarWfcPalette, ground: PlanarWfcVariant): readonly SolvedPlanarCell[] | undefined {
  const byCell = new Map(cells.map((cell) => [key(cell), cell]));
  const bridges = cells.filter((cell) => cell.variant.roles?.includes("road.bridge"));
  if (!bridges.length) return;
  const seen = new Set<string>();
  const queue = [bridges[0]];
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
  if (bridges.some((cell) => !seen.has(key(cell))) || seen.size <= 8) return;
  const lake = cells.filter((cell) => seen.has(key(cell)));
  const xs = lake.map((cell) => cell.column), ys = lake.map((cell) => cell.row);
  const width = Math.max(...xs) - Math.min(...xs) + 1, depth = Math.max(...ys) - Math.min(...ys) + 1;
  const shore = lake.filter((cell) => cell.variant.roles?.includes("terrain.shore")).length;
  const plain = lake.filter((cell) => number(cell.variant) === "001").length;
  if (seen.size === width * depth || Math.max(width, depth) > Math.min(width, depth) * 2.5 || shore <= plain) return;
  const output = cells.map((cell) => ports(cell.variant, "water").length && !seen.has(key(cell)) ? { ...cell, variant: ground } : cell);
  const completed = new Map(output.map((cell) => [key(cell), cell]));
  for (const cell of output) for (const direction of planarDirections) {
    const delta = directionOffset[direction];
    const next = completed.get(key({ column: cell.column + delta.column, row: cell.row + delta.row }));
    if (next && !palette.adjacency[cell.variant.id][direction].includes(next.variant.id)) return;
  }
  return output;
}
