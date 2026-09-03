import * as THREE from "three";
import { worldSceneConfig } from "./world.config";

/** The invisible raycast-target ground plane plus its visible grid helper. Trivial/static — a factory, not a full lifecycle class. */
export function createGround(width: number, depth: number) {
  const grid = new THREE.GridHelper(width, width, worldSceneConfig.gridColorCenter, worldSceneConfig.gridColorGrid);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ visible: false }));
  ground.rotation.x = -Math.PI / 2;
  return { grid, ground };
}
