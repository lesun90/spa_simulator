import * as THREE from "three";
import { describe, expect, test } from "vitest";
import { createScene } from "../src/editor-core/scene";
import type { InteractionSystem } from "../src/engine/InteractionSystem";
import { WorldFeature } from "../src/features/world/WorldFeature";
import { EditorState } from "../src/state/EditorState";

describe("world object placement", () => {
  test("stacks a new object on the hovered object only when the pointer resolves to the same snapped cell", () => {
    const state = new EditorState();
    state.history = { scene: createScene("Scene"), undoStack: [], redoStack: [] };
    state.placementAssetId = "asset.cube";
    const world = new WorldFeature(
      document.createElement("canvas"),
      { instantiate: async () => null } as never,
      { register: () => () => {} } as unknown as InteractionSystem,
      state
    );
    (world as unknown as { objects: { getObjectBox: () => THREE.Box3 } }).objects = {
      getObjectBox: () => new THREE.Box3(new THREE.Vector3(1, 0, 1), new THREE.Vector3(2, 2.75, 2))
    };
    const resolve = (world as unknown as {
      resolveObjectPlacementPosition(objectId: string, point: THREE.Vector3 | null): { x: number; y: number; z: number } | null;
    }).resolveObjectPlacementPosition.bind(world);

    expect(resolve("obj_1", new THREE.Vector3(1.2, 0, 1.2))).toEqual({ x: 1.5, y: 2.75, z: 1.5 });
    expect(resolve("obj_1", new THREE.Vector3(2.2, 0, 1.2))).toEqual({ x: 2.5, y: 0, z: 1.5 });
  });

  test("snaps moved objects onto another object's top when the moved center lands in its cell", () => {
    const state = new EditorState();
    const scene = createScene("Scene");
    scene.grid = { cellSize: 1, width: 20, depth: 20 };
    scene.objects = [
      {
        id: "moving",
        assetId: "asset.cube",
        name: "Moving",
        position: { x: 0.5, y: 0, z: 0.5 },
        rotationY: 0,
        scale: 1
      },
      {
        id: "target",
        assetId: "asset.cube",
        name: "Target",
        position: { x: 1.5, y: 0, z: 1.5 },
        rotationY: 0,
        scale: 1
      }
    ];
    state.history = { scene, undoStack: [], redoStack: [] };
    const world = new WorldFeature(
      document.createElement("canvas"),
      { instantiate: async () => null } as never,
      { register: () => () => {} } as unknown as InteractionSystem,
      state
    );
    (world as unknown as {
      objects: {
        getObjectScaleToFitGridCell: () => number;
        getObjectBox: (id: string) => THREE.Box3 | null;
      };
    }).objects = {
      getObjectScaleToFitGridCell: () => 1,
      getObjectBox: (id) =>
        id === "target" ? new THREE.Box3(new THREE.Vector3(1, 0, 1), new THREE.Vector3(2, 2.75, 2)) : null
    };
    const snap = (world as unknown as {
      snapTransformPatch(
        objectId: string,
        mode: "move",
        patch: { position: { x: number; y: number; z: number } }
      ): { position?: { x: number; y: number; z: number } };
    }).snapTransformPatch.bind(world);

    expect(snap("moving", "move", { position: { x: 1.2, y: 0, z: 1.2 } }).position).toEqual({ x: 1.5, y: 2.75, z: 1.5 });
    expect(snap("moving", "move", { position: { x: 2.2, y: 0, z: 1.2 } }).position).toEqual({ x: 2.5, y: 0, z: 1.5 });
  });
});
