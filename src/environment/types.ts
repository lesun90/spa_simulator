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
