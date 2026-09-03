import * as THREE from "three";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { rasterizePanel, type PanelCornerRadius, type PanelShadowLevel } from "./panelTexture";
import { hudZ } from "./zIndex";

/** Every HUD rect is a unit quad scaled per-instance — one shared geometry, never disposed (module-lifetime resource). */
export const unitPlane = createHudUnitPlane();

function createHudUnitPlane() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const index = geometry.index;
  if (!index) return geometry;

  const reversed: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    reversed.push(index.getX(i), index.getX(i + 2), index.getX(i + 1));
  }
  geometry.setIndex(reversed);
  return geometry;
}

export interface PanelOptions {
  fill?: number;
  fillOpacity?: number;
  border?: number;
  borderWidth?: number;
  /** Corner radius in px, uniform or per-corner. Defaults to the kit's standard radius; pass 0 to square it off. */
  radius?: number | PanelCornerRadius;
  /** Drop shadow baked into the panel texture, for floating chrome (the dock, popovers) or hover lift. */
  shadow?: PanelShadowLevel;
  z?: number;
}

/** A rounded rectangular background (fill + optional border + optional drop shadow), the base look every HUD widget shares. */
export class Panel {
  readonly root = new THREE.Group();
  private readonly background: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private rect: Rect;
  private readonly z: number;
  private fill: number;
  private fillOpacity?: number;
  private border?: number;
  private readonly borderWidth: number;
  private readonly radius?: number | PanelCornerRadius;
  private shadow: PanelShadowLevel;
  private padding = 0;

  constructor(rect: Rect, options: PanelOptions = {}) {
    this.rect = rect;
    this.z = options.z ?? hudZ.panel;
    this.fill = options.fill ?? 0xffffff;
    this.fillOpacity = options.fillOpacity;
    this.border = options.border;
    this.borderWidth = options.borderWidth ?? 1;
    this.radius = options.radius;
    this.shadow = options.shadow ?? "none";

    this.background = new THREE.Mesh(unitPlane, hudBasicMaterial({ transparent: true }));
    this.background.position.z = this.z;
    this.root.add(this.background);
    this.redraw();
  }

  private redraw() {
    const rasterized = rasterizePanel({
      width: this.rect.width,
      height: this.rect.height,
      radius: this.radius,
      fill: this.fill,
      fillOpacity: this.fillOpacity,
      border: this.border,
      borderWidth: this.borderWidth,
      shadow: this.shadow
    });
    this.background.material.map = rasterized.texture;
    this.background.material.needsUpdate = true;
    this.padding = rasterized.padding;
    this.applyTransform();
  }

  private applyTransform() {
    const pad = this.padding;
    this.background.scale.set(Math.max(this.rect.width + pad * 2, 0.001), Math.max(this.rect.height + pad * 2, 0.001), 1);
    this.root.position.set(this.rect.x + this.rect.width / 2, this.rect.y + this.rect.height / 2, 0);
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.redraw();
  }

  setFill(color: number) {
    if (this.fill === color) return;
    this.fill = color;
    this.redraw();
  }

  setBorder(color: number) {
    if (this.border === color) return;
    this.border = color;
    this.redraw();
  }

  /** Swaps the elevation level (e.g. a subtle lift on hover) without touching fill/border. */
  setShadow(level: PanelShadowLevel) {
    if (this.shadow === level) return;
    this.shadow = level;
    this.redraw();
  }

  getRect(): Rect {
    return this.rect;
  }

  dispose() {
    // The texture is a module-level cache entry shared across panels with matching params — only the
    // per-instance material (and its map reference) belongs to this Panel.
    this.background.material.dispose();
  }
}

export type { PanelCornerRadius, PanelShadowLevel };
