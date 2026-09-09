import * as THREE from "three";
import { describe, expect, test, vi } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import type { Scene } from "../src/editor-core/scene";
import type { InteractionSystem } from "../src/engine/InteractionSystem";
import { SceneObjectsFeature } from "../src/features/world/SceneObjectsFeature";

describe("scene object transform previews", () => {
  test("applies and commits snapped vertical positions while moving", async () => {
    const onTransformCommit = vi.fn();
    const feature = new SceneObjectsFeature(
      {
        instantiate: async () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
      } as never,
      {
        register: () => () => {}
      } as unknown as InteractionSystem,
      {
        getGroundPoint: () => ({ x: 1, y: 0, z: 1 }),
        onObjectPointerDown: () => true,
        onObjectPointerMove: () => {},
        onObjectPointerUp: () => {},
        onObjectClick: () => {},
        onTransformPreview: () => ({ position: { x: 1.5, y: 2.75, z: 1.5 } }),
        onTransformCommit,
        onTransformStart: () => {},
        onTransformEnd: () => {},
        setCursor: () => {}
      }
    );
    const scene = testScene({ position: { x: 1.5, y: 0, z: 1.5 } });
    const asset = testAsset();

    await feature.sync(scene, [asset], "obj_1", new Set());
    (feature as unknown as { beginTransform(id: string, mode: "move", event: { x: number; y: number }): void }).beginTransform(
      "obj_1",
      "move",
      { x: 0, y: 0 }
    );
    (feature as unknown as { finishTransform(event: { x: number; y: number }): void }).finishTransform({ x: 10, y: 0 });

    const center = feature.getObjectBox("obj_1")?.getCenter(new THREE.Vector3());
    expect(center?.y).toBeCloseTo(2.75);
    expect(onTransformCommit).toHaveBeenCalledWith(
      "obj_1",
      expect.objectContaining({ position: { x: 1.5, y: 2.75, z: 1.5 } })
    );
  });

  test("applies snapped preview positions while resizing", async () => {
    const feature = new SceneObjectsFeature(
      {
        instantiate: async () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
      } as never,
      {
        register: () => () => {}
      } as unknown as InteractionSystem,
      {
        getGroundPoint: () => ({ x: 3, y: 0, z: 1 }),
        onObjectPointerDown: () => true,
        onObjectPointerMove: () => {},
        onObjectPointerUp: () => {},
        onObjectClick: () => {},
        onTransformPreview: () => ({ scale: 2, position: { x: 2, y: 0, z: 4 } }),
        onTransformCommit: () => {},
        onTransformStart: () => {},
        onTransformEnd: () => {},
        setCursor: () => {}
      }
    );
    const scene = testScene({ position: { x: 1, y: 0, z: 3 } });
    const asset = testAsset();

    await feature.sync(scene, [asset], "obj_1", new Set());
    (feature as unknown as { beginTransform(id: string, mode: "scale", event: { x: number; y: number }): void }).beginTransform(
      "obj_1",
      "scale",
      { x: 0, y: 0 }
    );
    (feature as unknown as { updateTransform(event: { x: number; y: number }): void }).updateTransform({ x: 20, y: 0 });

    const center = feature.getObjectBox("obj_1")?.getCenter(new THREE.Vector3());
    expect(center?.x).toBe(2);
    expect(center?.z).toBe(4);
  });
});

function testScene(objectPatch: Partial<Scene["objects"][number]> = {}): Scene {
  return {
    id: "scene_1",
    name: "Scene",
    description: "",
    grid: { cellSize: 2, width: 20, depth: 20 },
    background: { type: "color", color: "#000000", textureUrl: null },
    ground: { type: "color", color: "#000000", textureUrl: null },
    objects: [
      {
        id: "obj_1",
        assetId: "asset.cube",
        name: "Cube",
        position: { x: 1, y: 0, z: 3 },
        rotationY: 0,
        scale: 1,
        ...objectPatch
      }
    ]
  };
}

function testAsset(): AssetCatalogEntry {
  return {
    id: "asset.cube",
    label: "Cube",
    category: "Test",
    source: "shared",
    implementation: "placeholder"
  };
}
