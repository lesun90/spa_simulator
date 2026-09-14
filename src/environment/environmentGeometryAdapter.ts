import type { AssetCatalogEntry } from "../editor-core/assets";
import { disposeObject } from "../engine/disposeObject";
import type { ChunkAssignment } from "./chunking";
import { exportGlb } from "./glbExporter";
import { flattenRecords, groupPrimitives } from "./geometryCompiler";
import { removeInternalSeamFaces } from "./seamRemoval";
import type { SceneRecipe } from "./types";

export interface CompiledEnvironmentGeometry {
  glb: Uint8Array;
  meshCount: number;
  instancedMeshCount: number;
  triangleCount: number;
  removedSeamTriangleCount: number;
}

/** Node/Three.js edge adapter. It owns all temporary geometry until export finishes. */
export async function compileEnvironmentGeometry(
  recipe: SceneRecipe,
  assets: readonly AssetCatalogEntry[],
  chunks: ChunkAssignment,
  assetRoot: string,
  removeSeamFaces: boolean
): Promise<CompiledEnvironmentGeometry | { diagnostics: readonly string[] }> {
  const flattened = await flattenRecords(recipe, assets, chunks, assetRoot, { cloneCellGeometry: removeSeamFaces });
  if (flattened.diagnostics.length) return { diagnostics: flattened.diagnostics };
  const seamResult = removeSeamFaces
    ? removeInternalSeamFaces(flattened.cellMeshesByCellId, recipe)
    : { removedTriangleCount: 0 };
  const compiled = groupPrimitives(flattened.itemsByRecordId);
  try {
    const glb = await exportGlb(compiled.root);
    return { glb, ...compiled.stats, removedSeamTriangleCount: seamResult.removedTriangleCount };
  } finally {
    disposeObject(compiled.root);
  }
}
