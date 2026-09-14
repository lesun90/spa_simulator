import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { generateWfcScene } from "../src/wfc/sceneGenerator";
import { paletteFromAssets, sceneObjectsFromWfcResult, solvePlanarWfcInWorker, type GenerateWfcLayoutRequest, type WfcGenerationProgress } from "../src/wfc/sceneLayout";
import { createWorldPlan } from "../src/wfc/worldPlanner";
import type { WorldPlan } from "../src/wfc/worldPlan";

export interface CompatibilityCase {
  id: string;
  catalog: "roads" | "plain" | "empty";
  request: GenerateWfcLayoutRequest;
  preAborted?: boolean;
}

/** Runs production entry points unchanged, in Node or a real browser with its native Worker. */
export async function captureCompatibility(assets: AssetCatalogEntry[], cases: CompatibilityCase[]) {
  const captures = [];
  for (const entry of cases) {
    const catalog = entry.catalog === "empty" ? [] : entry.catalog === "plain"
      ? assets.filter((asset) => asset.category !== "3d-road-tiles") : assets;
    const roadScene = catalog.some((asset) => asset.category === "3d-road-tiles");
    const palette = paletteFromAssets("compatibility", catalog, {
      tileWidth: entry.request.tileWidth, tileDepth: entry.request.tileDepth,
      purpose: roadScene ? "road-scene" : undefined
    });
    const progress: WfcGenerationProgress[] = [];
    let plan: WorldPlan | undefined;
    const controller = new AbortController();
    if (entry.preAborted) controller.abort();
    const result = await solvePlanarWfcInWorker(palette, entry.request, {
      signal: controller.signal,
      worldPlan: roadScene ? createWorldPlan({ ...entry.request, roadCoverage: 0.5, scenic: true }) : undefined,
      onWorldPlan: (value) => { plan = value; },
      onProgress: (value) => { progress.push(value); }
    });
    const mapped = sceneObjectsFromWfcResult(result, entry.request, palette);
    const generated = await generateWfcScene(catalog, entry.request, { signal: controller.signal });
    // Palette is captured once per case; solved cells retain their ordered variant IDs.
    captures.push({ id: entry.id, palette, plan, progress,
      result: result.status === "failed" ? result : { ...result, cells: result.cells.map(({ column, row, variant }) => ({ column, row, variantId: variant.id })) },
      mapped: mapped.status === "failed" ? mapped : { ...mapped, palette: undefined },
      generated: generated.status === "failed" ? generated : { ...generated, palette: undefined }
    });
  }
  return captures;
}
