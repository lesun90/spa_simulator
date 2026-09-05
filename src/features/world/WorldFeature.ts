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
import { PlacementGhost } from "./PlacementGhost";
import { SceneObjectsFeature } from "./SceneObjectsFeature";
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
  private readonly unsubscribers: Array<() => void> = [];
  private unregisterGround: (() => void) | null = null;
  private ghostAssetToken = 0;
  private readonly textureLoader = new THREE.TextureLoader();
  private backgroundTexture: THREE.Texture | null = null;
  private backgroundToken = 0;
  private groundTexture: THREE.Texture | null = null;
  private groundToken = 0;

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

    const grid = state.scene?.grid ?? { cellSize: 1, width: 100, depth: 100 };
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
      onObjectClick: (objectId) => state.selectObject(objectId),
      onTransformCommit: (objectId, patch) => this.commitObjectTransform(objectId, patch),
      onTransformStart: () => this.cameraRig.setEnabled(false),
      onTransformEnd: () => this.cameraRig.setEnabled(true),
      setCursor: (cursor) => {
        this.canvas.style.cursor = cursor;
      }
    });
    this.scene.add(this.objects.root);

    this.registerGroundInteraction();
    this.applyBackground();
    this.applyGround();

    this.unsubscribers.push(
      state.on("scene", () => this.resync()),
      state.on("assets", () => this.resync()),
      state.on("selection", () => this.objects.setSelected(state.selectedObjectId)),
      state.on("objectsVisible", () => this.objects.setVisible(state.objectsVisible)),
      state.on("objectVisibility", () => this.objects.applyHiddenState(state.hiddenObjectIds)),
      state.on("placement", () => this.syncGhostAsset()),
      state.on("sceneBackground", () => this.applyBackground()),
      state.on("sceneGround", () => this.applyGround()),
      state.on("sceneGrid", () => this.syncGrid())
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
    void this.objects.sync(this.state.scene, this.state.assets, this.state.selectedObjectId, this.state.hiddenObjectIds);
    this.applyBackground();
    this.applyGround();
    this.syncGrid();
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

    this.tryPlace(point);
  }

  private handleObjectPointerDown(objectId: string): boolean {
    if (this.state.activeTool !== "select" || this.state.placementAssetId) {
      this.state.selectObject(objectId);
      return false;
    }

    this.state.selectObject(objectId);
    return true;
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
      return;
    }
    const asset = this.state.assets.find((entry) => entry.id === assetId);
    const instance = asset ? await this.assetManager.instantiate(asset) : null;
    if (token !== this.ghostAssetToken || this.state.placementAssetId !== assetId) return;
    this.ghost.setAsset(instance);
  }

  private updateGhost(point: THREE.Vector3 | null) {
    if (!point || !this.state.scene || !this.state.placementAssetId) {
      this.ghost.visible = false;
      return;
    }
    const resolved = resolveGroundPosition(point, this.state.placementResolution, this.state.scene.grid);
    this.ghost.setPosition(resolved.x, resolved.z);
    this.ghost.visible = true;
  }

  private tryPlace(point: THREE.Vector3 | null) {
    if (!point || !this.state.scene || !this.state.placementAssetId) return;
    const resolved = resolveGroundPosition(point, this.state.placementResolution, this.state.scene.grid);
    this.state.placeAsset(this.state.placementAssetId, resolved);
    this.ghost.visible = false;
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
    this.ghost.dispose();
    this.cameraRig.dispose();
  }
}
