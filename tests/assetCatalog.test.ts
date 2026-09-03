import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { discoverAssetCatalog } from "../server/assetCatalog";

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
});
