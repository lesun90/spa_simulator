import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { centerGroundFootprintOnOrigin } from "../../src/features/world/placementSizing";
import type { SceneObject } from "../../src/editor-core/scene";

export interface SolvedRoadCell {
  column: number;
  row: number;
  variant: { id: string; assetId: string };
}

export interface RoadSeamMismatch {
  sourceVariantId: string;
  neighborVariantId: string;
  sourcePosition: { column: number; row: number };
  neighborPosition: { column: number; row: number };
  direction: "east" | "north";
  boundsDelta: number;
}

const loader = new GLTFLoader();
const sceneCache = new Map<string, Promise<THREE.Object3D>>();

/**
 * Loads the same GLBs used by the viewport, applies the production centring and scene-object
 * transforms, then verifies that each solved internal seam shares a world-space boundary plane.
 */
export async function findRoadBoundsSeamMismatches(cells: readonly SolvedRoadCell[], objects: readonly SceneObject[], root = "assets/3d-road-tiles"): Promise<RoadSeamMismatch[]> {
  const objectByPosition = new Map(objects.map((object) => [positionKey(object), object]));
  const cellByPosition = new Map(cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
  const bounds = new Map<string, Promise<THREE.Box3>>();
  const worldBounds = (cell: SolvedRoadCell) => {
    const key = `${cell.column},${cell.row}`;
    let value = bounds.get(key);
    if (!value) {
      const object = objectByPosition.get(positionKeyForCell(cell, objects));
      if (!object) throw new Error(`No scene object for ${cell.variant.id} at ${key}.`);
      value = transformedBounds(cell.variant.assetId, object, root);
      bounds.set(key, value);
    }
    return value;
  };

  const mismatches: RoadSeamMismatch[] = [];
  for (const cell of cells) {
    for (const [direction, column, row] of [["east", cell.column + 1, cell.row], ["north", cell.column, cell.row + 1]] as const) {
      const neighbor = cellByPosition.get(`${column},${row}`);
      if (!neighbor) continue;
      const [sourceBounds, neighborBounds] = await Promise.all([worldBounds(cell), worldBounds(neighbor)]);
      const delta = direction === "east" ? Math.abs(sourceBounds.max.x - neighborBounds.min.x) : Math.abs(sourceBounds.max.z - neighborBounds.min.z);
      if (delta <= 1e-4) continue;
      mismatches.push({
        sourceVariantId: cell.variant.id,
        neighborVariantId: neighbor.variant.id,
        sourcePosition: { column: cell.column, row: cell.row },
        neighborPosition: { column: neighbor.column, row: neighbor.row },
        direction,
        boundsDelta: delta
      });
    }
  }
  return mismatches;
}

function positionKey(object: SceneObject) { return `${object.position.x},${object.position.z}`; }
function positionKeyForCell(cell: SolvedRoadCell, objects: readonly SceneObject[]) {
  const match = objects.find((object) => object.name.endsWith(`[${cell.column}, ${cell.row}]`));
  if (!match) throw new Error(`No scene object for ${cell.variant.id} at ${cell.column},${cell.row}.`);
  return positionKey(match);
}

async function transformedBounds(assetId: string, object: SceneObject, root: string) {
  const instance = (await loadRoadScene(assetId, root)).clone(true);
  centerGroundFootprintOnOrigin(instance);
  instance.position.set(object.position.x, object.position.y, object.position.z);
  instance.rotation.y = object.rotationY;
  instance.scale.setScalar(object.scale);
  instance.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(instance);
}

function loadRoadScene(assetId: string, root: string) {
  let scene = sceneCache.get(assetId);
  if (!scene) {
    const folder = assetId.split(".").at(-1)!;
    const file = join(root, folder, `${folder}.glb`);
    scene = readFile(file)
      .then((buffer) => Uint8Array.from(buffer).buffer)
      .then((data) => loader.parseAsync(data, ""))
      .then((gltf) => gltf.scene);
    sceneCache.set(assetId, scene);
  }
  return scene;
}
