import * as THREE from "three";

export function hudBasicMaterial(parameters: THREE.MeshBasicMaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, ...parameters });
}
