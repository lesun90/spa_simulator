import * as THREE from "three";
import { describe, expect, test } from "vitest";
import { snapTransformPatchForInspection } from "../src/features/world/transformSnap";

describe("object transform snapping", () => {
  test("snaps moved object positions to grid cell centers in Cell mode", () => {
    expect(
      snapTransformPatchForInspection(
        {
          position: { x: 1.1, y: 0, z: 2.9 }
        },
        "snap",
        { cellSize: 2, width: 20, depth: 20 },
        1,
        1
      )
    ).toEqual({
      position: { x: 1, y: 0, z: 3 },
      rotationY: undefined,
      scale: undefined
    });
  });

  test("snaps even-cell object centers to grid lines in Cell mode", () => {
    expect(
      snapTransformPatchForInspection(
        {
          position: { x: 1.1, y: 0, z: 2.9 }
        },
        "snap",
        { cellSize: 2, width: 20, depth: 20 },
        2,
        1
      )
    ).toEqual({
      position: { x: 2, y: 0, z: 2 },
      rotationY: undefined,
      scale: undefined
    });
  });

  test("realigns an object center when resizing to an even-cell footprint in Cell mode", () => {
    expect(
      snapTransformPatchForInspection(
        {
          scale: 2
        },
        "snap",
        { cellSize: 2, width: 20, depth: 20 },
        1,
        1,
        { x: 1, y: 0, z: 3 }
      )
    ).toEqual({
      position: { x: 2, y: 0, z: 4 },
      rotationY: undefined,
      scale: 2
    });
  });

  test("snaps rotation to quarter turns in Cell mode", () => {
    expect(
      snapTransformPatchForInspection(
        {
          rotationY: THREE.MathUtils.degToRad(37)
        },
        "snap",
        { cellSize: 2, width: 20, depth: 20 },
        1,
        1
      )
    ).toEqual({
      position: undefined,
      rotationY: 0,
      scale: undefined
    });
  });

  test("preserves continuous transform patches in Free mode", () => {
    const patch = {
      position: { x: 1.1, y: 0, z: 2.9 },
      rotationY: THREE.MathUtils.degToRad(37),
      scale: 1.45
    };

    expect(snapTransformPatchForInspection(patch, "free", { cellSize: 2, width: 20, depth: 20 }, 1.45, 1)).toBe(patch);
  });
});
