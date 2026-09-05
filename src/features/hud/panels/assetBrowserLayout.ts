import type { Rect } from "../kit/layout";

interface AssetTileLayoutInput {
  assetCount: number;
  grid: Rect;
  tile: { width: number; height: number; gap: number };
}

export function layoutAssetTiles({ assetCount, grid, tile }: AssetTileLayoutInput) {
  const tileWidth = Math.min(tile.width, grid.width);
  const columns = Math.max(1, Math.floor((grid.width + tile.gap) / (tileWidth + tile.gap)));
  const tiles = Array.from({ length: assetCount }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: grid.x + column * (tileWidth + tile.gap),
      y: grid.y + row * (tile.height + tile.gap),
      width: tileWidth,
      height: tile.height
    };
  });
  const rowCount = assetCount > 0 ? Math.ceil(assetCount / columns) : 0;
  const contentSize = rowCount > 0 ? rowCount * tile.height + (rowCount - 1) * tile.gap : 0;
  return { axis: "vertical" as const, tiles, contentSize };
}
