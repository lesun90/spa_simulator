import type { GridDefinition, Vector3Data } from "./scene";

export type PlacementResolution = "snap" | "free";

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
  grid: GridDefinition
): Vector3Data {
  if (resolution === "snap") {
    return snapToCellCenter(point, grid);
  }

  return { x: point.x, y: 0, z: point.z };
}
