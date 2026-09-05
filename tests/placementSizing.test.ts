import * as THREE from "three";
import { describe, expect, test } from "vitest";
import { centerGroundFootprintOnOrigin, scaleToFitGridCell } from "../src/features/world/placementSizing";

describe("placement sizing", () => {
  test("fits an object's largest ground footprint side into one grid cell", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4));

    expect(scaleToFitGridCell(mesh, 2)).toBeCloseTo(0.5);
  });

  test("keeps the default scale when the footprint cannot be measured", () => {
    expect(scaleToFitGridCell(new THREE.Group(), 2)).toBe(1);
    expect(scaleToFitGridCell(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), 0)).toBe(1);
  });

  test("centers an offset asset footprint on the placement origin", () => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3));
    mesh.position.set(1.5, 0.5, -1.5);
    group.add(mesh);

    centerGroundFootprintOnOrigin(group);

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
    expect(box.min.y).toBeCloseTo(0);
  });
});
