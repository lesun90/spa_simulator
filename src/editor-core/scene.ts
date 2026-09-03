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
  grid: GridDefinition;
  objects: SceneObject[];
}

export function createId(prefix = "id") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createScene(name: string): Scene {
  return {
    id: createId("scene"),
    name,
    grid: { cellSize: 1, width: 100, depth: 100 },
    objects: []
  };
}

export function cloneScene(scene: Scene): Scene {
  return {
    ...scene,
    grid: { ...scene.grid },
    objects: scene.objects.map((object) => ({
      ...object,
      position: { ...object.position }
    }))
  };
}
