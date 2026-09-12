import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { AssetCatalogEntry } from "../editor-core/assets";
import { resolveAssetGeometry } from "./assetGeometrySource";
import type { ChunkAssignment } from "./chunking";
import type { RecipeCell, RecipeObject, SceneRecipe } from "./types";

export interface CompiledGeometry {
  root: THREE.Group;
  diagnostics: readonly string[];
  stats: { meshCount: number; instancedMeshCount: number; triangleCount: number };
}

interface FlattenedPrimitive {
  kind: "groupable";
  chunkId: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  transparent: boolean;
}

/**
 * A mesh whose material is an array (per-material face groups on `geometry.groups`) can't be split
 * into one `FlattenedPrimitive` per material entry — each would reference the SAME full geometry,
 * so N separate meshes would each render the ENTIRE geometry with only one of its N materials
 * instead of just their own group's faces. Such a mesh bypasses grouping/instancing/merging
 * entirely and is baked straight into its chunk as a standalone node.
 */
interface OpaqueMeshPrimitive {
  kind: "opaque";
  chunkId: string;
  mesh: THREE.Mesh;
}

type FlattenedItem = FlattenedPrimitive | OpaqueMeshPrimitive;

export interface FlattenedRecords {
  cellMeshesByCellId: Map<string, THREE.Mesh[]>;
  itemsByRecordId: Map<string, FlattenedItem[]>;
  diagnostics: readonly string[];
}

/** Stage 1-2: resolve every referenced asset once, then bake each record's world transform into standalone meshes. */
export async function flattenRecords(
  recipe: SceneRecipe,
  assets: readonly AssetCatalogEntry[],
  chunkAssignment: ChunkAssignment,
  assetRoot: string,
  options: { cloneCellGeometry?: boolean } = {}
): Promise<FlattenedRecords> {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const referencedAssetIds = new Set([...recipe.cells.map((cell) => cell.sourceAssetId), ...recipe.objects.map((object) => object.sourceAssetId)]);

  const templates = new Map<string, THREE.Object3D>();
  const diagnostics: string[] = [];
  for (const assetId of referencedAssetIds) {
    const result = await resolveAssetGeometry(assetsById.get(assetId), assetId, assetRoot);
    if (result.status === "error") diagnostics.push(...result.diagnostics);
    else templates.set(assetId, result.object);
  }
  if (diagnostics.length) return { cellMeshesByCellId: new Map(), itemsByRecordId: new Map(), diagnostics };

  const cellMeshesByCellId = new Map<string, THREE.Mesh[]>();
  const itemsByRecordId = new Map<string, FlattenedItem[]>();

  for (const cell of recipe.cells) {
    const { meshes, items } = flattenRecord(cell, chunkAssignment.cellChunkIds.get(cell.id)!, templates.get(cell.sourceAssetId)!, options.cloneCellGeometry ?? false);
    cellMeshesByCellId.set(cell.id, meshes);
    itemsByRecordId.set(cell.id, items);
  }
  for (const object of recipe.objects) {
    const { items } = flattenRecord(object, chunkAssignment.objectChunkIds.get(object.id)!, templates.get(object.sourceAssetId)!, false);
    itemsByRecordId.set(object.id, items);
  }

  return { cellMeshesByCellId, itemsByRecordId, diagnostics: [] };
}

/** Stage 3-4 (post seam-removal): instances/merges already-flattened items into render nodes, scoped per chunk. */
export function groupPrimitives(itemsByRecordId: ReadonlyMap<string, FlattenedItem[]>): CompiledGeometry {
  const items = [...itemsByRecordId.values()].flat();
  const primitives = items.filter((item): item is FlattenedPrimitive => item.kind === "groupable");
  const opaqueMeshes = items.filter((item): item is OpaqueMeshPrimitive => item.kind === "opaque");

  const root = new THREE.Group();
  root.name = "SteerlabEnvironment";
  let meshCount = 0;
  let instancedMeshCount = 0;
  let triangleCount = 0;

  const chunkGroups = new Map<string, THREE.Group>();
  function chunkGroupFor(chunkId: string): THREE.Group {
    const existing = chunkGroups.get(chunkId);
    if (existing) return existing;
    const chunkGroup = new THREE.Group();
    chunkGroup.name = chunkId;
    root.add(chunkGroup);
    chunkGroups.set(chunkId, chunkGroup);
    return chunkGroup;
  }

  const byChunk = groupBy(primitives, (primitive) => primitive.chunkId);
  for (const [chunkId, chunkPrimitives] of byChunk) {
    const chunkGroup = chunkGroupFor(chunkId);

    const byGeometryMaterial = groupBy(chunkPrimitives, (primitive) => `${primitive.geometry.uuid}::${primitive.material.uuid}`);
    for (const group of byGeometryMaterial.values()) {
      const { geometry, material, transparent } = group[0];
      const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;

      if (group.length > 1 && !transparent) {
        const instanced = new THREE.InstancedMesh(geometry, material, group.length);
        group.forEach((primitive, index) => instanced.setMatrixAt(index, primitive.matrix));
        instanced.instanceMatrix.needsUpdate = true;
        chunkGroup.add(instanced);
        instancedMeshCount += 1;
        triangleCount += triangles * group.length;
      } else {
        for (const primitive of group) {
          const mesh = new THREE.Mesh(primitive.geometry, primitive.material);
          mesh.applyMatrix4(primitive.matrix);
          chunkGroup.add(mesh);
          meshCount += 1;
          triangleCount += triangles;
        }
      }
    }
  }

  const opaqueByChunk = groupBy(opaqueMeshes, (item) => item.chunkId);
  for (const [chunkId, chunkOpaqueMeshes] of opaqueByChunk) {
    const chunkGroup = chunkGroupFor(chunkId);
    for (const { mesh } of chunkOpaqueMeshes) {
      chunkGroup.add(mesh);
      meshCount += 1;
      const geometry = mesh.geometry;
      triangleCount += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    }
  }

  mergeCompatibleSingletons(root);
  return { root, diagnostics: [], stats: { meshCount, instancedMeshCount, triangleCount } };
}

/** Convenience wrapper kept for Task 3's existing tests: resolves, flattens, and groups in one call, with no seam-removal step in between. */
export async function compileGeometry(
  recipe: SceneRecipe,
  assets: readonly AssetCatalogEntry[],
  chunkAssignment: ChunkAssignment,
  assetRoot: string
): Promise<CompiledGeometry> {
  const flattened = await flattenRecords(recipe, assets, chunkAssignment, assetRoot);
  if (flattened.diagnostics.length) return { root: new THREE.Group(), diagnostics: flattened.diagnostics, stats: { meshCount: 0, instancedMeshCount: 0, triangleCount: 0 } };
  return groupPrimitives(flattened.itemsByRecordId);
}

function flattenRecord(record: RecipeCell | RecipeObject, chunkId: string, template: THREE.Object3D, cloneGeometry: boolean): { meshes: THREE.Mesh[]; items: FlattenedItem[] } {
  const instance = template.clone(true);
  instance.position.set(record.transform.position.x, record.transform.position.y, record.transform.position.z);
  instance.rotation.set(0, record.transform.rotationY, 0);
  instance.scale.setScalar(record.transform.scale);
  instance.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  const items: FlattenedItem[] = [];
  instance.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;

    if (Array.isArray(node.material)) {
      // Per-material face groups on geometry.groups: splitting this into one primitive per
      // material would make every one of them reference the same full geometry, so bake it
      // straight into a standalone mesh instead of feeding it into geometry+material grouping.
      // An opaque node's geometry is left shared even when cloneGeometry is set: it never gets
      // merged with anything else, and is not expected to be a seam-removal target.
      const mesh = new THREE.Mesh(node.geometry, node.material);
      mesh.applyMatrix4(node.matrixWorld);
      meshes.push(node);
      items.push({ kind: "opaque", chunkId, mesh });
      return;
    }

    // Per-cell placements of the same asset otherwise share one BufferGeometry instance (Mesh.copy
    // assigns geometry by reference in template.clone(true)) — necessary for groupPrimitives to
    // instance same-asset cells together. But seam removal mutates a mesh's geometry index buffer
    // in place, so when it's about to run, each cell needs its own independent geometry first;
    // otherwise mutating one cell's mesh corrupts every other cell placement of that asset.
    if (cloneGeometry) node.geometry = node.geometry.clone();
    meshes.push(node);

    items.push({
      kind: "groupable",
      chunkId,
      geometry: node.geometry,
      material: node.material,
      matrix: node.matrixWorld.clone(),
      transparent: node.material.transparent
    });
  });
  return { meshes, items };
}

/**
 * Merges same-chunk, same-material singleton meshes (groups of exactly one) into fewer draw calls,
 * skipping transparents and skipping opaque multi-material nodes (an array material means the mesh
 * bypassed grouping entirely in flattenRecord and must never be merged with anything else).
 */
function mergeCompatibleSingletons(root: THREE.Group) {
  for (const chunkGroup of root.children) {
    const singletons = chunkGroup.children.filter(
      (child): child is THREE.Mesh<THREE.BufferGeometry, THREE.Material> =>
        child instanceof THREE.Mesh &&
        !(child instanceof THREE.InstancedMesh) &&
        !Array.isArray(child.material) &&
        !child.material.transparent
    );
    const byMaterial = groupBy(singletons, (mesh) => mesh.material.uuid);

    for (const meshes of byMaterial.values()) {
      if (meshes.length < 2) continue;
      const bakedGeometries = meshes.map((mesh) => {
        const baked = mesh.geometry.clone();
        baked.applyMatrix4(mesh.matrix);
        return baked;
      });
      const merged = mergeGeometries(bakedGeometries, false);
      if (!merged) continue;
      for (const mesh of meshes) chunkGroup.remove(mesh);
      const mergedMesh = new THREE.Mesh(merged, meshes[0].material);
      chunkGroup.add(mergedMesh);
    }
  }
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const group = groups.get(groupKey);
    if (group) group.push(item);
    else groups.set(groupKey, [item]);
  }
  return groups;
}
