import type { SceneReference } from "./scene";

/** Owns the authored scene choice; later steps add authored agents and scripts here. */
export class ScenarioDocument {
  private activeScene: SceneReference | null = null;

  get sceneReference(): SceneReference | null {
    return this.activeScene;
  }

  replaceScene(reference: SceneReference): void {
    this.activeScene = Object.freeze({ ...reference });
  }
}
