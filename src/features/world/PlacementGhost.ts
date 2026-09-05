import * as THREE from "three";
import { theme } from "../../app/theme";

export const GHOST_OPACITY = 0.4;

/**
 * The translucent silhouette that previews where the asset armed for placement will land.
 * Wraps a cloned instance of that asset (real geometry) with a flat grey/transparent material on
 * every mesh, so the shape actually resembles what will be placed instead of a generic box.
 */
export class PlacementGhost {
  readonly root = new THREE.Group();
  private content: THREE.Object3D | null = null;

  constructor() {
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  set visible(value: boolean) {
    this.root.visible = value;
  }

  setPosition(x: number, z: number) {
    this.root.position.set(x, 0, z);
  }

  setScale(scale: number) {
    this.root.scale.setScalar(Number.isFinite(scale) && scale > 0 ? scale : 1);
  }

  /** Swaps in a cloned asset instance to preview; pass null to clear (e.g. placement cancelled). */
  setAsset(instance: THREE.Object3D | null) {
    this.clearContent();
    if (!instance) return;

    instance.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = new THREE.MeshStandardMaterial({
        color: theme.placementGhost.hex,
        transparent: true,
        opacity: GHOST_OPACITY
      });
    });

    this.root.add(instance);
    this.content = instance;
  }

  dispose() {
    this.clearContent();
  }

  private clearContent() {
    if (!this.content) return;
    this.root.remove(this.content);
    this.content.traverse((child) => {
      if (child instanceof THREE.Mesh) child.material.dispose();
    });
    this.content = null;
  }
}
