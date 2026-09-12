import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { createPlaceholder } from "../engine/AssetManager";
import "./nodeGltfShim";

export type AssetGeometryResult = { status: "resolved"; object: THREE.Object3D } | { status: "error"; diagnostics: string[] };

interface AssetModule {
  createAsset?: (context: { THREE: typeof THREE; directoryUrl: string; modelUrl?: string }) => Promise<THREE.Object3D> | THREE.Object3D;
}

/** Resolves a catalog entry to a static Three.js object graph in Node, the way AssetManager does in the browser. */
export async function resolveAssetGeometry(asset: AssetCatalogEntry | undefined, assetId: string, assetRoot: string): Promise<AssetGeometryResult> {
  if (!asset) return { status: "error", diagnostics: [`Asset ${assetId} is not present in the catalog.`] };

  try {
    const object = await loadAssetObject(asset, assetRoot);
    const diagnostics = unsupportedNodeDiagnostics(object, asset.id);
    return diagnostics.length ? { status: "error", diagnostics } : { status: "resolved", object };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", diagnostics: [`Could not resolve asset ${asset.id}: ${message}`] };
  }
}

async function loadAssetObject(asset: AssetCatalogEntry, assetRoot: string): Promise<THREE.Object3D> {
  if (asset.implementation === "glb" && asset.modelUrl) {
    const bytes = await readFile(assetFilePath(assetRoot, asset.modelUrl));
    const loader = new GLTFLoader();
    return await new Promise<THREE.Object3D>((resolve, reject) => {
      loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", (gltf) => resolve(gltf.scene), reject);
    });
  }

  if (asset.implementation === "module" && asset.moduleUrl) {
    const modulePath = assetFilePath(assetRoot, asset.moduleUrl);
    const module = (await import(pathToFileURL(modulePath).href)) as AssetModule;
    if (!module.createAsset) throw new Error(`${asset.moduleUrl} does not export createAsset.`);
    return await module.createAsset({ THREE, directoryUrl: "", modelUrl: asset.modelUrl });
  }

  return createPlaceholder(asset);
}

function assetFilePath(assetRoot: string, url: string): string {
  const relative = decodeURIComponent(url.replace(/^\/assets\//, ""));
  return join(assetRoot, ...relative.split("/"));
}

/** Names the object/asset so the diagnostic can be fixed at the source, per the design's asset-geometry-source contract. */
export function unsupportedNodeDiagnostics(object: THREE.Object3D, assetId: string): string[] {
  const diagnostics: string[] = [];

  object.traverse((node) => {
    const name = node.name || "unnamed";
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
      diagnostics.push(`Asset ${assetId} node "${name}" is a skinned mesh, which the environment exporter does not support.`);
      return;
    }
    if (!(node instanceof THREE.Mesh)) return;

    const positionMorphs = (node.geometry as THREE.BufferGeometry).morphAttributes?.position;
    if (positionMorphs && positionMorphs.length > 0) {
      diagnostics.push(`Asset ${assetId} node "${name}" has morph targets, which the environment exporter does not support.`);
    }

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material instanceof THREE.ShaderMaterial || material instanceof THREE.RawShaderMaterial) {
        diagnostics.push(`Asset ${assetId} node "${name}" uses a custom shader material, which GLB export cannot represent.`);
      }
    }
  });

  return diagnostics;
}
