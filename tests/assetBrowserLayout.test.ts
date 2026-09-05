import { describe, expect, test } from "vitest";
import { layoutAssetTiles } from "../src/features/hud/panels/assetBrowserLayout";

describe("asset browser tile layout", () => {
  test("wraps assets into rows and scrolls vertically", () => {
    const layout = layoutAssetTiles({
      assetCount: 8,
      grid: { x: 10, y: 100, width: 330, height: 250 },
      tile: { width: 100, height: 80, gap: 10 }
    });

    expect(layout.axis).toBe("vertical");
    expect(layout.contentSize).toBe(260);
    expect(layout.tiles.map((tile) => [tile.x, tile.y])).toEqual([
      [10, 100],
      [120, 100],
      [230, 100],
      [10, 190],
      [120, 190],
      [230, 190],
      [10, 280],
      [120, 280]
    ]);
  });

  test("clamps tile width to the grid width instead of overflowing sideways", () => {
    const layout = layoutAssetTiles({
      assetCount: 1,
      grid: { x: 10, y: 100, width: 80, height: 250 },
      tile: { width: 100, height: 80, gap: 10 }
    });

    expect(layout.tiles[0]).toEqual({ x: 10, y: 100, width: 80, height: 80 });
  });
});
