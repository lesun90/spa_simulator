import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { resolveAssetGeometry, unsupportedNodeDiagnostics } from "../src/environment/assetGeometrySource";

describe("resolveAssetGeometry", () => {
  let assetRoot: string;

  afterEach(async () => {
    if (assetRoot) await import("node:fs/promises").then((fs) => fs.rm(assetRoot, { recursive: true, force: true }));
  });

  test("reports an error when the asset is missing from the catalog instead of substituting a placeholder", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));

    const result = await resolveAssetGeometry(undefined, "tiles.missing", assetRoot);

    expect(result).toEqual({ status: "error", diagnostics: ["Asset tiles.missing is not present in the catalog."] });
  });

  test("reports an error for a glb-implementation asset with no modelUrl, instead of substituting a placeholder", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const asset: AssetCatalogEntry = { id: "props.chair", label: "Chair", category: "props", source: "shared", implementation: "glb" };

    const result = await resolveAssetGeometry(asset, asset.id, assetRoot);

    expect(result).toEqual({
      status: "error",
      diagnostics: ["Asset props.chair is declared as a glb implementation but has no modelUrl."]
    });
  });

  test("reports an error for a module-implementation asset with no moduleUrl, instead of substituting a placeholder", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const asset: AssetCatalogEntry = { id: "props.lamp", label: "Lamp", category: "props", source: "shared", implementation: "module" };

    const result = await resolveAssetGeometry(asset, asset.id, assetRoot);

    expect(result).toEqual({
      status: "error",
      diagnostics: ["Asset props.lamp is declared as a module implementation but has no moduleUrl."]
    });
  });

  test("resolves a glb-implementation asset by loading and parsing its GLB bytes", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    await mkdir(join(assetRoot, "props", "crate"), { recursive: true });

    const exporter = new GLTFExporter();
    const sourceGroup = new THREE.Group();
    sourceGroup.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const glbBytes = await new Promise<Uint8Array>((resolve, reject) => {
      exporter.parse(sourceGroup, (result) => resolve(new Uint8Array(result as ArrayBuffer)), reject, { binary: true });
    });
    await writeFile(join(assetRoot, "props", "crate", "crate.glb"), glbBytes);

    const asset: AssetCatalogEntry = {
      id: "props.crate",
      label: "Crate",
      category: "props",
      source: "shared",
      implementation: "glb",
      modelUrl: "/assets/props/crate/crate.glb"
    };

    const result = await resolveAssetGeometry(asset, asset.id, assetRoot);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    let meshCount = 0;
    result.object.traverse((node) => {
      if (node instanceof THREE.Mesh) meshCount += 1;
    });
    expect(meshCount).toBeGreaterThanOrEqual(1);
  });

  test("resolves a placeholder-implementation asset to a procedural box, matching the editor's fallback", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const asset: AssetCatalogEntry = { id: "props.cone", label: "Cone", category: "props", source: "shared", implementation: "placeholder" };

    const result = await resolveAssetGeometry(asset, asset.id, assetRoot);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    let meshCount = 0;
    result.object.traverse((node) => {
      if (node instanceof THREE.Mesh) meshCount += 1;
    });
    expect(meshCount).toBe(1);
  });

  test("resolves a module-implementation asset by importing its createAsset export", async () => {
    // Vitest's dev-server module graph refuses to dynamically import() files outside the
    // project root (confirmed: an equivalent fixture under os.tmpdir() fails with "Cannot
    // find module", while the identical fixture under the project root imports fine) — this
    // test's asset root must live inside the repo, unlike the other two tests in this file,
    // which never trigger a dynamic import and so can safely use os.tmpdir().
    assetRoot = await mkdtemp(join(process.cwd(), "tests", ".tmp-assets-"));
    await mkdir(join(assetRoot, "props", "lamp"), { recursive: true });
    await writeFile(
      join(assetRoot, "props", "lamp", "lamp.js"),
      `export const metadata = { id: "props.lamp", label: "Lamp", category: "props" };
export function createAsset({ THREE }) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1), new THREE.MeshStandardMaterial({ color: 0x888888 })));
  return group;
}
`
    );
    const asset: AssetCatalogEntry = {
      id: "props.lamp",
      label: "Lamp",
      category: "props",
      source: "shared",
      implementation: "module",
      moduleUrl: "/assets/props/lamp/lamp.js"
    };

    const result = await resolveAssetGeometry(asset, asset.id, assetRoot);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    let meshCount = 0;
    result.object.traverse((node) => {
      if (node instanceof THREE.Mesh) meshCount += 1;
    });
    expect(meshCount).toBe(1);
  });
});

describe("unsupportedNodeDiagnostics", () => {
  test("flags a skinned mesh by name", () => {
    const bones = [new THREE.Bone()];
    const skeleton = new THREE.Skeleton(bones);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = "rig";
    mesh.bind(skeleton);
    const root = new THREE.Group();
    root.add(mesh);

    expect(unsupportedNodeDiagnostics(root, "characters.walker")).toEqual([
      'Asset characters.walker node "rig" is a skinned mesh, which the environment exporter does not support.'
    ]);
  });

  test("flags a custom shader material by name", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.ShaderMaterial());
    mesh.name = "glow";
    const root = new THREE.Group();
    root.add(mesh);

    expect(unsupportedNodeDiagnostics(root, "fx.glow")).toEqual([
      'Asset fx.glow node "glow" uses a custom shader material, which GLB export cannot represent.'
    ]);
  });

  test("flags morph targets by name", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 0], 3)];
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = "blob";
    const root = new THREE.Group();
    root.add(mesh);

    expect(unsupportedNodeDiagnostics(root, "props.blob")).toEqual([
      'Asset props.blob node "blob" has morph targets, which the environment exporter does not support.'
    ]);
  });

  test("passes a plain static mesh", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const root = new THREE.Group();
    root.add(mesh);

    expect(unsupportedNodeDiagnostics(root, "props.crate")).toEqual([]);
  });
});
