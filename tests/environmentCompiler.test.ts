import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { compileEnvironmentPackage } from "../src/environment/compiler";
import { readGlbInfo } from "../src/environment/glb";
import "../src/environment/nodeGltfShim";
import { validateEnvironmentPackage } from "../src/environment/packageValidator";
import type { SceneRecipe } from "../src/environment/types";

describe("compileEnvironmentPackage", () => {
  let assetRoot: string;

  afterEach(async () => {
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  test("compiles a recipe into a manifest + GLB pair that pass validateEnvironmentPackage", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const assets: AssetCatalogEntry[] = [{ id: "tiles.a", label: "Tile A", category: "tiles", source: "shared", implementation: "placeholder" }];
    const recipe = recipeFixture();

    const result = await compileEnvironmentPackage(recipe, assets, {
      chunkSize: 10,
      removeInternalSeamFaces: false,
      assetRoot,
      source: "cli",
      generatorVersion: "0.1.0"
    });

    if ("status" in result) throw new Error(`expected success, got diagnostics: ${result.diagnostics.join(", ")}`);
    expect(result.manifest.format).toBe("steerlab-environment");
    expect(result.manifest.model.sha256).toBeTruthy();
    expect(readGlbInfo(result.glb).valid).toBe(true);
    const validation = validateEnvironmentPackage(result.manifest, result.glb);
    expect(validation).toEqual({ valid: true, diagnostics: [] });
    expect(result.metrics.cellCount).toBe(2);
    expect(result.metrics.glbByteLength).toBe(result.glb.byteLength);
  });

  test("returns a failed result naming the missing asset instead of throwing", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const recipe = recipeFixture();

    const result = await compileEnvironmentPackage(recipe, [], {
      chunkSize: 10,
      removeInternalSeamFaces: false,
      assetRoot,
      source: "cli",
      generatorVersion: "0.1.0"
    });

    expect(result).toEqual({ status: "failed", diagnostics: ["Asset tiles.a is not present in the catalog."] });
  });

  test("removes only the shared-seam triangles between adjacent same-asset cells, leaving a non-adjacent cell of the same asset fully intact", async () => {
    // Regression test for the geometry-sharing bug fixed alongside this test: template.clone(true)
    // makes every cell placement of the same asset share ONE BufferGeometry instance by reference,
    // so mutating one cell's geometry in place (as seam removal does) used to corrupt every other
    // placement of that asset in the grid — including cells nowhere near a seam. Three cells share
    // one asset here: c-0-0 and c-1-0 are grid-adjacent (a seam pair gets processed), c-5-0 is not
    // adjacent to anything and must come out of compilation with its full, untrimmed geometry.
    assetRoot = await mkdtemp(join(process.cwd(), "tests", ".tmp-assets-"));
    await mkdir(join(assetRoot, "tiles", "wall"), { recursive: true });
    await writeFile(join(assetRoot, "tiles", "wall", "wall.js"), WALL_ASSET_MODULE_SOURCE);
    const assets: AssetCatalogEntry[] = [
      { id: "tiles.wall", label: "Wall", category: "tiles", source: "shared", implementation: "module", moduleUrl: "/assets/tiles/wall/wall.js" }
    ];
    const recipe = seamRecipeFixture();

    const result = await compileEnvironmentPackage(recipe, assets, {
      chunkSize: 1,
      removeInternalSeamFaces: true,
      assetRoot,
      source: "cli",
      generatorVersion: "0.1.0"
    });

    if ("status" in result) throw new Error(`expected success, got diagnostics: ${result.diagnostics.join(", ")}`);
    expect(readGlbInfo(result.glb).valid).toBe(true);

    // The wall asset has 6 triangles untrimmed (2 west + 2 east + 2 top). Exactly one seam pair
    // (c-0-0's east face against c-1-0's west face) should match and be removed: 2 triangles from
    // each side, 4 total. c-5-0 isn't adjacent to either, so it must keep all 6 of its triangles.
    expect(result.metrics.removedSeamTriangleCount).toBe(4);
    expect(result.metrics.triangleCount).toBe(4 + 4 + 6);

    // Directly confirm the untouched cell's own render node still has its full, uncorrupted
    // geometry, not just that the aggregate total happens to add up.
    const scene = await parseGlbScene(result.glb);
    const untouchedChunk = scene.getObjectByName("chunk_5_0");
    if (!untouchedChunk) throw new Error("expected a chunk_5_0 node in the exported GLB");
    let untouchedTriangleCount = 0;
    untouchedChunk.traverse((node) => {
      if (node instanceof THREE.Mesh) untouchedTriangleCount += triangleCountOf(node.geometry);
    });
    expect(untouchedTriangleCount).toBe(6);
  });
});

/** Parses exported GLB bytes back into a THREE.Object3D scene graph, the same realm-safe way assetGeometrySource.ts does for GLB assets. */
async function parseGlbScene(glb: Uint8Array): Promise<THREE.Object3D> {
  const arrayBuffer = new Uint8Array(glb).buffer;
  const loader = new GLTFLoader();
  return await new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, "", (gltf) => resolve(gltf.scene), reject);
  });
}

function triangleCountOf(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

/**
 * A hand-authored module asset (not THREE.BoxGeometry — see environmentSeamRemoval.test.ts's
 * comment on why: BoxGeometry's opposite faces don't share a diagonal split, so they never produce
 * an exact vertex-set match). West and east faces here use the SAME corner layout and diagonal
 * split, just mirrored in x and wound oppositely, so two adjacent placements of this asset produce
 * a genuinely matching seam pair. A top face (2 triangles) is never eligible for seam removal
 * (near-vertical normal.y check) and always survives, giving 6 untrimmed triangles total.
 */
const WALL_ASSET_MODULE_SOURCE = `export function createAsset({ THREE }) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, 0, -1,  -1, 0, 1,  -1, 1, 1,  -1, 1, -1, // west quad (0-3)
     1, 0, -1,   1, 0, 1,   1, 1, 1,   1, 1, -1, // east quad (4-7)
    -1, 1, -1,   1, 1, -1,  1, 1, 1,  -1, 1, 1   // top quad (8-11)
  ], 3));
  geometry.setIndex([
    0, 1, 2,  0, 2, 3,   // west, outward normal -X
    4, 6, 5,  4, 7, 6,   // east, outward normal +X
    8, 9, 10, 8, 10, 11  // top, normal.y far from 0
  ]);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
  return new THREE.Mesh(geometry, material);
}
`;

function seamRecipeFixture(): SceneRecipe {
  return {
    grid: { width: 6, depth: 1, cellSize: 2, origin: { x: -1, y: 0, z: -1 } },
    generationRuns: [{ seed: 1, width: 6, depth: 1, cellSize: 2 }],
    cells: [
      {
        id: "c-0-0",
        column: 0,
        row: 0,
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.wall",
        semanticRoles: [],
        sourceLayer: "scene",
        recovered: false
      },
      {
        id: "c-1-0",
        column: 1,
        row: 0,
        transform: { position: { x: 2, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.wall",
        semanticRoles: [],
        sourceLayer: "scene",
        recovered: false
      },
      {
        id: "c-5-0",
        column: 5,
        row: 0,
        transform: { position: { x: 100, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.wall",
        semanticRoles: [],
        sourceLayer: "scene",
        recovered: false
      }
    ],
    objects: [],
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}

function recipeFixture(): SceneRecipe {
  return {
    grid: { width: 2, depth: 1, cellSize: 1, origin: { x: -1, y: 0, z: -0.5 } },
    generationRuns: [{ seed: 1, width: 2, depth: 1, cellSize: 1 }],
    cells: [
      {
        id: "c-0-0",
        column: 0,
        row: 0,
        transform: { position: { x: -0.5, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.a",
        semanticRoles: [],
        sourceLayer: "scene",
        recovered: false
      },
      {
        id: "c-1-0",
        column: 1,
        row: 0,
        transform: { position: { x: 0.5, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        sourceAssetId: "tiles.a",
        semanticRoles: [],
        sourceLayer: "scene",
        recovered: false
      }
    ],
    objects: [],
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
