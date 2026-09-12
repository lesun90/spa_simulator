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
  chunkId: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  transparent: boolean;
}

/** Resolves each referenced asset once, bakes every record's world transform, then instances/merges per chunk. */
export async function compileGeometry(
  recipe: SceneRecipe,
  assets: readonly AssetCatalogEntry[],
  chunkAssignment: ChunkAssignment,
  assetRoot: string
): Promise<CompiledGeometry> {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const referencedAssetIds = new Set([...recipe.cells.map((cell) => cell.sourceAssetId), ...recipe.objects.map((object) => object.sourceAssetId)]);

  const templates = new Map<string, THREE.Object3D>();
  const diagnostics: string[] = [];
  for (const assetId of referencedAssetIds) {
    const result = await resolveAssetGeometry(assetsById.get(assetId), assetId, assetRoot);
    if (result.status === "error") {
      diagnostics.push(...result.diagnostics);
      continue;
    }
    templates.set(assetId, result.object);
  }
  if (diagnostics.length) return { root: new THREE.Group(), diagnostics, stats: { meshCount: 0, instancedMeshCount: 0, triangleCount: 0 } };

  const primitives: FlattenedPrimitive[] = [
    ...recipe.cells.flatMap((cell) => flattenRecord(cell, chunkAssignment.cellChunkIds.get(cell.id)!, templates.get(cell.sourceAssetId)!)),
    ...recipe.objects.flatMap((object) => flattenRecord(object, chunkAssignment.objectChunkIds.get(object.id)!, templates.get(object.sourceAssetId)!))
  ];

  const root = new THREE.Group();
  root.name = "SteerlabEnvironment";
  let meshCount = 0;
  let instancedMeshCount = 0;
  let triangleCount = 0;

  const byChunk = groupBy(primitives, (primitive) => primitive.chunkId);
  for (const [chunkId, chunkPrimitives] of byChunk) {
    const chunkGroup = new THREE.Group();
    chunkGroup.name = chunkId;
    root.add(chunkGroup);

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
      } else if (group.length > 1) {
        for (const primitive of group) {
          const mesh = new THREE.Mesh(primitive.geometry, primitive.material);
          mesh.applyMatrix4(primitive.matrix);
          chunkGroup.add(mesh);
          meshCount += 1;
          triangleCount += triangles;
        }
      } else {
        const primitive = group[0];
        const mesh = new THREE.Mesh(primitive.geometry, primitive.material);
        mesh.applyMatrix4(primitive.matrix);
        chunkGroup.add(mesh);
        meshCount += 1;
        triangleCount += triangles;
      }
    }
  }

  mergeCompatibleSingletons(root);

  return { root, diagnostics: [], stats: { meshCount, instancedMeshCount, triangleCount } };
}

function flattenRecord(record: RecipeCell | RecipeObject, chunkId: string, template: THREE.Object3D): FlattenedPrimitive[] {
  const instance = template.clone(true);
  instance.position.set(record.transform.position.x, record.transform.position.y, record.transform.position.z);
  instance.rotation.set(0, record.transform.rotationY, 0);
  instance.scale.setScalar(record.transform.scale);
  instance.updateMatrixWorld(true);

  const primitives: FlattenedPrimitive[] = [];
  instance.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      primitives.push({
        chunkId,
        geometry: node.geometry,
        material,
        matrix: node.matrixWorld.clone(),
        transparent: material.transparent
      });
    }
  });
  return primitives;
}

/** Merges same-chunk, same-material singleton meshes (groups of exactly one) into fewer draw calls, skipping transparents. */
function mergeCompatibleSingletons(root: THREE.Group) {
  for (const chunkGroup of root.children) {
    const singletons = chunkGroup.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && !child.material.transparent
    );
    const byMaterial = groupBy(singletons, (mesh) => (Array.isArray(mesh.material) ? mesh.material.map((m) => m.uuid).join(",") : mesh.material.uuid));

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
