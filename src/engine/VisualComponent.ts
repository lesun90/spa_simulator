import type * as THREE from "three";
import type { ViewportSize } from "./Viewport";

/** Standard lifecycle contract for a modular visual feature (see .claude/skills/threejs-design-rule). */
export interface VisualComponent {
  readonly root: THREE.Object3D;
  init(): Promise<void> | void;
  update(dt: number, elapsed: number): void;
  resize(size: ViewportSize): void;
  dispose(): void;
}
