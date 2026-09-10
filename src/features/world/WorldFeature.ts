import * as THREE from "three";
import { worldConfig } from "../../app/config";
import type { AssetManager } from "../../engine/AssetManager";
import type { InteractionSystem, RaycastLayer } from "../../engine/InteractionSystem";
import { CameraRig } from "../../engine/CameraRig";
import type { ViewportSize } from "../../engine/Viewport";
import { resolveGroundPosition } from "../../editor-core/grid";
import type { GridDefinition, SceneObject } from "../../editor-core/scene";
import type { EditorState } from "../../state/EditorState";
import { createGround, disposeGround, type GroundMesh } from "./Ground";
import { applyGridVisibilityColors, gridColorsForGroundColor } from "./gridVisibility";
import { PlacementGhost } from "./PlacementGhost";
import { centerGroundFootprintOnOrigin, scaleToFitGridCell } from "./placementSizing";
import { SceneObjectsFeature, type TransformMode } from "./SceneObjectsFeature";
import { WfcPreviewFeature } from "./WfcPreviewFeature";
import { snapTransformPatchForInspection } from "./transformSnap";
import { shouldClearSelectionOnGroundClick } from "./worldInteraction";
import { worldSceneConfig } from "./world.config";

/** World units per repeat of a ground texture tile, so a picked image doesn't stretch across the whole plane. */
const GROUND_TEXTURE_TILE_SIZE = 4;

/**
 * The 3D ground-plane viewport: camera, lights, ground/grid, placed objects, and placement ghost.
 * A top-level composite — it owns its own Scene+Camera directly (rendered straight by Renderer),
 * unlike a sub-feature that exposes a `root` to be added into a parent scene.
 */
export class WorldFeature {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private readonly cameraRig: CameraRig;
  private ground: GroundMesh;
  private gridHelper: THREE.GridHelper;
  private lastGrid: GridDefinition;
  private readonly ghost: PlacementGhost;
  private readonly objects: SceneObjectsFeature;
  private readonly wfcPreview: WfcPreviewFeature;
  private readonly unsubscribers: Array<() => void> = [];
  private unregisterGround: (() => void) | null = null;
  private ghostAssetToken = 0;
  private previewSyncQueued = false;
  private readonly textureLoader = new THREE.TextureLoader();
  private backgroundTexture: THREE.Texture | null = null;
  private backgroundToken = 0;
  private groundTexture: THREE.Texture | null = null;
  private groundToken = 0;
  private placementScale = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assetManager: AssetManager,
    private readonly interaction: InteractionSystem,
    private readonly state: EditorState
  ) {
    this.camera = new THREE.PerspectiveCamera(worldConfig.cameraFov, 1, worldConfig.cameraNear, worldConfig.cameraFar);
    this.camera.position.set(worldConfig.cameraPosition.x, worldConfig.cameraPosition.y, worldConfig.cameraPosition.z);
    this.camera.lookAt(0, 0, 0);

    this.cameraRig = new CameraRig(this.camera, canvas, worldConfig.maxPolarAngle);

    this.scene.add(new THREE.HemisphereLight(worldSceneConfig.hemisphereLightSky, worldSceneConfig.hemisphereLightGround, worldSceneConfig.hemisphereLightIntensity));
    const sun = new THREE.DirectionalLight(worldSceneConfig.sunColor, worldSceneConfig.sunIntensity);
    sun.position.set(worldSceneConfig.sunPosition.x, worldSceneConfig.sunPosition.y, worldSceneConfig.sunPosition.z);
    this.scene.add(sun);

    const grid = state.scene?.grid ?? { cellSize: 1, width: 10, depth: 10 };
    const { grid: gridHelper, ground } = createGround(grid.width, grid.depth, grid.cellSize);
    this.ground = ground;
    this.gridHelper = gridHelper;
    this.lastGrid = { ...grid };
    this.scene.add(gridHelper, ground);

    this.ghost = new PlacementGhost();
    this.scene.add(this.ghost.root);

    this.objects = new SceneObjectsFeature(assetManager, interaction, {
      getGroundPoint: (x, y) => this.interaction.raycastAgainst(x, y, this.ground, this.camera),
      onObjectPointerDown: (objectId) => this.handleObjectPointerDown(objectId),
      onObjectPointerMove: (objectId, event) => this.handleObjectPlacementPointerMove(objectId, event.point ?? null),
      onObjectPointerUp: (objectId, event) => this.handleObjectPlacementPointerUp(objectId, event.point ?? null),
      onObjectClick: (objectId) => this.handleObjectClick(objectId),
      onTransformPreview: (objectId, mode, patch) => this.snapTransformPatch(objectId, mode, patch),
      onTransformCommit: (objectId, patch) => this.commitObjectTransform(objectId, patch),
      onTransformStart: () => this.cameraRig.setEnabled(false),
      onTransformEnd: () => this.cameraRig.setEnabled(true),
      setCursor: (cursor) => {
        this.canvas.style.cursor = cursor;
      }
    });
    this.scene.add(this.objects.root);
    this.wfcPreview = new WfcPreviewFeature(assetManager);
    this.scene.add(this.wfcPreview.root);

    this.registerGroundInteraction();
    this.applyBackground();
    this.applyGround();

    this.unsubscribers.push(
      state.on("scene", () => this.resync()),
      state.on("wfcProgress", () => this.schedulePreviewSync()),
      state.on("assets", () => this.resync()),
      state.on("selection", () => this.objects.setSelected(state.selectedObjectId)),
      state.on("objectsVisible", () => this.objects.setVisible(state.objectsVisible)),
      state.on("objectVisibility", () => this.objects.applyHiddenState(state.hiddenObjectIds)),
      state.on("placement", () => this.syncGhostAsset()),
      state.on("sceneBackground", () => this.applyBackground()),
      state.on("sceneGround", () => this.applyGround()),
      state.on("sceneGrid", () => {
        this.syncGrid();
        void this.syncGhostAsset();
      })
    );

    this.resync();
  }

  get raycastLayer(): RaycastLayer {
    return { scene: this.scene, camera: this.camera };
  }

  resetView() {
    this.cameraRig.resetView();
  }

  zoom(deltaY: number) {
    this.cameraRig.zoom(deltaY);
  }

  setCameraControlsEnabled(enabled: boolean) {
    this.cameraRig.setEnabled(enabled);
  }

  private resync() {
    if (!this.state.scene) return;
    this.syncSceneObjects();
    this.applyBackground();
    this.applyGround();
    this.syncGrid();
  }

  private schedulePreviewSync() {
    if (this.previewSyncQueued) return;
    this.previewSyncQueued = true;
    requestAnimationFrame(() => {
      this.previewSyncQueued = false;
      this.wfcPreview.sync(this.state.wfcPreviewObjects, this.state.assets);
    });
  }

  private syncSceneObjects() {
    if (!this.state.scene) return;
    void this.objects.sync(this.state.scene, this.state.assets, this.state.selectedObjectId, this.state.hiddenObjectIds);
    this.wfcPreview.sync(this.state.wfcPreviewObjects, this.state.assets);
  }

  private registerGroundInteraction() {
    this.unregisterGround = this.interaction.register(this.ground, {
      onPointerMove: (event) => this.updateGhost(event.point ?? null),
      onPointerUp: (event) => this.handleGroundPointerUp(event.point ?? null)
    });
  }

  private handleGroundPointerUp(point: THREE.Vector3 | null) {
    if (
      shouldClearSelectionOnGroundClick({
        activeTool: this.state.activeTool,
        placementAssetId: this.state.placementAssetId,
        hasGroundPoint: Boolean(point)
      })
    ) {
      this.state.selectObject(null);
      return;
    }

    void this.tryPlace(point ? this.resolvePlacementPosition(point, 0) : null);
  }

  private handleObjectPointerDown(objectId: string): boolean {
    if (this.state.activeTool !== "select" || this.state.placementAssetId) {
      if (!this.state.placementAssetId) this.state.selectObject(objectId);
      return false;
    }

    this.state.selectObject(objectId);
    return true;
  }

  private handleObjectClick(objectId: string) {
    if (this.state.placementAssetId) return;
    this.state.selectObject(objectId);
  }

  private handleObjectPlacementPointerMove(objectId: string, point: THREE.Vector3 | null) {
    if (!this.state.placementAssetId) return;
    const position = this.resolveObjectPlacementPosition(objectId, point);
    this.updateGhostAtPosition(position);
  }

  private handleObjectPlacementPointerUp(objectId: string, point: THREE.Vector3 | null) {
    if (!this.state.placementAssetId) return;
    void this.tryPlace(this.resolveObjectPlacementPosition(objectId, point));
  }

  private commitObjectTransform(
    objectId: string,
    patch: Partial<Pick<SceneObject, "position" | "rotationY" | "scale">>
  ) {
    if (this.state.selectedObjectId !== objectId) this.state.selectObject(objectId);
    this.state.updateSelectedObject(patch);
  }

  private syncGrid() {
    const grid = this.state.scene?.grid;
    if (!grid) return;
    if (grid.cellSize === this.lastGrid.cellSize && grid.width === this.lastGrid.width && grid.depth === this.lastGrid.depth) {
      return;
    }
    this.rebuildGround(grid);
  }

  private rebuildGround(grid: GridDefinition) {
    this.unregisterGround?.();
    this.scene.remove(this.gridHelper, this.ground);
    disposeGround(this.gridHelper, this.ground);

    const { grid: gridHelper, ground } = createGround(grid.width, grid.depth, grid.cellSize);
    this.gridHelper = gridHelper;
    this.ground = ground;
    this.lastGrid = { ...grid };
    this.scene.add(gridHelper, ground);
    this.registerGroundInteraction();
    this.applyGround();
  }

  /** Applies the scene's configured background: a flat color, or a loaded image for the "texture" type. */
  private applyBackground() {
    const background = this.state.scene?.background;
    if (!background) return;
    const token = ++this.backgroundToken;

    if (background.type === "color" || !background.textureUrl) {
      this.disposeBackgroundTexture();
      this.scene.background = new THREE.Color(background.color);
      return;
    }

    this.textureLoader.load(background.textureUrl, (texture) => {
      if (token !== this.backgroundToken) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      this.disposeBackgroundTexture();
      this.backgroundTexture = texture;
      this.scene.background = texture;
    });
  }

  private disposeBackgroundTexture() {
    this.backgroundTexture?.dispose();
    this.backgroundTexture = null;
  }

  /** Applies the scene's configured ground surface: a flat color, or a tiled image for the "texture" type. */
  private applyGround() {
    const ground = this.state.scene?.ground;
    if (!ground) return;
    const token = ++this.groundToken;
    const material = this.ground.material;
    applyGridVisibilityColors(this.gridHelper, gridColorsForGroundColor(ground.color));

    if (ground.type === "color" || !ground.textureUrl) {
      this.disposeGroundTexture();
      material.map = null;
      material.color.set(ground.color);
      material.needsUpdate = true;
      return;
    }

    this.textureLoader.load(ground.textureUrl, (texture) => {
      if (token !== this.groundToken) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      const grid = this.state.scene?.grid;
      texture.repeat.set(
        Math.max((grid?.width ?? GROUND_TEXTURE_TILE_SIZE) / GROUND_TEXTURE_TILE_SIZE, 1),
        Math.max((grid?.depth ?? GROUND_TEXTURE_TILE_SIZE) / GROUND_TEXTURE_TILE_SIZE, 1)
      );
      this.disposeGroundTexture();
      this.groundTexture = texture;
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    });
  }

  private disposeGroundTexture() {
    this.groundTexture?.dispose();
    this.groundTexture = null;
  }

  private async syncGhostAsset() {
    const assetId = this.state.placementAssetId;
    const token = ++this.ghostAssetToken;
    if (!assetId) {
      this.ghost.visible = false;
      this.ghost.setAsset(null);
      this.ghost.setScale(1);
      this.placementScale = 1;
      return;
    }
    const asset = this.state.assets.find((entry) => entry.id === assetId);
    const instance = asset ? await this.assetManager.instantiate(asset) : null;
    if (token !== this.ghostAssetToken || this.state.placementAssetId !== assetId) return;
    if (instance) centerGroundFootprintOnOrigin(instance);
    this.placementScale =
      instance && this.state.scene && this.state.placementResolution === "snap" ? scaleToFitGridCell(instance, this.state.scene.grid.cellSize) : 1;
    this.ghost.setAsset(instance);
    this.ghost.setScale(this.placementScale);
  }

  private updateGhost(point: THREE.Vector3 | null) {
    if (!point || !this.state.scene || !this.state.placementAssetId) {
      this.ghost.visible = false;
      return;
    }
    this.updateGhostAtPosition(this.resolvePlacementPosition(point, 0));
  }

  private updateGhostAtPosition(position: SceneObject["position"] | null) {
    if (!position || !this.state.scene || !this.state.placementAssetId) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.setPosition(position.x, position.z, position.y);
    this.ghost.visible = true;
  }

  private async tryPlace(position: SceneObject["position"] | null) {
    if (!position || !this.state.scene || !this.state.placementAssetId) return;
    const assetId = this.state.placementAssetId;
    const scale = await this.resolvePlacementScale(assetId);
    if (this.state.placementAssetId !== assetId) return;
    this.state.placeAsset(assetId, position, { scale });
    this.ghost.visible = false;
  }

  private resolveObjectPlacementPosition(objectId: string, point: THREE.Vector3 | null): SceneObject["position"] | null {
    if (!point) return null;
    const box = this.objects.getObjectBox(objectId);
    if (!box) return this.resolvePlacementPosition(point, 0);
    if (this.state.placementResolution === "free") return this.resolvePlacementPosition(point, box.max.y);

    const groundPosition = this.resolvePlacementPosition(point, 0);
    if (!groundPosition) return null;
    return boxContainsGroundPosition(box, groundPosition) ? { ...groundPosition, y: box.max.y } : groundPosition;
  }

  private resolvePlacementPosition(point: THREE.Vector3, y: number): SceneObject["position"] | null {
    if (!this.state.scene) return null;
    return resolveGroundPosition(point, this.state.placementResolution, this.state.scene.grid, y);
  }

  private async resolvePlacementScale(assetId: string): Promise<number> {
    if (!this.state.scene || this.state.placementResolution === "free") return 1;
    const asset = this.state.assets.find((entry) => entry.id === assetId);
    const instance = asset ? await this.assetManager.instantiate(asset) : null;
    return instance ? scaleToFitGridCell(instance, this.state.scene.grid.cellSize) : this.placementScale;
  }

  private snapTransformPatch(objectId: string, mode: TransformMode, patch: Partial<Pick<SceneObject, "position" | "rotationY" | "scale">>) {
    if (!this.state.scene) return patch;
    const object = this.state.scene.objects.find((item) => item.id === objectId);
    const objectScale = object?.scale ?? 1;
    const cellFitScale = this.objects.getObjectScaleToFitGridCell(objectId, this.state.scene.grid.cellSize);
    const snapped = snapTransformPatchForInspection(
      patch,
      this.state.inspectionResolution,
      this.state.scene.grid,
      objectScale,
      cellFitScale ?? 1,
      object?.position
    );
    if (mode !== "move" || this.state.inspectionResolution !== "snap" || !snapped.position) return snapped;

    return {
      ...snapped,
      position: { ...snapped.position, y: this.topSurfaceHeightAt(objectId, snapped.position) ?? 0 }
    };
  }

  private topSurfaceHeightAt(excludedObjectId: string, position: SceneObject["position"]): number | null {
    if (!this.state.scene) return null;
    let top: number | null = null;
    for (const object of this.state.scene.objects) {
      if (object.id === excludedObjectId) continue;
      const box = this.objects.getObjectBox(object.id);
      if (!box || !boxContainsGroundPosition(box, position)) continue;
      top = Math.max(top ?? box.max.y, box.max.y);
    }
    return top;
  }

  async init() {}

  update(_dt: number, _elapsed: number) {
    this.cameraRig.update();
  }

  resize(size: ViewportSize) {
    this.camera.aspect = size.aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unregisterGround?.();
    disposeGround(this.gridHelper, this.ground);
    this.disposeBackgroundTexture();
    this.disposeGroundTexture();
    this.objects.dispose();
    this.wfcPreview.dispose();
    this.ghost.dispose();
    this.cameraRig.dispose();
  }
}

const BOX_FOOTPRINT_EPSILON = 0.0001;

function boxContainsGroundPosition(box: THREE.Box3, position: SceneObject["position"]): boolean {
  return (
    position.x >= box.min.x - BOX_FOOTPRINT_EPSILON &&
    position.x <= box.max.x + BOX_FOOTPRINT_EPSILON &&
    position.z >= box.min.z - BOX_FOOTPRINT_EPSILON &&
    position.z <= box.max.z + BOX_FOOTPRINT_EPSILON
  );
}
