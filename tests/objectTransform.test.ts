import * as THREE from "three";
import { describe, expect, test } from "vitest";
import {
  hasTransformChanged,
  moveOnGround,
  rotateFromHorizontalDrag,
  rotateAroundGroundCenter,
  snapRotationToQuarterTurn,
  scaleFromGroundHandle,
  transformModeForPointerButton
} from "../src/features/world/objectTransform";

describe("object transform gestures", () => {
  test("moves an object by the horizontal ground-plane pointer delta", () => {
    expect(
      moveOnGround(
        { x: 2, y: 0, z: 3 },
        { x: 10, y: 0, z: 20 },
        { x: 12.5, y: 0, z: 18 }
      )
    ).toEqual({ x: 4.5, y: 0, z: 1 });
  });

  test("scales uniformly from a dragged footprint handle and clamps tiny values", () => {
    expect(
      scaleFromGroundHandle(
        2,
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 }
      )
    ).toBe(4);

    expect(
      scaleFromGroundHandle(
        2,
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 0.01, y: 0, z: 0 }
      )
    ).toBe(0.05);
  });

  test("rotates opposite the ground-angle delta so right-drag follows the mouse direction", () => {
    expect(
      rotateAroundGroundCenter(
        Math.PI / 4,
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }
      )
    ).toBeCloseTo(-Math.PI / 4);
  });

  test("rotates from horizontal mouse movement only", () => {
    expect(rotateFromHorizontalDrag(1, 100, 140)).toBeCloseTo(1.4);
    expect(rotateFromHorizontalDrag(1, 100, 60)).toBeCloseTo(0.6);
    expect(rotateFromHorizontalDrag(1, 100, 100)).toBe(1);
  });

  test("snaps rotation to the nearest quarter turn", () => {
    expect(snapRotationToQuarterTurn(THREE.MathUtils.degToRad(40))).toBeCloseTo(0);
    expect(snapRotationToQuarterTurn(THREE.MathUtils.degToRad(50))).toBeCloseTo(Math.PI / 2);
    expect(snapRotationToQuarterTurn(THREE.MathUtils.degToRad(181))).toBeCloseTo(Math.PI);
  });

  test("ignores no-op transform previews so clicks do not create history entries", () => {
    const start = {
      position: { x: 2, y: 0, z: 3 },
      rotationY: 1,
      scale: 1.5
    };

    expect(hasTransformChanged(start, { position: { x: 2, y: 0, z: 3 }, rotationY: 1, scale: 1.5 })).toBe(false);
    expect(hasTransformChanged(start, { position: { x: 2.2, y: 0, z: 3 }, rotationY: 1, scale: 1.5 })).toBe(true);
  });

  test("maps pointer buttons to direct object transform modes", () => {
    expect(transformModeForPointerButton(0)).toBe("move");
    expect(transformModeForPointerButton(2)).toBe("rotate");
    expect(transformModeForPointerButton(1)).toBe(null);
  });
});
