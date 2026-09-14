import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { discoverAssetCatalog } from "../server/assetCatalog";
import { generateWfcScene } from "../src/wfc/sceneGenerator";
import { generateWfcLayout, paletteFromAssets } from "../src/wfc/sceneLayout";
import { resolvePackProfile, validatePackDeclaration } from "../src/wfc/metadata/packCatalog";
import roadPackData from "../assets/scene_element/3d-road-tiles/wfc-pack.json";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import type { WfcPackDeclaration } from "../src/wfc/metadata/packTypes";

const declaration: WfcPackDeclaration = { id: "mosaic", version: 1, dimensions: { sourceTileWidth: 2, sourceTileDepth: 4 }, capabilities: ["tiling"], defaultProfile: "tiling", profiles: { tiling: { requires: ["tiling"] }, alternate: { requires: ["tiling"] } }, socketNamespace: "mosaic-v1" };
const sockets = { north: "mosaic-v1:edge", east: "mosaic-v1:edge", south: "mosaic-v1:edge", west: "mosaic-v1:edge", top: "", bottom: "" };
const source: AssetCatalogEntry = { id: "mosaic.square", label: "Mosaic", category: "decorative", source: "shared", implementation: "glb", wfcPack: declaration, wfc: { height: 0, defaultWeight: 2.25, diagnostics: [], variants: [{ variantId: "mosaic.square@r90", rotationDegrees: 90, weight: 0.125, sockets }, { variantId: "mosaic.square@r0", rotationDegrees: 0, sockets }] } };
const request = { width: 3, depth: 2, seed: 42, tileWidth: 6, tileDepth: 12 };
const directory = await mkdtemp(join(tmpdir(), "wfc-pack-integration-"));
try {
  await mkdir(join(directory, "mosaic"));
  await writeFile(join(directory, "mosaic", "asset.json"), JSON.stringify(source));
  await writeFile(join(directory, "mosaic", "model.glb"), "catalog-only fixture");
  const assets = await discoverAssetCatalog(directory);
  assert.deepEqual(assets[0].wfcPack, declaration);
  const solved = await generateWfcScene(assets, request);
  assert.equal(solved.status, "solved");
  assert.equal(solved.roadScene, false);
  assert.equal(solved.objects.length, 6);
  assert(solved.objects.every((object) => object.scale === 3 && object.position.y === 0));
  assert.deepEqual(solved.objects.map((object) => [object.position.x, object.position.z]), [[-6, -6], [0, -6], [6, -6], [-6, 6], [0, 6], [6, 6]]);
  assert.deepEqual(solved.palette.variants.map((variant) => [variant.id, variant.weight]), [["mosaic.square@r0", 2.25], ["mosaic.square@r90", 0.125]]);
  assert(!("pack" in solved.palette) && !("scenic" in solved.palette));
  assert.equal(generateWfcLayout(assets, { ...request, profile: "alternate" }).status, "solved");
  const failure = async (catalog: AssetCatalogEntry[], pattern: RegExp, change = {}) => {
    const result = await generateWfcScene(catalog, { ...request, ...change });
    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.match(result.diagnostics[0], pattern);
  };
  await failure(assets, /uniform scale/, { tileDepth: 6 });
  await failure(assets, /unsupported profile/, { profile: "missing" });
  const withPack = (pack: WfcPackDeclaration) => [{ ...source, wfcPack: pack }];
  await failure(withPack({ ...declaration, dimensions: { sourceTileWidth: 0, sourceTileDepth: 4 } }), /positive source dimensions/);
  await failure(withPack({ ...declaration, profiles: { tiling: { requires: ["tiling", "scenic"] } } }), /profile tiling: missing required capability scenic/);
  await failure(withPack({ ...declaration, capabilities: ["tiling", "scenic"], profiles: { tiling: { requires: ["tiling", "scenic"] } } }), /scenic capability is missing ordered assembly recipes/);
  await failure(withPack({ ...declaration, capabilities: ["tiling", "road"], profiles: { tiling: { requires: ["tiling", "road"] } } }), /road capability is missing road channel/);
  assert.equal((await generateWfcScene(withPack({ ...declaration, capabilities: ["tiling", "road"] }), request)).status, "solved");
  await failure([{ ...source, wfc: { ...source.wfc!, variants: [{ ...source.wfc!.variants[0], sockets: { ...sockets, north: "" } }] } }], /nonempty planar sockets/);
  const second = { ...source, id: "second.square", wfcPack: { ...declaration, id: "second" }, wfc: { ...source.wfc!, variants: [{ ...source.wfc!.variants[0], variantId: "second.square@r90" }] } };
  assert.equal((await generateWfcScene([source, second], request)).status, "solved");
  await failure([source, { ...second, wfcPack: { ...second.wfcPack, defaultProfile: "alternate" } }], /Ambiguous/);
  assert.equal((await generateWfcScene([source, { ...second, wfcPack: { ...second.wfcPack, defaultProfile: "alternate" } }], { ...request, profile: "tiling" })).status, "solved");
  await failure([source, { ...second, wfcPack: { ...second.wfcPack, socketNamespace: undefined } }], /shared socket namespace/);
  await failure([source, { ...second, wfcPack: { ...second.wfcPack, dimensions: { sourceTileWidth: 3, sourceTileDepth: 3 } } }], /incompatible source dimensions/);
  await failure([source, { ...second, wfcPack: undefined }], /Declared and undeclared/);
  const inherited = join(directory, "nested", "pack", "tile");
  await mkdir(inherited, { recursive: true });
  await writeFile(join(directory, "nested", "pack", "wfc-pack.json"), JSON.stringify(declaration));
  await writeFile(join(inherited, "asset.json"), JSON.stringify({ ...source, wfcPack: undefined, id: "inherited" }));
  await writeFile(join(inherited, "model.glb"), "catalog-only fixture");
  assert.deepEqual((await discoverAssetCatalog(directory)).find((asset) => asset.id === "inherited")?.wfcPack, declaration);
  await writeFile(join(inherited, "asset.json"), JSON.stringify({ ...source, id: "inherited", wfcPack: { ...declaration, id: "override" } }));
  assert.equal((await discoverAssetCatalog(directory)).find((asset) => asset.id === "inherited")?.wfcPack?.id, "override");
  console.log("PASS: filesystem catalog declaration, non-road profile selection, authored rotations/weights, source dimensions/scales, diagnostics and mixed-pack namespaces.");

  const authorRoot = join(directory, "authoring");
  await mkdir(join(authorRoot, "tile"), { recursive: true });
  const authorPack = { ...declaration, dimensions: { sourceTileWidth: 3, sourceTileDepth: 3 } };
  const packPath = join(directory, "author-pack.json");
  await writeFile(packPath, JSON.stringify(authorPack));
  const tileJson = join(authorRoot, "tile", "asset.json");
  await writeFile(tileJson, JSON.stringify({ ...source, wfcPack: undefined }));
  await copyFile("assets/scene_element/3d-road-tiles/road-tile-163/road-tile-163.glb", join(authorRoot, "tile", "model.glb"));
  execFileSync("npx", ["vite-node", "scripts/generateRoadTileWfcMetadata.ts", "--asset-root", authorRoot, "--pack", packPath], { stdio: "pipe" });
  assert.deepEqual(JSON.parse(await readFile(join(authorRoot, "wfc-pack.json"), "utf8")), authorPack);
  const authoredTile = JSON.parse(await readFile(tileJson, "utf8"));
  assert.equal(authoredTile.wfcPack, undefined);
  assert.equal(authoredTile.wfc.defaultWeight, 2.25);
  assert.deepEqual((await discoverAssetCatalog(authorRoot))[0].wfcPack, authorPack);
  console.log("PASS: authoring CLI persists one pack declaration, preserves weights, and reloads through the catalog.");

  const frozen = JSON.parse(gunzipSync(await readFile("docs/superpowers/baselines/2026-09-13-lean-modular/inputs.json.gz")).toString()) as { assets: AssetCatalogEntry[] };
  const roads = frozen.assets.filter((asset) => asset.category === "3d-road-tiles");
  const authoredRoadPack = roadPackData as unknown as WfcPackDeclaration;
  assert.equal(authoredRoadPack.id, "3d-road-tiles");
  assert.equal(authoredRoadPack.version, 1);
  assert.equal(authoredRoadPack.defaultProfile, "road-scene");
  validatePackDeclaration(authoredRoadPack, roads.map((asset) => ({ ...asset, wfcPack: authoredRoadPack })), "road-scene");
  validatePackDeclaration(authoredRoadPack, roads.map((asset) => ({ ...asset, wfcPack: authoredRoadPack })), "tiling");
  const actualRoads = (await discoverAssetCatalog("assets")).filter((asset) => asset.category === "3d-road-tiles");
  assert(actualRoads.length > 0 && actualRoads.every((asset) => asset.wfcPack?.id === authoredRoadPack.id));
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  for (const purpose of [undefined, "road-scene"] as const) {
    assert.deepEqual(plain(paletteFromAssets("catalog", actualRoads, { purpose })), plain(paletteFromAssets("catalog", roads, { purpose })));
  }
  assert.deepEqual(plain(await generateWfcScene(actualRoads, { width: 10, depth: 10, seed: 13 })), plain(await generateWfcScene(roads, { width: 10, depth: 10, seed: 13 })));
  for (const [path, value] of [["scenic.water.bridges", null], ["adjacency.ground", []], ["scenic.stages", {}], ["scenic.unknown", true]] as const) {
    const malformed = structuredClone(authoredRoadPack);
    const keys = path.split(".");
    let target = malformed.profiles["road-scene"] as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = value;
    assert.throws(() => validatePackDeclaration(malformed, actualRoads), new RegExp("WFC pack 3d-road-tiles, profile road-scene: declaration.profiles.road-scene." + path));
  }
  console.log("PASS: actual nested catalog loads authored pack; generic/road palettes and seeded scene match frozen inputs; malformed nested fields have contextual diagnostics.");
  const externalGround = { ...roads.find((asset) => asset.id.endsWith("road-tile-163"))!, id: "external.ground", category: "external", semantics: { roles: ["terrain.ground"], sockets: {} }, wfc: { ...roads.find((asset) => asset.id.endsWith("road-tile-163"))!.wfc!, variants: roads.find((asset) => asset.id.endsWith("road-tile-163"))!.wfc!.variants.map((variant) => ({ ...variant, variantId: `external.${variant.variantId}` })) } };
  assert(paletteFromAssets("mixed", [...roads, externalGround], { purpose: "road-scene" }).variants.some((variant) => variant.assetId === externalGround.id));
  const unusableTrigger = { ...source, wfcPack: undefined, wfc: undefined, category: "3d-road-tiles" };
  assert.equal(resolvePackProfile([unusableTrigger], undefined, true).profileName, "road-scene");
  assert.equal(resolvePackProfile([unusableTrigger]).profileName, "tiling");
  const renamed = (id: string) => id.replaceAll("3d-road-tiles.road-tile-", "garden.piece-");
  const profile = JSON.parse(renamed(JSON.stringify(roadPackData.profiles["road-scene"]))) as WfcPackDeclaration["profiles"][string];
  profile.scenic!.aliases = undefined;
  // Suffix-based legacy compatibility selectors become explicit concrete references.
  for (const selector of [...Object.values(profile.adjacency!), profile.eligibility!.exclude!]) if (selector.assetIdSuffixes) {
    selector.assetIds = roads.filter((asset) => selector.assetIdSuffixes!.some((suffix: string) => asset.id.endsWith(suffix))).map((asset) => renamed(asset.id));
    delete selector.assetIdSuffixes;
  }
  const gardenPack: WfcPackDeclaration = { id: "garden", version: 1, dimensions: { sourceTileWidth: 3, sourceTileDepth: 3 }, capabilities: ["tiling", "road", "scenic"], defaultProfile: "scenic", profiles: { scenic: profile }, socketNamespace: "garden-v1" };
  const garden = roads.map((asset) => ({ ...asset, id: renamed(asset.id), category: "garden", wfcPack: gardenPack, semantics: asset.semantics ?? { roles: ["road.surface"], sockets: {} }, wfc: asset.wfc && { ...asset.wfc, variants: asset.wfc.variants.map((variant) => ({ ...variant, variantId: renamed(variant.variantId) })) } }));
  const legacyScene = await generateWfcScene(roads, { width: 10, depth: 10, seed: 13 });
  const gardenScene = await generateWfcScene(garden, { width: 10, depth: 10, seed: 13 });
  assert.equal(gardenScene.status, "solved", gardenScene.status === "failed" ? gardenScene.diagnostics.join("; ") : "");
  assert.deepEqual(JSON.parse(JSON.stringify(gardenScene)), JSON.parse(renamed(JSON.stringify(legacyScene))));
  console.log("PASS: mixed legacy eligibility and unusable road trigger; renamed metadata-defined scenic pack matches legacy scene exactly after ID translation.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
