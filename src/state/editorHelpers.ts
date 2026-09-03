import type { AssetCatalogEntry } from "../editor-core/assets";
import type { Scene } from "../editor-core/scene";

export function createTemporaryAsset(file: File): AssetCatalogEntry {
  const slug = file.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
  return {
    id: `temp.${slug}`,
    label: file.name,
    category: "session imports",
    tags: ["temporary"],
    source: "temporary",
    implementation: "placeholder",
    diagnostics: ["Session-only review asset. Add it to the shared library before saving a scene that uses it."]
  };
}

export function selectedObject(scene: Scene | null, selectedId: string | null) {
  return scene?.objects.find((object) => object.id === selectedId) ?? null;
}
