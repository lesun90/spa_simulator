import * as THREE from "three";
import { worldConfig } from "../../app/config";
import type { AssetManager } from "../../engine/AssetManager";
import type { InteractionSystem, RaycastLayer } from "../../engine/InteractionSystem";
import { CameraRig } from "../../engine/CameraRig";
import type { ViewportSize } from "../../engine/Viewport";
import { resolveGroundPosition } from "../../editor-core/grid";
import type { EditorState } from "../../state/EditorState";
import { createGround } from "./Ground";
import { createPlacementGhost } from "./PlacementGhost";
import { SceneObjectsFeature } from "./SceneObjectsFeature";
import { worldSceneConfig } from "./world.config";

/**
 * The 3D ground-plane viewport: camera, lights, ground/grid, placed objects, and placement ghost.
 * A top-level composite — it owns its own Scene+Camera directly (rendered straight by Renderer),
 * unlike a sub-feature that exposes a `root` to be added into a parent scene.
 */
export class WorldFeature {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private readonly cameraRig: CameraRig;
  private readonly ground: THREE.Mesh;
  private readonly ghost: THREE.Mesh;
  private readonly objects: SceneObjectsFeature;
  private readonly unsubscribers: Array<() => void> = [];
  private unregisterGround: (() => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assetManager: AssetManager,
    private readonly interaction: InteractionSystem,
    private readonly state: EditorState
  ) {
    this.scene.background = new THREE.Color(worldSceneConfig.backgroundColor);

    this.camera = new THREE.PerspectiveCamera(worldConfig.cameraFov, 1, worldConfig.cameraNear, worldConfig.cameraFar);
    this.camera.position.set(worldConfig.cameraPosition.x, worldConfig.cameraPosition.y, worldConfig.cameraPosition.z);
    this.camera.lookAt(0, 0, 0);

    this.cameraRig = new CameraRig(this.camera, canvas, worldConfig.maxPolarAngle);

    this.scene.add(new THREE.HemisphereLight(worldSceneConfig.hemisphereLightSky, worldSceneConfig.hemisphereLightGround, worldSceneConfig.hemisphereLightIntensity));
    const sun = new THREE.DirectionalLight(worldSceneConfig.sunColor, worldSceneConfig.sunIntensity);
    sun.position.set(worldSceneConfig.sunPosition.x, worldSceneConfig.sunPosition.y, worldSceneConfig.sunPosition.z);
    this.scene.add(sun);

    const grid = state.scene?.grid ?? { cellSize: 1, width: 100, depth: 100 };
    const { grid: gridHelper, ground } = createGround(grid.width, grid.depth);
    this.ground = ground;
    this.scene.add(gridHelper, ground);

    this.ghost = createPlacementGhost();
    this.scene.add(this.ghost);

    this.objects = new SceneObjectsFeature(assetManager, interaction, {
      onObjectClick: (objectId) => state.selectObject(objectId)
    });
    this.scene.add(this.objects.root);

    this.unregisterGround = interaction.register(this.ground, {
      onPointerMove: (event) => this.updateGhost(event.point ?? null),
      onPointerUp: (event) => this.tryPlace(event.point ?? null)
    });

    this.unsubscribers.push(
      state.on("scene", () => this.resync()),
      state.on("assets", () => this.resync()),
      state.on("selection", () => this.objects.setSelected(state.selectedObjectId)),
      state.on("objectsVisible", () => this.objects.setVisible(state.objectsVisible)),
      state.on("placement", () => {
        if (!state.placementAssetId) this.ghost.visible = false;
      })
    );

    this.resync();
  }

  get raycastLayer(): RaycastLayer {
    return { scene: this.scene, camera: this.camera };
  }

  private resync() {
    if (!this.state.scene) return;
    void this.objects.sync(this.state.scene, this.state.assets, this.state.selectedObjectId);
  }

  private updateGhost(point: THREE.Vector3 | null) {
    if (!point || !this.state.scene || !this.state.placementAssetId) {
      this.ghost.visible = false;
      return;
    }
    const resolved = resolveGroundPosition(point, this.state.placementResolution, this.state.scene.grid);
    this.ghost.position.set(resolved.x, 0.45, resolved.z);
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
    this.objects.dispose();
    this.cameraRig.dispose();
  }
}
