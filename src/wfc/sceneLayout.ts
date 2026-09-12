import { planScenicWorld } from "./scenicWorldPlan";
import { policiesFromWorldPlan } from "./worldPlanPolicies";
import type { WorldPlan } from "./worldPlan";
import type { AssetCatalogEntry } from "../editor-core/assets";
import type { AssetSemantics, RoadTopologyTag } from "./metadata/socketTypes";
import type { SceneObject } from "../editor-core/scene";
import { preparePlanarPalette, cloneCompactPalette, compactVariantId, type CompactPlanarPalette, type PreparedPlanarPalette } from "./compactPlanarWfc";
import { resolveVariantWeight } from "./paletteSelection";
import { withReviewedRoadTransitions } from "./metadata/reviewedRoadTransitions";
import { createPlanarPalette, solvePlanarWfc, type PlanarDirection, type PlanarPolicySpec, type PlanarWfcPalette, type PlanarWfcProgress, type PlanarWfcResult, type PlanarWfcVariant } from "./planarWfc";

export const GENERATED_WFC_NAME_PREFIX = "WFC layout";
export const DEFAULT_WFC_TILE_SIZE = 3;
export interface GenerateWfcLayoutRequest { width: number; depth: number; seed: number; tileWidth?: number; tileDepth?: number; maxBacktracks?: number; policies?: readonly PlanarPolicySpec[]; }
export type GenerateWfcLayoutResult = | { status: "solved"; seed: number; objects: readonly SceneObject[]; palette: PlanarWfcPalette; decisions: number; backtracks: number } | Exclude<PlanarWfcResult, { status: "solved" }>;
export type WfcGenerationProgress = | { status: "building-palette" } | { status: "solving"; cells: number; variants: number; decisions: number; backtracks: number; collapsedCells: number; objects: readonly SceneObject[]; checkpoint?: string } | { status: "placing"; cells: number };
type CompactCell = { column: number; row: number; variantIndex: number };
type WorkerMessage = | { type: "plan"; plan: WorldPlan } | { type: "progress"; decisions: number; backtracks: number; collapsedCells: number; cells: readonly CompactCell[]; checkpoint: string } | { type: "result"; result: PlanarWfcResult | { status: "solved"; seed: number; cells: readonly CompactCell[]; decisions: number; backtracks: number } };
type WfcWorker = Pick<Worker, "postMessage" | "terminate"> & { onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null; onerror: ((event: ErrorEvent) => void) | null; };
export type WfcWorkerFactory = () => WfcWorker;
const createWfcWorker: WfcWorkerFactory = () => new Worker(new URL("./planarWfcWorker.ts", import.meta.url), { type: "module" });
const preparedPaletteCache = new WeakMap<readonly AssetCatalogEntry[], Map<string, PreparedPlanarPalette>>();
const preparedByPalette = new WeakMap<PlanarWfcPalette, PreparedPlanarPalette>();

export function solvePlanarWfcInWorker(palette: PlanarWfcPalette, request: GenerateWfcLayoutRequest, options: { onProgress?(progress: WfcGenerationProgress): void; workerFactory?: WfcWorkerFactory; signal?: AbortSignal; worldPlan?: WorldPlan; onWorldPlan?(plan: WorldPlan): void } = {}): Promise<PlanarWfcResult> {
  options.onProgress?.({ status: "solving", cells: request.width * request.depth, variants: palette.variants.length, decisions: 0, backtracks: 0, collapsedCells: 0, objects: [] });
  if (typeof Worker === "undefined" && !options.workerFactory) {
    const plan = options.worldPlan && planScenicWorld(options.worldPlan, palette, request.seed);
    if (plan) options.onWorldPlan?.(plan);
    return Promise.resolve(solvePlanarWfc(palette, { ...request, policies: [...(request.policies ?? []), ...(plan ? policiesFromWorldPlan(plan) : [])] }));
  }
  const prepared = preparedByPalette.get(palette) ?? preparePlanarPalette(palette);
  preparedByPalette.set(palette, prepared);
  const worker = (options.workerFactory ?? createWfcWorker)();
  return new Promise((resolve, reject) => {
    const cancel = () => { worker.terminate(); reject(new DOMException("WFC generation cancelled", "AbortError")); };
    options.signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "plan") { options.onWorldPlan?.(data.plan); return; }
      if (data.type === "progress") {
        options.onProgress?.({ status: "solving", cells: request.width * request.depth, variants: palette.variants.length, decisions: data.decisions, backtracks: data.backtracks, collapsedCells: data.collapsedCells, checkpoint: data.checkpoint, objects: previewObjectsFromCompactCells(data.cells, request.seed, request, palette) });
        return;
      }
      worker.terminate(); options.signal?.removeEventListener("abort", cancel);
      if (data.result.status === "failed") resolve(data.result);
      else {
        const compactResult = data.result as { status: "solved"; seed: number; cells: readonly CompactCell[]; decisions: number; backtracks: number };
        resolve({ ...compactResult, cells: compactResult.cells.map((cell) => ({ column: cell.column, row: cell.row, variant: palette.variants[cell.variantIndex] })) });
      }
    };
    worker.onerror = (event) => { worker.terminate(); options.signal?.removeEventListener("abort", cancel); reject(new Error(event.message || "WFC worker failed")); };
    const compact = cloneCompactPalette(prepared.compact);
    const variantIndexes = new Map(palette.variants.map((variant, index) => [variant.id, compactVariantId(index)]));
    const policies = request.policies?.map((policy) => policy.type === "cell-variants"
      ? { ...policy, variantIds: policy.variantIds.flatMap((id) => variantIndexes.has(id) ? [variantIndexes.get(id)!] : []) }
      : policy);
    worker.postMessage({ type: "solve", compact, worldPlan: options.worldPlan, descriptors: options.worldPlan ? prepared.descriptors : undefined, request: { width: request.width, depth: request.depth, seed: request.seed, maxBacktracks: request.maxBacktracks, policies } }, [compact.socketIds.buffer, compact.weights.buffer, compact.compatibility.buffer]);
  });
}

export function sceneObjectsFromWfcResult(result: PlanarWfcResult, request: GenerateWfcLayoutRequest, palette: PlanarWfcPalette): GenerateWfcLayoutResult { if (result.status === "failed") return result; return { status: "solved", seed: result.seed, palette, decisions: result.decisions, backtracks: result.backtracks, objects: sceneObjectsFromSolvedCells(result.cells, result.seed, request, palette) }; }
function sceneObjectsFromSolvedCells(cells: readonly { column: number; row: number; variant: PlanarWfcVariant }[], seed: number, request: GenerateWfcLayoutRequest, palette: PlanarWfcPalette): SceneObject[] {
  return cells.map((cell) => ({
    id: `wfc-preview-${cell.column}-${cell.row}`,
    assetId: cell.variant.assetId,
    name: `${GENERATED_WFC_NAME_PREFIX} ${seed} [${cell.column}, ${cell.row}]`,
    position: { x: (cell.column - (request.width - 1) / 2) * palette.tileWidth, y: 0, z: (cell.row - (request.depth - 1) / 2) * palette.tileDepth },
    rotationY: (cell.variant.rotationDegrees * Math.PI) / 180,
    scale: palette.tileWidth / DEFAULT_WFC_TILE_SIZE,
    generated: { pipeline: "wfc", stage: "structural", column: cell.column, row: cell.row, variantId: cell.variant.id, seed }
  }));
}
export function previewObjectsFromWfcProgress(cells: readonly { column: number; row: number; variant: PlanarWfcVariant }[], seed: number, request: GenerateWfcLayoutRequest, palette: PlanarWfcPalette) { return sceneObjectsFromSolvedCells(cells, seed, request, palette); }
function previewObjectsFromCompactCells(cells: readonly CompactCell[], seed: number, request: GenerateWfcLayoutRequest, palette: PlanarWfcPalette) { return sceneObjectsFromSolvedCells(cells.map((cell) => ({ ...cell, variant: palette.variants[cell.variantIndex] })), seed, request, palette); }

/** Catalog browsing is unrestricted; road scenes admit only reviewed roads and authored terrain. */
export function paletteFromAssets(id: string, assets: readonly AssetCatalogEntry[], options: { tileWidth?: number; tileDepth?: number; category?: string; purpose?: "road-scene" } = {}): PlanarWfcPalette {
  const key = JSON.stringify({ id, tileWidth: options.tileWidth ?? DEFAULT_WFC_TILE_SIZE, tileDepth: options.tileDepth ?? DEFAULT_WFC_TILE_SIZE, category: options.category, purpose: options.purpose });
  const cached = preparedPaletteCache.get(assets)?.get(key);
  if (cached) return cached.palette;
  const variants = assets
    .filter((asset) => asset.wfc?.variants.length && asset.wfc.variants.every((variant) => planarSocketsAreComplete(variant.sockets)) && (!options.category || asset.category === options.category))
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((asset) => asset.wfc!.variants
      .filter((variant) => options.purpose !== "road-scene" || !/\.road-tile-(027|034)$/.test(asset.id) && (variant.roadTopology || asset.semantics?.roles.includes("terrain.ground")))
      .map((variant) => ({
        id: variant.variantId,
        assetId: asset.id,
        rotationDegrees: variant.rotationDegrees,
        sockets: variant.sockets,
        weight: resolveVariantWeight(asset.wfc!, variant),
        roles: asset.semantics?.roles ?? inferredRoadRoles(asset),
        semanticPorts: mergeSemanticPorts(roadTopologyPorts(variant.roadTopology), rotateSemanticPorts(asset.semantics?.sockets, variant.rotationDegrees))
      })))
    .sort((a, b) => a.id.localeCompare(b.id));
  const exactPalette = createPlanarPalette(id, options.tileWidth ?? DEFAULT_WFC_TILE_SIZE, options.tileDepth ?? DEFAULT_WFC_TILE_SIZE, variants);
  const palette = options.purpose === "road-scene" ? withReviewedRoadTransitions(exactPalette) : exactPalette;
  const prepared = preparePlanarPalette(palette);
  preparedByPalette.set(palette, prepared);
  let entries = preparedPaletteCache.get(assets); if (!entries) { entries = new Map(); preparedPaletteCache.set(assets, entries); } entries.set(key, prepared);
  return palette;
}
export function generateWfcLayout(assets: readonly AssetCatalogEntry[], request: GenerateWfcLayoutRequest, options: { category?: string } = {}): GenerateWfcLayoutResult { const palette = paletteFromAssets("catalog", assets, { tileWidth: request.tileWidth, tileDepth: request.tileDepth, category: options.category }); return sceneObjectsFromWfcResult(solvePlanarWfc(palette, request, { policies: request.policies }), request, palette); }
export function isGeneratedWfcObject(object: SceneObject): boolean { return object.generated?.pipeline === "wfc" || object.name.startsWith(GENERATED_WFC_NAME_PREFIX); }
export function compactPaletteMetrics(palette: PlanarWfcPalette) { const prepared = preparePlanarPalette(palette); return { bytes: prepared.byteLength, distinctSocketIds: new Set(prepared.compact.socketIds).size }; }
function planarSocketsAreComplete(sockets: PlanarWfcVariant["sockets"]) { return planarDirections.every((direction) => typeof sockets[direction] === "string" && sockets[direction].length > 0); }
const planarDirections = ["north", "east", "south", "west"] as const;
export function rotateSemanticPorts(sockets: AssetSemantics["sockets"] | undefined, rotationDegrees: number): Partial<Record<PlanarDirection, readonly string[]>> | undefined { if (!sockets) return undefined; const turns = ((rotationDegrees / 90) % 4 + 4) % 4; const directions: PlanarDirection[] = ["north", "east", "south", "west"]; const output: Partial<Record<PlanarDirection, readonly string[]>> = {}; for (const direction of directions) { const socket = sockets[direction]; if (socket?.type) output[directions[(directions.indexOf(direction) + turns) % 4]] = [socket.type]; } return output; }
function inferredRoadRoles(asset: AssetCatalogEntry) { return asset.category === "3d-road-tiles" ? ["road.surface"] : undefined; }
function roadTopologyPorts(topology: RoadTopologyTag | undefined): Partial<Record<PlanarDirection, readonly string[]>> | undefined { if (!topology) return undefined; return Object.fromEntries(Object.entries(topology.edges).map(([direction]) => [direction, ["road"]])) as Partial<Record<PlanarDirection, readonly string[]>>; }

function mergeSemanticPorts(...maps: (Partial<Record<PlanarDirection, readonly string[]>> | undefined)[]) {
  if (maps.every((map) => !map)) return undefined;
  return Object.fromEntries(planarDirections.flatMap((direction) => {
    const channels = [...new Set(maps.flatMap((map) => map?.[direction] ?? []))];
    return channels.length ? [[direction, channels]] : [];
  }));
}
