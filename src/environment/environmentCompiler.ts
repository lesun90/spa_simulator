import type { AssetCatalogEntry } from "../editor-core/assets";
import type { ChunkAssignment } from "./chunking";
import type { CompiledEnvironmentGeometry } from "./environmentGeometryAdapter";
import type { EnvironmentManifest, SceneRecipe } from "./types";
import type { CompileEnvironmentOptions, CompileEnvironmentResult, EnvironmentCompileMetrics } from "./compiler";

export interface EnvironmentCompilerDependencies {
  assignChunks(recipe: SceneRecipe, chunkSize: number): ChunkAssignment;
  compileGeometry(recipe: SceneRecipe, assets: readonly AssetCatalogEntry[], chunks: ChunkAssignment, assetRoot: string, removeSeamFaces: boolean): Promise<CompiledEnvironmentGeometry | { diagnostics: readonly string[] }>;
  buildAssetTable(recipe: SceneRecipe, assets: readonly AssetCatalogEntry[], assetRoot: string): Promise<EnvironmentManifest["assets"]>;
  buildManifestRecords(recipe: SceneRecipe, chunks: ChunkAssignment, assets: EnvironmentManifest["assets"]): Pick<EnvironmentManifest, "cells" | "objects" | "ground">;
  buildNavigation(cells: EnvironmentManifest["cells"], recipe: SceneRecipe, assets: readonly AssetCatalogEntry[]): EnvironmentManifest["navigation"];
  encodeManifest(manifest: EnvironmentManifest): EnvironmentManifest;
  hash(bytes: Uint8Array): string;
  now(): number;
}

/** Application service: orchestration over injected geometry, content, and hashing adapters. */
export class EnvironmentCompiler {
  constructor(private readonly dependencies: EnvironmentCompilerDependencies) {}

  async compile(recipe: SceneRecipe, assets: readonly AssetCatalogEntry[], options: CompileEnvironmentOptions): Promise<CompileEnvironmentResult> {
    const startedAt = this.dependencies.now();
    const chunks = this.dependencies.assignChunks(recipe, options.chunkSize);
    const geometry = await this.dependencies.compileGeometry(recipe, assets, chunks, options.assetRoot, options.removeInternalSeamFaces);
    if ("diagnostics" in geometry) return { status: "failed", diagnostics: geometry.diagnostics };
    let assetTable: EnvironmentManifest["assets"];
    try { assetTable = await this.dependencies.buildAssetTable(recipe, assets, options.assetRoot); }
    catch (error) { return { status: "failed", diagnostics: [error instanceof Error ? error.message : String(error)] }; }
    const { cells, objects, ground } = this.dependencies.buildManifestRecords(recipe, chunks, assetTable);
    const manifest = this.dependencies.encodeManifest({
      format: "steerlab-environment", formatVersion: 1,
      model: { file: "environment.glb", sha256: this.dependencies.hash(geometry.glb), rootNode: "SteerlabEnvironment", upAxis: "Y", unitsPerMeter: 1 },
      grid: { width: recipe.grid.width, depth: recipe.grid.depth, cellSize: recipe.grid.cellSize, origin: recipe.grid.origin, bounds: { min: { x: recipe.grid.origin.x, y: 0, z: recipe.grid.origin.z }, max: { x: recipe.grid.origin.x + recipe.grid.width * recipe.grid.cellSize, y: 4, z: recipe.grid.origin.z + recipe.grid.depth * recipe.grid.cellSize } } },
      provenance: { source: options.source, generatorVersion: options.generatorVersion, generationRuns: recipe.generationRuns },
      build: { chunkSize: options.chunkSize, removeInternalSeamFaces: options.removeInternalSeamFaces },
      chunks: chunks.chunks, assets: assetTable, cells, objects, ground,
      navigation: this.dependencies.buildNavigation(cells, recipe, assets), diagnostics: recipe.diagnostics
    });
    const metrics: EnvironmentCompileMetrics = { cellCount: recipe.cells.length, objectCount: recipe.objects.length, chunkCount: chunks.chunks.length, meshCount: geometry.meshCount, instancedMeshCount: geometry.instancedMeshCount, triangleCount: geometry.triangleCount, removedSeamTriangleCount: geometry.removedSeamTriangleCount, glbByteLength: geometry.glb.byteLength, elapsedMs: this.dependencies.now() - startedAt };
    return { manifest, glb: geometry.glb, metrics };
  }
}
