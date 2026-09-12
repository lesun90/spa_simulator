import { describe, expect, test } from "vitest";
import { assetSlug, createScene, normalizeScene, objectDisplayNames, type Scene, type SceneObject } from "../src/editor-core/scene";

describe("assetSlug", () => {
  test("takes the lowercased, underscored tail of a dotted asset id", () => {
    expect(assetSlug("vegetation.oak")).toBe("oak");
    expect(assetSlug("props.traffic-cone")).toBe("traffic_cone");
  });
});

describe("objectDisplayNames", () => {
  test("numbers objects per asset in scene order, starting at 1", () => {
    const objects: SceneObject[] = [
      object("obj_1", "vegetation.oak"),
      object("obj_2", "props.cone"),
      object("obj_3", "vegetation.oak")
    ];

    const names = objectDisplayNames(objects);

    expect(names.get("obj_1")).toBe("oak_1");
    expect(names.get("obj_2")).toBe("cone_1");
    expect(names.get("obj_3")).toBe("oak_2");
  });

  test("uses custom object names before generated asset names", () => {
    const objects: SceneObject[] = [
      { ...object("obj_1", "vegetation.oak"), name: "Entry tree" },
      object("obj_2", "vegetation.oak")
    ];

    const names = objectDisplayNames(objects);

    expect(names.get("obj_1")).toBe("Entry tree");
    expect(names.get("obj_2")).toBe("oak_2");
  });
});

describe("normalizeScene", () => {
  test("creates new scenes with dark background and ground colors for grid contrast", () => {
    const scene = createScene("Downtown");

    expect(scene.background).toEqual({ type: "color", color: "#15181d", textureUrl: null });
    expect(scene.ground).toEqual({ type: "color", color: "#050608", textureUrl: null });
  });

  test("backfills description and background on scenes saved before those fields existed", () => {
    const legacy = {
      id: "scene_1",
      name: "Downtown",
      grid: { cellSize: 1, width: 100, depth: 100 },
      objects: []
    } as unknown as Scene;

    const normalized = normalizeScene(legacy);

    expect(normalized.description).toBe("");
    expect(normalized.background).toEqual({ type: "color", color: "#15181d", textureUrl: null });
    expect(normalized.ground).toEqual({ type: "color", color: "#050608", textureUrl: null });
  });

  test("backfills object names for scenes saved before object names existed", () => {
    const legacy = {
      id: "scene_1",
      name: "Downtown",
      description: "",
      grid: { cellSize: 1, width: 100, depth: 100 },
      background: { type: "color", color: "#eef2f7", textureUrl: null },
      ground: { type: "color", color: "#eef2f7", textureUrl: null },
      objects: [
        object("obj_1", "props.traffic-cone"),
        object("obj_2", "props.traffic-cone")
      ],
      environment: null
    } as Scene;

    const normalized = normalizeScene(legacy);

    expect(normalized.objects.map((item) => item.name)).toEqual(["traffic_cone_1", "traffic_cone_2"]);
  });

  test("preserves stacked object heights when loading scenes", () => {
    const scene: Scene = {
      id: "scene_1",
      name: "Downtown",
      description: "",
      grid: { cellSize: 1, width: 100, depth: 100 },
      background: { type: "color", color: "#eef2f7", textureUrl: null },
      ground: { type: "color", color: "#eef2f7", textureUrl: null },
      objects: [
        { ...object("obj_1", "props.traffic-cone"), position: { x: 1.5, y: 2.75, z: 1.5 } }
      ],
      environment: null
    };

    expect(normalizeScene(scene).objects[0].position).toEqual({ x: 1.5, y: 2.75, z: 1.5 });
  });

  test("leaves already-populated fields untouched", () => {
    const scene: Scene = {
      id: "scene_1",
      name: "Downtown",
      description: "A city block",
      grid: { cellSize: 1, width: 100, depth: 100 },
      background: { type: "texture", color: "#000000", textureUrl: "data:image/png;base64,abc" },
      ground: { type: "color", color: "#8a7a63", textureUrl: null },
      objects: [],
      environment: null
    };

    expect(normalizeScene(scene)).toEqual(scene);
  });
});

function object(id: string, assetId: string): SceneObject {
  return { id, assetId, name: "", position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 };
}
