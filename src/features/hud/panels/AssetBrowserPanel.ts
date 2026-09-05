import * as THREE from "three";
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
import { Panel, unitPlane } from "../kit/Panel";
import { hudBasicMaterial } from "../kit/materials";
import { rasterizeText } from "../kit/TextRenderer";
import { hudZ } from "../kit/zIndex";
import { layoutAssetTiles } from "./assetBrowserLayout";

const CONTROLS_HEIGHT = 52;
const CONTROL_ROW_HEIGHT = 34;
const REFRESH_BUTTON_WIDTH = 108;
const PADDING = 16;
const DIVIDER_HEIGHT = 1;

interface TileRow {
  tile: Tile;
  assetId: string;
}

/** The footer: search/category filter + refresh, and a vertically-scrolling grid of asset tiles. */
export class AssetBrowserPanel extends BasePanel {
  private readonly searchField: TextField;
  private readonly dropdown: Dropdown;
  private readonly refreshButton: Button;
  private readonly divider: Panel;
  private readonly scroll: ScrollRegion;
  private rows: TileRow[] = [];
  private emptyStateMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private hoveredHandle: { assetId: string; handle: LiveThumbnailHandle } | null = null;
  private hoverToken = 0;

  constructor(
    rect: Rect,
    private readonly interaction: InteractionSystem,
    private readonly state: EditorState,
    private readonly thumbnails: ThumbnailRenderer
  ) {
    super(
      rect,
      {
        fill: theme.panel.hex,
        border: theme.borderStrong.hex,
        borderWidth: 1,
        radius: { topLeft: theme.radius.lg, topRight: theme.radius.lg, bottomLeft: 0, bottomRight: 0 },
        shadow: "lg",
        z: -0.2
      },
      interaction
    );

    const searchWidth = Math.min(340, rect.width * 0.4);
    const controlsY = rect.y + (CONTROLS_HEIGHT - CONTROL_ROW_HEIGHT) / 2;
    this.searchField = new TextField(
      { x: rect.x + PADDING, y: controlsY, width: searchWidth, height: CONTROL_ROW_HEIGHT },
      interaction,
      { placeholder: "Search assets", onChange: (value) => state.setSearch(value) },
      state.assetSearch
    );
    this.root.add(this.searchField.root);

    this.dropdown = new Dropdown(
      { x: rect.x + PADDING + searchWidth + 10, y: controlsY, width: 150, height: CONTROL_ROW_HEIGHT },
      interaction,
      state.categories,
      state.category,
      (value) => state.setCategory(value)
    );
    this.root.add(this.dropdown.root);

    this.refreshButton = new Button(
      {
        x: rect.x + PADDING + searchWidth + 10 + 150 + 10,
        y: controlsY,
        width: REFRESH_BUTTON_WIDTH,
        height: CONTROL_ROW_HEIGHT
      },
      interaction,
      { label: "Refresh", icon: "refresh", justify: "start", onClick: () => this.refreshAssets() }
    );
    this.root.add(this.refreshButton.root);

    this.divider = new Panel(this.dividerRect(), { fill: theme.borderSubtle.hex, radius: 0 });
    this.root.add(this.divider.root);

    this.scroll = new ScrollRegion(this.gridRect(), interaction, { axis: "vertical" });
    this.root.add(this.scroll.root);

    this.registerCleanup(state.on("assets", () => this.rebuildGrid()));
    this.registerCleanup(state.on("search", () => this.rebuildGrid()));
    this.registerCleanup(state.on("category", () => this.rebuildGrid()));
    this.registerCleanup(state.on("assetRefresh", () => this.updateRefreshButton()));
    this.registerCleanup(state.on("placement", () => this.updateActiveTiles()));
    this.updateRefreshButton();
    this.rebuildGrid();
  }

  private dividerRect(): Rect {
    return { x: this.rect.x + PADDING, y: this.rect.y + CONTROLS_HEIGHT, width: this.rect.width - PADDING * 2, height: DIVIDER_HEIGHT };
  }

  private gridRect(): Rect {
    const top = this.rect.y + CONTROLS_HEIGHT + DIVIDER_HEIGHT;
    return { x: this.rect.x + PADDING, y: top, width: this.rect.width - PADDING * 2, height: this.rect.height - CONTROLS_HEIGHT - DIVIDER_HEIGHT };
  }

  private rebuildGrid() {
    this.releaseHover();
    for (const row of this.rows) row.tile.dispose();
    this.rows = [];
    this.scroll.clearContent();
    this.clearEmptyState();

    this.dropdown.setOptions(this.state.categories, this.state.category);

    const grid = this.gridRect();
    const { width: tileWidth, height: tileHeight, gap } = assetTileSize;
    const tileLayout = layoutAssetTiles({
      assetCount: this.state.filteredAssets.length,
      grid,
      tile: { width: tileWidth, height: tileHeight, gap }
    });

    this.state.filteredAssets.forEach((asset, index) => {
      const tileRect: Rect = tileLayout.tiles[index];
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
    });
    this.scroll.setContentSize(tileLayout.contentSize);
    this.scroll.applyClipping();

    if (this.state.filteredAssets.length === 0) this.showEmptyState(grid);
  }

  private showEmptyState(grid: Rect) {
    const filtered = Boolean(this.state.assetSearch.trim()) || this.state.category !== "all";
    const message = filtered ? "No assets match your filters" : "No assets yet — try Refresh";
    const rasterized = rasterizeText(message, { size: 13, color: theme.textMutedAlt.css });
    const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
    const mesh = new THREE.Mesh(unitPlane, material);
    mesh.scale.set(rasterized.width, rasterized.height, 1);
    mesh.position.set(grid.x + grid.width / 2, grid.y + grid.height / 2, hudZ.glyph);
    this.root.add(mesh);
    this.emptyStateMesh = mesh;
  }

  private clearEmptyState() {
    if (!this.emptyStateMesh) return;
    this.root.remove(this.emptyStateMesh);
    this.emptyStateMesh.material.dispose();
    this.emptyStateMesh = null;
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
    this.searchField?.setRect({ x: this.rect.x + PADDING, y: controlsY, width: searchWidth, height: CONTROL_ROW_HEIGHT });
    this.dropdown?.setRect({ x: this.rect.x + PADDING + searchWidth + 10, y: controlsY, width: 150, height: CONTROL_ROW_HEIGHT });
    this.refreshButton?.setRect({
      x: this.rect.x + PADDING + searchWidth + 10 + 150 + 10,
      y: controlsY,
      width: REFRESH_BUTTON_WIDTH,
      height: CONTROL_ROW_HEIGHT
    });
    this.divider?.setRect(this.dividerRect());
    this.scroll.setRect(this.gridRect());
    this.rebuildGrid();
  }

  dispose() {
    this.releaseHover();
    this.clearEmptyState();
    this.searchField.dispose();
    this.dropdown.dispose();
    this.refreshButton.dispose();
    this.divider.dispose();
    for (const row of this.rows) row.tile.dispose();
    this.scroll.dispose();
    super.dispose();
  }
}
