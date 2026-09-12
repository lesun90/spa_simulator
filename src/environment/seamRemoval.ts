import * as THREE from "three";
import type { RecipeCell, SceneRecipe } from "./types";

export interface SeamRemovalResult {
  removedTriangleCount: number;
  removedVertexCount: number;
}

const EPSILON = 1e-3;

/**
 * Removes matching opposite-facing triangle pairs on the shared vertical boundary between
 * grid-adjacent cells (north/east pairs only, so each seam is visited once). Only opaque, static,
 * fully-overlapping side faces qualify — top/bottom faces, the ground, transparent materials, and
 * partial overlaps are left untouched, per the design's seam-removal contract.
 */
export function removeInternalSeamFaces(cellMeshesByCellId: ReadonlyMap<string, THREE.Mesh[]>, recipe: SceneRecipe): SeamRemovalResult {
  const cellsByCoordinate = new Map(recipe.cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
  let removedTriangleCount = 0;
  let removedVertexCount = 0;

  for (const cell of recipe.cells) {
    for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
      const neighbor = cellsByCoordinate.get(`${cell.column + dc},${cell.row + dr}`);
      if (!neighbor) continue;

      const cellMeshes = (cellMeshesByCellId.get(cell.id) ?? []).filter((mesh) => !isTransparent(mesh));
      const neighborMeshes = (cellMeshesByCellId.get(neighbor.id) ?? []).filter((mesh) => !isTransparent(mesh));
      const boundaryX = midpointX(cell, neighbor, recipe.grid.cellSize, dc);
      const boundaryZ = midpointZ(cell, neighbor, recipe.grid.cellSize, dr);

      for (const cellMesh of cellMeshes) {
        for (const neighborMesh of neighborMeshes) {
          const result = removeMatchingTrianglePairs(cellMesh, neighborMesh, boundaryX, boundaryZ, recipe.grid.cellSize);
          removedTriangleCount += result.removedTriangleCount;
          removedVertexCount += result.removedVertexCount;
        }
      }
    }
  }

  return { removedTriangleCount, removedVertexCount };
}

function isTransparent(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((material) => material.transparent);
}

function midpointX(cell: RecipeCell, neighbor: RecipeCell, cellSize: number, dc: number): number | null {
  return dc === 1 ? (cell.transform.position.x + neighbor.transform.position.x) / 2 : null;
}

function midpointZ(cell: RecipeCell, neighbor: RecipeCell, cellSize: number, dr: number): number | null {
  return dr === 1 ? (cell.transform.position.z + neighbor.transform.position.z) / 2 : null;
}

function removeMatchingTrianglePairs(
  meshA: THREE.Mesh,
  meshB: THREE.Mesh,
  boundaryX: number | null,
  boundaryZ: number | null,
  cellSize: number
): SeamRemovalResult {
  const trianglesA = boundaryTriangles(meshA, boundaryX, boundaryZ, cellSize);
  const trianglesB = boundaryTriangles(meshB, boundaryX, boundaryZ, cellSize);
  const removeA = new Set<number>();
  const removeB = new Set<number>();

  for (const triangleA of trianglesA) {
    for (const triangleB of trianglesB) {
      if (removeB.has(triangleB.index)) continue;
      if (trianglesMatch(triangleA, triangleB, cellSize)) {
        removeA.add(triangleA.index);
        removeB.add(triangleB.index);
        break;
      }
    }
  }

  const removedFromA = removeTriangles(meshA, removeA);
  const removedFromB = removeTriangles(meshB, removeB);
  return {
    removedTriangleCount: removeA.size + removeB.size,
    removedVertexCount: removedFromA + removedFromB
  };
}

interface BoundaryTriangle {
  index: number;
  vertices: THREE.Vector3[];
  normal: THREE.Vector3;
}

function boundaryTriangles(mesh: THREE.Mesh, boundaryX: number | null, boundaryZ: number | null, cellSize: number): BoundaryTriangle[] {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const triangles: BoundaryTriangle[] = [];

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const [ia, ib, ic] = index
      ? [index.getX(triangleIndex * 3), index.getX(triangleIndex * 3 + 1), index.getX(triangleIndex * 3 + 2)]
      : [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2];
    const vertices = [ia, ib, ic].map((vertexIndex) => new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld));

    const onBoundary = vertices.every(
      (vertex) => (boundaryX === null || Math.abs(vertex.x - boundaryX) < EPSILON * cellSize) && (boundaryZ === null || Math.abs(vertex.z - boundaryZ) < EPSILON * cellSize)
    );
    if (!onBoundary) continue;

    const normal = new THREE.Triangle(vertices[0], vertices[1], vertices[2]).getNormal(new THREE.Vector3());
    if (Math.abs(normal.y) > 0.1) continue; // side faces only, not top/bottom

    triangles.push({ index: triangleIndex, vertices, normal });
  }

  return triangles;
}

function trianglesMatch(a: BoundaryTriangle, b: BoundaryTriangle, cellSize: number): boolean {
  const oppositeNormals = a.normal.dot(b.normal) < -0.99;
  if (!oppositeNormals) return false;

  const unmatched = [...b.vertices];
  for (const vertex of a.vertices) {
    const matchIndex = unmatched.findIndex((candidate) => candidate.distanceTo(vertex) < EPSILON * cellSize);
    if (matchIndex === -1) return false;
    unmatched.splice(matchIndex, 1);
  }
  return unmatched.length === 0;
}

function removeTriangles(mesh: THREE.Mesh, triangleIndices: Set<number>): number {
  if (!triangleIndices.size) return 0;
  const geometry = mesh.geometry;
  const index = geometry.index;
  if (!index) return 0;

  const keptIndices: number[] = [];
  const totalTriangles = index.count / 3;
  for (let triangleIndex = 0; triangleIndex < totalTriangles; triangleIndex += 1) {
    if (triangleIndices.has(triangleIndex)) continue;
    keptIndices.push(index.getX(triangleIndex * 3), index.getX(triangleIndex * 3 + 1), index.getX(triangleIndex * 3 + 2));
  }
  geometry.setIndex(keptIndices);
  return triangleIndices.size * 3;
}
