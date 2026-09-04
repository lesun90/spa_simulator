import { describe, expect, test } from "vitest";
import { shouldClearSelectionOnGroundClick } from "../src/features/world/worldInteraction";

describe("world interaction decisions", () => {
  test("clears selection on a normal select-mode ground click", () => {
    expect(shouldClearSelectionOnGroundClick({ activeTool: "select", placementAssetId: null, hasGroundPoint: true })).toBe(true);
  });

  test("keeps selection while placing or using another tool", () => {
    expect(shouldClearSelectionOnGroundClick({ activeTool: "select", placementAssetId: "props.cone", hasGroundPoint: true })).toBe(false);
    expect(shouldClearSelectionOnGroundClick({ activeTool: "erase", placementAssetId: null, hasGroundPoint: true })).toBe(false);
    expect(shouldClearSelectionOnGroundClick({ activeTool: "select", placementAssetId: null, hasGroundPoint: false })).toBe(false);
  });
});
