import { describe, expect, test } from "vitest";
import { validateSceneForSave } from "../src/editor-core/validation";
import type { Scene } from "../src/editor-core/scene";
import { validateSceneSaveRequest } from "../server/viteApiPlugin";

describe("scene validation", () => {
  test("rejects saved scenes that reference temporary assets", () => {
    const result = validateSceneForSave(
      {
        id: "scene_1",
        name: "Temporary Asset",
        description: "",
        grid: { cellSize: 1, width: 10, depth: 10 },
        background: { type: "color", color: "#eef2f7", textureUrl: null },
        ground: { type: "color", color: "#eef2f7", textureUrl: null },
        objects: [
          {
            id: "obj_1",
            assetId: "temp.imported",
            position: { x: 0, y: 0, z: 0 },
            rotationY: 0,
            scale: 1
          }
        ]
      },
      [{ id: "temp.imported", label: "Imported", category: "imports", source: "temporary", implementation: "module" }]
    );

    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]).toContain("temporary asset");
  });
});

test("server save validation rejects mismatched route ids and temporary assets", () => {
  const scene: Scene = {
    id: "scene_body",
    name: "Bad Save",
    description: "",
    grid: { cellSize: 1, width: 10, depth: 10 },
    background: { type: "color", color: "#eef2f7", textureUrl: null },
    ground: { type: "color", color: "#eef2f7", textureUrl: null },
    objects: [
      {
        id: "obj_1",
        assetId: "temp.review",
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        scale: 1
      }
    ]
  };

  const result = validateSceneSaveRequest("scene_route", scene, [
    { id: "temp.review", label: "Review", category: "imports", source: "temporary", implementation: "placeholder" }
  ]);

  expect(result.valid).toBe(false);
  expect(result.diagnostics).toContain("Route scene ID does not match the scene body ID.");
  expect(result.diagnostics.join(" ")).toContain("temporary asset");
});
