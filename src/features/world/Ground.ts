import * as THREE from "three";
import { worldSceneConfig } from "./world.config";

export type GroundMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;

/**
 * The ground plane (also the placement raycast target) plus its grid-line helper. The plane's own
 * appearance (color/texture) is applied separately by WorldFeature — this factory just builds the
 * geometry at the given size and a neutral starting material. `polygonOffset` keeps the grid's
 * coplanar line segments from z-fighting against the now-visible plane beneath them.
 */
export function createGround(width: number, depth: number, cellSize: number) {
  const divisions = Math.max(Math.round(width / cellSize), 1);
  const grid = new THREE.GridHelper(width, divisions, worldSceneConfig.gridColorCenter, worldSceneConfig.gridColorGrid);

  const material = new THREE.MeshStandardMaterial({
    color: worldSceneConfig.backgroundColor,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
  const ground: GroundMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  ground.rotation.x = -Math.PI / 2;
  return { grid, ground };
}

export function disposeGround(grid: THREE.GridHelper, ground: THREE.Mesh) {
  grid.geometry.dispose();
  (grid.material as THREE.Material).dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
}
