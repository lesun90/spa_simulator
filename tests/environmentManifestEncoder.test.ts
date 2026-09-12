import { describe, expect, test } from "vitest";
import { canonicalJson, encodeManifest, sha256Hex } from "../src/environment/manifestEncoder";
import type { EnvironmentManifest } from "../src/environment/types";

describe("sha256Hex", () => {
  test("matches the known SHA-256 of the empty buffer", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("encodeManifest", () => {
  test("sorts every identifier-keyed array so reordered input produces the same encoded manifest", () => {
    const manifestA = fixtureManifest({ order: ["b", "a"] });
    const manifestB = fixtureManifest({ order: ["a", "b"] });

    expect(encodeManifest(manifestA)).toEqual(encodeManifest(manifestB));
  });

  test("sorts diagnostics", () => {
    const manifest = fixtureManifest({ order: ["a", "b"] });
    manifest.diagnostics = ["zebra", "aardvark"];

    expect(encodeManifest(manifest).diagnostics).toEqual(["aardvark", "zebra"]);
  });
});

describe("canonicalJson", () => {
  test("produces identical output regardless of source key order", () => {
    const first = canonicalJson({ b: 1, a: 2 });
    const second = canonicalJson({ a: 2, b: 1 });

    expect(first).toBe(second);
    expect(first).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });

  test("sorts keys inside nested objects and arrays", () => {
    expect(canonicalJson({ items: [{ z: 1, a: 2 }] })).toBe('{\n  "items": [\n    {\n      "a": 2,\n      "z": 1\n    }\n  ]\n}');
  });
});

function fixtureManifest(options: { order: readonly string[] }): EnvironmentManifest {
  const [first, second] = options.order;
  return {
    format: "steerlab-environment",
    formatVersion: 1,
    model: { file: "environment.glb", sha256: "hash", rootNode: "SteerlabEnvironment", upAxis: "Y", unitsPerMeter: 1 },
    grid: { width: 1, depth: 1, cellSize: 1, origin: { x: 0, y: 0, z: 0 }, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } },
    provenance: { source: "cli", generatorVersion: "0.1.0", generationRuns: [] },
    build: { chunkSize: 10, removeInternalSeamFaces: false },
    chunks: [first, second].map((id) => ({ id, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } })),
    assets: [],
    cells: [],
    objects: [],
    ground: null,
    navigation: { nodes: [], edges: [] },
    diagnostics: []
  };
}
