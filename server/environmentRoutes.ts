import { randomUUID } from "node:crypto";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import type { Scene } from "../src/editor-core/scene";
import { compileEnvironmentPackage, type EnvironmentCompileMetrics } from "../src/environment/compiler";
import { buildSceneRecipe } from "../src/environment/sceneRecipe";
import type { EnvironmentManifest } from "../src/environment/types";

const GENERATOR_VERSION = "0.1.0";

export interface ExportEnvironmentOptions {
  chunkSize: number;
  removeSeamFaces: boolean;
}

export type ExportEnvironmentResult =
  | { status: "ok"; exportId: string; manifest: EnvironmentManifest; metrics: EnvironmentCompileMetrics }
  | { status: "error"; message: string };

/** Compiles a scene server-side and holds its GLB in memory under a fresh export ID, so the client can fetch the manifest (JSON response) and the model (a later binary GET) as separate payloads. */
export function createEnvironmentExportCache() {
  const glbByExportId = new Map<string, Uint8Array>();
  const exportIdBySceneId = new Map<string, string>();

  return {
    async compile(
      scene: Scene,
      assets: readonly AssetCatalogEntry[],
      assetRoot: string,
      options: ExportEnvironmentOptions
    ): Promise<ExportEnvironmentResult> {
      const recipe = buildSceneRecipe(scene, assets);
      const compiled = await compileEnvironmentPackage(recipe, assets, {
        chunkSize: options.chunkSize,
        removeInternalSeamFaces: options.removeSeamFaces,
        assetRoot,
        source: "editor",
        generatorVersion: GENERATOR_VERSION
      });
      if ("status" in compiled) return { status: "error", message: compiled.diagnostics[0] ?? "Environment export failed." };

      const previousExportId = exportIdBySceneId.get(scene.id);
      if (previousExportId) glbByExportId.delete(previousExportId);
      const exportId = randomUUID();
      glbByExportId.set(exportId, compiled.glb);
      exportIdBySceneId.set(scene.id, exportId);

      return { status: "ok", exportId, manifest: compiled.manifest, metrics: compiled.metrics };
    },

    model(exportId: string): Uint8Array | undefined {
      return glbByExportId.get(exportId);
    }
  };
}
