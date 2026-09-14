import { legacyRoadScene, type resolvePackProfile } from "./metadata/packCatalog";
import type { AssetCatalogEntry } from "../editor-core/assets";
import type { SceneObject } from "../editor-core/scene";
import type { PlanarWfcPalette } from "./planarWfc";
import type { CatalogPaletteFactory } from "./catalogPaletteFactory";
import type { sceneObjectsFromWfcResult } from "./sceneMapping";
import { solveWithSceneProgress } from "./sceneSolveProgress";
import type { PlanarSolver } from "./solverPort";
import type { GenerateWfcLayoutRequest, WfcGenerationProgress } from "./sceneLayoutTypes";
import type { WorldPlan } from "./worldPlan";
import type { createWorldPlan } from "./worldPlanner";
import type { validateWorldPlanResult } from "./worldPlanPolicies";

export type GenerateWfcSceneResult =
  | { status: "solved"; seed: number; roadScene: boolean; objects: readonly SceneObject[]; palette: PlanarWfcPalette; decisions: number; backtracks: number }
  | { status: "failed"; seed: number; roadScene: boolean; diagnostics: readonly string[] };

export interface GenerateWfcSceneOptions {
  onProgress?(progress: WfcGenerationProgress): void;
  signal?: AbortSignal;
}

export interface SceneGenerationDependencies {
  palette: Pick<CatalogPaletteFactory, "create">;
  resolveProfile: typeof resolvePackProfile;
  plan: typeof createWorldPlan;
  solver: PlanarSolver;
  validate: typeof validateWorldPlanResult;
  map: typeof sceneObjectsFromWfcResult;
}

/** Coordinates injected generation responsibilities; retains first-diagnostic/empty-result behavior. */
export class SceneGenerationService {
  constructor(private readonly dependencies: SceneGenerationDependencies) {}
  async generate(assets: readonly AssetCatalogEntry[], request: GenerateWfcLayoutRequest, options: GenerateWfcSceneOptions = {}): Promise<GenerateWfcSceneResult> {
  let roadScene = legacyRoadScene(assets);

  try {
    const selected = this.dependencies.resolveProfile(assets, request.profile, true);
    roadScene = Boolean(selected.profile.worldPlan);
    let worldPlan: WorldPlan | undefined = roadScene
      ? this.dependencies.plan({ width: request.width, depth: request.depth, seed: request.seed, ...selected.profile.worldPlan! })
      : undefined;
    const palette = this.dependencies.palette.create("shared-assets", assets, {
      tileWidth: request.tileWidth,
      tileDepth: request.tileDepth,
      profile: selected.profileName
    });
    const solved = await solveWithSceneProgress(this.dependencies.solver, palette, request, {
      worldPlan,
      scenicRecipe: selected.profile.scenic ?? null,
      onWorldPlan: (plan) => { worldPlan = plan; },
      onProgress: options.onProgress,
      signal: options.signal
    });
    const validationDiagnostics = worldPlan ? this.dependencies.validate(worldPlan, palette, solved) : [];
    const result = this.dependencies.map(solved, request, palette);
    const objects = result.status === "solved" && !validationDiagnostics.length ? result.objects : [];

    if (!objects.length) {
      const diagnostic = validationDiagnostics[0] ?? (result.status === "failed" ? result.diagnostics[0] ?? "WFC generation failed" : "WFC generation failed");
      return { status: "failed", seed: request.seed, roadScene, diagnostics: [diagnostic] };
    }

    return {
      status: "solved",
      seed: request.seed,
      roadScene,
      objects,
      palette,
      decisions: result.status === "solved" ? result.decisions : 0,
      backtracks: result.status === "solved" ? result.backtracks : 0
    };
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : "WFC generation failed";
    return { status: "failed", seed: request.seed, roadScene, diagnostics: [diagnostic] };
  }
  }
}
