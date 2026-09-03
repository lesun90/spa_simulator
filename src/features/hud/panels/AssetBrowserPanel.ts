import { assetTileSize } from "../../../app/config";
import { theme } from "../../../app/theme";
import type { AssetCatalogEntry } from "../../../editor-core/assets";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { EditorState } from "../../../state/EditorState";
import type { LiveThumbnailHandle, ThumbnailRenderer } from "../thumbnails/ThumbnailRenderer";
import { BasePanel } from "../kit/BasePanel";
import { Button } from "../kit/Button";
import { Dropdown } from "../kit/Dropdown";
import type { Rect } from "../kit/layout";
import { ScrollRegion } from "../kit/ScrollRegion";
import { TextField } from "../kit/TextField";
import { Tile } from "../kit/Tile";

const CONTROLS_HEIGHT = 44;
const CONTROL_ROW_HEIGHT = 34;
const REFRESH_BUTTON_WIDTH = 108;

interface TileRow {
  tile: Tile;
  assetId: string;
}

/** The footer: search/category filter + refresh, and a horizontally-scrolling grid of asset tiles. */
export class AssetBrowserPanel extends BasePanel {
  private readonly searchField: TextField;
  private readonly dropdown: Dropdown;
  private readonly refreshButton: Button;
  private readonly scroll: ScrollRegion;
  private rows: TileRow[] = [];
  private hoveredHandle: { assetId: string; handle: LiveThumbnailHandle } | null = null;
  private hoverToken = 0;

  constructor(
    rect: Rect,
    private readonly interaction: InteractionSystem,
    private readonly state: EditorState,
    private readonly thumbnails: ThumbnailRenderer
  ) {
    super(rect, { fill: theme.panel.hex, border: theme.borderStrong.hex, borderWidth: 1, z: -0.2 });

    const searchWidth = Math.min(340, rect.width * 0.4);
    this.searchField = new TextField(
      { x: rect.x, y: rect.y + (CONTROLS_HEIGHT - CONTROL_ROW_HEIGHT) / 2, width: searchWidth, height: CONTROL_ROW_HEIGHT },
      interaction,
      { placeholder: "Search assets", onChange: (value) => state.setSearch(value) },
      state.assetSearch
    );
    this.root.add(this.searchField.root);

    this.dropdown = new Dropdown(
      { x: rect.x + searchWidth + 10, y: rect.y + (CONTROLS_HEIGHT - CONTROL_ROW_HEIGHT) / 2, width: 150, height: CONTROL_ROW_HEIGHT },
      interaction,
      state.categories,
      state.category,
      (value) => state.setCategory(value)
    );
    this.root.add(this.dropdown.root);

    this.refreshButton = new Button(
      {
        x: rect.x + searchWidth + 10 + 150 + 10,
        y: rect.y + (CONTROLS_HEIGHT - CONTROL_ROW_HEIGHT) / 2,
        width: REFRESH_BUTTON_WIDTH,
        height: CONTROL_ROW_HEIGHT
      },
      interaction,
      { label: "Refresh", icon: "refresh", justify: "start", onClick: () => this.refreshAssets() }
    );
    this.root.add(this.refreshButton.root);

    this.scroll = new ScrollRegion(this.gridRect(), interaction, { axis: "horizontal" });
    this.root.add(this.scroll.root);

    this.registerCleanup(state.on("assets", () => this.rebuildGrid()));
    this.registerCleanup(state.on("search", () => this.rebuildGrid()));
    this.registerCleanup(state.on("category", () => this.rebuildGrid()));
    this.registerCleanup(state.on("assetRefresh", () => this.updateRefreshButton()));
    this.registerCleanup(state.on("placement", () => this.updateActiveTiles()));
    this.updateRefreshButton();
    this.rebuildGrid();
  }

  private gridRect(): Rect {
    return { x: this.rect.x, y: this.rect.y + CONTROLS_HEIGHT, width: this.rect.width, height: this.rect.height - CONTROLS_HEIGHT };
  }

  private rebuildGrid() {
    this.releaseHover();
    for (const row of this.rows) row.tile.dispose();
    this.rows = [];
    this.scroll.clearContent();

    this.dropdown.setOptions(this.state.categories, this.state.category);

    const grid = this.gridRect();
    const { width: tileWidth, height: tileHeight, gap } = assetTileSize;
    let x = grid.x;
    const y = grid.y + (grid.height - tileHeight) / 2;

    for (const asset of this.state.filteredAssets) {
      const tileRect: Rect = { x, y, width: tileWidth, height: tileHeight };
      const tile = new Tile(tileRect, this.interaction, {
        label: asset.label,
        tag: asset.source === "temporary" ? "temporary" : asset.category,
        onClick: () => this.state.choosePlacement(asset.id),
        onHover: () => this.startHover(asset),
        onLeave: () => this.endHover(asset)
      });
      tile.setActive(asset.id === this.state.placementAssetId);
      void this.thumbnails.getStaticThumbnail(asset).then((texture) => tile.setThumbnailTexture(texture));
      this.scroll.content.add(tile.root);
      this.rows.push({ tile, assetId: asset.id });
      x += tileWidth + gap;
    }
    this.scroll.setContentSize(Math.max(x - grid.x - gap, 0));
    this.scroll.applyClipping();
  }

  private updateActiveTiles() {
    for (const row of this.rows) row.tile.setActive(row.assetId === this.state.placementAssetId);
  }

  private refreshAssets() {
    void this.state.refreshAssets();
  }

  private updateRefreshButton() {
    this.refreshButton.setContent({ icon: "refresh", label: this.state.assetsRefreshing ? "Refreshing" : "Refresh" });
    this.refreshButton.setDisabled(this.state.assetsRefreshing);
  }

  private startHover(asset: AssetCatalogEntry) {
    const token = ++this.hoverToken;
    this.releaseHover();
    void this.thumbnails.acquireLiveThumbnail(asset).then((handle) => {
      if (!handle) return;
      if (token !== this.hoverToken) {
        handle.dispose();
        return;
      }
      this.hoveredHandle = { assetId: asset.id, handle };
      this.rows.find((row) => row.assetId === asset.id)?.tile.setThumbnailTexture(handle.texture);
    });
  }

  private endHover(asset: AssetCatalogEntry) {
    this.hoverToken++;
    if (this.hoveredHandle?.assetId !== asset.id) return;
    this.releaseHover();
    const row = this.rows.find((entry) => entry.assetId === asset.id);
    if (row) void this.thumbnails.getStaticThumbnail(asset).then((texture) => row.tile.setThumbnailTexture(texture));
  }

  private releaseHover() {
    this.hoveredHandle?.handle.dispose();
    this.hoveredHandle = null;
  }

  update(dt: number) {
    if (!this.root.visible) return;
    this.searchField.update(dt);
  }

  setVisible(visible: boolean) {
    if (this.root.visible === visible) return;
    super.setVisible(visible);
    if (!visible) this.releaseHover();
  }

  protected layout() {
    const searchWidth = Math.min(340, this.rect.width * 0.4);
    const controlsY = this.rect.y + (CONTROLS_HEIGHT - CONTROL_ROW_HEIGHT) / 2;
    this.searchField?.setRect({ x: this.rect.x, y: controlsY, width: searchWidth, height: CONTROL_ROW_HEIGHT });
    this.dropdown?.setRect({ x: this.rect.x + searchWidth + 10, y: controlsY, width: 150, height: CONTROL_ROW_HEIGHT });
    this.refreshButton?.setRect({
      x: this.rect.x + searchWidth + 10 + 150 + 10,
      y: controlsY,
      width: REFRESH_BUTTON_WIDTH,
      height: CONTROL_ROW_HEIGHT
    });
    this.scroll.setRect(this.gridRect());
    this.rebuildGrid();
  }

  dispose() {
    this.releaseHover();
    this.searchField.dispose();
    this.dropdown.dispose();
    this.refreshButton.dispose();
    for (const row of this.rows) row.tile.dispose();
    this.scroll.dispose();
    super.dispose();
  }
}
