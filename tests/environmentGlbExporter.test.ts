import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { exportGlb } from "../src/environment/glbExporter";
import { readGlbInfo } from "../src/environment/glb";

describe("exportGlb", () => {
  test("exports a named root with a mesh child as a valid GLB whose root node name round-trips", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x7d8aa2 })));

    const glb = await exportGlb(root);

    const info = readGlbInfo(glb);
    expect(info.valid).toBe(true);
    expect(info.nodeNames).toContain("SteerlabEnvironment");
  });

  test("exports an InstancedMesh child without throwing", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 2);
    instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
    instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0));
    root.add(instanced);

    const glb = await exportGlb(root);

    expect(readGlbInfo(glb).valid).toBe(true);
  });
});
