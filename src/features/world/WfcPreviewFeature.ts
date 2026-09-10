import * as THREE from "three";
import type { AssetCatalogEntry } from "../../editor-core/assets";
import type { SceneObject } from "../../editor-core/scene";
import type { AssetManager } from "../../engine/AssetManager";
import { centerGroundFootprintOnOrigin } from "./placementSizing";

/** Renders transient WFC collapse cells without replacing the persisted scene-object collection. */
export class WfcPreviewFeature {
  readonly root = new THREE.Group();
  private readonly instances = new Map<string, THREE.Object3D>();
  private requestedIds = new Set<string>();

  constructor(private readonly assetManager: AssetManager) {}

  sync(objects: readonly SceneObject[], assets: readonly AssetCatalogEntry[]) {
    this.requestedIds = new Set(objects.map((object) => object.id));
    const catalog = new Map(assets.map((asset) => [asset.id, asset]));

    for (const [id, instance] of this.instances) {
      if (this.requestedIds.has(id)) continue;
      this.instances.delete(id);
      this.root.remove(instance);
    }

    for (const object of objects) {
      const existing = this.instances.get(object.id);
      if (existing) {
        applyTransform(existing, object);
        continue;
      }
      const asset = catalog.get(object.assetId);
      if (!asset) continue;
      void this.assetManager.instantiate(asset).then((instance) => {
        if (!this.requestedIds.has(object.id) || this.instances.has(object.id)) return;
        centerGroundFootprintOnOrigin(instance);
        applyTransform(instance, object);
        this.instances.set(object.id, instance);
        this.root.add(instance);
      });
    }
  }

  dispose() {
    this.instances.clear();
    this.root.clear();
  }
}

function applyTransform(instance: THREE.Object3D, object: SceneObject) {
  instance.position.set(object.position.x, object.position.y, object.position.z);
  instance.rotation.y = object.rotationY;
  instance.scale.setScalar(object.scale);
}
