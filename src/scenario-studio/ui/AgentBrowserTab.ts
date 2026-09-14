import * as THREE from "three";
import { assetTileSize, narrowAssetTileSize, shellLayout } from "../../app/config";
import { theme } from "../../app/theme";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import { BasePanel } from "../../features/hud/kit/BasePanel";
import type { Rect } from "../../features/hud/kit/layout";
import { Tile } from "../../features/hud/kit/Tile";
import { configureHudCanvasTexture } from "../../features/hud/kit/textures";
import { layoutAssetTiles } from "../../features/hud/panels/assetBrowserLayout";
import type { AgentChoice } from "../domain/agent";
import { CatalogBrowserChrome } from "./CatalogBrowserChrome";

export class AgentBrowserTab extends BasePanel {
  private readonly chrome: CatalogBrowserChrome;
  private readonly loader = new THREE.TextureLoader();
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private rows: { choice: AgentChoice; tile: Tile }[] = [];
  private choices: readonly AgentChoice[] = [];
  private selectedId: string | null = null;
  private query = "";
  private generation = 0;
  private disposed = false;
  private drag: { choice: AgentChoice; x: number; y: number; active: boolean } | null = null;

  constructor(
    rect: Rect,
    private readonly browserInteraction: InteractionSystem,
    onRefresh: () => void,
    private readonly onSelect: (choice: AgentChoice) => void,
    private readonly onVisualChange: () => void,
    private readonly onDrag: (choice: AgentChoice, phase: "start" | "move" | "drop", x: number, y: number) => void
  ) {
    super(rect, {
      fill: theme.panel.hex, border: theme.borderStrong.hex, borderWidth: 1,
      radius: { topLeft: theme.radius.lg, topRight: theme.radius.lg, bottomLeft: 0, bottomRight: 0 }, shadow: "lg", z: -0.2
    }, browserInteraction);
    this.chrome = new CatalogBrowserChrome(rect, browserInteraction, "", "Search agents…", onRefresh, (value) => { this.query = value; this.rebuild(); }, onVisualChange);
    this.root.add(this.chrome.root);
  }

  setChoices(choices: readonly AgentChoice[]): void { this.choices = choices; this.rebuild(); }
  setSelected(id: string | null): void {
    this.selectedId = id;
    for (const row of this.rows) row.tile.setActive(row.choice.asset.id === id);
  }
  setRefreshing(value: boolean): void { this.chrome.setRefreshing(value); }

  protected layout(): void {
    this.chrome?.setRect(this.rect);
    if (this.chrome) this.rebuild();
  }

  update(dt: number): void { this.chrome.update(dt); }

  private rebuild(): void {
    const generation = ++this.generation;
    for (const row of this.rows) row.tile.dispose();
    this.rows = [];
    this.chrome.scroll.clearContent();
    const query = this.query.trim().toLowerCase();
    const visible = this.choices.filter((choice) => `${choice.asset.label} ${choice.asset.id} ${choice.asset.key}`.toLowerCase().includes(query));
    this.chrome.setEmpty(!this.choices.length ? "No agent assets found in assets/agents." : !visible.length ? "No matching agents. Change or clear your search." : "");
    const grid = this.chrome.gridRect();
    const tileSize = this.rect.width < shellLayout.narrowBreakpoint ? narrowAssetTileSize : assetTileSize;
    const layout = layoutAssetTiles({ assetCount: visible.length, grid, tile: tileSize });
    visible.forEach((choice, index) => {
      const tile = new Tile(layout.tiles[index], this.browserInteraction, {
        label: choice.asset.label,
        tag: choice.available ? choice.asset.category : "unavailable",
        onClick: () => this.onSelect(choice),
        onPointerDown: (event) => { if (choice.available) this.drag = { choice, x: event.x, y: event.y, active: false }; },
        onPointerMove: (event) => {
          if (!this.drag || this.drag.choice !== choice) return;
          if (!this.drag.active && Math.hypot(event.x - this.drag.x, event.y - this.drag.y) >= 6) {
            this.drag.active = true;
            this.onSelect(choice);
            this.onDrag(choice, "start", event.x, event.y);
          } else if (this.drag.active) this.onDrag(choice, "move", event.x, event.y);
        },
        onPointerUp: (event) => {
          if (this.drag?.choice === choice && this.drag.active) this.onDrag(choice, "drop", event.x, event.y);
          this.drag = null;
        }
      });
      tile.setActive(choice.asset.id === this.selectedId);
      this.chrome.scroll.content.add(tile.root);
      this.rows.push({ choice, tile });
      if (choice.available && choice.asset.thumbnailUrl) void this.texture(choice.asset.thumbnailUrl).then((texture) => {
        if (!this.disposed && generation === this.generation) { tile.setThumbnailTexture(texture); this.onVisualChange(); }
      }).catch(() => {});
    });
    this.chrome.scroll.setContentSize(layout.contentSize);
    this.chrome.scroll.applyClipping();
    this.onVisualChange();
  }

  private texture(url: string): Promise<THREE.Texture> {
    let pending = this.textures.get(url);
    if (!pending) {
      pending = this.loader.loadAsync(url).then(configureHudCanvasTexture);
      this.textures.set(url, pending);
    }
    return pending;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.drag = null;
    for (const row of this.rows) row.tile.dispose();
    for (const texture of this.textures.values()) void texture.then((value) => value.dispose(), () => {});
    this.textures.clear();
    this.chrome.dispose();
    super.dispose();
  }
}
