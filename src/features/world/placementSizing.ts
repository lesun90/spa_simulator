import * as THREE from "three";

export function scaleToFitGridCell(object: THREE.Object3D, cellSize: number): number {
  if (!Number.isFinite(cellSize) || cellSize <= 0) return 1;

  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return 1;

  const size = box.getSize(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z);
  if (!Number.isFinite(footprint) || footprint <= 0) return 1;

  return cellSize / footprint;
}

export function centerGroundFootprintOnOrigin(object: THREE.Object3D): void {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);
  for (const child of object.children) {
    child.position.add(offset);
  }
  object.updateWorldMatrix(true, true);
}
