import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CameraRig } from "../../engine/CameraRig";
import type { ViewportSize } from "../../engine/Viewport";
import { disposeObject } from "../../features/world/disposeObject";
import { DefaultGround } from "../domain/DefaultGround";
import type { ScenePackageData } from "../domain/scene";

export interface ScenePresentation {
  readonly object: THREE.Object3D;
  readonly bounds: THREE.Box3;
  dispose(): void;
}

export interface ScenePresenter {
  createDefault(): ScenePresentation;
  prepare(data: ScenePackageData): Promise<ScenePresentation>;
  show(presentation: ScenePresentation): void;
}

class OwnedPresentation implements ScenePresentation {
  private disposed = false;
  constructor(readonly object: THREE.Object3D, readonly bounds: THREE.Box3) {}
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    disposeObject(this.object);
  }
}

export class ScenarioViewport implements ScenePresenter {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.05, 3000);
  private readonly cameraRig: CameraRig;
  private readonly loader = new GLTFLoader();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x15181d);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x728568, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(25, 55, 35);
    this.scene.add(sun);
    this.camera.position.set(55, 48, 55);
    this.cameraRig = new CameraRig(this.camera, canvas, Math.PI / 2.03);
  }

  resize(size: ViewportSize): void {
    this.camera.aspect = size.aspect;
    this.camera.updateProjectionMatrix();
  }

  update(): void { this.cameraRig.update(); }
  zoom(deltaY: number): void { this.cameraRig.zoom(deltaY); }
  setCameraControlsEnabled(enabled: boolean): void { this.cameraRig.setEnabled(enabled); }
  resetView(): void { this.cameraRig.resetView(); }

  createDefault(): ScenePresentation {
    const ground = new DefaultGround();
    const root = new THREE.Group();
    const grid = new THREE.GridHelper(ground.width, ground.width, 0x9fb0c7, 0xe6edf7);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ground.width, ground.depth),
      new THREE.MeshStandardMaterial({
        color: ground.color,
        roughness: 1,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = ground.y;
    root.name = "Default ground grid";
    root.add(grid, mesh);
    return new OwnedPresentation(root, new THREE.Box3().setFromObject(root));
  }

  async prepare(data: ScenePackageData): Promise<ScenePresentation> {
    const bytes = data.glb.slice();
    const gltf = await this.loader.parseAsync(bytes.buffer, "");
    try {
      gltf.scene.scale.setScalar(1 / data.manifest.model.unitsPerMeter);
      gltf.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      if (bounds.isEmpty()) throw new Error("The scene model has no visible geometry.");
      return new OwnedPresentation(gltf.scene, bounds);
    } catch (error) {
      disposeObject(gltf.scene);
      throw error;
    }
  }

  show(presentation: ScenePresentation): void {
    if (this.disposed) return;
    this.scene.add(presentation.object);
    const center = presentation.bounds.getCenter(new THREE.Vector3());
    const radius = presentation.bounds.getSize(new THREE.Vector3()).length() / 2;
    const distance = Math.max(radius * 1.8, 16);
    this.cameraRig.setMaxZoomDistance(distance * 8);
    this.camera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.9, distance));
    this.cameraRig.focus(center);
    this.camera.near = Math.max(distance / 200, 0.05);
    this.camera.far = Math.max(distance * 20, 500);
    this.camera.updateProjectionMatrix();
    this.cameraRig.saveViewAsHome();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cameraRig.dispose();
  }
}
