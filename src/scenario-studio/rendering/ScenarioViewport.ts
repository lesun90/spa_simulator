import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CameraRig } from "../../engine/CameraRig";
import { Renderer } from "../../engine/Renderer";
import { RenderLoop } from "../../engine/RenderLoop";
import { Viewport } from "../../engine/Viewport";
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
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.05, 3000);
  private readonly viewport = new Viewport(2);
  private readonly renderer: Renderer;
  private readonly loop: RenderLoop;
  private readonly cameraRig: CameraRig;
  private readonly loader = new GLTFLoader();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0xb8cbd2);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x728568, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(25, 55, 35);
    this.scene.add(sun);
    this.camera.position.set(55, 48, 55);
    this.renderer = new Renderer(canvas, this.viewport);
    this.loop = new RenderLoop(this.renderer);
    this.cameraRig = new CameraRig(this.camera, canvas, Math.PI / 2.03);
    this.unsubscribe = this.viewport.subscribe((size) => {
      this.camera.aspect = size.aspect;
      this.camera.updateProjectionMatrix();
    });
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.loop.start(() => {
      this.cameraRig.update();
      this.renderer.renderLayers([{ scene: this.scene, camera: this.camera }]);
    });
  }

  createDefault(): ScenePresentation {
    const ground = new DefaultGround();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ground.width, ground.depth),
      new THREE.MeshStandardMaterial({ color: ground.color, roughness: 1, side: THREE.DoubleSide })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = ground.y;
    mesh.name = "Default ground";
    return new OwnedPresentation(mesh, new THREE.Box3().setFromObject(mesh));
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
  }

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.cameraRig.zoom(event.deltaY);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.loop.stop();
    this.cameraRig.dispose();
    this.unsubscribe();
    this.renderer.dispose();
    this.viewport.dispose();
  }
}
