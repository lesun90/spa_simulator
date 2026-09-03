import * as THREE from "three";
import { theme } from "../../app/theme";
import type { AssetManager } from "../../engine/AssetManager";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import type { AssetCatalogEntry } from "../../editor-core/assets";
import type { Scene as EditorScene } from "../../editor-core/scene";
import { worldSceneConfig } from "./world.config";

export interface SceneObjectsCallbacks {
  onObjectClick(objectId: string): void;
}

/**
 * Syncs Scene.objects to Three.js instances via the AssetManager. Owns objectsById/meshesById as real
 * application-adjacent state (threejs-design-rule §10) — business ids are captured in registered
 * closures, never stashed in userData.
 */
export class SceneObjectsFeature {
  readonly root = new THREE.Group();

  private readonly meshesById = new Map<string, THREE.Object3D>();
  private readonly unregisterByRoot = new Map<THREE.Object3D, () => void>();
  private selectionHelper: THREE.Box3Helper | null = null;
  private syncVersion = 0;

  constructor(
    private readonly assetManager: AssetManager,
    private readonly interaction: InteractionSystem,
    private readonly callbacks: SceneObjectsCallbacks
  ) {}

  setVisible(visible: boolean) {
    this.root.visible = visible;
  }

  async sync(scene: EditorScene, assets: AssetCatalogEntry[], selectedObjectId: string | null) {
    const version = ++this.syncVersion;
    const catalog = new Map(assets.map((asset) => [asset.id, asset]));

    const instances = await Promise.all(
      scene.objects.map(async (object) => {
        const asset = catalog.get(object.assetId);
        const instance = asset ? await this.assetManager.instantiate(asset) : createFallbackMesh();
        return { object, instance };
      })
    );

    if (version !== this.syncVersion) return;

    this.clearInstances();

    for (const { object, instance } of instances) {
      instance.position.set(object.position.x, object.position.y, object.position.z);
      instance.rotation.y = object.rotationY;
      instance.scale.setScalar(object.scale);
      this.root.add(instance);
      this.meshesById.set(object.id, instance);
      const unregister = this.interaction.register(instance, {
        onClick: () => this.callbacks.onObjectClick(object.id)
      });
      this.unregisterByRoot.set(instance, unregister);
    }

    this.setSelected(selectedObjectId);
  }

  /** Marks an object selected with a bounding-box outline — the real mesh materials are left untouched. */
  setSelected(selectedObjectId: string | null) {
    this.clearSelectionHelper();

    if (!selectedObjectId) return;
    const instance = this.meshesById.get(selectedObjectId);
    if (!instance) return;
    instance.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(instance);
    const helper = new THREE.Box3Helper(box, theme.selectionHighlight.hex);
    this.root.add(helper);
    this.selectionHelper = helper;
  }

  private clearSelectionHelper() {
    if (!this.selectionHelper) return;
    this.root.remove(this.selectionHelper);
    this.selectionHelper.geometry.dispose();
    (this.selectionHelper.material as THREE.Material).dispose();
    this.selectionHelper = null;
  }

  private clearInstances() {
    for (const unregister of this.unregisterByRoot.values()) unregister();
    this.unregisterByRoot.clear();
    this.meshesById.clear();
    this.clearSelectionHelper();
    this.root.clear();
  }

  dispose() {
    this.clearInstances();
  }
}

function createFallbackMesh() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: worldSceneConfig.fallbackObjectColor, roughness: 0.6 })
  );
}
