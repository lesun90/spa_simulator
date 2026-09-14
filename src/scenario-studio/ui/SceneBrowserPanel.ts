import * as THREE from "three";
import { assetTileSize, narrowAssetTileSize, shellLayout } from "../../app/config";
import { theme } from "../../app/theme";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import { BasePanel } from "../../features/hud/kit/BasePanel";
import { Button } from "../../features/hud/kit/Button";
import type { Rect } from "../../features/hud/kit/layout";
import { Panel } from "../../features/hud/kit/Panel";
import { ScrollRegion } from "../../features/hud/kit/ScrollRegion";
import { TextField } from "../../features/hud/kit/TextField";
import { Tile } from "../../features/hud/kit/Tile";
import type { LiveThumbnailHandle } from "../../features/hud/thumbnails/ThumbnailRenderer";
import { layoutAssetTiles } from "../../features/hud/panels/assetBrowserLayout";
import type { SceneChoice, SceneReference } from "../domain/scene";
import type { ScenarioSceneThumbnails } from "../rendering/ScenarioSceneThumbnails";
import { HudText } from "./HudText";

/** Scene Studio's bottom asset browser chrome and tile grid, backed by published scenes. */
export class SceneBrowserPanel extends BasePanel {
  private readonly heading: HudText;
  private readonly empty: HudText;
  private readonly refreshButton: Button;
  private readonly search: TextField;
  private query = "";
  private disposed = false;
  private readonly divider: Panel;
  private readonly scroll: ScrollRegion;
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
    this.heading = new HudText({ x: rect.x + 18, y: rect.y + 17, width: 220 }, { size: 12, weight: "700", color: theme.text.css });
    this.heading.setText("SCENES");
    this.empty = new HudText({ x: rect.x + 18, y: rect.y + 72, width: Math.max(rect.width - 36, 1) }, { size: 12.5, color: theme.textMuted.css });
    this.refreshButton = new Button(this.refreshRect(), interaction, { icon: "refresh", label: "Refresh", onClick: onRefresh });
    this.search = new TextField(this.searchRect(), interaction, {
      placeholder: "Search scenes…",
      onChange: (value) => { this.query = value; this.rebuild(); }
    });
    this.divider = new Panel(this.dividerRect(), { fill: theme.borderSubtle.hex, radius: 0 });
    this.scroll = new ScrollRegion(this.gridRect(), interaction, { axis: "vertical" });
    this.root.add(this.heading.root, this.refreshButton.root, this.search.root, this.divider.root, this.scroll.root, this.empty.root);
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
    this.refreshButton.setDisabled(refreshing);
    this.refreshButton.setLabel(refreshing ? "Refreshing" : "Refresh");
  }

  private searchRect(): Rect {
    const x = this.rect.x + 90;
    return { x, y: this.rect.y + 9, width: Math.max(Math.min(this.rect.width - 226, 320), 70), height: 34 };
  }

  private refreshRect(): Rect { return { x: this.rect.x + this.rect.width - 124, y: this.rect.y + 9, width: 108, height: 34 }; }
  private dividerRect(): Rect { return { x: this.rect.x + 16, y: this.rect.y + 52, width: this.rect.width - 32, height: 1 }; }
  private gridRect(): Rect { return { x: this.rect.x + 16, y: this.rect.y + 53, width: this.rect.width - 32, height: Math.max(this.rect.height - 53, 1) }; }

  private rebuild(): void {
    ++this.refreshGeneration;
    ++this.hoverToken;
    this.releaseHover();
    for (const row of this.rows) row.tile.dispose();
    this.rows = [];
    this.scroll.clearContent();
    const grid = this.gridRect();
    const tileSize = this.rect.width < shellLayout.narrowBreakpoint ? narrowAssetTileSize : assetTileSize;
    const query = this.query.trim().toLowerCase();
    const visible = this.choices.filter((choice) => `${choice.label} ${choice.reference.key}`.toLowerCase().includes(query));
    this.empty.setText(!this.choices.length ? "No published scenes found in assets/scenes." : !visible.length ? "No matching scenes. Change or clear your search." : "");
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
      this.scroll.content.add(tile.root);
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
    this.scroll.setContentSize(layout.contentSize);
    this.scroll.applyClipping();
    this.onVisualChange();
  }

  protected layout(): void {
    this.heading?.setFrame({ x: this.rect.x + 18, y: this.rect.y + 17, width: 220 });
    this.empty?.setFrame({ x: this.rect.x + 18, y: this.rect.y + 72, width: Math.max(this.rect.width - 36, 1), maxLines: 2 });
    this.refreshButton?.setRect(this.refreshRect());
    this.search?.setRect(this.searchRect());
    this.divider?.setRect(this.dividerRect());
    this.scroll?.setRect(this.gridRect());
    if (this.scroll) this.rebuild();
  }

  update(dt: number): void {
    this.search.update(dt);
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
    this.heading.dispose();
    this.empty.dispose();
    this.refreshButton.dispose();
    this.search.dispose();
    this.divider.dispose();
    this.scroll.dispose();
    super.dispose();
  }
}
