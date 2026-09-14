import * as THREE from "three";
import { AssetManager } from "../../engine/AssetManager";
import { ThumbnailRenderer, type LiveThumbnailHandle } from "../../features/hud/thumbnails/ThumbnailRenderer";
import type { SceneChoice } from "../domain/scene";

/** Renders published environment packages into the same static 3D card previews used by Scene Studio. */
export class ScenarioSceneThumbnails {
  private readonly assets = new AssetManager();
  private readonly thumbnails: ThumbnailRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.thumbnails = new ThumbnailRenderer(renderer, this.assets);
  }

  getStaticThumbnail(choice: SceneChoice): Promise<THREE.Texture> {
    return this.thumbnails.getStaticThumbnail(this.assetFor(choice));
  }

  acquireLiveThumbnail(choice: SceneChoice): Promise<LiveThumbnailHandle | null> {
    return this.thumbnails.acquireLiveThumbnail(this.assetFor(choice));
  }

  update(dt: number): void {
    this.thumbnails.update(dt);
  }

  retain(choices: readonly SceneChoice[]): void {
    this.thumbnails.pruneStatic(new Set(choices.filter((choice) => choice.available).map((choice) => this.assetFor(choice).id)));
  }

  dispose(): void {
    this.thumbnails.dispose();
    this.assets.dispose();
  }

  private assetFor(choice: SceneChoice) {
    return {
      id: `published-scene:${choice.reference.key}:${choice.reference.modelSha256}:${choice.reference.manifestSha256}`,
      label: choice.label,
      category: "published scenes",
      source: "shared",
      implementation: "glb",
      modelUrl: modelUrl(choice)
    } as const;
  }
}

function modelUrl(choice: SceneChoice): string {
  const query = new URLSearchParams({
    key: choice.reference.key,
    modelSha256: choice.reference.modelSha256,
    manifestSha256: choice.reference.manifestSha256
  });
  return `/api/scenario-studio/scene-package/model?${query}`;
}
