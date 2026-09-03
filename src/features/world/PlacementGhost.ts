import * as THREE from "three";
import { theme } from "../../app/theme";

/** The translucent box that previews where an asset will land while placement is armed. */
export function createPlacementGhost() {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    new THREE.MeshStandardMaterial({ color: theme.ghost.hex, transparent: true, opacity: 0.35 })
  );
  mesh.position.y = 0.45;
  mesh.visible = false;
  return mesh;
}
