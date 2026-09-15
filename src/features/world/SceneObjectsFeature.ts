import * as THREE from "three";
import { theme } from "../../app/theme";
import type { AssetManager } from "../../engine/AssetManager";
import type { InteractionEvent, InteractionSystem } from "../../engine/InteractionSystem";
import type { AssetCatalogEntry } from "../../editor-core/assets";
import type { Scene as EditorScene, SceneObject, Vector3Data } from "../../editor-core/scene";
import { GHOST_OPACITY } from "./PlacementGhost";
import { ObjectTransformControls } from "./ObjectTransformControls";
import {
  type DirectObjectTransformMode,
  hasTransformChanged,
  moveOnGround,
  rotateFromHorizontalDrag,
  scaleFromGroundHandle,
  transformModeForPointerButton
} from "./objectTransform";
import { disposeObject } from "./disposeObject";
import { centerGroundFootprintOnOrigin, scaleToFitGridCell } from "./placementSizing";
import { worldSceneConfig } from "./world.config";

export interface SceneObjectsCallbacks {
  getGroundPoint(x: number, y: number): Vector3Data | null;
  onObjectPointerDown(objectId: string): boolean;
  onObjectPointerMove(objectId: string, event: InteractionEvent): void;
  onObjectPointerUp(objectId: string, event: InteractionEvent): void;
  onObjectClick(objectId: string): void;
  onTransformPreview(
    objectId: string,
    mode: TransformMode,
    patch: Partial<Pick<SceneObject, "position" | "rotationY" | "scale">>
  ): Partial<Pick<SceneObject, "position" | "rotationY" | "scale">>;
  onTransformCommit(objectId: string, patch: Partial<Pick<SceneObject, "position" | "rotationY" | "scale">>): void;
  onTransformStart(): void;
  onTransformEnd(): void;
  setCursor(cursor: string): void;
}

export type TransformMode = DirectObjectTransformMode | "scale";

interface ActiveTransform {
  readonly objectId: string;
  readonly mode: TransformMode;
  readonly startObject: SceneObject;
  readonly startScreenX: number;
  readonly startPointer: Vector3Data;
  readonly center: Vector3Data;
  changed: boolean;
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
  private readonly originalMaterialsById = new Map<string, Map<THREE.Mesh, THREE.Material | THREE.Material[]>>();
  private readonly objectsById = new Map<string, SceneObject>();
  private readonly ghostMaterial = new THREE.MeshStandardMaterial({
    color: theme.placementGhost.hex,
    transparent: true,
    opacity: GHOST_OPACITY
  });
  private selectionControls: ObjectTransformControls | null = null;
  private hoverHelper: THREE.Box3Helper | null = null;
  private hoverObjectId: string | null = null;
  private selectedObjectId: string | null = null;
  private activeTransform: ActiveTransform | null = null;
  private syncVersion = 0;

  constructor(
    private readonly assetManager: AssetManager,
    private readonly interaction: InteractionSystem,
    private readonly callbacks: SceneObjectsCallbacks
  ) {}

  setVisible(visible: boolean) {
    this.root.visible = visible;
  }

  getObjectBox(objectId: string): THREE.Box3 | null {
    const instance = this.meshesById.get(objectId);
    if (!instance) return null;
    instance.updateWorldMatrix(true, false);
    return new THREE.Box3().setFromObject(instance);
  }

  getObjectScaleToFitGridCell(objectId: string, cellSize: number): number | null {
    const instance = this.meshesById.get(objectId);
    if (!instance) return null;

    const previousScale = instance.scale.clone();
    instance.scale.setScalar(1);
    const cellFitScale = scaleToFitGridCell(instance, cellSize);
    instance.scale.copy(previousScale);
    instance.updateWorldMatrix(true, true);
    return cellFitScale;
  }

  async sync(
    scene: EditorScene,
    assets: AssetCatalogEntry[],
    selectedObjectId: string | null,
    hiddenObjectIds: ReadonlySet<string>
  ) {
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
      centerGroundFootprintOnOrigin(instance);
      instance.position.set(object.position.x, object.position.y, object.position.z);
      instance.rotation.y = object.rotationY;
      instance.scale.setScalar(object.scale);
      this.root.add(instance);
      this.objectsById.set(object.id, object);
      this.meshesById.set(object.id, instance);
      this.originalMaterialsById.set(object.id, captureMaterials(instance));
      const unregister = this.interaction.register(instance, {
        onPointerDown: (event) => this.startObjectMove(object.id, event),
        onPointerMove: (event) => this.handleObjectPointerMove(object.id, event),
        onPointerUp: (event) => this.handleObjectPointerUp(object.id, event),
        onClick: () => this.callbacks.onObjectClick(object.id),
        onHover: () => this.setHovered(object.id),
        onLeave: () => this.clearHovered(object.id)
      });
      this.unregisterByRoot.set(instance, unregister);
    }

    this.applyHiddenState(hiddenObjectIds);
    this.setSelected(selectedObjectId);
  }

  /**
   * Applies the editor-only "hidden for viewing" toggle — never removes objects from the scene data.
   * A hidden object stays in place as a translucent ghost silhouette (matching the placement ghost's
   * look) rather than disappearing, so its position stays visible while viewing is decluttered.
   */
  applyHiddenState(hiddenObjectIds: ReadonlySet<string>) {
    for (const [objectId, instance] of this.meshesById) {
      const hidden = hiddenObjectIds.has(objectId);
      const originalMaterials = this.originalMaterialsById.get(objectId);
      instance.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (hidden) {
          child.material = this.ghostMaterial;
          return;
        }
        const original = originalMaterials?.get(child);
        if (original) child.material = original;
      });
    }
  }

  /** Marks an object selected with a bounding-box outline — the real mesh materials are left untouched. */
  setSelected(selectedObjectId: string | null) {
    this.selectedObjectId = selectedObjectId;
    this.clearSelectionControls();

    if (!selectedObjectId) return;
    const instance = this.meshesById.get(selectedObjectId);
    if (!instance) return;
    instance.updateWorldMatrix(true, false);
    this.selectionControls = new ObjectTransformControls(new THREE.Box3().setFromObject(instance), this.interaction, {
      onPointerDown: (mode, event) => this.startHandleTransform(mode, event),
      onPointerMove: (event) => this.updateTransform(event),
      onPointerUp: (event) => this.finishTransform(event),
      onResizeHover: (cursor) => {
        if (!this.activeTransform) this.callbacks.setCursor(cursor);
      }
    });
    this.root.add(this.selectionControls.root);
  }

  private setHovered(objectId: string) {
    if (this.activeTransform || this.hoverObjectId === objectId || objectId === this.selectedObjectId) return;
    this.clearHoverHelper();
    const instance = this.meshesById.get(objectId);
    if (!instance) return;
    instance.updateWorldMatrix(true, false);
    const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(instance), theme.assetPlaceholderTemporary.hex);
    this.root.add(helper);
    this.hoverHelper = helper;
    this.hoverObjectId = objectId;
  }

  private clearHovered(objectId: string) {
    if (this.hoverObjectId === objectId) this.clearHoverHelper();
  }

  private clearHoverHelper() {
    if (!this.hoverHelper) return;
    this.root.remove(this.hoverHelper);
    disposeObject(this.hoverHelper);
    this.hoverHelper = null;
    this.hoverObjectId = null;
  }

  private clearSelectionControls() {
    if (!this.selectionControls) return;
    this.root.remove(this.selectionControls.root);
    this.selectionControls.dispose();
    this.selectionControls = null;
  }

  private startObjectMove(objectId: string, event: { x: number; y: number; button: number }) {
    if (!this.callbacks.onObjectPointerDown(objectId)) return;
    const mode = transformModeForPointerButton(event.button);
    if (!mode) return;
    this.beginTransform(objectId, mode, event);
  }

  private handleObjectPointerMove(objectId: string, event: InteractionEvent) {
    if (this.activeTransform) {
      this.updateTransform(event);
      return;
    }
    this.callbacks.onObjectPointerMove(objectId, event);
  }

  private handleObjectPointerUp(objectId: string, event: InteractionEvent) {
    if (this.activeTransform) {
      this.finishTransform(event);
      return;
    }
    this.callbacks.onObjectPointerUp(objectId, event);
  }

  private startHandleTransform(mode: Exclude<TransformMode, "move">, event: { x: number; y: number }) {
    if (!this.selectedObjectId) return;
    this.beginTransform(this.selectedObjectId, mode, event);
  }

  private beginTransform(objectId: string, mode: TransformMode, event: { x: number; y: number }) {
    const object = this.objectsById.get(objectId);
    const point = this.callbacks.getGroundPoint(event.x, event.y);
    const instance = this.meshesById.get(objectId);
    if (!object || !point || !instance) return;

    this.clearHoverHelper();
    this.activeTransform = {
      objectId,
      mode,
      startObject: cloneSceneObject(object),
      startScreenX: event.x,
      startPointer: point,
      center: { x: instance.position.x, y: 0, z: instance.position.z },
      changed: false
    };
    this.callbacks.onTransformStart();
    this.callbacks.setCursor(mode === "scale" ? "ew-resize" : "grabbing");
  }

  private updateTransform(event: { x: number; y: number }) {
    if (!this.activeTransform) return;

    const { objectId, mode, startObject, startScreenX, startPointer, center } = this.activeTransform;
    const instance = this.meshesById.get(objectId);
    if (!instance) return;

    let current = {
      position: { x: instance.position.x, y: instance.position.y, z: instance.position.z },
      rotationY: instance.rotation.y,
      scale: instance.scale.x
    };

    if (mode === "move") {
      const point = this.callbacks.getGroundPoint(event.x, event.y);
      if (!point) return;
      const patch = this.callbacks.onTransformPreview(objectId, mode, {
        position: moveOnGround(startObject.position, startPointer, point)
      });
      const position = patch.position ?? startObject.position;
      instance.position.set(position.x, position.y, position.z);
      current = { ...current, position };
    } else if (mode === "scale") {
      const point = this.callbacks.getGroundPoint(event.x, event.y);
      if (!point) return;
      const patch = this.callbacks.onTransformPreview(objectId, mode, {
        scale: scaleFromGroundHandle(startObject.scale, center, startPointer, point)
      });
      const scale = patch.scale ?? startObject.scale;
      const position = patch.position ?? startObject.position;
      instance.scale.setScalar(scale);
      instance.position.set(position.x, position.y, position.z);
      current = { ...current, position, scale };
    } else {
      const patch = this.callbacks.onTransformPreview(objectId, mode, {
        rotationY: rotateFromHorizontalDrag(startObject.rotationY, startScreenX, event.x)
      });
      const rotationY = patch.rotationY ?? startObject.rotationY;
      instance.rotation.y = rotationY;
      current = { ...current, rotationY };
    }

    if (hasTransformChanged(startObject, current)) this.activeTransform.changed = true;
    this.refreshSelectionControlsFor(objectId);
  }

  private finishTransform(event: { x: number; y: number }) {
    if (!this.activeTransform) return;
    this.updateTransform(event);

    const { objectId, changed } = this.activeTransform;
    const instance = this.meshesById.get(objectId);
    this.activeTransform = null;
    this.callbacks.onTransformEnd();
    this.callbacks.setCursor("default");

    if (!changed || !instance) return;
    this.callbacks.onTransformCommit(objectId, {
      position: { x: instance.position.x, y: instance.position.y, z: instance.position.z },
      rotationY: instance.rotation.y,
      scale: instance.scale.x
    });
  }

  private refreshSelectionControlsFor(objectId: string) {
    if (this.selectedObjectId !== objectId) return;
    const instance = this.meshesById.get(objectId);
    if (!instance) return;
    instance.updateWorldMatrix(true, false);
    this.selectionControls?.setBox(new THREE.Box3().setFromObject(instance));
  }

  private clearInstances() {
    for (const unregister of this.unregisterByRoot.values()) unregister();
    this.unregisterByRoot.clear();
    this.meshesById.clear();
    this.objectsById.clear();
    this.originalMaterialsById.clear();
    this.activeTransform = null;
    this.clearHoverHelper();
    this.clearSelectionControls();
    this.callbacks.setCursor("default");
    this.root.clear();
  }

  dispose() {
    this.clearInstances();
    this.ghostMaterial.dispose();
  }
}

function createFallbackMesh() {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: worldSceneConfig.fallbackObjectColor, roughness: 0.6 })
  );
}

function captureMaterials(instance: THREE.Object3D): Map<THREE.Mesh, THREE.Material | THREE.Material[]> {
  const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  instance.traverse((child) => {
    if (child instanceof THREE.Mesh) materials.set(child, child.material);
  });
  return materials;
}

function cloneSceneObject(object: SceneObject): SceneObject {
  return { ...object, position: { ...object.position } };
}
