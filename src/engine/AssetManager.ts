import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { disposeObject } from "./disposeObject";

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
  private readonly chassisHullPoints = new Map<string, Promise<Float32Array>>();
  private readonly loader = new GLTFLoader();
  private disposed = false;

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

  /**
   * Vertex positions (root-local frame) of every mesh in the asset's template, excluding any mesh under a
   * node named in `excludeNodeNames` (e.g. wheel nodes, which get their own separate physics treatment).
   * Callers feed this to a convex-hull collider; it is not a rendered shape. Cached per template, same as
   * getTemplate, so repeated calls for the same asset are free after the first.
   */
  async getChassisHullPoints(asset: AssetCatalogEntry, excludeNodeNames: ReadonlySet<string> = new Set()): Promise<Float32Array> {
    const key = `${asset.id}:${asset.implementation}:${asset.moduleUrl ?? ""}:${asset.modelUrl ?? ""}:${[...excludeNodeNames].sort().join(",")}`;
    let hull = this.chassisHullPoints.get(key);
    if (!hull) {
      hull = this.getTemplate(asset).then((template) => extractHullPoints(template, excludeNodeNames));
      this.chassisHullPoints.set(key, hull);
    }
    return hull;
  }

  /** The composition root owns cached template resources; clones remain consumer-owned scene nodes. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const template of this.templates.values()) void template.then(disposeObject, () => {});
    this.templates.clear();
    this.chassisHullPoints.clear();
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

/** Collects every mesh's world (root-local) vertex position, skipping any mesh nested under an excluded node name. */
function extractHullPoints(root: THREE.Object3D, excludeNodeNames: ReadonlySet<string>): Float32Array {
  root.updateMatrixWorld(true);
  const points: number[] = [];
  const point = new THREE.Vector3();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (let node: THREE.Object3D | null = child; node; node = node.parent) {
      if (excludeNodeNames.has(node.name)) return;
    }
    const position = child.geometry.getAttribute("position");
    if (!position) return;
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
      points.push(point.x, point.y, point.z);
    }
  });
  return new Float32Array(points);
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
