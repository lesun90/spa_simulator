import type { AssetCatalogEntry } from "./assets";
import { isSurfaceAppearance, type Scene, type SceneObject } from "./scene";

export interface ValidationResult {
  valid: boolean;
  diagnostics: string[];
}

export function validateSceneJson(value: unknown): ValidationResult {
  const diagnostics: string[] = [];
  const scene = value as Partial<Scene>;

  if (!scene || typeof scene !== "object") {
    return { valid: false, diagnostics: ["Scene JSON must be an object."] };
  }

  if (!scene.id || typeof scene.id !== "string") diagnostics.push("Scene ID is required.");
  if (!scene.name || typeof scene.name !== "string") diagnostics.push("Scene name is required.");
  if (scene.description !== undefined && typeof scene.description !== "string") {
    diagnostics.push("Scene description must be a string.");
  }
  if (!scene.grid || !isPositiveNumber(scene.grid.cellSize) || !isPositiveNumber(scene.grid.width) || !isPositiveNumber(scene.grid.depth)) {
    diagnostics.push("Scene grid must define positive cellSize, width, and depth.");
  }
  if (scene.background !== undefined && !isSurfaceAppearance(scene.background)) {
    diagnostics.push("Scene background must define a valid type and color.");
  }
  if (scene.ground !== undefined && !isSurfaceAppearance(scene.ground)) {
    diagnostics.push("Scene ground must define a valid type and color.");
  }
  if (!Array.isArray(scene.objects)) {
    diagnostics.push("Scene objects must be an array.");
  } else {
    scene.objects.forEach((object, index) => validateObject(object, index, diagnostics));
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

export function validateSceneForSave(scene: Scene, catalog: AssetCatalogEntry[]): ValidationResult {
  const diagnostics = validateSceneJson(scene).diagnostics;
  const assets = new Map(catalog.map((asset) => [asset.id, asset]));

  for (const object of scene.objects) {
    const asset = assets.get(object.assetId);
    if (!asset) {
      diagnostics.push(`Object ${object.id} references unknown asset ${object.assetId}.`);
    } else if (asset.source === "temporary") {
      diagnostics.push(`Object ${object.id} references temporary asset ${object.assetId}; add it to the shared library before saving.`);
    }
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

function validateObject(object: SceneObject, index: number, diagnostics: string[]) {
  if (!object || typeof object !== "object") {
    diagnostics.push(`Object ${index} must be an object.`);
    return;
  }

  if (!object.id || typeof object.id !== "string") diagnostics.push(`Object ${index} requires an ID.`);
  if (!object.assetId || typeof object.assetId !== "string") diagnostics.push(`Object ${index} requires an asset ID.`);
  if (!object.position || !isNumber(object.position.x) || !isNumber(object.position.y) || !isNumber(object.position.z)) {
    diagnostics.push(`Object ${index} requires a numeric position.`);
  }
  if (!isNumber(object.rotationY)) diagnostics.push(`Object ${index} requires a numeric rotationY.`);
  if (!isPositiveNumber(object.scale)) diagnostics.push(`Object ${index} requires a positive scale.`);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isNumber(value) && value > 0;
}
