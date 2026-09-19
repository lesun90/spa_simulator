import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { Panel, unitPlane } from "./Panel";
import { rasterizeText } from "./TextRenderer";
import { hudZ } from "./zIndex";

const TOOLTIP_PADDING_X = 8;
const TOOLTIP_HEIGHT = 26;
const TOOLTIP_GAP = 6;

type LabelMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/**
 * A small "?" affordance that reveals a one-line tooltip on hover — for labeling a field whose meaning
 * (units, semantics) isn't obvious from its name alone.
 */
export class InfoHint {
  readonly root = new THREE.Group();
  private readonly background: Panel;
  private readonly hitArea: THREE.Mesh;
  private glyph: LabelMesh | null = null;
  private readonly unregister: () => void;
  private tooltip: THREE.Group | null = null;
  private tooltipPanel: Panel | null = null;

  constructor(
    private rect: Rect,
    interaction: InteractionSystem,
    private readonly text: string
  ) {
    this.background = new Panel(rect, { fill: theme.panelSubtle.hex, radius: 5, z: hudZ.control });
    this.background.root.visible = false;
    this.root.add(this.background.root);

    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.root.add(this.hitArea);

    this.unregister = interaction.register(this.hitArea, {
      onHover: () => this.setHovered(true),
      onLeave: () => this.setHovered(false)
    });

    this.renderGlyph();
    this.applyRect();
  }

  private setHovered(hovered: boolean) {
    this.background.root.visible = hovered;
    if (hovered) this.showTooltip();
    else this.hideTooltip();
  }

  private renderGlyph() {
    if (this.glyph) {
      this.root.remove(this.glyph);
      this.glyph.material.dispose();
    }
    const rasterized = rasterizeText("?", { size: 10, color: theme.textMutedAlt.css, weight: "700" });
    const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
    const mesh = new THREE.Mesh(unitPlane, material);
    mesh.scale.set(rasterized.width, rasterized.height, 1);
    this.root.add(mesh);
    this.glyph = mesh;
  }

  private applyRect() {
    const cx = this.rect.x + this.rect.width / 2;
    const cy = this.rect.y + this.rect.height / 2;
    this.hitArea.position.set(cx, cy, hudZ.control + 0.01);
    this.hitArea.scale.set(this.rect.width, this.rect.height, 1);
    this.background.setRect(this.rect);
    this.glyph?.position.set(cx, cy, hudZ.glyph);
  }

  private showTooltip() {
    this.hideTooltip();

    const rasterized = rasterizeText(this.text, { size: 11, color: theme.white.css, weight: "600" });
    const width = rasterized.width + TOOLTIP_PADDING_X * 2;
    const tooltipRect: Rect = {
      x: this.rect.x,
      y: this.rect.y - TOOLTIP_HEIGHT - TOOLTIP_GAP,
      width,
      height: TOOLTIP_HEIGHT
    };

    const group = new THREE.Group();
    group.position.z = hudZ.tooltip;

    const panel = new Panel(tooltipRect, { fill: theme.text.hex, radius: 6, shadow: "md", z: 0 });
    group.add(panel.root);

    const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
    const mesh = new THREE.Mesh(unitPlane, material);
    mesh.scale.set(rasterized.width, rasterized.height, 1);
    mesh.position.set(tooltipRect.x + width / 2, tooltipRect.y + TOOLTIP_HEIGHT / 2, 0.01);
    group.add(mesh);

    this.root.add(group);
    this.tooltip = group;
    this.tooltipPanel = panel;
  }

  private hideTooltip() {
    if (!this.tooltip) return;
    this.root.remove(this.tooltip);
    this.tooltipPanel?.dispose();
    this.tooltip = null;
    this.tooltipPanel = null;
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.applyRect();
    if (this.tooltip) this.showTooltip();
  }

  dispose() {
    this.unregister();
    this.background.dispose();
    this.glyph?.material.dispose();
    this.hideTooltip();
  }
}
