import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AssetCatalogEntry } from "../editor-core/assets";

interface AssetModule {
  createAsset?: (context: { THREE: typeof THREE; directoryUrl: string; modelUrl?: string }) => Promise<THREE.Object3D> | THREE.Object3D;
}

/**
 * Centralized asset loading. Resolves each catalog entry's visual once and caches the resolved template
 * (geometry/materials are shared GPU resources owned here); instantiate() returns a cheap clone per
 * placement or thumbnail. Callers must never dispose a cloned instance's geometry/materials themselves.
 */
export class AssetManager {
  private readonly templates = new Map<string, Promise<THREE.Object3D>>();
  private readonly loader = new GLTFLoader();

  getTemplate(asset: AssetCatalogEntry): Promise<THREE.Object3D> {
    const key = `${asset.id}:${asset.implementation}:${asset.moduleUrl ?? ""}:${asset.modelUrl ?? ""}`;
    let template = this.templates.get(key);
    if (!template) {
      template = this.resolve(asset).catch((error) => {
        this.templates.delete(key);
        throw error;
      });
      this.templates.set(key, template);
    }
    return template;
  }

  async instantiate(asset: AssetCatalogEntry): Promise<THREE.Object3D> {
    try {
      const template = await this.getTemplate(asset);
      return template.clone(true);
    } catch {
      return createPlaceholder(asset);
    }
  }

  private async resolve(asset: AssetCatalogEntry): Promise<THREE.Object3D> {
    if (asset.implementation === "module" && asset.moduleUrl) {
      const module = (await import(/* @vite-ignore */ asset.moduleUrl)) as AssetModule;
      if (!module.createAsset) {
        throw new Error(`${asset.id} module does not export createAsset.`);
      }
      const directoryUrl = asset.moduleUrl.split("/").slice(0, -1).join("/");
      return module.createAsset({ THREE, directoryUrl, modelUrl: asset.modelUrl });
    }

    if (asset.implementation === "glb" && asset.modelUrl) {
      const gltf = await this.loader.loadAsync(asset.modelUrl);
      return gltf.scene;
    }

    return createPlaceholder(asset);
  }
}

export function createPlaceholder(asset: Pick<AssetCatalogEntry, "label" | "source">) {
  const group = new THREE.Group();
  const color = asset.source === "temporary" ? 0xf2a93b : 0x7d8aa2;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  mesh.position.y = 0.4;
  group.add(mesh);
  group.name = asset.label;
  return group;
}
