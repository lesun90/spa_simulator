import type { AssetCatalogEntry } from "../editor-core/assets";
import { environmentCompiler } from "./environmentCompilerComposition";
import type { EnvironmentManifest, SceneRecipe } from "./types";

export interface CompileEnvironmentOptions {
  chunkSize: number;
  removeInternalSeamFaces: boolean;
  assetRoot: string;
  source: "editor" | "cli";
  generatorVersion: string;
}

export interface EnvironmentCompileMetrics {
  cellCount: number;
  objectCount: number;
  chunkCount: number;
  meshCount: number;
  instancedMeshCount: number;
  triangleCount: number;
  removedSeamTriangleCount: number;
  glbByteLength: number;
  elapsedMs: number;
}

export type CompileEnvironmentResult =
  | { manifest: EnvironmentManifest; glb: Uint8Array; metrics: EnvironmentCompileMetrics }
  | { status: "failed"; diagnostics: readonly string[] };

export async function compileEnvironmentPackage(
  recipe: SceneRecipe,
  assets: readonly AssetCatalogEntry[],
  options: CompileEnvironmentOptions
): Promise<CompileEnvironmentResult> {
  return environmentCompiler.compile(recipe, assets, options);
}
