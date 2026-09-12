import { describe, expect, test, vi } from "vitest";
import * as THREE from "three";
import { disposeObject } from "../src/features/world/disposeObject";

describe("disposeObject", () => {
  test("disposes a mesh's geometry, material, and any texture the material references", () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);

    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");

    disposeObject(mesh);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  test("traverses a group and disposes every descendant mesh", () => {
    const group = new THREE.Group();
    const geometryA = new THREE.BoxGeometry(1, 1, 1);
    const materialA = new THREE.MeshBasicMaterial();
    const geometryB = new THREE.SphereGeometry(1);
    const materialB = new THREE.MeshBasicMaterial();
    const meshA = new THREE.Mesh(geometryA, materialA);
    const meshB = new THREE.Mesh(geometryB, materialB);
    group.add(meshA);
    const nested = new THREE.Group();
    nested.add(meshB);
    group.add(nested);

    const disposeA = vi.spyOn(geometryA, "dispose");
    const disposeB = vi.spyOn(geometryB, "dispose");

    disposeObject(group);

    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);
  });

  test("disposes every material in an array-material mesh", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    const mesh = new THREE.Mesh(geometry, materials);

    const disposeSpies = materials.map((material) => vi.spyOn(material, "dispose"));

    disposeObject(mesh);

    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
