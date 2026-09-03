import type { AssetCatalogEntry } from "../editor-core/assets";
import type { Scene } from "../editor-core/scene";

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
