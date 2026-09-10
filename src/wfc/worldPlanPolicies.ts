import { arePlanarNeighborsCompatible, type PlanarPolicySpec, type PlanarWfcPalette, type PlanarWfcResult } from "./planarWfc";
import type { WorldPlan } from "./worldPlan";

const directions = ["north", "east", "south", "west"] as const;

/** Converts a planned primary route into exact concrete WFC road-edge requirements. */
export function policiesFromWorldPlan(plan: WorldPlan): readonly PlanarPolicySpec[] {
  const plannedCells = new Map(plan.corridors.flatMap((corridor) => corridor.cells.map((cell) => [`${cell.column},${cell.row}`, cell] as const)));
  const policies: PlanarPolicySpec[] = [];

  for (let row = 0; row < plan.bounds.depth; row += 1) {
    for (let column = 0; column < plan.bounds.width; column += 1) {
      const cell = plannedCells.get(`${column},${row}`);
      if (cell) {
        policies.push({
          type: "exact-cell-ports",
          id: `planned-road-${column}-${row}`,
          column,
          row,
          ports: cell.directions.map((direction) => ({ direction, channel: "road" }))
        });
      } else {
        policies.push({
          type: "forbidden-cell-ports",
          id: `unplanned-road-${column}-${row}`,
          column,
          row,
          ports: directions.map((direction) => ({ direction, channel: "road" }))
        });
      }
    }
  }

  return [...policies, ...(plan.tiles ?? []).map((cell) => ({ type: "cell-variants" as const, id: `scenery-${cell.column}-${cell.row}`, ...cell }))];
}

/** Validates the concrete output against the accepted version-one world-plan contract. */
export function validateWorldPlanResult(plan: WorldPlan, palette: PlanarWfcPalette, result: PlanarWfcResult): readonly string[] {
  if (result.status !== "solved") return result.diagnostics;
  const cells = new Map<string, (typeof result.cells)[number]>(result.cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
  const planned = new Map<string, (typeof plan.corridors)[number]["cells"][number]>(plan.corridors.flatMap((corridor) => corridor.cells.map((cell) => [`${cell.column},${cell.row}`, cell])));
  const diagnostics: string[] = [];

  for (const tile of plan.tiles ?? []) {
    const actual = cells.get(`${tile.column},${tile.row}`);
    if (!actual || !tile.variantIds.includes(actual.variant.id)) diagnostics.push(`Scenery plan mismatch at ${tile.column},${tile.row}.`);
  }

  if (cells.size !== plan.bounds.width * plan.bounds.depth) diagnostics.push("The concrete result does not place every planned world cell.");
  for (const [key, cell] of cells) {
    const expected = planned.get(key)?.directions ?? [];
    const actual = directions.filter((direction) => cell.variant.semanticPorts?.[direction]?.includes("road"));
    if (actual.length !== expected.length || actual.some((direction) => !expected.includes(direction))) {
      diagnostics.push(`Road plan mismatch at ${key}.`);
    }
    for (const direction of ["north", "east"] as const) {
      const neighbor = cells.get(neighborKey(cell.column, cell.row, direction));
      if (neighbor && !arePlanarNeighborsCompatible(palette, cell.variant.id, direction, neighbor.variant.id)) {
        diagnostics.push(`Physical socket mismatch at ${key} toward ${direction}.`);
      }
    }
  }

  return diagnostics;
}

function neighborKey(column: number, row: number, direction: "north" | "east") {
  return direction === "north" ? `${column},${row + 1}` : `${column + 1},${row}`;
}
