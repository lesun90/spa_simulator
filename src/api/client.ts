import type { AssetCatalogEntry } from "../editor-core/assets";
import type { Scene } from "../editor-core/scene";
import type { EnvironmentCompileMetrics } from "../environment/compiler";
import type { EnvironmentManifest } from "../environment/types";

export interface SceneSummary {
  id: string;
  name: string;
  objectCount: number;
  updatedAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function listAssets() {
  return (await request<{ assets: AssetCatalogEntry[] }>("/api/assets")).assets;
}

export async function listScenes() {
  return (await request<{ scenes: SceneSummary[] }>("/api/scenes")).scenes;
}

export async function createSceneRequest(name: string) {
  return (await request<{ scene: Scene }>("/api/scenes", { method: "POST", body: JSON.stringify({ name }) })).scene;
}

export async function openSceneRequest(id: string) {
  return (await request<{ scene: Scene }>(`/api/scenes/${encodeURIComponent(id)}`)).scene;
}

export async function saveSceneRequest(scene: Scene) {
  return (await request<{ scene: Scene }>(`/api/scenes/${encodeURIComponent(scene.id)}`, { method: "PUT", body: JSON.stringify({ scene }) })).scene;
}

export async function renameSceneRequest(id: string, name: string) {
  return (await request<{ scene: Scene }>(`/api/scenes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) })).scene;
}

export async function duplicateSceneRequest(id: string) {
  return (await request<{ scene: Scene }>(`/api/scenes/${encodeURIComponent(id)}/duplicate`, { method: "POST" })).scene;
}

export async function deleteSceneRequest(id: string) {
  await request<void>(`/api/scenes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function importSharedAssetRequest(input: {
  id: string;
  label: string;
  category: string;
  folderName: string;
  overwrite?: boolean;
  files: Array<{ name: string; contentBase64: string }>;
}) {
  return (await request<{ asset: AssetCatalogEntry }>("/api/assets/shared-import", { method: "POST", body: JSON.stringify(input) })).asset;
}

export async function exportEnvironmentRequest(scene: Scene, options: { chunkSize: number; removeSeamFaces: boolean }) {
  return request<{ exportId: string; manifest: EnvironmentManifest; metrics: EnvironmentCompileMetrics }>(
    `/api/scenes/${encodeURIComponent(scene.id)}/environment/export`,
    { method: "POST", body: JSON.stringify({ scene, options }) }
  );
}

export async function fetchExportedEnvironmentModel(sceneId: string, exportId: string): Promise<Uint8Array> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/environment/export/${encodeURIComponent(exportId)}/model`);
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function uploadEnvironmentManifestRequest(sceneId: string, manifestJson: string): Promise<void> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/environment/import/manifest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: manifestJson
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
}

export async function uploadEnvironmentModelRequest(sceneId: string, glb: Uint8Array): Promise<void> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/environment/import/model`, {
    method: "POST",
    headers: { "Content-Type": "model/gltf-binary" },
    body: glb as BodyInit
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
}

export async function commitEnvironmentImportRequest(sceneId: string): Promise<Scene> {
  return (await request<{ scene: Scene }>(`/api/scenes/${encodeURIComponent(sceneId)}/environment/import/commit`, { method: "POST" })).scene;
}

export async function fetchCommittedEnvironmentManifest(sceneId: string): Promise<EnvironmentManifest | null> {
  return (await request<{ manifest: EnvironmentManifest | null }>(`/api/scenes/${encodeURIComponent(sceneId)}/environment`)).manifest;
}

export async function fetchCommittedEnvironmentModel(sceneId: string): Promise<Uint8Array> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/environment/model`);
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
