import { type PlacementResolution, snapToCellCenter, snapToGridMultiplier } from "../../editor-core/grid";
import type { GridDefinition, SceneObject } from "../../editor-core/scene";
import { snapRotationToQuarterTurn } from "./objectTransform";
import { gridCellsForScale, snapScaleToGridCells } from "./placementSizing";

export function snapTransformPatchForInspection(
  patch: Partial<Pick<SceneObject, "position" | "rotationY" | "scale">>,
  resolution: PlacementResolution,
  grid: GridDefinition,
  objectScale: number,
  cellFitScale: number,
  objectPosition?: SceneObject["position"]
): Partial<Pick<SceneObject, "position" | "rotationY" | "scale">> {
  if (resolution === "free") return patch;

  const snappedScale = patch.scale === undefined ? objectScale : snapScaleToGridCells(patch.scale, cellFitScale);
  const positionToSnap = patch.position ?? (patch.scale === undefined ? undefined : objectPosition);

  return {
    ...patch,
    position: positionToSnap === undefined ? undefined : snapPositionForFootprint(positionToSnap, grid, snappedScale, cellFitScale),
    rotationY: patch.rotationY === undefined ? undefined : snapRotationToQuarterTurn(patch.rotationY),
    scale: patch.scale === undefined ? undefined : snappedScale
  };
}

function snapPositionForFootprint(
  point: SceneObject["position"],
  grid: GridDefinition,
  objectScale: number,
  cellFitScale: number
): SceneObject["position"] {
  const cells = snapToGridMultiplier(gridCellsForScale(objectScale, cellFitScale));
  if (!Number.isInteger(cells) || cells % 2 !== 0) return snapToCellCenter(point, grid);

  return {
    x: snapToGridLine(point.x, grid.cellSize),
    y: 0,
    z: snapToGridLine(point.z, grid.cellSize)
  };
}

function snapToGridLine(value: number, cellSize: number): number {
  return Math.round(value / cellSize) * cellSize;
}
