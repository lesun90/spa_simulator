import type { AssetCatalogEntry } from "../editor-core/assets";
import type { Scene, SceneObject } from "../editor-core/scene";
import type { GenerationRun, RecipeCell, RecipeObject, SceneRecipe } from "./types";

const EPSILON = 1e-4;

export function buildSceneRecipe(scene: Scene, assets: readonly AssetCatalogEntry[]): SceneRecipe {
  const width = Math.round(scene.grid.width / scene.grid.cellSize);
  const depth = Math.round(scene.grid.depth / scene.grid.cellSize);
  const cellSize = scene.grid.cellSize;
  const grid = { width, depth, cellSize };
  const origin = { x: -scene.grid.width / 2, y: 0, z: -scene.grid.depth / 2 };
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const diagnostics: string[] = [];
  const cells: RecipeCell[] = [];
  const objects: RecipeObject[] = [];

  for (const object of scene.objects) {
    const cell = object.generated?.pipeline === "wfc" ? recipeCellFromObject(object, grid, assetsById, diagnostics) : undefined;
    if (cell) {
      cells.push(cell);
    } else {
      objects.push(recipeObjectFromObject(object, assetsById));
    }
  }

  return {
    grid: { ...grid, origin },
    generationRuns: generationRunsFromScene(scene, grid),
    cells,
    objects,
    ground: { appearance: { ...scene.ground } },
    diagnostics
  };
}

function recipeCellFromObject(
  object: SceneObject,
  grid: { width: number; depth: number; cellSize: number },
  assetsById: Map<string, AssetCatalogEntry>,
  diagnostics: string[]
): RecipeCell | undefined {
  const provenance = object.generated!;
  const hasStoredCoordinate = provenance.column !== undefined && provenance.row !== undefined;
  const coordinate = hasStoredCoordinate ? { column: provenance.column!, row: provenance.row! } : recoverCoordinate(object.position, grid);

  if (!coordinate) {
    diagnostics.push(`Could not recover a grid-aligned cell coordinate for object ${object.id}; exported as a plain object.`);
    return undefined;
  }

  const asset = assetsById.get(object.assetId);
  const variantId = provenance.variantId ?? recoverVariantId(object, asset, diagnostics);

  return {
    id: object.id,
    column: coordinate.column,
    row: coordinate.row,
    transform: { position: { ...object.position }, rotationY: object.rotationY, scale: object.scale },
    sourceAssetId: object.assetId,
    variantId,
    semanticRoles: asset?.semantics?.roles ?? [],
    sourceLayer: "scene",
    recovered: !hasStoredCoordinate
  };
}

function recoverCoordinate(position: SceneObject["position"], grid: { width: number; depth: number; cellSize: number }) {
  const column = Math.round(position.x / grid.cellSize + (grid.width - 1) / 2);
  const row = Math.round(position.z / grid.cellSize + (grid.depth - 1) / 2);
  const expectedX = (column - (grid.width - 1) / 2) * grid.cellSize;
  const expectedZ = (row - (grid.depth - 1) / 2) * grid.cellSize;
  if (Math.abs(position.x - expectedX) > EPSILON || Math.abs(position.z - expectedZ) > EPSILON) return undefined;
  return { column, row };
}

function recoverVariantId(object: SceneObject, asset: AssetCatalogEntry | undefined, diagnostics: string[]): string | undefined {
  const rotationDegrees = normalizeRotationDegrees(object.rotationY);
  const matches = (asset?.wfc?.variants ?? []).filter((variant) => variant.rotationDegrees === rotationDegrees);
  if (matches.length === 1) return matches[0].variantId;
  if (matches.length > 1) diagnostics.push(`Ambiguous WFC variant for object ${object.id}: ${matches.length} variants of ${object.assetId} share rotation ${rotationDegrees}.`);
  else diagnostics.push(`No WFC variant of ${object.assetId} matches object ${object.id} at rotation ${rotationDegrees}.`);
  return undefined;
}

function normalizeRotationDegrees(rotationY: number) {
  const degrees = Math.round((rotationY * 180) / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

function recipeObjectFromObject(object: SceneObject, assetsById: Map<string, AssetCatalogEntry>): RecipeObject {
  return {
    id: object.id,
    name: object.name,
    transform: { position: { ...object.position }, rotationY: object.rotationY, scale: object.scale },
    sourceAssetId: object.assetId,
    semanticRoles: assetsById.get(object.assetId)?.semantics?.roles ?? [],
    sourceLayer: "scene"
  };
}

function generationRunsFromScene(scene: Scene, grid: { width: number; depth: number; cellSize: number }): readonly GenerationRun[] {
  const seeds = new Set(
    scene.objects
      .map((object) => (object.generated?.pipeline === "wfc" ? object.generated.seed : undefined))
      .filter((seed): seed is number => seed !== undefined)
  );
  return [...seeds].sort((a, b) => a - b).map((seed) => ({ seed, ...grid }));
}
