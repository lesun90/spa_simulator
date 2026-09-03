import type * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Wraps OrbitControls so it can be suspended while the HUD is consuming a pointer gesture. */
export class CameraRig {
  private readonly controls: OrbitControls;

  constructor(camera: THREE.Camera, domElement: HTMLElement, maxPolarAngle: number) {
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = maxPolarAngle;
  }

  setEnabled(enabled: boolean) {
    this.controls.enabled = enabled;
  }

  update() {
    this.controls.update();
  }

  dispose() {
    this.controls.dispose();
  }
}
