import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { EnvironmentManifest, EnvironmentManifestCell, EnvironmentManifestObject, WorldBounds } from "../../environment/types";

const loader = new GLTFLoader();

/**
 * Loads an imported environment package under its own root, with no interaction registration —
 * matching how gridHelper is already excluded from selection today, this class simply never calls
 * InteractionSystem.register() on anything it owns. Exposes read-only spatial/semantic queries over
 * the manifest for placement snapping and future consumers, per the design's locked-environment contract.
 */
export class LockedEnvironmentFeature {
  readonly root = new THREE.Group();
  private manifest: EnvironmentManifest | null = null;
  private loadToken = 0;
  private loadedModel: THREE.Object3D | null = null;

  async load(manifestJson: string, glb: ArrayBuffer): Promise<void> {
    const token = ++this.loadToken;
    const manifest = JSON.parse(manifestJson) as EnvironmentManifest;
    const gltf = await loader.parseAsync(glb, "");
    if (token !== this.loadToken) return;

    this.clear();
    this.manifest = manifest;
    this.loadedModel = gltf.scene;
    this.root.add(this.loadedModel);
  }

  clear(): void {
    this.loadToken += 1;
    this.manifest = null;
    if (this.loadedModel) {
      this.root.remove(this.loadedModel);
      this.loadedModel = null;
    }
  }

  get hasGround(): boolean {
    return this.manifest?.ground != null;
  }

  cellAt(x: number, z: number): EnvironmentManifestCell | null {
    if (!this.manifest) return null;
    const column = Math.floor((x - this.manifest.grid.origin.x) / this.manifest.grid.cellSize);
    const row = Math.floor((z - this.manifest.grid.origin.z) / this.manifest.grid.cellSize);
    return this.manifest.cells.find((cell) => cell.column === column && cell.row === row) ?? null;
  }

  objectsInBounds(bounds: WorldBounds): EnvironmentManifestObject[] {
    if (!this.manifest) return [];
    return this.manifest.objects.filter((object) => boundsIntersect(object.bounds, bounds));
  }

  dispose(): void {
    this.clear();
  }
}

function boundsIntersect(a: WorldBounds, b: WorldBounds): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
}
