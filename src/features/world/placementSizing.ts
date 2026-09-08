import * as THREE from "three";
import { GRID_SIZE_MULTIPLIERS } from "../../editor-core/grid";

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

export function snapScaleToGridCells(scale: number, cellFitScale: number): number {
  if (!Number.isFinite(scale)) return 1;
  if (!Number.isFinite(cellFitScale) || cellFitScale <= 0) return scale;

  const gridCells = gridCellsForScale(scale, cellFitScale);
  const snappedCells = GRID_SIZE_MULTIPLIERS.reduce((best, candidate) =>
    Math.abs(candidate - gridCells) < Math.abs(best - gridCells) ? candidate : best
  );
  return cellFitScale * snappedCells;
}

export function gridCellsForScale(scale: number, cellFitScale: number): number {
  if (!Number.isFinite(scale)) return 1;
  if (!Number.isFinite(cellFitScale) || cellFitScale <= 0) return scale;
  return scale / cellFitScale;
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
