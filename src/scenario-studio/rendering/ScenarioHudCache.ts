import * as THREE from "three";
import type { ViewportSize } from "../../engine/Viewport";
import { configureHudRenderTargetTexture } from "../../features/hud/kit/textures";

/** Renders Scene Studio's mostly-static HUD once, then composites its texture over each world frame. */
export class ScenarioHudCache {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 100);
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  private readonly quad = new THREE.Mesh(this.geometry, this.material);
  private target: THREE.WebGLRenderTarget | null = null;
  private width = 0;
  private height = 0;
  private pixelRatio = 0;

  constructor() {
    this.camera.position.z = 10;
    this.scene.add(this.quad);
  }

  refresh(renderer: THREE.WebGLRenderer, source: THREE.Scene, sourceCamera: THREE.Camera, size: ViewportSize): void {
    this.resize(size);
    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(source, sourceCamera);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.setRenderTarget(previousTarget);
  }

  dispose(): void {
    this.target?.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }

  private resize(size: ViewportSize): void {
    if (this.width === size.width && this.height === size.height && this.pixelRatio === size.pixelRatio) return;
    this.width = size.width;
    this.height = size.height;
    this.pixelRatio = size.pixelRatio;
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(
      Math.max(Math.round(size.width * size.pixelRatio), 1),
      Math.max(Math.round(size.height * size.pixelRatio), 1)
    );
    configureHudRenderTargetTexture(this.target.texture);
    this.material.map = this.target.texture;
    this.material.needsUpdate = true;
    this.camera.right = size.width;
    this.camera.bottom = size.height;
    this.camera.updateProjectionMatrix();
    this.quad.scale.set(size.width, size.height, 1);
    this.quad.position.set(size.width / 2, size.height / 2, 0);
  }
}
