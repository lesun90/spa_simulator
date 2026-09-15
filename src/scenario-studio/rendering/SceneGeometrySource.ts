import * as THREE from "three";
import type { SceneGeometryDescription, TriangleMeshDescription } from "../physics/PhysicsWorld";
import { normalizeMaterialToken } from "../domain/materialFriction";

/** Extracts transformed, meter-scaled solid triangles without leaking Three.js types across the adapter boundary. */
export class SceneGeometrySource {
  fromObject(root: THREE.Object3D): SceneGeometryDescription {
    root.updateMatrixWorld(true);
    const meshes: TriangleMeshDescription[] = [];
    const nonSupportingMeshes: TriangleMeshDescription[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BufferGeometry)) return;
      if (object instanceof THREE.InstancedMesh) {
        for (let index = 0; index < object.count; index++) {
          const instance = new THREE.Matrix4();
          object.getMatrixAt(index, instance);
          const matrix = new THREE.Matrix4().multiplyMatrices(object.matrixWorld, instance);
          appendGeometry(object, matrix, `${object.name || "mesh"} instance ${index}`, meshes, nonSupportingMeshes);
        }
        return;
      }
      appendGeometry(object, object.matrixWorld, object.name || "scene mesh", meshes, nonSupportingMeshes);
    });
    return { kind: "imported", meshes, nonSupportingMeshes };
  }

  defaultGround(ground: { width: number; depth: number; y: number }): SceneGeometryDescription {
    return { kind: "default-ground", meshes: [], defaultGround: { width: ground.width, depth: ground.depth, y: ground.y } };
  }
}

function appendGeometry(mesh: THREE.Mesh, matrix: THREE.Matrix4, label: string, solids: TriangleMeshDescription[], nonSupporting: TriangleMeshDescription[]): void {
  const solid = extract(mesh, matrix, label, false);
  const blocked = extract(mesh, matrix, `${label} (non-supporting)`, true);
  if (solid) solids.push(solid);
  if (blocked) nonSupporting.push(blocked);
}

function extract(mesh: THREE.Mesh, matrix: THREE.Matrix4, label: string, water: boolean): TriangleMeshDescription | null {
  const position = mesh.geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute) && !(position instanceof THREE.InterleavedBufferAttribute)) return null;
  const sourceIndices = mesh.geometry.index;
  const triangleCount = Math.floor((sourceIndices?.count ?? position.count) / 3);
  const vertices: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  let material = "unnamed";
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const first = triangle * 3;
    if (isWaterTriangle(mesh, first) !== water) continue;
    if (material === "unnamed") material = triangleMaterialName(mesh, first);
    for (let corner = 0; corner < 3; corner++) {
      const vertexIndex = sourceIndices ? sourceIndices.getX(first + corner) : first + corner;
      point.fromBufferAttribute(position, vertexIndex).applyMatrix4(matrix);
      vertices.push(point.x, point.y, point.z);
      indices.push(indices.length);
    }
  }
  if (!indices.length) return null;
  return { label, vertices: new Float32Array(vertices), indices: new Uint32Array(indices), material };
}

function triangleMaterialName(mesh: THREE.Mesh, indexOffset: number): string {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const group = mesh.geometry.groups.find((candidate) => indexOffset >= candidate.start && indexOffset < candidate.start + candidate.count);
  const material = materials[group?.materialIndex ?? 0];
  return normalizeMaterialToken(material?.name || mesh.name || "unnamed");
}

function isWaterTriangle(mesh: THREE.Mesh, indexOffset: number): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const group = mesh.geometry.groups.find((candidate) => indexOffset >= candidate.start && indexOffset < candidate.start + candidate.count);
  const material = materials[group?.materialIndex ?? 0];
  return /water/i.test(`${mesh.name} ${material?.name ?? ""}`);
}
