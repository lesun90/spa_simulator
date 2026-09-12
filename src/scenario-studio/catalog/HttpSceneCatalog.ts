import type { SceneChoice, ScenePackageData, SceneReference } from "../domain/scene";
import type { SceneCatalog } from "./SceneCatalog";

export class HttpSceneCatalog implements SceneCatalog {
  async list(): Promise<readonly SceneChoice[]> {
    const response = await fetch("/api/scenario-studio/scenes");
    if (!response.ok) throw new Error(await errorMessage(response));
    return (await response.json() as { scenes: SceneChoice[] }).scenes;
  }

  async load(reference: SceneReference): Promise<ScenePackageData> {
    const query = new URLSearchParams({ key: reference.key, modelSha256: reference.modelSha256, manifestSha256: reference.manifestSha256 });
    const base = "/api/scenario-studio/scene-package";
    const [manifestResponse, modelResponse] = await Promise.all([
      fetch(`${base}/manifest?${query}`),
      fetch(`${base}/model?${query}`)
    ]);
    if (!manifestResponse.ok) throw new Error(await errorMessage(manifestResponse));
    if (!modelResponse.ok) throw new Error(await errorMessage(modelResponse));
    const [manifest, glb] = await Promise.all([manifestResponse.json(), modelResponse.arrayBuffer()]);
    return { reference, manifest, glb: new Uint8Array(glb) };
  }
}

async function errorMessage(response: Response): Promise<string> {
  try { return (await response.json() as { error?: string }).error ?? `Request failed (${response.status}).`; }
  catch { return `Request failed (${response.status}).`; }
}
