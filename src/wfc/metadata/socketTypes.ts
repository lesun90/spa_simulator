export const wfcDirections = ["north", "east", "south", "west", "top", "bottom"] as const;

export type WfcDirection = (typeof wfcDirections)[number];

export type WfcSocketMap = Record<WfcDirection, string>;

/** Hand-authored semantic connector information, kept separate from derived geometric sockets. */
export interface AssetSemanticSocket {
  type: string;
  profile?: string;
}

export interface AssetSemantics {
  roles: string[];
  sockets: Partial<Record<WfcDirection, AssetSemanticSocket>>;
}

export type WfcPlanarDirection = Extract<WfcDirection, "north" | "east" | "south" | "west">;
export type RoadTopologyKind = "straight" | "dead-end" | "corner" | "curve" | "t-junction" | "four-way";

/**
 * Reviewed road-surface profile at a tile edge. Exact socket compatibility remains
 * the geometric authority; this class declares which edges may fulfill a road route.
 */
export type RoadEdgeClass = "road";

/** Reviewed road-shape and road-edge metadata persisted for each rotated variant. */
export interface RoadTopologyTag {
  kind: RoadTopologyKind;
  edges: Partial<Record<WfcPlanarDirection, RoadEdgeClass>>;
}

export interface WfcVariant {
  variantId: string;
  rotationDegrees: number;
  sockets: WfcSocketMap;
  weight?: number;
  roadTopology?: RoadTopologyTag;
}

export interface WfcMetadata {
  height: number;
  defaultWeight?: number;
  variants: WfcVariant[];
  diagnostics: string[];
}

export interface WfcAdjacencyFile {
  version: 1;
  assetRoot: string;
  generatedFrom: string;
  adjacency: Record<string, Record<WfcDirection, string[]>>;
  diagnostics: string[];
}

export interface WfcVariantLike {
  variantId: string;
  sockets: WfcSocketMap;
}

export type WfcSocketMatcher = (a: string, b: string, direction: WfcDirection) => boolean;

export const oppositeDirections: Record<WfcDirection, WfcDirection> = {
  north: "south",
  east: "west",
  south: "north",
  west: "east",
  top: "bottom",
  bottom: "top"
};
