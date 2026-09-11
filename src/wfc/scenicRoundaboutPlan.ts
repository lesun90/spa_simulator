import { directionOffset, oppositeDirection, planarDirections, solvePlanarWfc, type PlanarDirection, type PlanarPolicySpec, type PlanarWfcPalette, type SolvedPlanarCell } from "./planarWfc";

/** A complete ring with one to four external arms. Tile 048 closes unused
 * exits; 049 corners, 043 entrances and island 039 retain their authored seams. */
export function planRoundabout(exits: readonly PlanarDirection[], palette: PlanarWfcPalette, seed: number): readonly SolvedPlanarCell[] {
  if (exits.length < 1 || exits.length > 4 || new Set(exits).size !== exits.length) return [];
  const policies: PlanarPolicySpec[] = [];
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const island = column === 1 && row === 1;
    const corner = column !== 1 && row !== 1;
    const outward = planarDirections.find((direction) => column === 1 + directionOffset[direction].column && row === 1 + directionOffset[direction].row);
    const id = island ? "039" : corner ? "049" : exits.includes(outward!) ? "043" : "048";
    const roads = island ? [] : planarDirections.filter((direction) => {
      const x = column + directionOffset[direction].column, y = row + directionOffset[direction].row;
      if (x === 1 && y === 1) return false;
      if (x >= 0 && x < 3 && y >= 0 && y < 3) return true;
      return direction === outward && exits.includes(direction);
    });
    const allowed = palette.variants.filter((variant) => variant.assetId.endsWith(`road-tile-${id}`)
      && planarDirections.every((direction) => Boolean(variant.semanticPorts?.[direction]?.includes("road")) === roads.includes(direction)));
    if (!allowed.length) return [];
    policies.push({ type: "cell-variants", id: `roundabout-${column}-${row}`, column, row, variantIds: allowed.map((variant) => variant.id) });
  }
  const result = solvePlanarWfc(palette, { width: 3, depth: 3, seed, policies });
  if (result.status !== "solved") return [];
  // All exterior edges must return to the ordinary road or grass profile.
  for (const cell of result.cells) for (const direction of planarDirections) {
    const x = cell.column + directionOffset[direction].column, y = cell.row + directionOffset[direction].row;
    if (x >= 0 && x < 3 && y >= 0 && y < 3) continue;
    const road = cell.variant.semanticPorts?.[direction]?.includes("road");
    const reference = palette.variants.find((v) => v.assetId.endsWith(`road-tile-${road ? "162" : "163"}`)
      && (!road || v.semanticPorts?.[oppositeDirection[direction]]?.includes("road")));
    if (!reference || !palette.adjacency[cell.variant.id][direction].includes(reference.id)) return [];
  }
  return result.cells;
}
