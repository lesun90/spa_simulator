// @vitest-environment node
import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { readGlbInfo } from "../src/environment/glb";

describe("NodeFileReader (real Node environment, no jsdom FileReader)", () => {
  test("real Node has no built-in FileReader until nodeGltfShim installs the polyfill", async () => {
    // Confirms this test file genuinely exercises the `if (!("FileReader" in globalThis))` branch in
    // nodeGltfShim.ts, rather than silently passing because jsdom's real FileReader is already present
    // (the default Vitest environment, which this file overrides via the directive above).
    expect(typeof (globalThis as { FileReader?: unknown }).FileReader).toBe("undefined");

    await import("../src/environment/glbExporter"); // side-effect: installs the NodeFileReader polyfill

    expect(typeof (globalThis as { FileReader?: unknown }).FileReader).toBe("function");
  });

  test("exportGlb resolves to a valid non-empty GLB via the NodeFileReader polyfill", async () => {
    const { exportGlb } = await import("../src/environment/glbExporter");
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x7d8aa2 })));

    const glb = await exportGlb(root);

    expect(glb).toBeInstanceOf(Uint8Array);
    expect(glb.byteLength).toBeGreaterThan(0);
    const info = readGlbInfo(glb);
    expect(info.valid).toBe(true);
    expect(info.nodeNames).toContain("SteerlabEnvironment");
  });
});
