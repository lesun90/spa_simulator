import type { SceneChoice, ScenePackageData, SceneReference } from "../domain/scene";

export interface SceneCatalog {
  list(): Promise<readonly SceneChoice[]>;
  load(reference: SceneReference): Promise<ScenePackageData>;
}
