import * as THREE from "three";
import { describe, expect, test } from "vitest";
import { applyGridVisibilityColors, gridColorsForGroundColor } from "../src/features/world/gridVisibility";

describe("grid visibility", () => {
  test("uses light grid lines over a dark ground", () => {
    expect(gridColorsForGroundColor("#050608")).toEqual({ center: 0x9fb0c7, grid: 0xe6edf7 });
  });

  test("uses dark grid lines over a light ground", () => {
    expect(gridColorsForGroundColor("#eeeeee")).toEqual({ center: 0x2f3948, grid: 0x4a5566 });
  });

  test("keeps a visible fallback for invalid ground colors", () => {
    expect(gridColorsForGroundColor("not-a-color")).toEqual({ center: 0x9fb0c7, grid: 0xe6edf7 });
  });

  test("updates the grid helper vertex colors", () => {
    const grid = new THREE.GridHelper(2, 2, 0xffffff, 0xffffff);

    applyGridVisibilityColors(grid, { center: 0x2f3948, grid: 0x4a5566 });

    const colors = grid.geometry.getAttribute("color");
    const expectedLine = new THREE.Color(0x4a5566);
    const expectedCenter = new THREE.Color(0x2f3948);
    expect(colors.getX(0)).toBeCloseTo(expectedLine.r);
    expect(colors.getX(4)).toBeCloseTo(expectedCenter.r);
    expect(colors.getX(8)).toBeCloseTo(expectedLine.r);
  });
});
