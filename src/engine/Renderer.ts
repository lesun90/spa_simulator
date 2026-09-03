import * as THREE from "three";
import type { Viewport } from "./Viewport";

export interface RenderLayer {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

/** Owns the single WebGLRenderer/canvas. Renders an ordered stack of layers, clearing depth between each. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, viewport: Viewport) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.localClippingEnabled = true;
    viewport.subscribe((size) => {
      this.renderer.setPixelRatio(size.pixelRatio);
      this.renderer.setSize(size.width, size.height, false);
    });
  }

  renderLayers(layers: readonly RenderLayer[]) {
    this.renderer.clear();
    layers.forEach((layer, index) => {
      if (index > 0) this.renderer.clearDepth();
      this.renderer.render(layer.scene, layer.camera);
    });
  }

  dispose() {
    this.renderer.dispose();
  }
}
