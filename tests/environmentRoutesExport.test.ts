import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { createScene } from "../src/editor-core/scene";
import { createEnvironmentExportCache } from "../server/environmentRoutes";
import { canonicalJson } from "../src/environment/manifestEncoder";

describe("createEnvironmentExportCache", () => {
  let assetRoot: string;

  afterEach(async () => {
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  test("compiles the given scene and caches the GLB under a fresh export ID", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-export-assets-"));
    const assets: AssetCatalogEntry[] = [];
    const scene = createScene("Export test");
    const cache = createEnvironmentExportCache();

    const result = await cache.compile(scene, assets, assetRoot, { chunkSize: 10, removeSeamFaces: false });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.manifest.format).toBe("steerlab-environment");
    expect(cache.model(result.exportId)).toBeInstanceOf(Uint8Array);
    expect(result.manifestJson).toBe(canonicalJson(result.manifest));
  });

  test("returns an error result naming the failure instead of throwing", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-export-assets-"));
    const scene = {
      ...createScene("Export test"),
      objects: [{ id: "o-1", assetId: "missing.asset", name: "o-1", position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 }]
    };
    const cache = createEnvironmentExportCache();

    const result = await cache.compile(scene, [], assetRoot, { chunkSize: 10, removeSeamFaces: false });

    expect(result).toEqual({ status: "error", message: "Asset missing.asset is not present in the catalog." });
  });

  test("evicts the previous export for the same scene when a new one is compiled", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-export-assets-"));
    const scene = createScene("Export test");
    const cache = createEnvironmentExportCache();

    const first = await cache.compile(scene, [], assetRoot, { chunkSize: 10, removeSeamFaces: false });
    const second = await cache.compile(scene, [], assetRoot, { chunkSize: 10, removeSeamFaces: false });

    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected ok");
    expect(cache.model(first.exportId)).toBeUndefined();
    expect(cache.model(second.exportId)).toBeInstanceOf(Uint8Array);
  });
});
