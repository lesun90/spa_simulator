import * as THREE from "three";
import type { AssetManager } from "../../../engine/AssetManager";
import type { AssetCatalogEntry } from "../../../editor-core/assets";
import { configureHudRenderTargetTexture } from "../kit/textures";
import { centerObjectForPreview } from "./previewMath";

const STATIC_RESOLUTION = 128;
const LIVE_RESOLUTION = 160;
const LIVE_POOL_SIZE = 4;
const ROTATE_SPEED = 0.6;

interface PreviewRig {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

function createRig(): PreviewRig {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(2.8, 2.1, 3.2);
  camera.lookAt(0, 0.65, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb7bdc8, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(3, 5, 4);
  scene.add(key);
  return { scene, camera };
}

interface LiveSlot {
  target: THREE.WebGLRenderTarget;
  rig: PreviewRig;
  object: THREE.Object3D | null;
  inUse: boolean;
}

export interface LiveThumbnailHandle {
  texture: THREE.Texture;
  dispose(): void;
}

/**
 * Renders small asset preview thumbnails using the app's single shared renderer (no per-tile
 * WebGLRenderer/canvas). Static thumbnails get one dedicated render target per asset id, rendered
 * once and left alone. A small pool of "live" render targets serves previews that rotate
 * continuously, such as the hovered asset tile.
 */
export class ThumbnailRenderer {
  private readonly staticTargets = new Map<string, THREE.WebGLRenderTarget>();
  private readonly staticRig = createRig();
  private readonly livePool: LiveSlot[];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly assetManager: AssetManager
  ) {
    this.livePool = Array.from({ length: LIVE_POOL_SIZE }, () => ({
      target: createThumbnailTarget(LIVE_RESOLUTION),
      rig: createRig(),
      object: null,
      inUse: false
    }));
  }

  async getStaticThumbnail(asset: AssetCatalogEntry): Promise<THREE.Texture> {
    const existing = this.staticTargets.get(asset.id);
    if (existing) return existing.texture;

    const target = createThumbnailTarget(STATIC_RESOLUTION);
    this.staticTargets.set(asset.id, target);

    const object = await this.assetManager.instantiate(asset);
    centerObjectForPreview(object);
    this.staticRig.scene.add(object);
    this.renderInto(target, this.staticRig);
    this.staticRig.scene.remove(object);

    return target.texture;
  }

  async acquireLiveThumbnail(asset: AssetCatalogEntry): Promise<LiveThumbnailHandle | null> {
    const slot = this.livePool.find((candidate) => !candidate.inUse);
    if (!slot) return null;
    slot.inUse = true;

    const object = await this.assetManager.instantiate(asset);
    if (!slot.inUse) {
      // Released while the asset was loading.
      return null;
    }
    centerObjectForPreview(object);
    slot.object = object;
    slot.rig.scene.add(object);
    this.renderInto(slot.target, slot.rig);

    return {
      texture: slot.target.texture,
      dispose: () => {
        if (slot.object) slot.rig.scene.remove(slot.object);
        slot.object = null;
        slot.inUse = false;
      }
    };
  }

  update(dt: number) {
    for (const slot of this.livePool) {
      if (!slot.inUse || !slot.object) continue;
      slot.object.rotation.y += dt * ROTATE_SPEED;
      this.renderInto(slot.target, slot.rig);
    }
  }

  private renderInto(target: THREE.WebGLRenderTarget, rig: PreviewRig) {
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(rig.scene, rig.camera);
    this.renderer.setRenderTarget(previousTarget);
  }

  /** Drops the cached static thumbnail for assets no longer in the catalog. */
  pruneStatic(validAssetIds: ReadonlySet<string>) {
    for (const [id, target] of this.staticTargets) {
      if (!validAssetIds.has(id)) {
        target.dispose();
        this.staticTargets.delete(id);
      }
    }
  }

  dispose() {
    for (const target of this.staticTargets.values()) target.dispose();
    this.staticTargets.clear();
    for (const slot of this.livePool) slot.target.dispose();
  }
}

function createThumbnailTarget(resolution: number) {
  const target = new THREE.WebGLRenderTarget(resolution, resolution);
  configureHudRenderTargetTexture(target.texture);
  return target;
}
