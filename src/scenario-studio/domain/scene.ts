import type { EnvironmentManifest } from "../../environment/types";

export interface SceneReference {
  readonly key: string;
  readonly modelSha256: string;
  readonly manifestSha256: string;
  readonly formatVersion: number;
}

export interface SceneChoice {
  readonly label: string;
  readonly description?: string;
  readonly sceneSize?: number;
  readonly cellSize?: number;
  readonly seed?: number;
  readonly materials?: readonly string[];
  readonly reference: SceneReference;
  readonly thumbnailUrl: string | null;
  readonly available: boolean;
  readonly diagnostics: readonly string[];
}

export interface ScenePackageData {
  readonly reference: SceneReference;
  readonly manifest: EnvironmentManifest;
  readonly glb: Uint8Array;
}

export function sameSceneReference(a: SceneReference | null, b: SceneReference | null): boolean {
  return a?.key === b?.key && a?.modelSha256 === b?.modelSha256 && a?.manifestSha256 === b?.manifestSha256 && a?.formatVersion === b?.formatVersion;
}
