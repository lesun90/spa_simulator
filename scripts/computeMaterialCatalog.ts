import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Derives the full set of real material tokens used anywhere in the pack, from the visual-grid
 * segments generateRoadTileWfcMetadata.ts already bakes into every asset's socket signatures
 * (real GLB mesh material names, normalized — see that script's materialResolver/normalizeToken).
 * Writes the sorted list into wfc-pack.json as `materials`, a pack-wide catalog other tooling
 * (the environment exporter, Scenario Studio's friction editor) can read without hardcoding names.
 */
const packRoot = "assets/scene_element/3d-road-tiles";
const EMPTY_CELL = "empty";

interface AssetMetadataShape {
  wfc?: { variants?: Array<{ sockets?: Record<string, string> }> };
}

async function main() {
  const entries = await readdir(packRoot, { withFileTypes: true });
  const materials = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const raw = await readFile(join(packRoot, entry.name, "asset.json"), "utf8").catch(() => null);
    if (!raw) continue;
    const asset = JSON.parse(raw) as AssetMetadataShape;
    for (const variant of asset.wfc?.variants ?? []) {
      for (const socket of Object.values(variant.sockets ?? {})) collectMaterials(socket, materials);
    }
  }

  const sorted = [...materials].sort();
  const packPath = join(packRoot, "wfc-pack.json");
  const raw = await readFile(packPath, "utf8");
  const updated = raw.includes('"materials":')
    ? raw.replace(/"materials":\s*\[[^\]]*\]/, `"materials": ${JSON.stringify(sorted)}`)
    : raw.replace(/"dimensions": \{/, `"materials": ${JSON.stringify(sorted)},\n  "dimensions": {`);
  await writeFile(packPath, updated);
  console.log(`wfc-pack.json: materials = ${sorted.join(", ") || "(none found)"}`);
}

/** Splits a socket signature on "|"; every segment prefixed "v:" (the outer face grid and, for
 * planar directions, the nested edge-strip grid alike) is a visual/material sample grid. */
function collectMaterials(socket: string, into: Set<string>): void {
  for (const segment of socket.split("|")) {
    if (!segment.startsWith("v:")) continue;
    for (const row of segment.slice(2).split("/")) for (const token of row.split(",")) {
      if (token && token !== EMPTY_CELL) into.add(token);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
