import type { EditorStateDependencies } from "./EditorStateDependencies";

/** Browser/HTTP/file-picker composition adapter. Imports are lazy to preserve test and startup boundaries. */
export function createBrowserEditorStateDependencies(): EditorStateDependencies {
  return {
    async listAssets() { return (await import("../api/client")).listAssets(); },
    async listScenes() { return (await import("../api/client")).listScenes(); },
    async createScene(name) { return (await import("../api/client")).createSceneRequest(name); },
    async openScene(id) { return (await import("../api/client")).openSceneRequest(id); },
    async saveScene(scene) { await (await import("../api/client")).saveSceneRequest(scene); },
    async renameScene(id, name) { return (await import("../api/client")).renameSceneRequest(id, name); },
    async duplicateScene(id) { return (await import("../api/client")).duplicateSceneRequest(id); },
    async deleteScene(id) { await (await import("../api/client")).deleteSceneRequest(id); },
    async importSharedAsset(input) { return (await import("../api/client")).importSharedAssetRequest(input); },
    async exportEnvironment(scene, options) { return (await import("../api/client")).exportEnvironmentRequest(scene, options); },
    async fetchEnvironmentModel(sceneId, exportId) { return (await import("../api/client")).fetchExportedEnvironmentModel(sceneId, exportId); },
    async saveEnvironmentPackage(manifestJson, glb) { await (await import("../features/hud/kit/fileSystemAccess")).saveEnvironmentPackage(manifestJson, glb); },
    async pickEnvironmentPackage() { return (await import("../features/hud/kit/fileSystemAccess")).pickEnvironmentPackageFiles(); },
    async uploadEnvironmentManifest(sceneId, manifestJson) { await (await import("../api/client")).uploadEnvironmentManifestRequest(sceneId, manifestJson); },
    async uploadEnvironmentModel(sceneId, glb) { await (await import("../api/client")).uploadEnvironmentModelRequest(sceneId, glb); },
    async commitEnvironmentImport(sceneId) { return (await import("../api/client")).commitEnvironmentImportRequest(sceneId); },
    async removeEnvironment(sceneId) { await (await import("../api/client")).removeEnvironmentRequest(sceneId); },
    async generate(assets, request, options) { return (await import("../wfc/sceneGenerator")).generateWfcScene(assets, request, options); },
    prompt: (message, value) => window.prompt(message, value),
    confirm: (message) => window.confirm(message),
    async fileToBase64(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
  };
}
