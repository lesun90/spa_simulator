import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEnvironmentImportStaging } from "../server/environmentRoutes";
import { createEnvironmentPackageStore } from "../server/environmentPackageStore";
import { sha256Hex } from "../src/environment/manifestEncoder";

describe("createEnvironmentImportStaging", () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("commit fails when only one of the two files has been staged", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-import-"));
    const staging = createEnvironmentImportStaging(root);
    const environmentStore = createEnvironmentPackageStore(root);
    await staging.stageManifest("scene-1", "{}");

    const result = await staging.commit("scene-1", environmentStore);

    expect(result).toEqual({ status: "error", diagnostics: ["Both environment.json and environment.glb must be uploaded before committing."] });
  });

  test("commit rejects an invalid pair and leaves no committed package", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-import-"));
    const staging = createEnvironmentImportStaging(root);
    const environmentStore = createEnvironmentPackageStore(root);
    await staging.stageManifest("scene-1", JSON.stringify({ format: "wrong-format" }));
    await staging.stageModel("scene-1", Buffer.from([1, 2, 3]));

    const result = await staging.commit("scene-1", environmentStore);

    expect(result.status).toBe("error");
    expect(await environmentStore.read("scene-1")).toBeNull();
  });

  test("commit clears staging after rejecting an invalid pair, so a later re-upload isn't paired with stale files", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-import-"));
    const staging = createEnvironmentImportStaging(root);
    const environmentStore = createEnvironmentPackageStore(root);
    await staging.stageManifest("scene-1", JSON.stringify({ format: "wrong-format" }));
    await staging.stageModel("scene-1", Buffer.from([1, 2, 3]));
    const rejected = await staging.commit("scene-1", environmentStore);
    expect(rejected.status).toBe("error");

    // Only re-stage the manifest — if the stale rejected model were still on disk, this commit
    // would silently pair the new manifest with that stale model instead of failing outright.
    const glb = buildMinimalGlb();
    const manifest = minimalManifest(sha256Hex(glb));
    await staging.stageManifest("scene-1", JSON.stringify(manifest));

    const result = await staging.commit("scene-1", environmentStore);

    expect(result).toEqual({ status: "error", diagnostics: ["Both environment.json and environment.glb must be uploaded before committing."] });
  });

  test("commit accepts a valid pair, replaces the store, and clears staging", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-import-"));
    const staging = createEnvironmentImportStaging(root);
    const environmentStore = createEnvironmentPackageStore(root);
    const glb = buildMinimalGlb();
    const manifest = minimalManifest(sha256Hex(glb));
    await staging.stageManifest("scene-1", JSON.stringify(manifest));
    await staging.stageModel("scene-1", glb);

    const result = await staging.commit("scene-1", environmentStore);

    expect(result).toEqual({ status: "ok", sha256: manifest.model.sha256, manifestVersion: 1 });
    expect(await environmentStore.read("scene-1")).toEqual({ manifest: JSON.stringify(manifest), glb });
  });
});

function buildMinimalGlb(): Buffer {
  const json = JSON.stringify({ nodes: [{ name: "SteerlabEnvironment" }] });
  const padded = json + " ".repeat((4 - (json.length % 4)) % 4);
  const jsonBytes = Buffer.from(padded, "utf8");
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonBytes.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunkHeader, jsonBytes]);
}

function minimalManifest(sha256: string) {
  return {
    format: "steerlab-environment",
    formatVersion: 1,
    model: { file: "environment.glb", sha256, rootNode: "SteerlabEnvironment", upAxis: "Y", unitsPerMeter: 1 },
    grid: { width: 1, depth: 1, cellSize: 1, origin: { x: 0, y: 0, z: 0 }, bounds: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } } },
    provenance: { source: "cli", generatorVersion: "0.1.0", generationRuns: [] },
    build: { chunkSize: 10, removeInternalSeamFaces: false },
    chunks: [],
    assets: [],
    cells: [],
    objects: [],
    ground: null,
    navigation: { nodes: [], edges: [] },
    diagnostics: []
  };
}
