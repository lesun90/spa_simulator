import type { ScenePackageData } from "./scene";

/** Application port: scene lifecycle is independent of the rendering engine's object types. */
export interface ScenePresentation { dispose(): void; }
export interface ScenePresenter {
  createDefault(): ScenePresentation;
  prepare(data: ScenePackageData): Promise<ScenePresentation>;
  show(presentation: ScenePresentation): void;
}
