import * as THREE from "three";
import { assetTileSize, narrowAssetTileSize, shellLayout } from "../../app/config";
import { theme } from "../../app/theme";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import { BasePanel } from "../../features/hud/kit/BasePanel";
import type { Rect } from "../../features/hud/kit/layout";
import { Tile } from "../../features/hud/kit/Tile";
import type { LiveThumbnailHandle } from "../../features/hud/thumbnails/ThumbnailRenderer";
import { layoutAssetTiles } from "../../features/hud/panels/assetBrowserLayout";
import type { SceneChoice, SceneReference } from "../domain/scene";
import type { ScenarioSceneThumbnails } from "../rendering/ScenarioSceneThumbnails";
import { CatalogBrowserChrome } from "./CatalogBrowserChrome";

/** Scene Studio's bottom asset browser chrome and tile grid, backed by published scenes. */
export class SceneBrowserPanel extends BasePanel {
  private readonly chrome: CatalogBrowserChrome;
  private query = "";
  private disposed = false;
  private rows: { choice: SceneChoice; tile: Tile; texture: THREE.Texture | null }[] = [];
  private choices: readonly SceneChoice[] = [];
  private selected: SceneReference | null = null;
  private refreshGeneration = 0;
  private hoverToken = 0;
  private hoveredHandle: { key: string; handle: LiveThumbnailHandle } | null = null;

  constructor(
    rect: Rect,
    private readonly interaction: InteractionSystem,
    onRefresh: () => void,
    private readonly onSelect: (choice: SceneChoice) => void,
    private readonly onVisualChange: () => void,
    private readonly thumbnails: ScenarioSceneThumbnails
  ) {
    super(rect, {
      fill: theme.panel.hex,
      border: theme.borderStrong.hex,
      borderWidth: 1,
      radius: { topLeft: theme.radius.lg, topRight: theme.radius.lg, bottomLeft: 0, bottomRight: 0 },
      shadow: "lg",
      z: -0.2
    }, interaction);
    this.chrome = new CatalogBrowserChrome(rect, interaction, "", "Search scenes…", onRefresh, (value) => { this.query = value; this.rebuild(); }, onVisualChange);
    this.root.add(this.chrome.root);
  }

  setChoices(choices: readonly SceneChoice[]): void {
    this.choices = choices;
    this.rebuild();
    this.thumbnails.retain(choices);
  }

  setSelected(reference: SceneReference | null): void {
    this.selected = reference;
    for (const row of this.rows) row.tile.setActive(row.choice.reference.key === reference?.key);
  }

  setRefreshing(refreshing: boolean): void {
    this.chrome.setRefreshing(refreshing);
  }

  private rebuild(): void {
    ++this.refreshGeneration;
    ++this.hoverToken;
    this.releaseHover();
    for (const row of this.rows) row.tile.dispose();
    this.rows = [];
    this.chrome.scroll.clearContent();
    const grid = this.chrome.gridRect();
    const tileSize = this.rect.width < shellLayout.narrowBreakpoint ? narrowAssetTileSize : assetTileSize;
    const query = this.query.trim().toLowerCase();
    const visible = this.choices.filter((choice) => `${choice.label} ${choice.reference.key}`.toLowerCase().includes(query));
    this.chrome.setEmpty(!this.choices.length ? "No published scenes found in assets/scenes." : !visible.length ? "No matching scenes. Change or clear your search." : "");
    const layout = layoutAssetTiles({ assetCount: visible.length, grid, tile: tileSize });
    visible.forEach((choice, index) => {
      const tile = new Tile(layout.tiles[index], this.interaction, {
        label: choice.label,
        tag: choice.available ? choice.reference.key === "." ? "published" : choice.reference.key : "unavailable",
        onClick: () => this.onSelect(choice),
        onHover: () => this.startHover(choice),
        onLeave: () => this.endHover(choice)
      });
      tile.setActive(choice.reference.key === this.selected?.key);
      this.chrome.scroll.content.add(tile.root);
      const row = { choice, tile, texture: null as THREE.Texture | null };
      this.rows.push(row);
      const generation = this.refreshGeneration;
      if (choice.available) void this.thumbnails.getStaticThumbnail(choice).then((texture) => {
        if (this.disposed || generation !== this.refreshGeneration) return;
        row.texture = texture;
        if (this.hoveredHandle?.key !== choice.reference.key) tile.setThumbnailTexture(texture);
        this.onVisualChange();
      }).catch(() => {});
    });
    this.chrome.scroll.setContentSize(layout.contentSize);
    this.chrome.scroll.applyClipping();
    this.onVisualChange();
  }

  protected layout(): void {
    this.chrome?.setRect(this.rect);
    if (this.chrome) this.rebuild();
  }

  update(dt: number): void {
    this.chrome.update(dt);
    if (this.interaction.hasFocus()) this.onVisualChange();
    if (this.hoveredHandle) {
      this.thumbnails.update(dt);
      this.onVisualChange();
    }
  }

  private startHover(choice: SceneChoice): void {
    if (this.disposed || !choice.available) return;
    const token = ++this.hoverToken;
    this.releaseHover();
    void this.thumbnails.acquireLiveThumbnail(choice).then((handle) => {
      if (!handle) return;
      if (this.disposed || token !== this.hoverToken) {
        handle.dispose();
        return;
      }
      this.hoveredHandle = { key: choice.reference.key, handle };
      this.rows.find((row) => row.choice.reference.key === choice.reference.key)?.tile.setThumbnailTexture(handle.texture);
      this.onVisualChange();
    }).catch(() => {});
  }

  private endHover(choice: SceneChoice): void {
    this.hoverToken++;
    if (this.hoveredHandle?.key !== choice.reference.key) return;
    this.releaseHover();
    const row = this.rows.find((entry) => entry.choice.reference.key === choice.reference.key);
    row?.tile.setThumbnailTexture(row.texture);
    this.onVisualChange();
  }

  private releaseHover(): void {
    this.hoveredHandle?.handle.dispose();
    this.hoveredHandle = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.hoverToken;
    ++this.refreshGeneration;
    this.releaseHover();
    for (const row of this.rows) row.tile.dispose();
    this.chrome.dispose();
    super.dispose();
  }
}
