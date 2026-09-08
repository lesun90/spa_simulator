import { type PlacementResolution, snapToCellCenter } from "../../editor-core/grid";
import type { GridDefinition, SceneObject } from "../../editor-core/scene";
import { snapRotationToQuarterTurn } from "./objectTransform";
import { snapScaleToGridCells } from "./placementSizing";

export function snapTransformPatchForInspection(
  patch: Partial<Pick<SceneObject, "position" | "rotationY" | "scale">>,
  resolution: PlacementResolution,
  grid: GridDefinition,
  cellFitScale: number
): Partial<Pick<SceneObject, "position" | "rotationY" | "scale">> {
  if (resolution === "free") return patch;

  return {
    ...patch,
    position: patch.position === undefined ? undefined : snapToCellCenter(patch.position, grid),
    rotationY: patch.rotationY === undefined ? undefined : snapRotationToQuarterTurn(patch.rotationY),
    scale: patch.scale === undefined ? undefined : snapScaleToGridCells(patch.scale, cellFitScale)
  };
}
