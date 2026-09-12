import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { removeInternalSeamFaces } from "../src/environment/seamRemoval";
import type { SceneRecipe } from "../src/environment/types";

describe("removeInternalSeamFaces", () => {
  test("removes a matching pair of opposite triangles on the shared boundary between north/east-adjacent cells", () => {
    // Deliberately NOT using THREE.BoxGeometry here: two independently-constructed boxes' opposite
    // faces (+X vs -X) use different diagonal splits by default (verified empirically — e.g. a unit
    // BoxGeometry's +X face triangulates as {B,C,D}/{A,B,C} while its -X face triangulates as
    // {A,C,D}/{A,B,D} for the same 4 corners), so their triangles never share an exact vertex set even
    // though the faces geometrically coincide. quadFaceMesh below builds each side's boundary face from
    // the SAME 4 corners with the SAME diagonal, differing only in winding (so the normals come out
    // opposite) — a fixture that actually exercises exact-vertex-set matching, the case this pass is
    // designed to handle.
    const recipe = recipeWithAdjacentCells();
    const corners: [number, number, number][] = [
      [0.5, 0, -0.5],
      [0.5, 0, 0.5],
      [0.5, 1, 0.5],
      [0.5, 1, -0.5]
    ];
    const westMesh = quadFaceMesh(corners, true); // outward +X, facing into the seam from the west cell
    const eastMesh = quadFaceMesh(corners, false); // outward -X, facing into the seam from the east cell
    const cellMeshesByCellId = new Map([
      ["c-0-0", [westMesh]],
      ["c-1-0", [eastMesh]]
    ]);
    const trianglesBefore = triangleCount(westMesh) + triangleCount(eastMesh);

    const result = removeInternalSeamFaces(cellMeshesByCellId, recipe);

    expect(result.removedTriangleCount).toBe(4);
    expect(triangleCount(westMesh) + triangleCount(eastMesh)).toBe(0);
    expect(trianglesBefore).toBe(4);
  });

  test("matches seam triangles at a non-unit cellSize (epsilon scales with cellSize, not fixed)", () => {
    // Same setup as the unit-cellSize match test above, scaled up 10x: cellSize 10, corners at
    // x=5 (the midpoint between cell columns 0 and 1 at cellSize 10), spanning y:[0,10] z:[-5,5].
    // The east side's corners are perturbed by 0.005 along y — bigger than the bare EPSILON
    // (1e-3) but smaller than EPSILON * cellSize (1e-2) — so this only matches if the vertex-match
    // tolerance in trianglesMatch is scaled by cellSize the same way the boundary-plane tolerance
    // in boundaryTriangles already is. Without that scaling, this fails to match at cellSize 10.
    const recipe = recipeWithAdjacentCells(10);
    const westCorners: [number, number, number][] = [
      [5, 0, -5],
      [5, 0, 5],
      [5, 10, 5],
      [5, 10, -5]
    ];
    const perturbation = 0.005;
    const eastCorners: [number, number, number][] = westCorners.map(([x, y, z]) => [x, y + perturbation, z]);
    const westMesh = quadFaceMesh(westCorners, true);
    const eastMesh = quadFaceMesh(eastCorners, false);
    const cellMeshesByCellId = new Map([
      ["c-0-0", [westMesh]],
      ["c-1-0", [eastMesh]]
    ]);

    const result = removeInternalSeamFaces(cellMeshesByCellId, recipe);

    expect(result.removedTriangleCount).toBe(4);
    expect(triangleCount(westMesh) + triangleCount(eastMesh)).toBe(0);
  });

  test("leaves triangles alone when cells are not grid-adjacent", () => {
    const recipe = recipeWithFarCells();
    const meshA = boxMesh({ x: 0, z: 0 });
    const meshB = boxMesh({ x: 10, z: 0 });
    const cellMeshesByCellId = new Map([
      ["c-0-0", [meshA]],
      ["c-9-0", [meshB]]
    ]);
    const trianglesBefore = triangleCount(meshA) + triangleCount(meshB);

    const result = removeInternalSeamFaces(cellMeshesByCellId, recipe);

    expect(result.removedTriangleCount).toBe(0);
    expect(triangleCount(meshA) + triangleCount(meshB)).toBe(trianglesBefore);
  });

  test("does not touch a transparent material's geometry", () => {
    const recipe = recipeWithAdjacentCells();
    const westMesh = boxMesh({ x: 0, z: 0 }, { transparent: true });
    const eastMesh = boxMesh({ x: 1, z: 0 }, { transparent: true });
    const cellMeshesByCellId = new Map([
      ["c-0-0", [westMesh]],
      ["c-1-0", [eastMesh]]
    ]);

    const result = removeInternalSeamFaces(cellMeshesByCellId, recipe);

    expect(result.removedTriangleCount).toBe(0);
  });
});

function boxMesh(center: { x: number; z: number }, materialOptions: THREE.MeshStandardMaterialParameters = {}): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(center.x, 0.5, center.z);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(materialOptions));
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Builds a single quad face (2 triangles, indexed) from 4 corners in loop order, split on the same diagonal regardless of winding — reversing `flipWinding` only reverses the face's normal direction, keeping the underlying triangle vertex sets identical to a face built from the same corners with the opposite flag. */
function quadFaceMesh(corners: readonly [number, number, number][], flipWinding: boolean): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners.flat(), 3));
  geometry.setIndex(flipWinding ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

function triangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

function recipeWithAdjacentCells(cellSize = 1): SceneRecipe {
  return recipeWithCells(
    [
      { id: "c-0-0", column: 0, row: 0 },
      { id: "c-1-0", column: 1, row: 0 }
    ],
    cellSize
  );
}

function recipeWithFarCells(): SceneRecipe {
  return recipeWithCells([
    { id: "c-0-0", column: 0, row: 0 },
    { id: "c-9-0", column: 9, row: 0 }
  ]);
}

function recipeWithCells(cells: { id: string; column: number; row: number }[], cellSize = 1): SceneRecipe {
  return {
    grid: { width: 10, depth: 1, cellSize, origin: { x: 0, y: 0, z: 0 } },
    generationRuns: [],
    cells: cells.map((cell) => ({
      id: cell.id,
      column: cell.column,
      row: cell.row,
      transform: { position: { x: cell.column * cellSize, y: 0, z: cell.row * cellSize }, rotationY: 0, scale: 1 },
      sourceAssetId: "tiles.a",
      semanticRoles: [],
      sourceLayer: "scene",
      recovered: false
    })),
    objects: [],
    ground: { appearance: { type: "color", color: "#050608", textureUrl: null } },
    diagnostics: []
  };
}
