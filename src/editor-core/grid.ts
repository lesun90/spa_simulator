import type { GridDefinition, Vector3Data } from "./scene";

export type PlacementResolution = "snap" | "free";
export const GRID_SIZE_MULTIPLIERS = [0.5, 1, 2, 3, 4, 5, 6, 7, 8] as const;

function nearestCellCenter(value: number, cellSize: number) {
  return Math.floor(value / cellSize) * cellSize + cellSize / 2;
}

export function snapToCellCenter(point: Vector3Data, grid: GridDefinition): Vector3Data {
  return {
    x: nearestCellCenter(point.x, grid.cellSize),
    y: 0,
    z: nearestCellCenter(point.z, grid.cellSize)
  };
}

export function resolveGroundPosition(
  point: Vector3Data,
  resolution: PlacementResolution,
  grid: GridDefinition,
  y = 0
): Vector3Data {
  if (resolution === "snap") {
    const snapped = snapToCellCenter(point, grid);
    return { ...snapped, y };
  }

  return { x: point.x, y, z: point.z };
}

export function snapToGridMultiplier(value: number): number {
  const safeValue = Number.isFinite(value) ? value : 1;
  return GRID_SIZE_MULTIPLIERS.reduce((best, candidate) =>
    Math.abs(candidate - safeValue) < Math.abs(best - safeValue) ? candidate : best
  );
}
