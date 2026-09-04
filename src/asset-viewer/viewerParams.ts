export type AssetViewAngle = "front" | "side" | "top" | "iso";

export interface AssetViewerParams {
  assetId: string | null;
  angle: AssetViewAngle;
  grid: boolean;
  spin: boolean;
  debug: boolean;
  ui: boolean;
}

const viewAngles = new Set<AssetViewAngle>(["front", "side", "top", "iso"]);

export function parseAssetViewerParams(search: string): AssetViewerParams {
  const params = new URLSearchParams(search);
  const assetId = params.get("asset")?.trim() || null;
  const angleParam = params.get("angle");

  return {
    assetId,
    angle: isAssetViewAngle(angleParam) ? angleParam : "iso",
    grid: parseBooleanParam(params.get("grid"), true),
    spin: parseBooleanParam(params.get("spin"), false),
    debug: parseBooleanParam(params.get("debug"), false),
    ui: parseBooleanParam(params.get("ui"), true)
  };
}

export function viewDirectionForAngle(angle: AssetViewAngle): [number, number, number] {
  if (angle === "front") return [0, 0.45, 1];
  if (angle === "side") return [1, 0.45, 0];
  if (angle === "top") return [0, 1, 0.001];
  return [1, 0.75, 1];
}

function isAssetViewAngle(value: string | null): value is AssetViewAngle {
  return value !== null && viewAngles.has(value as AssetViewAngle);
}

function parseBooleanParam(value: string | null, fallback: boolean) {
  if (value === null) return fallback;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}
