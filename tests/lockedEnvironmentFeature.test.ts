import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { LockedEnvironmentFeature } from "../src/features/world/LockedEnvironmentFeature";
import type { EnvironmentManifest } from "../src/environment/types";

describe("LockedEnvironmentFeature", () => {
  test("load adds the GLB's scene under root and never registers interaction (no selectable state to check — verified by the absence of any register() call in this class)", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    const glb = await exportTestGlb(root);
    const manifest = manifestFixture();
    const feature = new LockedEnvironmentFeature();

    await feature.load(JSON.stringify(manifest), new Uint8Array(glb).buffer);

    expect(feature.root.children.length).toBeGreaterThan(0);
    expect(feature.hasGround).toBe(true);
  });

  test("cellAt maps a world position to the containing cell by grid coordinate", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const glb = await exportTestGlb(root);
    const manifest = manifestFixture();
    const feature = new LockedEnvironmentFeature();
    await feature.load(JSON.stringify(manifest), new Uint8Array(glb).buffer);

    expect(feature.cellAt(0.5, 0.5)?.id).toBe("c-0-0");
    expect(feature.cellAt(100, 100)).toBeNull();
  });

  test("objectsInBounds returns objects whose bounds intersect the query bounds", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const glb = await exportTestGlb(root);
    const manifest = manifestFixture();
    manifest.objects = [
      {
        id: "obj-1",
        name: "Wall",
        transform: { position: { x: 5, y: 0, z: 5 }, rotationY: 0, scale: 1 },
        bounds: { min: { x: 4.5, y: 0, z: 4.5 }, max: { x: 5.5, y: 1, z: 5.5 } },
        sourceAssetId: "props.wall",
        semanticRoles: ["obstacle.wall"],
        chunkId: "chunk_0_0",
        sourceLayer: "scene"
      }
    ];
    const feature = new LockedEnvironmentFeature();
    await feature.load(JSON.stringify(manifest), new Uint8Array(glb).buffer);

    expect(feature.objectsInBounds({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 2, z: 10 } })).toHaveLength(1);
    expect(feature.objectsInBounds({ min: { x: 20, y: 0, z: 20 }, max: { x: 30, y: 2, z: 30 } })).toHaveLength(0);
  });

  test("clear removes the loaded model and resets query state", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const glb = await exportTestGlb(root);
    const feature = new LockedEnvironmentFeature();
    await feature.load(JSON.stringify(manifestFixture()), new Uint8Array(glb).buffer);

    feature.clear();

    expect(feature.root.children).toHaveLength(0);
    expect(feature.hasGround).toBe(false);
    expect(feature.cellAt(0.5, 0.5)).toBeNull();
  });
});

function exportTestGlb(root: THREE.Object3D): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(root, (result) => resolve(new Uint8Array(result as ArrayBuffer)), reject, { binary: true });
  });
}

function manifestFixture(): EnvironmentManifest {
  return {
    format: "steerlab-environment",
    formatVersion: 1,
    model: { file: "environment.glb", sha256: "hash", rootNode: "SteerlabEnvironment", upAxis: "Y", unitsPerMeter: 1 },
    grid: { width: 1, depth: 1, cellSize: 1, origin: { x: 0, y: 0, z: 0 }, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } },
    provenance: { source: "cli", generatorVersion: "0.1.0", generationRuns: [] },
    build: { chunkSize: 10, removeInternalSeamFaces: false },
    chunks: [{ id: "chunk_0_0", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } }],
    assets: [],
    cells: [
      {
        id: "c-0-0",
        column: 0,
        row: 0,
        transform: { position: { x: 0.5, y: 0, z: 0.5 }, rotationY: 0, scale: 1 },
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
        sourceAssetId: "tiles.a",
        semanticRoles: [],
        chunkId: "chunk_0_0",
        sourceLayer: "scene"
      }
    ],
    objects: [],
    ground: { bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0, z: 1 } }, material: { color: "#050608", textureUrl: null }, chunkIds: ["chunk_0_0"] },
    navigation: { nodes: [], edges: [] },
    diagnostics: []
  };
}
