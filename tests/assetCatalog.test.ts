import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { discoverAssetCatalog, importSharedAsset } from "../server/assetCatalog";

describe("asset catalog discovery", () => {
  test("recursively discovers module-primary and glb-fallback assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    await mkdir(join(root, "props", "cone"), { recursive: true });
    await mkdir(join(root, "vehicles", "sedan"), { recursive: true });
    await writeFile(
      join(root, "props", "cone", "cone.js"),
      "export const metadata = { label: 'Traffic cone', tags: ['traffic'] }; export function createAsset() {};"
    );
    await writeFile(join(root, "vehicles", "sedan", "sedan.glb"), "glb");

    const catalog = await discoverAssetCatalog(root);

    expect(catalog.map((entry) => [entry.id, entry.implementation, entry.label])).toEqual([
      ["props.cone", "module", "Traffic cone"],
      ["vehicles.sedan", "glb", "Sedan"]
    ]);
  });

  test("reports duplicate catalog ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    await mkdir(join(root, "props", "a"), { recursive: true });
    await mkdir(join(root, "props", "b"), { recursive: true });
    await writeFile(join(root, "props", "a", "a.js"), "export const metadata = { id: 'props.same' }; export function createAsset() {};");
    await writeFile(join(root, "props", "b", "b.js"), "export const metadata = { id: 'props.same' }; export function createAsset() {};");

    const catalog = await discoverAssetCatalog(root);

    expect(catalog).toHaveLength(2);
    expect(catalog.every((entry) => entry.diagnostics?.some((diagnostic) => diagnostic.includes("Duplicate asset ID")))).toBe(true);
  });

  test("discovers top-level glb files as standalone shared assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    await writeFile(join(root, "delivery-van.glb"), "glb");

    const catalog = await discoverAssetCatalog(root);

    expect(catalog).toEqual([
      expect.objectContaining({
        id: "delivery-van",
        label: "Delivery Van",
        category: "uncategorized",
        implementation: "glb",
        modelUrl: "/assets/delivery-van.glb"
      })
    ]);
  });

  test("imports glb-only shared assets as model assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    const imported = await importSharedAsset(root, {
      id: "vehicles.delivery-van",
      label: "Delivery van",
      category: "vehicles",
      folderName: "delivery-van",
      files: [{ name: "delivery-van.glb", contentBase64: Buffer.from("glb").toString("base64") }]
    });

    expect(imported).toMatchObject({
      id: "vehicles.delivery-van",
      label: "Delivery van",
      category: "vehicles",
      implementation: "glb",
      modelUrl: "/assets/vehicles/delivery-van/delivery-van.glb"
    });
    const files = await readdir(join(root, "vehicles", "delivery-van"));
    expect(files.sort()).toEqual(["asset.json", "delivery-van.glb"]);
  });

  test("preserves WFC weights and semantic ports", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    await mkdir(join(root, "tiles", "road"), { recursive: true });
    await writeFile(join(root, "tiles", "road", "road.glb"), "glb");
    await writeFile(join(root, "tiles", "road", "asset.json"), JSON.stringify({
      id: "tiles.road", wfc: { height: 1, defaultWeight: 8, variants: [], diagnostics: [] },
      semantics: { roles: ["road.surface"], sockets: { north: { type: "road" } } }
    }));

    const [entry] = await discoverAssetCatalog(root);
    expect(entry.wfc).toMatchObject({ defaultWeight: 8 });
    expect(entry.semantics).toEqual({ roles: ["road.surface"], sockets: { north: { type: "road" } } });
  });

  test("reports malformed WFC palette weights without hiding the asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-assets-"));
    await mkdir(join(root, "tiles", "road"), { recursive: true });
    await writeFile(join(root, "tiles", "road", "road.glb"), "glb");
    await writeFile(join(root, "tiles", "road", "asset.json"), JSON.stringify({ id: "tiles.road", wfc: { height: 1, defaultWeight: 0, variants: [], diagnostics: [] } }));

    const [entry] = await discoverAssetCatalog(root);
    expect(entry.diagnostics).toContain("WFC default weight must be a positive finite number.");
  });

});
