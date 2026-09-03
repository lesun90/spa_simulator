import * as THREE from "three";

/** Centers/scales/rotates a loaded asset object to sit nicely inside a small preview frame. */
export function centerObjectForPreview(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z, 0.001);

  object.position.sub(center);
  object.position.y += size.y / 2;
  object.scale.multiplyScalar(1.55 / maxAxis);
  object.rotation.y = Math.PI / 5;
}
