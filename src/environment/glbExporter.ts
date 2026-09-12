import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import "./nodeGltfShim";

/** Exports a compiled environment root (named "SteerlabEnvironment") as binary GLB bytes. */
export function exportGlb(root: THREE.Object3D): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => resolve(new Uint8Array(result as ArrayBuffer)),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, embedImages: true }
    );
  });
}
