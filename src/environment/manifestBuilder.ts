import type { ChunkAssignment } from "./chunking";
import type {
  EnvironmentManifestAsset,
  EnvironmentManifestCell,
  EnvironmentManifestGround,
  EnvironmentManifestObject,
  RecipeCell,
  RecipeObject,
  SceneRecipe,
  WorldBounds
} from "./types";

const HALF_FOOTPRINT = 0.5;

export interface ManifestRecordsResult {
  cells: EnvironmentManifestCell[];
  objects: EnvironmentManifestObject[];
  ground: EnvironmentManifestGround | null;
}

/** Assembles per-record manifest fields (bounds, chunk ID, asset content hash) that a bare SceneRecipe doesn't carry. */
export function buildManifestRecords(
  recipe: SceneRecipe,
  chunkAssignment: ChunkAssignment,
  assetTable: readonly EnvironmentManifestAsset[]
): ManifestRecordsResult {
  const contentHashById = new Map(assetTable.map((asset) => [asset.id, asset.contentHash]));

  const cells = recipe.cells.map((cell) => manifestCell(cell, recipe.grid.cellSize, chunkAssignment, contentHashById));
  const objects = recipe.objects.map((object) => manifestObject(object, chunkAssignment, contentHashById));
  const ground = buildGroundRecord(recipe, chunkAssignment);

  return { cells, objects, ground };
}

function manifestCell(
  cell: RecipeCell,
  cellSize: number,
  chunkAssignment: ChunkAssignment,
  contentHashById: ReadonlyMap<string, string>
): EnvironmentManifestCell {
  const half = (cellSize * cell.transform.scale) / 2;
  return {
    id: cell.id,
    column: cell.column,
    row: cell.row,
    transform: cell.transform,
    bounds: boundsAround(cell.transform.position, half, half),
    sourceAssetId: cell.sourceAssetId,
    assetContentHash: contentHashById.get(cell.sourceAssetId),
    variantId: cell.variantId,
    semanticRoles: cell.semanticRoles,
    chunkId: chunkAssignment.cellChunkIds.get(cell.id)!,
    sourceLayer: cell.sourceLayer
  };
}

function manifestObject(object: RecipeObject, chunkAssignment: ChunkAssignment, contentHashById: ReadonlyMap<string, string>): EnvironmentManifestObject {
  const half = HALF_FOOTPRINT * object.transform.scale;
  return {
    id: object.id,
    name: object.name,
    transform: object.transform,
    bounds: boundsAround(object.transform.position, half, half),
    sourceAssetId: object.sourceAssetId,
    assetContentHash: contentHashById.get(object.sourceAssetId),
    semanticRoles: object.semanticRoles,
    chunkId: chunkAssignment.objectChunkIds.get(object.id)!,
    sourceLayer: object.sourceLayer
  };
}

function boundsAround(position: { x: number; y: number; z: number }, halfX: number, halfZ: number): WorldBounds {
  return {
    min: { x: position.x - halfX, y: position.y, z: position.z - halfZ },
    max: { x: position.x + halfX, y: position.y + halfX * 2, z: position.z + halfZ }
  };
}

function buildGroundRecord(recipe: SceneRecipe, chunkAssignment: ChunkAssignment): EnvironmentManifestGround | null {
  const { grid } = recipe;
  return {
    bounds: {
      min: { x: grid.origin.x, y: 0, z: grid.origin.z },
      max: { x: grid.origin.x + grid.width * grid.cellSize, y: 0, z: grid.origin.z + grid.depth * grid.cellSize }
    },
    material: { color: recipe.ground.appearance.color, textureUrl: recipe.ground.appearance.textureUrl },
    chunkIds: chunkAssignment.groundChunkIds
  };
}
