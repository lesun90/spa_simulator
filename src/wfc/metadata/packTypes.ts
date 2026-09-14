import type { WfcPlanarDirection } from "./socketTypes";

export type WfcCapability = "tiling" | "road" | "water" | "terrain" | "elevation" | "boundary" | "scenic";
export interface AssetSelector { assetIds?: readonly string[]; assetIdSuffixes?: readonly string[]; }
export interface ReviewedAdjacencyMetadata {
  structures: AssetSelector;
  centers: AssetSelector;
  crosswalks: AssetSelector;
  ground: AssetSelector;
  water: AssetSelector;
  mouths: AssetSelector;
  caps: AssetSelector;
}
export type ScenicStage = { operation: "addStreets" | "bridgeLakes" | "growStreets" | "junctions" | "overpasses" | "roundabouts" | "bendRoads" | "smoothCorners" | "mountainPasses" | "standaloneLakes" | "terrain"; minimum?: number; areaDivisor?: number; subtractEarlyBridges?: boolean; elevation?: "high" | "low" };
/** Concrete ordered assembly members. IDs are catalog data, never geometry/name inference. */
export interface ScenicRecipe {
  ground: string;
  groundDiagnostic: string;
  straightRoad: string;
  ordinaryRoads: readonly string[];
  lakeRoads: readonly string[];
  lakeMargins: readonly string[];
  crosswalk: string;
  junction: string;
  crossing: string;
  terrain: readonly { assetId: string; cornerMask: string }[];
  mountainPass: string;
  roundabout: { island: string; corner: string; entrance: string; closedExit: string; selectors?: Readonly<Record<string, AssetSelector>> };
  smoothCorner: readonly { id: string; column: number; row: number; before: readonly WfcPlanarDirection[] }[];
  overpass: { deck: string; members: readonly string[]; supports: readonly string[]; approaches: readonly string[]; transverseCuts: readonly string[] };
  water: { core: string; coreWeightMultiplier: number; banks: readonly string[]; exclusions: readonly string[]; bridges: readonly { id: string; approaches: readonly string[]; clearance: number; coreDistance: number; minimumSpan: number; raisedBanks: boolean }[] };
  stages: readonly ScenicStage[];
  /** Legacy aliases preserve the former suffix matching of direct water/roundabout callers. */
  aliases?: Readonly<Record<string, AssetSelector>>;
}
export interface WfcPackProfile {
  requires: readonly WfcCapability[];
  eligibility?: { exclude?: AssetSelector; requireTopologyOrRole?: string; assetIds?: readonly string[] };
  adjacency?: ReviewedAdjacencyMetadata;
  scenic?: ScenicRecipe;
  worldPlan?: { roadCoverage: number; scenic: boolean };
  references?: { roles?: readonly string[]; channels?: readonly string[]; variantIds?: readonly string[] };
}
export interface WfcPackDeclaration {
  id: string;
  version: 1;
  dimensions: { sourceTileWidth: number; sourceTileDepth: number };
  capabilities: readonly WfcCapability[];
  defaultProfile: string;
  profiles: Readonly<Record<string, WfcPackProfile>>;
  /** Required on every declared pack in a combined request. */
  socketNamespace?: string;
  /** Catalog entrypoint compatibility choices for packs migrated from implicit legacy selection. */
  catalogProfiles?: { generic: string; automatic: string };
  triggerCategory?: string;
  inferredRoles?: readonly string[];
  /** Existing catalogs allowed width/depth overrides independently of the uniform model scale. */
  independentPlacementDimensions?: boolean;
}
