export const wfcDirections = ["north", "east", "south", "west", "top", "bottom"] as const;

export type WfcDirection = (typeof wfcDirections)[number];

export type WfcSocketMap = Record<WfcDirection, string>;

export interface WfcVariant {
  variantId: string;
  rotationDegrees: number;
  sockets: WfcSocketMap;
}

export interface WfcMetadata {
  height: number;
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
