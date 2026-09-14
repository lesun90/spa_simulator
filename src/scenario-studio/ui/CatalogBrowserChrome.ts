import * as THREE from "three";
import { theme } from "../../app/theme";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import { Button } from "../../features/hud/kit/Button";
import type { Rect } from "../../features/hud/kit/layout";
import { Panel } from "../../features/hud/kit/Panel";
import { ScrollRegion } from "../../features/hud/kit/ScrollRegion";
import { TextField } from "../../features/hud/kit/TextField";
import { HudText } from "./HudText";

/** Shared bottom-browser heading, search, refresh, empty state, divider, and scrolling surface. */
export class CatalogBrowserChrome {
  readonly root = new THREE.Group();
  readonly scroll: ScrollRegion;
  private readonly heading: HudText;
  private readonly empty: HudText;
  private readonly refreshButton: Button;
  private readonly search: TextField;
  private readonly divider: Panel;
  private rect: Rect;

  constructor(
    rect: Rect,
    private readonly interaction: InteractionSystem,
    title: string,
    placeholder: string,
    onRefresh: () => void,
    onQuery: (query: string) => void,
    private readonly onVisualChange: () => void
  ) {
    this.rect = rect;
    this.heading = new HudText(this.headingFrame(), { size: 12, weight: "700", color: theme.text.css });
    this.heading.setText(title);
    this.empty = new HudText(this.emptyFrame(), { size: 12.5, color: theme.textMuted.css });
    this.refreshButton = new Button(this.refreshRect(), interaction, { icon: "refresh", label: "Refresh", onClick: onRefresh });
    this.search = new TextField(this.searchRect(), interaction, { placeholder, onChange: onQuery });
    this.divider = new Panel(this.dividerRect(), { fill: theme.borderSubtle.hex, radius: 0 });
    this.scroll = new ScrollRegion(this.gridRect(), interaction, { axis: "vertical" });
    this.root.add(this.heading.root, this.empty.root, this.refreshButton.root, this.search.root, this.divider.root, this.scroll.root);
  }

  setEmpty(text: string): void { this.empty.setText(text); }
  setRefreshing(refreshing: boolean): void {
    this.refreshButton.setDisabled(refreshing);
    this.refreshButton.setLabel(refreshing ? "Refreshing" : "Refresh");
  }
  gridRect(): Rect {
    const insetTop = this.rect.width < 980 ? 95 : 53;
    return { x: this.rect.x + 16, y: this.rect.y + insetTop, width: this.rect.width - 32, height: Math.max(this.rect.height - insetTop, 1) };
  }
  setRect(rect: Rect): void {
    this.rect = rect;
    this.heading.setFrame(this.headingFrame());
    this.empty.setFrame(this.emptyFrame());
    this.refreshButton.setRect(this.refreshRect());
    this.search.setRect(this.searchRect());
    this.divider.setRect(this.dividerRect());
    this.scroll.setRect(this.gridRect());
  }
  update(dt: number): void {
    this.search.update(dt);
    if (this.interaction.hasFocus()) this.onVisualChange();
  }
  dispose(): void {
    this.heading.dispose(); this.empty.dispose(); this.refreshButton.dispose(); this.search.dispose(); this.divider.dispose(); this.scroll.dispose();
  }

  private headingFrame() { return { x: this.rect.x + 18, y: this.rect.y + 17, width: 220 }; }
  private emptyFrame() { return { x: this.rect.x + 18, y: this.rect.y + 72, width: Math.max(this.rect.width - 36, 1), maxLines: 2 }; }
  private searchRect(): Rect { const x = this.rect.x + 90; return { x, y: this.rect.y + 9, width: Math.max(Math.min(this.rect.width - 226, 320), 70), height: 34 }; }
  private refreshRect(): Rect { return { x: this.rect.x + this.rect.width - 124, y: this.rect.y + 9, width: 108, height: 34 }; }
  private dividerRect(): Rect { return { x: this.rect.x + 16, y: this.rect.y + 52, width: this.rect.width - 32, height: 1 }; }
}
