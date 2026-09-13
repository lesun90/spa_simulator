import type { AssetSemantics, WfcMetadata } from "../wfc/metadata/socketTypes";
import { environmentAssetId, type Scene } from "./scene";

export type AssetImplementation = "module" | "glb" | "placeholder";
export type AssetSource = "shared" | "temporary";

export interface AssetCatalogEntry {
  id: string;
  label: string;
  category: string;
  tags?: string[];
  source: AssetSource;
  implementation: AssetImplementation;
  moduleUrl?: string;
  modelUrl?: string;
  thumbnailUrl?: string;
  wfc?: WfcMetadata;
  semantics?: AssetSemantics;
  diagnostics?: string[];
}

export function environmentAssetForScene(scene: Scene | null): AssetCatalogEntry | null {
  if (!scene?.environment) return null;
  return {
    id: environmentAssetId(scene.id),
    label: "Imported environment",
    category: "scene imports",
    source: "shared",
    implementation: "glb",
    modelUrl: `/api/scenes/${encodeURIComponent(scene.id)}/environment/model?sha256=${scene.environment.sha256}`
  };
}

export function assetLabelFromId(id: string) {
  return id
    .split(".")
    .at(-1)!
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
