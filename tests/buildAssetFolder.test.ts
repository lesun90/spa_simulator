import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildAssetFolder, importTempAssets } from "../scripts/buildAssetFolder";

describe("asset folder builder", () => {
  test("builds a self-contained folder from a glb and texture files", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-asset-builder-"));
    const source = join(root, "source");
    const assets = join(root, "assets");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "building-type-a.glb"), makeGlbWithImage("variation-a.png"));
    await writeFile(join(source, "variation-a.png"), pngBytes());

    const entry = await buildAssetFolder({
      assetRoot: assets,
      category: "city-kit-suburban-A",
      glbFile: join(source, "building-type-a.glb"),
      textureFiles: [join(source, "variation-a.png")]
    });

    expect(entry).toEqual({
      id: "city-kit-suburban-A.building-type-a",
      label: "Building Type A",
      category: "city-kit-suburban-A",
      folder: join(assets, "city-kit-suburban-A", "building-type-a")
    });
    expect((await readdir(entry.folder)).sort()).toEqual(["asset.json", "building-type-a.glb"]);
    expect(readImagesFromGlb(await readFile(join(entry.folder, "building-type-a.glb")))).toEqual([
      expect.objectContaining({ bufferView: expect.any(Number), mimeType: "image/png" })
    ]);
    expect(JSON.parse(await readFile(join(entry.folder, "asset.json"), "utf8"))).toEqual({
      id: "city-kit-suburban-A.building-type-a",
      label: "Building Type A",
      category: "city-kit-suburban-A"
    });
  });

  test("imports top-level temp asset kits with normalized categories, previews, and variant categories", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-temp-import-"));
    const tempRoot = join(root, "temp_assets");
    const kit = join(tempRoot, "city-kit-suburban_20");
    const assets = join(root, "assets");
    await mkdir(join(kit, "Models", "GLB format"), { recursive: true });
    await mkdir(join(kit, "Models", "GLB format", "Textures"), { recursive: true });
    await mkdir(join(kit, "Models", "Textures"), { recursive: true });
    await mkdir(join(kit, "Previews"), { recursive: true });
    await writeFile(join(kit, "Models", "GLB format", "building-type-a.glb"), makeGlbWithImage("Textures/colormap.png"));
    await writeFile(join(kit, "Models", "GLB format", "road-straight.glb"), makeGlbWithImage("Textures/colormap.png"));
    await writeFile(join(kit, "Models", "GLB format", "Textures", "colormap.png"), pngBytes());
    await writeFile(join(kit, "Models", "Textures", "variation-a.png"), "texture-a");
    await writeFile(join(kit, "Models", "Textures", "variation-b.png"), "texture-b");
    await writeFile(join(kit, "Previews", "building-type-a.png"), "preview");

    const entries = await importTempAssets({ tempRoot, assetRoot: assets });

    expect(entries.map((entry) => [entry.id, entry.category]).sort()).toEqual([
      ["city-kit-suburban-A.building-type", "city-kit-suburban-A"],
      ["city-kit-suburban.road-straight", "city-kit-suburban"]
    ]);
    expect((await readdir(join(assets, "city-kit-suburban-A", "building-type"))).sort()).toEqual([
      "asset.json",
      "building-type-a.png",
      "building-type.glb"
    ]);
    expect(readImagesFromGlb(await readFile(join(assets, "city-kit-suburban-A", "building-type", "building-type.glb")))).toEqual([
      expect.objectContaining({ bufferView: expect.any(Number), mimeType: "image/png" })
    ]);
    expect(JSON.parse(await readFile(join(assets, "city-kit-suburban-A", "building-type", "asset.json"), "utf8"))).toEqual({
      id: "city-kit-suburban-A.building-type",
      label: "Building Type",
      category: "city-kit-suburban-A"
    });
    expect((await readdir(join(assets, "city-kit-suburban", "road-straight"))).sort()).toEqual([
      "asset.json",
      "road-straight.glb"
    ]);
  });

  test("embeds textures nested beside a kit's GLB folder into the imported GLB", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-nested-textures-"));
    const tempRoot = join(root, "temp_assets");
    const kit = join(tempRoot, "car-kit");
    const assets = join(root, "assets");
    await mkdir(join(kit, "Models", "GLB format", "Textures"), { recursive: true });
    await mkdir(join(kit, "Previews"), { recursive: true });
    await writeFile(join(kit, "Models", "GLB format", "ambulance.glb"), makeGlbWithImage("Textures/colormap.png"));
    await writeFile(join(kit, "Models", "GLB format", "Textures", "colormap.png"), pngBytes());
    await writeFile(join(kit, "Previews", "ambulance.png"), "preview");

    await importTempAssets({ tempRoot, assetRoot: assets });

    expect((await readdir(join(assets, "car-kit", "ambulance"))).sort()).toEqual([
      "ambulance.glb",
      "ambulance.png",
      "asset.json"
    ]);
    expect(readImagesFromGlb(await readFile(join(assets, "car-kit", "ambulance", "ambulance.glb")))).toEqual([
      expect.objectContaining({ bufferView: expect.any(Number), mimeType: "image/png" })
    ]);
  });

  test("imports gltf road tiles as glb assets with material colors", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-gltf-import-"));
    const tempRoot = join(root, "temp_assets");
    const kit = join(tempRoot, "3d-road-tiles");
    const assets = join(root, "assets");
    await mkdir(join(kit, "Models", "gLTF"), { recursive: true });
    await writeFile(join(kit, "Models", "gLTF", "roadTile_001.gltf"), JSON.stringify(makeGltfWithColor([0.1, 0.2, 0.3, 1])));

    const entries = await importTempAssets({ tempRoot, assetRoot: assets });

    expect(entries).toEqual([
      {
        id: "3d-road-tiles.road-tile-001",
        label: "Road Tile 001",
        category: "3d-road-tiles",
        folder: join(assets, "3d-road-tiles", "road-tile-001")
      }
    ]);
    expect((await readdir(join(assets, "3d-road-tiles", "road-tile-001"))).sort()).toEqual([
      "asset.json",
      "road-tile-001.glb"
    ]);
    const glbJson = readJsonFromGlb(await readFile(join(assets, "3d-road-tiles", "road-tile-001", "road-tile-001.glb")));
    expect(glbJson.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([0.1, 0.2, 0.3, 1]);
    expect(glbJson.buffers[0]).toEqual({ byteLength: 4 });
    expect(glbJson.buffers[0].uri).toBeUndefined();
  });
});

function makeGlbWithImage(uri: string) {
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    images: [{ uri }]
  };
  return writeGlb(json, Buffer.alloc(0));
}

function makeGltfWithColor(baseColorFactor: number[]) {
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 4, uri: "data:application/octet-stream;base64,AQIDBA==" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor } }]
  };
}

function readImagesFromGlb(glb: Buffer) {
  return readJsonFromGlb(glb).images;
}

function readJsonFromGlb(glb: Buffer) {
  const jsonLength = glb.readUInt32LE(12);
  const jsonType = glb.readUInt32LE(16);
  expect(jsonType).toBe(0x4e4f534a);
  return JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
}

function writeGlb(json: unknown, bin: Buffer) {
  const jsonBuffer = padBuffer(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binBuffer = padBuffer(bin, 0x00);
  const length = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
  const glb = Buffer.alloc(length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(length, 8);
  glb.writeUInt32LE(jsonBuffer.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonBuffer.copy(glb, 20);
  glb.writeUInt32LE(binBuffer.length, 20 + jsonBuffer.length);
  glb.writeUInt32LE(0x004e4942, 24 + jsonBuffer.length);
  binBuffer.copy(glb, 28 + jsonBuffer.length);
  return glb;
}

function padBuffer(buffer: Buffer, padByte: number) {
  const paddedLength = Math.ceil(buffer.length / 4) * 4;
  return paddedLength === buffer.length ? buffer : Buffer.concat([buffer, Buffer.alloc(paddedLength - buffer.length, padByte)]);
}

function pngBytes() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}
