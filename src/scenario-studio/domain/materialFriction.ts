/** Starting-point grip per real material token (see scripts/computeMaterialCatalog.ts); a
 * scenario's own materialFriction map (ScenarioDocument) overrides these per material. */
export const DEFAULT_MATERIAL_FRICTION: Readonly<Record<string, number>> = Object.freeze({
  asphalt: 0.7,
  road: 0.7,
  concrete: 0.75,
  sidewalk: 0.8,
  curb: 0.8,
  grass: 0.9,
  dirt: 0.75,
  gravel: 0.75,
  sand: 0.6,
  water: 0.05,
  default: 0.6
});

export function frictionForMaterial(material: string, overrides: Readonly<Record<string, number>>): number {
  return overrides[material] ?? DEFAULT_MATERIAL_FRICTION[material] ?? DEFAULT_MATERIAL_FRICTION.default;
}

/** Same normalization generateRoadTileWfcMetadata.ts's normalizeToken applies at pack-build time,
 * duplicated here (not imported — that script is a Node build tool, not part of the browser bundle)
 * so a mesh's live material name matches the catalog's tokens. */
export function normalizeMaterialToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "unnamed";
}
