import { mkdtemp, rm } from "node:fs/promises";
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
});

function recipeWithObjects(objects: { id: string; x: number; z: number }[]): SceneRecipe {
  return {
    grid: { width: 10, depth: 10, cellSize: 1, origin: { x: -5, y: 0, z: -5 } },
    generationRuns: [],
    cells: [],
    objects: objects.map((object) => ({
      id: object.id,
      name: object.id,
      transform: { position: { x: object.x, y: 0, z: object.z }, rotationY: 0, scale: 1 },
      sourceAssetId: "props.cone",
      semanticRoles: [],
      sourceLayer: "scene"
    })),
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
