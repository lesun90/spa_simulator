import { describe, expect, test } from "vitest";
import { resolveGroundPosition, snapToCellCenter, snapToGridMultiplier } from "../src/editor-core/grid";

describe("grid placement", () => {
  test("snaps a ground position to the nearest square cell center", () => {
    expect(
      snapToCellCenter({ x: 12.1, y: 8, z: 9.1 }, { cellSize: 1, width: 100, depth: 100 })
    ).toEqual({ x: 12.5, y: 0, z: 9.5 });
  });

  test("free placement preserves the ground-plane x and z with y fixed to zero", () => {
    expect(resolveGroundPosition({ x: -2.25, y: 4, z: 3.75 }, "free", { cellSize: 1, width: 20, depth: 20 })).toEqual({
      x: -2.25,
      y: 0,
      z: 3.75
    });
  });

  test("stacked placement snaps x and z while preserving the target surface height", () => {
    expect(resolveGroundPosition({ x: 1.1, y: 4, z: 2.1 }, "snap", { cellSize: 1, width: 20, depth: 20 }, 3.25)).toEqual({
      x: 1.5,
      y: 3.25,
      z: 2.5
    });
  });

  test("snaps values to the supported grid-size multipliers", () => {
    expect(snapToGridMultiplier(0.7)).toBe(0.5);
    expect(snapToGridMultiplier(1.45)).toBe(1);
    expect(snapToGridMultiplier(2.6)).toBe(3);
    expect(snapToGridMultiplier(9)).toBe(8);
  });
});
