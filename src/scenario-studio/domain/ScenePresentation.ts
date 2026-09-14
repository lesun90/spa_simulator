import type { ScenePackageData } from "./scene";
import type { SceneGeometryDescription } from "../physics/PhysicsWorld";

/** Application port: scene lifecycle is independent of the rendering engine's object types. */
export interface ScenePresentation {
  readonly geometry: SceneGeometryDescription;
  dispose(): void;
}
export interface ScenePresenter {
  createDefault(): ScenePresentation;
  prepare(data: ScenePackageData): Promise<ScenePresentation>;
  show(presentation: ScenePresentation): void;
}
