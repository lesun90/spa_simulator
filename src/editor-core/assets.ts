import type { AssetSemantics, WfcMetadata } from "../wfc/metadata/socketTypes";

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

export function assetLabelFromId(id: string) {
  return id
    .split(".")
    .at(-1)!
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
