import { describe, expect, test } from "vitest";
import { sha256Hex } from "../src/environment/manifestEncoder";
import { validateEnvironmentPackage } from "../src/environment/packageValidator";
import type { EnvironmentManifest } from "../src/environment/types";

describe("validateEnvironmentPackage", () => {
  test("accepts a well-formed manifest whose GLB hash and root node match", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result).toEqual({ valid: true, diagnostics: [] });
  });

  test("rejects a GLB that does not match the recorded hash", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest("0".repeat(64));

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("environment.glb does not match the hash recorded in the manifest.");
  });

  test("rejects a GLB missing the manifest's root node", () => {
    const glb = buildGlb({ nodes: [{ name: "SomethingElse" }] });
    const manifest = fixtureManifest(sha256Hex(glb));

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("environment.glb does not contain the root node named in the manifest.");
  });

  test("rejects a cell that references an unknown chunk and asset", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.cells = [
      {
        id: "cell-1",
        column: 0,
        row: 0,
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
        sourceAssetId: "missing.asset",
        semanticRoles: [],
        chunkId: "missing-chunk",
        sourceLayer: "scene"
      }
    ];

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        "Cell cell-1 references unknown chunk missing-chunk.",
        "Cell cell-1 references unknown asset missing.asset."
      ])
    );
  });

  test("rejects a cell placed outside the grid bounds", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.chunks = [{ id: "chunk-0", bounds: manifest.grid.bounds }];
    manifest.assets = [{ id: "tiles.a", label: "Tile A", category: "tiles", contentHash: "hash", semanticRoles: [] }];
    manifest.cells = [
      {
        id: "cell-1",
        column: 99,
        row: 0,
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        bounds: manifest.grid.bounds,
        sourceAssetId: "tiles.a",
        semanticRoles: [],
        chunkId: "chunk-0",
        sourceLayer: "scene"
      }
    ];

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Cell cell-1 coordinate (99, 0) is outside the grid bounds.");
  });

  test("rejects a navigation edge with an unknown endpoint", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.navigation = {
      nodes: [{ id: "node-1", cellId: "cell-1", position: { x: 0, y: 0, z: 0 }, channels: ["road"], featureTags: [] }],
      edges: [{ id: "edge-1", fromNodeId: "node-1", toNodeId: "node-missing", direction: "north", channel: "road", cost: 1, bidirectional: true }]
    };

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Navigation edge edge-1 references unknown node node-missing.");
  });

  test("rejects a navigation edge whose channel is incompatible with an endpoint node", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.navigation = {
      nodes: [
        { id: "node-1", cellId: "cell-1", position: { x: 0, y: 0, z: 0 }, channels: ["road"], featureTags: [] },
        { id: "node-2", cellId: "cell-1", position: { x: 1, y: 0, z: 0 }, channels: ["sidewalk"], featureTags: [] }
      ],
      edges: [{ id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", direction: "north", channel: "road", cost: 1, bidirectional: true }]
    };

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Navigation edge edge-1 channel road is not compatible with node node-2's channels.");
  });

  test("rejects a manifest with duplicate navigation edge IDs", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.navigation = {
      nodes: [{ id: "node-1", cellId: "cell-1", position: { x: 0, y: 0, z: 0 }, channels: ["road"], featureTags: [] }],
      edges: [
        { id: "edge-1", fromNodeId: "node-1", toNodeId: "node-1", direction: "north", channel: "road", cost: 1, bidirectional: true },
        { id: "edge-1", fromNodeId: "node-1", toNodeId: "node-1", direction: "south", channel: "road", cost: 1, bidirectional: true }
      ]
    };

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Duplicate navigation edge ID edge-1.");
  });

  test("rejects a navigation node that references an unknown cell", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.navigation = {
      nodes: [{ id: "node-1", cellId: "missing-cell", position: { x: 0, y: 0, z: 0 }, channels: ["road"], featureTags: [] }],
      edges: []
    };

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Navigation node node-1 references unknown cell missing-cell.");
  });

  test("rejects an object that references an unknown chunk and asset", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.objects = [
      {
        id: "object-1",
        name: "Prop",
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 },
        bounds: manifest.grid.bounds,
        sourceAssetId: "missing.asset",
        semanticRoles: [],
        chunkId: "missing-chunk",
        sourceLayer: "scene"
      }
    ];

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        "Object object-1 references unknown chunk missing-chunk.",
        "Object object-1 references unknown asset missing.asset."
      ])
    );
  });

  test("rejects a cell with a non-finite transform", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.chunks = [{ id: "chunk-0", bounds: manifest.grid.bounds }];
    manifest.assets = [{ id: "tiles.a", label: "Tile A", category: "tiles", contentHash: "hash", semanticRoles: [] }];
    manifest.cells = [
      {
        id: "cell-1",
        column: 0,
        row: 0,
        transform: { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 0 },
        bounds: manifest.grid.bounds,
        sourceAssetId: "tiles.a",
        semanticRoles: [],
        chunkId: "chunk-0",
        sourceLayer: "scene"
      }
    ];

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Cell cell-1 has an invalid transform.");
  });

  test("rejects a manifest with unsupported format, format version, and model file", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    const invalid = { ...manifest, format: "something-else", formatVersion: 2, model: { ...manifest.model, file: "other.glb" } };

    const result = validateEnvironmentPackage(invalid, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        "Unsupported package format.",
        "Unsupported package format version.",
        "Manifest model.file must be environment.glb."
      ])
    );
  });

  test("rejects a manifest with a non-positive grid dimension", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    const invalid = { ...manifest, grid: { ...manifest.grid, width: 0 } };

    const result = validateEnvironmentPackage(invalid, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Manifest grid must define positive width, depth, and cellSize.");
  });

  test("rejects a manifest with invalid grid bounds", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    const invalid = { ...manifest, grid: { ...manifest.grid, bounds: { min: { x: 1, y: 0, z: 0 }, max: { x: -1, y: 1, z: 1 } } } };

    const result = validateEnvironmentPackage(invalid, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Manifest grid bounds must be finite with min not exceeding max on every axis.");
  });

  test("rejects a manifest with duplicate IDs", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const manifest = fixtureManifest(sha256Hex(glb));
    manifest.chunks = [
      { id: "chunk-0", bounds: manifest.grid.bounds },
      { id: "chunk-0", bounds: manifest.grid.bounds }
    ];

    const result = validateEnvironmentPackage(manifest, glb);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("Duplicate chunk ID chunk-0.");
  });

  test("rejects a GLB smaller than a valid header", () => {
    const manifest = fixtureManifest("0".repeat(64));

    const result = validateEnvironmentPackage(manifest, Buffer.from([1, 2, 3, 4]));

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("GLB is smaller than a valid header.");
  });

  test("rejects a GLB with corrupt magic bytes", () => {
    const manifest = fixtureManifest("0".repeat(64));
    const corrupt = Buffer.alloc(20);
    corrupt.writeUInt32LE(0xdeadbeef, 0);

    const result = validateEnvironmentPackage(manifest, corrupt);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("GLB magic bytes are missing.");
  });

  test("rejects a GLB whose chunk length exceeds the file size", () => {
    const glb = buildGlb({ nodes: [{ name: "SteerlabEnvironment" }] });
    const corrupt = Buffer.from(glb);
    corrupt.writeUInt32LE(1000, 12);
    const manifest = fixtureManifest(sha256Hex(glb));

    const result = validateEnvironmentPackage(manifest, corrupt);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContain("GLB chunk length exceeds file size.");
  });
});

function fixtureManifest(sha256: string): EnvironmentManifest {
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

function buildGlb(json: unknown): Buffer {
  const jsonText = JSON.stringify(json);
  const padded = jsonText + " ".repeat((4 - (jsonText.length % 4)) % 4);
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
