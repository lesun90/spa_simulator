/** Compatibility facade. New consumers import the owning module directly. */
export * from "./sceneLayoutTypes";
export { paletteFromAssets } from "./catalogPaletteFactory";
export { sceneObjectsFromWfcResult, previewObjectsFromWfcProgress, isGeneratedWfcObject } from "./sceneMapping";
export { mergeSemanticPorts, roadTopologyPorts, rotateSemanticPorts } from "./semanticPorts";
export { solvePlanarWfcInWorker, type WfcWorkerFactory } from "./solverComposition";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { paletteFromAssets } from "./catalogPaletteFactory";
import { sceneObjectsFromWfcResult } from "./sceneMapping";
import { solvePlanarWfc, type PlanarWfcPalette } from "./planarWfc";
import type { GenerateWfcLayoutRequest, GenerateWfcLayoutResult } from "./sceneLayoutTypes";
import { preparePlanarPalette } from "./compactPlanarWfc";
export function generateWfcLayout(assets: readonly AssetCatalogEntry[], request: GenerateWfcLayoutRequest, options: { category?: string } = {}): GenerateWfcLayoutResult { const palette = paletteFromAssets("catalog", assets, { tileWidth: request.tileWidth, tileDepth: request.tileDepth, category: options.category, profile: request.profile }); return sceneObjectsFromWfcResult(solvePlanarWfc(palette, request, { policies: request.policies }), request, palette); }
export function compactPaletteMetrics(palette: PlanarWfcPalette) { const prepared = preparePlanarPalette(palette); return { bytes: prepared.byteLength, distinctSocketIds: new Set(prepared.compact.socketIds).size }; }
