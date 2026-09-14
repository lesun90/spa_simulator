import { eligibleForProfile, legacyRoles, registerPaletteProfile, resolvePackProfile } from "./metadata/packCatalog";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { resolveVariantWeight } from "./paletteSelection";
import { withReviewedRoadTransitions } from "./metadata/reviewedRoadTransitions";
import { createPlanarPalette, planarDirections, type PlanarWfcPalette, type PlanarWfcVariant } from "./planarWfc";
import { mergeSemanticPorts, roadTopologyPorts, rotateSemanticPorts } from "./semanticPorts";
import { DEFAULT_WFC_TILE_SIZE } from "./sceneLayoutTypes";

/** Owns palette preparation for immutable catalog snapshots. */
export class CatalogPaletteFactory {
  private readonly cache = new WeakMap<readonly AssetCatalogEntry[], Map<string, PlanarWfcPalette>>();
create(id: string, assets: readonly AssetCatalogEntry[], options: { tileWidth?: number; tileDepth?: number; category?: string; purpose?: "road-scene"; profile?: string } = {}): PlanarWfcPalette {
  const key = JSON.stringify({ id, tileWidth: options.tileWidth ?? DEFAULT_WFC_TILE_SIZE, tileDepth: options.tileDepth ?? DEFAULT_WFC_TILE_SIZE, category: options.category, purpose: options.purpose, profile: options.profile });
  const cached = this.cache.get(assets)?.get(key);
  if (cached) return cached;
  const normalized = resolvePackProfile(assets, options.profile ?? options.purpose);
  const tileWidth = options.tileWidth ?? DEFAULT_WFC_TILE_SIZE;
  const tileDepth = options.tileDepth ?? DEFAULT_WFC_TILE_SIZE;
  if (!normalized.independentPlacementDimensions && Math.abs(tileWidth / normalized.dimensions.sourceTileWidth - tileDepth / normalized.dimensions.sourceTileDepth) > 1e-10) throw new Error(`WFC profile ${normalized.profileName}: placement dimensions require incompatible uniform scale ratios.`);
  const variants = assets
    .filter((asset) => asset.wfc?.variants.length && asset.wfc.variants.every((variant) => planarSocketsAreComplete(variant.sockets)) && (!options.category || asset.category === options.category))
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((asset) => asset.wfc!.variants
      .filter((variant) => eligibleForProfile(asset, variant, normalized.profile))
      .map((variant) => ({
        id: variant.variantId,
        assetId: asset.id,
        rotationDegrees: variant.rotationDegrees,
        sockets: variant.sockets,
        weight: resolveVariantWeight(asset.wfc!, variant),
        roles: asset.semantics?.roles ?? asset.wfcPack?.inferredRoles ?? (normalized.legacy ? legacyRoles(asset) : undefined),
        semanticPorts: mergeSemanticPorts(roadTopologyPorts(variant.roadTopology), rotateSemanticPorts(asset.semantics?.sockets, variant.rotationDegrees))
      })))
    .sort((a, b) => a.id.localeCompare(b.id));
  const exactPalette = createPlanarPalette(id, options.tileWidth ?? DEFAULT_WFC_TILE_SIZE, options.tileDepth ?? DEFAULT_WFC_TILE_SIZE, variants);
  const palette = normalized.profile.adjacency ? withReviewedRoadTransitions(exactPalette, normalized.profile.adjacency) : exactPalette;
  registerPaletteProfile(palette, normalized);
  let entries = this.cache.get(assets); if (!entries) { entries = new Map(); this.cache.set(assets, entries); } entries.set(key, palette);
  return palette;
}
}

const defaultFactory = new CatalogPaletteFactory();
export const paletteFromAssets = defaultFactory.create.bind(defaultFactory);
function planarSocketsAreComplete(sockets: PlanarWfcVariant["sockets"]) { return planarDirections.every((direction) => typeof sockets[direction] === "string" && sockets[direction].length > 0); }
