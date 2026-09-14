import type { AssetCatalogEntry } from "../editor-core/assets";
import type { Scene } from "../editor-core/scene";
import type { EnvironmentManifest } from "../environment/types";
import type { GenerateWfcSceneResult } from "../wfc/sceneGenerator";
import type { GenerateWfcLayoutRequest, WfcGenerationProgress } from "../wfc/sceneLayout";

export interface SceneSummary { id: string; name: string; objectCount: number; updatedAt: string; }
export interface EditorStateDependencies {
  listAssets(): Promise<AssetCatalogEntry[]>;
  listScenes(): Promise<SceneSummary[]>;
  createScene(name: string): Promise<Scene>;
  openScene(id: string): Promise<Scene>;
  saveScene(scene: Scene): Promise<void>;
  renameScene(id: string, name: string): Promise<Scene>;
  duplicateScene(id: string): Promise<Scene>;
  deleteScene(id: string): Promise<void>;
  importSharedAsset(input: { id: string; label: string; category: string; folderName: string; overwrite?: boolean; files: Array<{ name: string; contentBase64: string }> }): Promise<AssetCatalogEntry>;
  exportEnvironment(scene: Scene, options: { chunkSize: number; removeSeamFaces: boolean }): Promise<{ exportId: string; manifest: EnvironmentManifest; manifestJson: string }>;
  fetchEnvironmentModel(sceneId: string, exportId: string): Promise<Uint8Array>;
  saveEnvironmentPackage(sceneName: string, manifestJson: string, glb: Uint8Array): Promise<void>;
  pickEnvironmentPackage(): Promise<{ manifestJson: string; glb: Uint8Array } | null>;
  uploadEnvironmentManifest(sceneId: string, manifestJson: string): Promise<void>;
  uploadEnvironmentModel(sceneId: string, glb: Uint8Array): Promise<void>;
  commitEnvironmentImport(sceneId: string): Promise<Scene>;
  removeEnvironment(sceneId: string): Promise<void>;
  generate(assets: readonly AssetCatalogEntry[], request: GenerateWfcLayoutRequest, options: { onProgress?(progress: WfcGenerationProgress): void }): Promise<GenerateWfcSceneResult>;
  prompt(message: string, value?: string): string | null;
  confirm(message: string): boolean;
  fileToBase64(file: File): Promise<string>;
}
