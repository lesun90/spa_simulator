import type { AssetCatalogEntry } from "../editor-core/assets";
import { assignChunks } from "./chunking";
import { buildAssetTable } from "./assetTable";
import { exportGlb } from "./glbExporter";
import { flattenRecords, groupPrimitives } from "./geometryCompiler";
import { encodeManifest, sha256Hex } from "./manifestEncoder";
import { buildManifestRecords } from "./manifestBuilder";
import { buildNavigationGraph } from "./navigationGraph";
import { removeInternalSeamFaces } from "./seamRemoval";
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
  const startedAt = Date.now();
  const chunkAssignment = assignChunks(recipe, options.chunkSize);

  const flattened = await flattenRecords(recipe, assets, chunkAssignment, options.assetRoot);
  if (flattened.diagnostics.length) return { status: "failed", diagnostics: flattened.diagnostics };

  const seamResult = options.removeInternalSeamFaces
    ? removeInternalSeamFaces(flattened.cellMeshesByCellId, recipe)
    : { removedTriangleCount: 0, removedVertexCount: 0 };

  const compiled = groupPrimitives(flattened.itemsByRecordId);
  const glb = await exportGlb(compiled.root);

  let assetTable;
  try {
    assetTable = await buildAssetTable(recipe, assets, options.assetRoot);
  } catch (error) {
    return { status: "failed", diagnostics: [error instanceof Error ? error.message : String(error)] };
  }

  const { cells, objects, ground } = buildManifestRecords(recipe, chunkAssignment, assetTable);
  const navigation = buildNavigationGraph(cells, recipe, assets);

  const manifest: EnvironmentManifest = encodeManifest({
    format: "steerlab-environment",
    formatVersion: 1,
    model: { file: "environment.glb", sha256: sha256Hex(glb), rootNode: "SteerlabEnvironment", upAxis: "Y", unitsPerMeter: 1 },
    grid: {
      width: recipe.grid.width,
      depth: recipe.grid.depth,
      cellSize: recipe.grid.cellSize,
      origin: recipe.grid.origin,
      bounds: {
        min: { x: recipe.grid.origin.x, y: 0, z: recipe.grid.origin.z },
        max: { x: recipe.grid.origin.x + recipe.grid.width * recipe.grid.cellSize, y: 4, z: recipe.grid.origin.z + recipe.grid.depth * recipe.grid.cellSize }
      }
    },
    provenance: { source: options.source, generatorVersion: options.generatorVersion, generationRuns: recipe.generationRuns },
    build: { chunkSize: options.chunkSize, removeInternalSeamFaces: options.removeInternalSeamFaces },
    chunks: chunkAssignment.chunks,
    assets: assetTable,
    cells,
    objects,
    ground,
    navigation,
    diagnostics: recipe.diagnostics
  });

  return {
    manifest,
    glb,
    metrics: {
      cellCount: recipe.cells.length,
      objectCount: recipe.objects.length,
      chunkCount: chunkAssignment.chunks.length,
      meshCount: compiled.stats.meshCount,
      instancedMeshCount: compiled.stats.instancedMeshCount,
      triangleCount: compiled.stats.triangleCount,
      removedSeamTriangleCount: seamResult.removedTriangleCount,
      glbByteLength: glb.byteLength,
      elapsedMs: Date.now() - startedAt
    }
  };
}
