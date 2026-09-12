export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vector3;
  rotationY: number;
  scale: number;
}

export interface WorldBounds {
  min: Vector3;
  max: Vector3;
}

export interface GenerationRun {
  seed: number;
  width: number;
  depth: number;
  cellSize: number;
}

export type RecipeSourceLayer = "base" | "scene";

export interface RecipeCell {
  id: string;
  column: number;
  row: number;
  transform: Transform;
  sourceAssetId: string;
  variantId?: string;
  semanticRoles: readonly string[];
  sourceLayer: RecipeSourceLayer;
  /** True when column/row/variant were recovered from the transform instead of read from provenance. */
  recovered: boolean;
}

export interface RecipeObject {
  id: string;
  name: string;
  transform: Transform;
  sourceAssetId: string;
  semanticRoles: readonly string[];
  sourceLayer: RecipeSourceLayer;
}

export interface RecipeGround {
  appearance: { type: "color" | "texture"; color: string; textureUrl: string | null };
}

export interface SceneRecipe {
  grid: { width: number; depth: number; cellSize: number; origin: Vector3 };
  generationRuns: readonly GenerationRun[];
  cells: readonly RecipeCell[];
  objects: readonly RecipeObject[];
  ground: RecipeGround;
  diagnostics: readonly string[];
}

export interface EnvironmentManifestModel {
  file: "environment.glb";
  sha256: string;
  rootNode: "SteerlabEnvironment";
  upAxis: "Y";
  unitsPerMeter: number;
}

export interface EnvironmentManifestGrid {
  width: number;
  depth: number;
  cellSize: number;
  origin: Vector3;
  bounds: WorldBounds;
}

export interface EnvironmentManifestProvenance {
  source: "editor" | "cli";
  generatorVersion: string;
  generationRuns: readonly GenerationRun[];
}

export interface EnvironmentManifestBuild {
  chunkSize: number;
  removeInternalSeamFaces: boolean;
}

export interface EnvironmentManifestChunk {
  id: string;
  bounds: WorldBounds;
}

export interface EnvironmentManifestAsset {
  id: string;
  label: string;
  category: string;
  contentHash: string;
  semanticRoles: readonly string[];
}

export interface EnvironmentManifestCell {
  id: string;
  column: number;
  row: number;
  transform: Transform;
  bounds: WorldBounds;
  sourceAssetId: string;
  assetContentHash?: string;
  variantId?: string;
  semanticRoles: readonly string[];
  chunkId: string;
  sourceLayer: RecipeSourceLayer;
}

export interface EnvironmentManifestObject {
  id: string;
  name: string;
  transform: Transform;
  bounds: WorldBounds;
  sourceAssetId: string;
  assetContentHash?: string;
  semanticRoles: readonly string[];
  chunkId: string;
  sourceLayer: RecipeSourceLayer;
}

export interface EnvironmentManifestGround {
  bounds: WorldBounds;
  material: { color: string; textureUrl: string | null };
  chunkIds: readonly string[];
}

export interface EnvironmentManifestNavigationNode {
  id: string;
  cellId: string;
  position: Vector3;
  channels: readonly string[];
  featureTags: readonly string[];
}

export interface EnvironmentManifestNavigationEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  direction: "north" | "east" | "south" | "west";
  channel: string;
  cost: number;
  bidirectional: boolean;
}

export interface EnvironmentManifest {
  format: "steerlab-environment";
  formatVersion: 1;
  model: EnvironmentManifestModel;
  grid: EnvironmentManifestGrid;
  provenance: EnvironmentManifestProvenance;
  build: EnvironmentManifestBuild;
  chunks: readonly EnvironmentManifestChunk[];
  assets: readonly EnvironmentManifestAsset[];
  cells: readonly EnvironmentManifestCell[];
  objects: readonly EnvironmentManifestObject[];
  ground: EnvironmentManifestGround | null;
  navigation: { nodes: readonly EnvironmentManifestNavigationNode[]; edges: readonly EnvironmentManifestNavigationEdge[] };
  diagnostics: readonly string[];
}
