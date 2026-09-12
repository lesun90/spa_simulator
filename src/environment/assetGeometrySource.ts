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

  const malformed = malformedImplementationDiagnostic(asset);
  if (malformed) return { status: "error", diagnostics: [malformed] };

  try {
    const object = await loadAssetObject(asset, assetRoot);
    const diagnostics = unsupportedNodeDiagnostics(object, asset.id);
    return diagnostics.length ? { status: "error", diagnostics } : { status: "resolved", object };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", diagnostics: [`Could not resolve asset ${asset.id}: ${message}`] };
  }
}

/**
 * A build-time compiler has no one watching to notice a wrong-looking box the way a human editor
 * user would — so unlike AssetManager.resolve()'s browser-side fallback, a catalog entry that
 * declares "glb"/"module" but is missing the URL that implementation requires must be reported as
 * an error, not silently substituted with a placeholder.
 */
function malformedImplementationDiagnostic(asset: AssetCatalogEntry): string | undefined {
  if (asset.implementation === "glb" && !asset.modelUrl) {
    return `Asset ${asset.id} is declared as a glb implementation but has no modelUrl.`;
  }
  if (asset.implementation === "module" && !asset.moduleUrl) {
    return `Asset ${asset.id} is declared as a module implementation but has no moduleUrl.`;
  }
  return undefined;
}

async function loadAssetObject(asset: AssetCatalogEntry, assetRoot: string): Promise<THREE.Object3D> {
  switch (asset.implementation) {
    case "glb": {
      const bytes = await readFile(assetFilePath(assetRoot, asset.modelUrl!));
      // Rebuild the ArrayBuffer via Uint8Array in the current realm rather than reaching into
      // Buffer.buffer directly: under a jsdom-based test runner, a Node Buffer's backing
      // ArrayBuffer belongs to a different JS realm than the one GLTFLoader's internal
      // `instanceof ArrayBuffer` checks run against, which silently misparses otherwise
      // byte-identical GLB data. This copy is realm-agnostic and correct in real Node too.
      const arrayBuffer = new Uint8Array(bytes).buffer;
      const loader = new GLTFLoader();
      return await new Promise<THREE.Object3D>((resolve, reject) => {
        loader.parse(arrayBuffer, "", (gltf) => resolve(gltf.scene), reject);
      });
    }
    case "module": {
      const modulePath = assetFilePath(assetRoot, asset.moduleUrl!);
      const module = (await import(pathToFileURL(modulePath).href)) as AssetModule;
      if (!module.createAsset) throw new Error(`${asset.moduleUrl} does not export createAsset.`);
      return await module.createAsset({ THREE, directoryUrl: "", modelUrl: asset.modelUrl });
    }
    case "placeholder":
      return createPlaceholder(asset);
  }
}

export function assetFilePath(assetRoot: string, url: string): string {
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
