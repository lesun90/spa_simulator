import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Wraps OrbitControls so it can be suspended while the HUD is consuming a pointer gesture. */
export class CameraRig {
  private readonly controls: OrbitControls;
  private readonly initialPosition: THREE.Vector3;
  private readonly initialTarget: THREE.Vector3;

  constructor(private readonly camera: THREE.Camera, domElement: HTMLElement, maxPolarAngle: number) {
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.enableZoom = false;
    this.controls.maxPolarAngle = maxPolarAngle;
    this.initialPosition = camera.position.clone();
    this.initialTarget = this.controls.target.clone();
  }

  setEnabled(enabled: boolean) {
    this.controls.enabled = enabled;
  }

  resetView() {
    this.camera.position.copy(this.initialPosition);
    this.controls.target.copy(this.initialTarget);
    this.controls.update();
  }

  zoom(deltaY: number) {
    const direction = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const scale = Math.exp(deltaY * 0.001);
    const distance = THREE.MathUtils.clamp(direction.length() * scale, 4, 140);
    direction.setLength(distance);
    this.camera.position.copy(this.controls.target).add(direction);
    this.controls.update();
  }

  update() {
    this.controls.update();
  }

  dispose() {
    this.controls.dispose();
  }
}
