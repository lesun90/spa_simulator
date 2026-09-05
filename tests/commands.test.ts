import { describe, expect, test } from "vitest";
import {
  addObjectCommand,
  createHistory,
  duplicateObjectCommand,
  executeCommand,
  redo,
  undo,
  updateObjectCommand
} from "../src/editor-core/commands";
import { createScene } from "../src/editor-core/scene";

describe("scene command history", () => {
  test("executes undo and redo for persistent scene edits", () => {
    const scene = createScene("Command Test");
    const object = {
      id: "obj_1",
      assetId: "props.cone",
      name: "cone_1",
      position: { x: 0.5, y: 0, z: 0.5 },
      rotationY: 0,
      scale: 1
    };

    const placed = executeCommand(createHistory(scene), addObjectCommand(object));
    expect(placed.scene.objects).toHaveLength(1);

    const undone = undo(placed);
    expect(undone.scene.objects).toHaveLength(0);

    const redone = redo(undone);
    expect(redone.scene.objects).toHaveLength(1);
  });

  test("clears redo history when a new edit is made after undo", () => {
    const scene = createScene("Redo Branch");
    const first = executeCommand(
      createHistory(scene),
      addObjectCommand({
        id: "obj_1",
        assetId: "props.cone",
        name: "cone_1",
        position: { x: 0.5, y: 0, z: 0.5 },
        rotationY: 0,
        scale: 1
      })
    );
    const branched = executeCommand(
      undo(first),
      addObjectCommand({
        id: "obj_2",
        assetId: "vegetation.oak",
        name: "oak_1",
        position: { x: 1.5, y: 0, z: 1.5 },
        rotationY: 0,
        scale: 1
      })
    );

    expect(redo(branched)).toBe(branched);
    expect(branched.scene.objects.map((object) => object.id)).toEqual(["obj_2"]);
  });

  test("updates and duplicates selected objects through commands", () => {
    const scene = createScene("Transforms");
    const withObject = executeCommand(
      createHistory(scene),
      addObjectCommand({
        id: "obj_1",
        assetId: "props.cone",
        name: "cone_1",
        position: { x: 0.5, y: 0, z: 0.5 },
        rotationY: 0,
        scale: 1
      })
    );

    const moved = executeCommand(
      withObject,
      updateObjectCommand("obj_1", { name: "Corner cone", position: { x: 3, y: 0, z: 4 }, rotationY: 1, scale: 2 })
    );
    const duplicated = executeCommand(moved, duplicateObjectCommand("obj_1", "obj_2"));

    expect(duplicated.scene.objects).toMatchObject([
      { id: "obj_1", name: "Corner cone", position: { x: 3, y: 0, z: 4 }, rotationY: 1, scale: 2 },
      { id: "obj_2", name: "Corner cone copy", position: { x: 4, y: 0, z: 5 }, rotationY: 1, scale: 2 }
    ]);
  });

  test("undo restores the previous object name", () => {
    const scene = createScene("Rename");
    const withObject = executeCommand(
      createHistory(scene),
      addObjectCommand({
        id: "obj_1",
        assetId: "props.cone",
        name: "cone_1",
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        scale: 1
      })
    );

    const renamed = executeCommand(withObject, updateObjectCommand("obj_1", { name: "Lobby cone" }));
    const restored = undo(renamed);

    expect(renamed.scene.objects[0].name).toBe("Lobby cone");
    expect(restored.scene.objects[0].name).toBe("cone_1");
  });
});
