import type { Vector3Data } from "../../editor-core/scene";

export const MIN_OBJECT_SCALE = 0.05;
export const ROTATION_RADIANS_PER_PIXEL = 0.01;
const TRANSFORM_EPSILON = 0.0001;

export interface ObjectTransformSnapshot {
  position: Vector3Data;
  rotationY: number;
  scale: number;
}

export type DirectObjectTransformMode = "move" | "rotate";

export function moveOnGround(startPosition: Vector3Data, startPointer: Vector3Data, currentPointer: Vector3Data): Vector3Data {
  return {
    x: startPosition.x + currentPointer.x - startPointer.x,
    y: 0,
    z: startPosition.z + currentPointer.z - startPointer.z
  };
}

export function scaleFromGroundHandle(
  startScale: number,
  center: Vector3Data,
  startPointer: Vector3Data,
  currentPointer: Vector3Data,
  minScale = MIN_OBJECT_SCALE
): number {
  const startDistance = groundDistance(center, startPointer);
  if (startDistance <= 0.0001) return Math.max(startScale, minScale);

  const currentDistance = groundDistance(center, currentPointer);
  return Math.max(startScale * (currentDistance / startDistance), minScale);
}

export function rotateAroundGroundCenter(
  startRotationY: number,
  center: Vector3Data,
  startPointer: Vector3Data,
  currentPointer: Vector3Data
): number {
  return startRotationY + groundAngle(center, startPointer) - groundAngle(center, currentPointer);
}

export function rotateFromHorizontalDrag(
  startRotationY: number,
  startScreenX: number,
  currentScreenX: number,
  radiansPerPixel = ROTATION_RADIANS_PER_PIXEL
): number {
  return startRotationY + (currentScreenX - startScreenX) * radiansPerPixel;
}

export function snapRotationToQuarterTurn(radians: number): number {
  const quarterTurn = Math.PI / 2;
  return Math.round(radians / quarterTurn) * quarterTurn;
}

export function hasTransformChanged(start: ObjectTransformSnapshot, current: ObjectTransformSnapshot): boolean {
  return (
    Math.abs(start.position.x - current.position.x) > TRANSFORM_EPSILON ||
    Math.abs(start.position.y - current.position.y) > TRANSFORM_EPSILON ||
    Math.abs(start.position.z - current.position.z) > TRANSFORM_EPSILON ||
    Math.abs(start.rotationY - current.rotationY) > TRANSFORM_EPSILON ||
    Math.abs(start.scale - current.scale) > TRANSFORM_EPSILON
  );
}

export function transformModeForPointerButton(button: number): DirectObjectTransformMode | null {
  if (button === 0) return "move";
  if (button === 2) return "rotate";
  return null;
}

function groundDistance(a: Vector3Data, b: Vector3Data): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function groundAngle(center: Vector3Data, point: Vector3Data): number {
  return Math.atan2(point.z - center.z, point.x - center.x);
}
