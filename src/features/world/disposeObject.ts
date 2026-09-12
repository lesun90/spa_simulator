import * as THREE from "three";

/** Disposes every mesh/line's geometry, material(s), and any textures a material references. */
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        disposeMaterialTextures(material);
        material.dispose();
      }
    }
  });
}

function disposeMaterialTextures(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
}
