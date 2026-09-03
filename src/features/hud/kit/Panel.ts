import * as THREE from "three";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
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
  z?: number;
}

/** A flat rectangular background, with an optional 1px-style border drawn as four thin quads. */
export class Panel {
  readonly root = new THREE.Group();
  private readonly background: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly borderMeshes: THREE.Mesh[] = [];
  private rect: Rect;
  private readonly options: PanelOptions;

  constructor(rect: Rect, options: PanelOptions = {}) {
    this.rect = rect;
    this.options = options;
    const material = hudBasicMaterial({
      color: options.fill ?? 0xffffff,
      transparent: options.fillOpacity !== undefined,
      opacity: options.fillOpacity ?? 1
    });
    this.background = new THREE.Mesh(unitPlane, material);
    this.background.position.z = options.z ?? hudZ.panel;
    this.root.add(this.background);
    if (options.border !== undefined) this.buildBorder();
    this.setRect(rect);
  }

  private buildBorder() {
    const material = hudBasicMaterial({ color: this.options.border });
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(unitPlane, material);
      mesh.position.z = (this.options.z ?? hudZ.panel) + 0.001;
      this.root.add(mesh);
      this.borderMeshes.push(mesh);
    }
    this.layoutBorder();
  }

  private layoutBorder() {
    const { width, height } = this.rect;
    const w = this.options.borderWidth ?? 1;
    const [top, bottom, left, right] = this.borderMeshes;
    top?.scale.set(width, w, 1);
    top?.position.set(0, height / 2 - w / 2, top.position.z);
    bottom?.scale.set(width, w, 1);
    bottom?.position.set(0, -height / 2 + w / 2, bottom.position.z);
    left?.scale.set(w, height, 1);
    left?.position.set(-width / 2 + w / 2, 0, left.position.z);
    right?.scale.set(w, height, 1);
    right?.position.set(width / 2 - w / 2, 0, right.position.z);
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.background.scale.set(Math.max(rect.width, 0.001), Math.max(rect.height, 0.001), 1);
    this.root.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, 0);
    if (this.borderMeshes.length) this.layoutBorder();
  }

  setFill(color: number) {
    this.background.material.color.setHex(color);
  }

  setBorder(color: number) {
    for (const mesh of this.borderMeshes) {
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
  }

  getRect(): Rect {
    return this.rect;
  }

  dispose() {
    this.background.material.dispose();
    (this.borderMeshes[0]?.material as THREE.Material | undefined)?.dispose();
  }
}
