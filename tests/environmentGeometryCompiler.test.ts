import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as THREE from "three";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { assignChunks } from "../src/environment/chunking";
import { compileGeometry } from "../src/environment/geometryCompiler";
import type { SceneRecipe } from "../src/environment/types";

describe("compileGeometry", () => {
  let assetRoot: string;

  afterEach(async () => {
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  test("instances repeated placeholder placements of the same asset within a chunk into one InstancedMesh", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const assets: AssetCatalogEntry[] = [{ id: "props.cone", label: "Cone", category: "props", source: "shared", implementation: "placeholder" }];
    const recipe = recipeWithObjects([
      { id: "o-1", x: 0, z: 0 },
      { id: "o-2", x: 2, z: 0 },
      { id: "o-3", x: 4, z: 0 }
    ]);
    const chunkAssignment = assignChunks(recipe, 0);

    const compiled = await compileGeometry(recipe, assets, chunkAssignment, assetRoot);

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.stats.instancedMeshCount).toBe(1);
    expect(compiled.stats.meshCount).toBe(0);
    let instancedMesh: THREE.InstancedMesh | null = null;
    compiled.root.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) instancedMesh = node;
    });
    expect(instancedMesh).not.toBeNull();
    expect((instancedMesh as unknown as THREE.InstancedMesh).count).toBe(3);
  });

  test("merges a single placement per chunk instead of instancing it", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const assets: AssetCatalogEntry[] = [{ id: "props.cone", label: "Cone", category: "props", source: "shared", implementation: "placeholder" }];
    const recipe = recipeWithObjects([{ id: "o-1", x: 0, z: 0 }]);
    const chunkAssignment = assignChunks(recipe, 0);

    const compiled = await compileGeometry(recipe, assets, chunkAssignment, assetRoot);

    expect(compiled.stats.instancedMeshCount).toBe(0);
    expect(compiled.stats.meshCount).toBe(1);
  });

  test("keeps geometry in separate chunk groups even when the same asset repeats across chunks", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const assets: AssetCatalogEntry[] = [{ id: "props.cone", label: "Cone", category: "props", source: "shared", implementation: "placeholder" }];
    const recipe = recipeWithObjects([
      { id: "o-1", x: 0, z: 0 },
      { id: "o-2", x: 100, z: 0 }
    ]);
    const chunkAssignment = assignChunks(recipe, 1);

    const compiled = await compileGeometry(recipe, assets, chunkAssignment, assetRoot);

    expect(compiled.root.children.length).toBeGreaterThanOrEqual(2);
    expect(compiled.stats.instancedMeshCount + compiled.stats.meshCount).toBeGreaterThanOrEqual(2);
  });

  test("collects a diagnostic naming the object and asset when an asset cannot be resolved, and stops", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const recipe = recipeWithObjects([{ id: "o-1", x: 0, z: 0 }]);
    const chunkAssignment = assignChunks(recipe, 0);

    const compiled = await compileGeometry(recipe, [], chunkAssignment, assetRoot);

    expect(compiled.diagnostics).toEqual(["Asset props.cone is not present in the catalog."]);
  });

  test("collects a diagnostic for every unresolvable asset, not just the first", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const recipe = recipeWithObjects([
      { id: "o-1", x: 0, z: 0, assetId: "props.cone" },
      { id: "o-2", x: 2, z: 0, assetId: "props.lamp" }
    ]);
    const chunkAssignment = assignChunks(recipe, 0);

    const compiled = await compileGeometry(recipe, [], chunkAssignment, assetRoot);

    expect(compiled.diagnostics).toEqual([
      "Asset props.cone is not present in the catalog.",
      "Asset props.lamp is not present in the catalog."
    ]);
  });

  test("bakes a multi-material mesh as a standalone opaque node instead of collapsing its per-group materials", async () => {
    // Vitest's dev-server module graph refuses to dynamically import() files outside the project
    // root (see tests/environmentAssetGeometrySource.test.ts), so this asset root must live inside
    // the repo, unlike the other tests in this file which never trigger a dynamic import.
    assetRoot = await mkdtemp(join(process.cwd(), "tests", ".tmp-assets-"));
    await mkdir(join(assetRoot, "props", "multi"), { recursive: true });
    await writeFile(
      join(assetRoot, "props", "multi", "multi.js"),
      `export function createAsset({ THREE }) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0,  1, 0, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  0, 1, 1
  ], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0xff0000 }),
    new THREE.MeshStandardMaterial({ color: 0x00ff00 })
  ];
  return new THREE.Mesh(geometry, materials);
}
`
    );
    const assets: AssetCatalogEntry[] = [
      { id: "props.multi", label: "Multi", category: "props", source: "shared", implementation: "module", moduleUrl: "/assets/props/multi/multi.js" }
    ];
    const recipe = recipeWithObjects([{ id: "o-1", x: 0, z: 0, assetId: "props.multi" }]);
    const chunkAssignment = assignChunks(recipe, 0);

    const compiled = await compileGeometry(recipe, assets, chunkAssignment, assetRoot);

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.stats.instancedMeshCount).toBe(0);
    expect(compiled.stats.meshCount).toBe(1);
    let multiMaterialMesh: THREE.Mesh | null = null;
    compiled.root.traverse((node) => {
      if (node instanceof THREE.Mesh && Array.isArray(node.material)) multiMaterialMesh = node;
    });
    expect(multiMaterialMesh).not.toBeNull();
    const materials = (multiMaterialMesh as unknown as THREE.Mesh).material as THREE.Material[];
    expect(materials.length).toBe(2);
    expect(materials[0]).not.toBe(materials[1]);
  });

  test("does not instance or merge placements whose material is transparent", async () => {
    assetRoot = await mkdtemp(join(process.cwd(), "tests", ".tmp-assets-"));
    await mkdir(join(assetRoot, "props", "glass"), { recursive: true });
    await writeFile(
      join(assetRoot, "props", "glass", "glass.js"),
      `export function createAsset({ THREE }) {
  const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const material = new THREE.MeshStandardMaterial({ color: 0x3388ff, transparent: true, opacity: 0.5 });
  return new THREE.Mesh(geometry, material);
}
`
    );
    const assets: AssetCatalogEntry[] = [
      { id: "props.glass", label: "Glass", category: "props", source: "shared", implementation: "module", moduleUrl: "/assets/props/glass/glass.js" }
    ];
    const recipe = recipeWithObjects([
      { id: "o-1", x: 0, z: 0, assetId: "props.glass" },
      { id: "o-2", x: 1, z: 0, assetId: "props.glass" },
      { id: "o-3", x: 2, z: 0, assetId: "props.glass" }
    ]);
    const chunkAssignment = assignChunks(recipe, 0);

    const compiled = await compileGeometry(recipe, assets, chunkAssignment, assetRoot);

    expect(compiled.stats.instancedMeshCount).toBe(0);
    expect(compiled.stats.meshCount).toBe(3);
    let transparentMeshCount = 0;
    compiled.root.traverse((node) => {
      if (node instanceof THREE.Mesh && !(node instanceof THREE.InstancedMesh) && !Array.isArray(node.material) && node.material.transparent) {
        transparentMeshCount += 1;
      }
    });
    expect(transparentMeshCount).toBe(3);
  });
});

function recipeWithObjects(objects: { id: string; x: number; z: number; assetId?: string }[]): SceneRecipe {
  return {
    grid: { width: 10, depth: 10, cellSize: 1, origin: { x: -5, y: 0, z: -5 } },
    generationRuns: [],
    cells: [],
    objects: objects.map((object) => ({
      id: object.id,
      name: object.id,
      transform: { position: { x: object.x, y: 0, z: object.z }, rotationY: 0, scale: 1 },
      sourceAssetId: object.assetId ?? "props.cone",
      semanticRoles: [],
      sourceLayer: "scene"
    })),
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
