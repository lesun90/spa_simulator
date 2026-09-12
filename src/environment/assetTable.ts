import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { sha256Hex } from "./manifestEncoder";
import type { EnvironmentManifestAsset, SceneRecipe } from "./types";

/** Snapshots every asset referenced by the recipe, hashed by its source file bytes so the snapshot stays stable if the live catalog changes. */
export async function buildAssetTable(recipe: SceneRecipe, assets: readonly AssetCatalogEntry[], assetRoot: string): Promise<EnvironmentManifestAsset[]> {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const referencedIds = new Set([...recipe.cells.map((cell) => cell.sourceAssetId), ...recipe.objects.map((object) => object.sourceAssetId)]);

  const entries = await Promise.all(
    [...referencedIds].map(async (id) => {
      const asset = assetsById.get(id);
      if (!asset) throw new Error(`Asset ${id} is not present in the catalog.`);
      return {
        id: asset.id,
        label: asset.label,
        category: asset.category,
        contentHash: await contentHashForAsset(asset, assetRoot),
        semanticRoles: asset.semantics?.roles ?? []
      };
    })
  );

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

async function contentHashForAsset(asset: AssetCatalogEntry, assetRoot: string): Promise<string> {
  if (asset.implementation === "glb" && asset.modelUrl) return sha256Hex(await readFile(assetFilePath(assetRoot, asset.modelUrl)));
  if (asset.implementation === "module" && asset.moduleUrl) return sha256Hex(await readFile(assetFilePath(assetRoot, asset.moduleUrl)));
  return sha256Hex(Buffer.from(`placeholder:${asset.id}`, "utf8"));
}

function assetFilePath(assetRoot: string, url: string): string {
  const relative = decodeURIComponent(url.replace(/^\/assets\//, ""));
  return join(assetRoot, ...relative.split("/"));
}
