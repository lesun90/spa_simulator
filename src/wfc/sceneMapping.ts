import type { SceneObject } from "../editor-core/scene";
import type { PlanarWfcPalette, PlanarWfcResult, PlanarWfcVariant } from "./planarWfc";
import { paletteProfile } from "./metadata/packCatalog";
import { DEFAULT_WFC_TILE_SIZE, GENERATED_WFC_NAME_PREFIX, type GenerateWfcLayoutRequest, type GenerateWfcLayoutResult } from "./sceneLayoutTypes";

export function sceneObjectsFromWfcResult(result: PlanarWfcResult, request: GenerateWfcLayoutRequest, palette: PlanarWfcPalette): GenerateWfcLayoutResult { if (result.status === "failed") return result; return { status: "solved", seed: result.seed, palette, decisions: result.decisions, backtracks: result.backtracks, objects: sceneObjectsFromSolvedCells(result.cells, result.seed, request, palette) }; }
function sceneObjectsFromSolvedCells(cells: readonly { column: number; row: number; variant: PlanarWfcVariant }[], seed: number, request: GenerateWfcLayoutRequest, palette: PlanarWfcPalette): SceneObject[] {
  return cells.map((cell) => ({
    id: `wfc-preview-${cell.column}-${cell.row}`,
    assetId: cell.variant.assetId,
    name: `${GENERATED_WFC_NAME_PREFIX} ${seed} [${cell.column}, ${cell.row}]`,
    position: { x: (cell.column - (request.width - 1) / 2) * palette.tileWidth, y: 0, z: (cell.row - (request.depth - 1) / 2) * palette.tileDepth },
    rotationY: (cell.variant.rotationDegrees * Math.PI) / 180,
    scale: palette.tileWidth / (paletteProfile(palette)?.dimensions.sourceTileWidth ?? DEFAULT_WFC_TILE_SIZE),
    generated: { pipeline: "wfc", stage: "structural", column: cell.column, row: cell.row, variantId: cell.variant.id, seed }
  }));
}
export function previewObjectsFromWfcProgress(cells: readonly { column: number; row: number; variant: PlanarWfcVariant }[], seed: number, request: GenerateWfcLayoutRequest, palette: PlanarWfcPalette) { return sceneObjectsFromSolvedCells(cells, seed, request, palette); }

export function isGeneratedWfcObject(object: SceneObject): boolean { return object.generated?.pipeline === "wfc" || object.name.startsWith(GENERATED_WFC_NAME_PREFIX); }
