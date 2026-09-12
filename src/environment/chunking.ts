import type { RecipeCell, RecipeObject, SceneRecipe, WorldBounds } from "./types";

export interface ChunkAssignment {
  chunks: readonly { id: string; bounds: WorldBounds }[];
  cellChunkIds: ReadonlyMap<string, string>;
  objectChunkIds: ReadonlyMap<string, string>;
  groundChunkIds: readonly string[];
}

/** Assigns cells by grid coordinate and everything else by world-space center, per the design's chunking rule. */
export function assignChunks(recipe: SceneRecipe, chunkSize: number): ChunkAssignment {
  const { grid } = recipe;
  const chunkCellSpan = chunkSize > 0 ? chunkSize : Math.max(grid.width, grid.depth, 1);
  const chunkWorldSpan = chunkCellSpan * grid.cellSize;
  const bounds = new Map<string, { min: [number, number]; max: [number, number] }>();
  const cellChunkIds = new Map<string, string>();
  const objectChunkIds = new Map<string, string>();

  function chunkIdForCoordinate(cx: number, cz: number): string {
    return `chunk_${cx}_${cz}`;
  }

  function expandBounds(id: string, minX: number, minZ: number, maxX: number, maxZ: number) {
    const existing = bounds.get(id);
    if (!existing) {
      bounds.set(id, { min: [minX, minZ], max: [maxX, maxZ] });
      return;
    }
    existing.min[0] = Math.min(existing.min[0], minX);
    existing.min[1] = Math.min(existing.min[1], minZ);
    existing.max[0] = Math.max(existing.max[0], maxX);
    existing.max[1] = Math.max(existing.max[1], maxZ);
  }

  for (const cell of recipe.cells) {
    const cx = chunkSize > 0 ? Math.floor(cell.column / chunkSize) : 0;
    const cz = chunkSize > 0 ? Math.floor(cell.row / chunkSize) : 0;
    const id = chunkIdForCoordinate(cx, cz);
    cellChunkIds.set(cell.id, id);
    const minX = grid.origin.x + cell.column * grid.cellSize;
    const minZ = grid.origin.z + cell.row * grid.cellSize;
    expandBounds(id, minX, minZ, minX + grid.cellSize, minZ + grid.cellSize);
  }

  for (const object of recipe.objects) {
    const localX = object.transform.position.x - grid.origin.x;
    const localZ = object.transform.position.z - grid.origin.z;
    const cx = chunkSize > 0 ? Math.floor(localX / chunkWorldSpan) : 0;
    const cz = chunkSize > 0 ? Math.floor(localZ / chunkWorldSpan) : 0;
    const id = chunkIdForCoordinate(cx, cz);
    objectChunkIds.set(object.id, id);
    expandBounds(id, object.transform.position.x, object.transform.position.z, object.transform.position.x, object.transform.position.z);
  }

  const groundChunkIds = groundChunkIdsForGrid(grid, chunkCellSpan, chunkWorldSpan, chunkIdForCoordinate, expandBounds);

  const chunks = [...bounds.entries()].map(([id, box]) => ({
    id,
    bounds: { min: { x: box.min[0], y: 0, z: box.min[1] }, max: { x: box.max[0], y: 0, z: box.max[1] } }
  }));

  return { chunks, cellChunkIds, objectChunkIds, groundChunkIds };
}

function groundChunkIdsForGrid(
  grid: SceneRecipe["grid"],
  chunkCellSpan: number,
  chunkWorldSpan: number,
  chunkIdForCoordinate: (cx: number, cz: number) => string,
  expandBounds: (id: string, minX: number, minZ: number, maxX: number, maxZ: number) => void
): string[] {
  const columnsPerChunk = chunkCellSpan;
  const rowsPerChunk = chunkCellSpan;
  const chunkColumns = Math.ceil(grid.width / columnsPerChunk);
  const chunkRows = Math.ceil(grid.depth / rowsPerChunk);
  const ids: string[] = [];

  for (let cz = 0; cz < chunkRows; cz += 1) {
    for (let cx = 0; cx < chunkColumns; cx += 1) {
      const id = chunkIdForCoordinate(cx, cz);
      ids.push(id);
      const minX = grid.origin.x + cx * chunkWorldSpan;
      const minZ = grid.origin.z + cz * chunkWorldSpan;
      const maxX = Math.min(minX + chunkWorldSpan, grid.origin.x + grid.width * grid.cellSize);
      const maxZ = Math.min(minZ + chunkWorldSpan, grid.origin.z + grid.depth * grid.cellSize);
      expandBounds(id, minX, minZ, maxX, maxZ);
    }
  }

  return ids;
}
