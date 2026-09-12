import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import type { Scene } from "../src/editor-core/scene";
import { compileEnvironmentPackage, type EnvironmentCompileMetrics } from "../src/environment/compiler";
import { canonicalJson } from "../src/environment/manifestEncoder";
import { validateEnvironmentPackage } from "../src/environment/packageValidator";
import { buildSceneRecipe } from "../src/environment/sceneRecipe";
import type { EnvironmentManifest } from "../src/environment/types";
import type { createEnvironmentPackageStore } from "./environmentPackageStore";
import { safeId } from "./sceneStore";

const GENERATOR_VERSION = "0.1.0";

export interface ExportEnvironmentOptions {
  chunkSize: number;
  removeSeamFaces: boolean;
}

export type ExportEnvironmentResult =
  | { status: "ok"; exportId: string; manifest: EnvironmentManifest; manifestJson: string; metrics: EnvironmentCompileMetrics }
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

      return { status: "ok", exportId, manifest: compiled.manifest, manifestJson: canonicalJson(compiled.manifest), metrics: compiled.metrics };
    },

    model(exportId: string): Uint8Array | undefined {
      return glbByExportId.get(exportId);
    }
  };
}

export type CommitEnvironmentImportResult = { status: "ok"; sha256: string; manifestVersion: number } | { status: "error"; diagnostics: string[] };

/** Stages an uploaded manifest and model as two separate payloads, then validates and commits them as one unit. */
export function createEnvironmentImportStaging(sceneRoot: string) {
  const stagingDir = (sceneId: string) => join(sceneRoot, `${safeId(sceneId)}.environment.staging`);

  return {
    async stageManifest(sceneId: string, manifestJson: string): Promise<void> {
      const dir = stagingDir(sceneId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "environment.json"), manifestJson, "utf8");
    },

    async stageModel(sceneId: string, glb: Buffer): Promise<void> {
      const dir = stagingDir(sceneId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "environment.glb"), glb);
    },

    async commit(sceneId: string, environmentStore: ReturnType<typeof createEnvironmentPackageStore>): Promise<CommitEnvironmentImportResult> {
      const dir = stagingDir(sceneId);
      let manifestJson: string;
      let glb: Buffer;
      try {
        [manifestJson, glb] = await Promise.all([readFile(join(dir, "environment.json"), "utf8"), readFile(join(dir, "environment.glb"))]);
      } catch {
        return { status: "error", diagnostics: ["Both environment.json and environment.glb must be uploaded before committing."] };
      }

      let manifestValue: unknown;
      try {
        manifestValue = JSON.parse(manifestJson);
      } catch {
        await rm(dir, { recursive: true, force: true });
        return { status: "error", diagnostics: ["environment.json is not valid JSON."] };
      }

      const validation = validateEnvironmentPackage(manifestValue, glb);
      if (!validation.valid) {
        await rm(dir, { recursive: true, force: true });
        return { status: "error", diagnostics: validation.diagnostics };
      }

      await environmentStore.replace(sceneId, manifestJson, glb);
      await rm(dir, { recursive: true, force: true });

      const manifest = manifestValue as { model: { sha256: string }; formatVersion: number };
      return { status: "ok", sha256: manifest.model.sha256, manifestVersion: manifest.formatVersion };
    }
  };
}
