export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface GridDefinition {
  cellSize: number;
  width: number;
  depth: number;
}

export type SurfaceAppearanceType = "color" | "texture";

/** A paintable surface — the sky/backdrop or the ground plane — as a flat color or an image. */
export interface SurfaceAppearance {
  type: SurfaceAppearanceType;
  /** CSS hex color, used when type is "color" and as the fallback while a texture loads. */
  color: string;
  /** Image URL (a data: URL for a user-picked file), used when type is "texture". */
  textureUrl: string | null;
}

export interface SceneObject {
  id: string;
  assetId: string;
  position: Vector3Data;
  rotationY: number;
  scale: number;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  grid: GridDefinition;
  background: SurfaceAppearance;
  ground: SurfaceAppearance;
  objects: SceneObject[];
}

export function createId(prefix = "id") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultSurfaceAppearance(color = "#eef2f7"): SurfaceAppearance {
  return { type: "color", color, textureUrl: null };
}

export function createScene(name: string): Scene {
  return {
    id: createId("scene"),
    name,
    description: "",
    grid: { cellSize: 1, width: 100, depth: 100 },
    background: defaultSurfaceAppearance(),
    ground: defaultSurfaceAppearance(),
    objects: []
  };
}

export function cloneScene(scene: Scene): Scene {
  return {
    ...scene,
    grid: { ...scene.grid },
    background: { ...scene.background },
    ground: { ...scene.ground },
    objects: scene.objects.map((object) => ({
      ...object,
      position: { ...object.position }
    }))
  };
}

/** Backfills fields absent from scene files saved before they existed, so old saves keep loading. */
export function normalizeScene(scene: Scene): Scene {
  return {
    ...scene,
    description: typeof scene.description === "string" ? scene.description : "",
    background: isSurfaceAppearance(scene.background) ? scene.background : defaultSurfaceAppearance(),
    ground: isSurfaceAppearance(scene.ground) ? scene.ground : defaultSurfaceAppearance()
  };
}

export function isSurfaceAppearance(value: unknown): value is SurfaceAppearance {
  const appearance = value as Partial<SurfaceAppearance> | undefined;
  if (!appearance || typeof appearance !== "object") return false;
  if (appearance.type !== "color" && appearance.type !== "texture") return false;
  if (typeof appearance.color !== "string") return false;
  return appearance.textureUrl === null || typeof appearance.textureUrl === "string";
}

/** Lowercase, underscore-joined tail of an asset id (e.g. "vegetation.oak" -> "oak"), the display-name stem. */
export function assetSlug(assetId: string): string {
  const tail = assetId.split(".").at(-1) ?? assetId;
  return tail.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "object";
}

/** Maps each object to a stable "asset_slug_N" display name, numbered per asset in scene order. */
export function objectDisplayNames(objects: SceneObject[]): Map<string, string> {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const object of objects) {
    const slug = assetSlug(object.assetId);
    const count = (counts.get(slug) ?? 0) + 1;
    counts.set(slug, count);
    names.set(object.id, `${slug}_${count}`);
  }
  return names;
}
