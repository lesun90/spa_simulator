import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { arePlanarNeighborsCompatible, createPlanarPalette, solvePlanarWfc } from "../src/wfc/planarWfc";
import type { WfcMetadata } from "../src/wfc/metadata/socketTypes";

interface AssetMetadata {
  id: string;
  wfc?: WfcMetadata;
}

const root = "assets/3d-road-tiles";
const folders = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
const variants = [];

for (const folder of folders) {
  const metadata = JSON.parse(await readFile(join(root, folder.name, "asset.json"), "utf8")) as AssetMetadata;
  if (!metadata.wfc) continue;
  for (const variant of metadata.wfc.variants) {
    variants.push({
      id: variant.variantId,
      assetId: metadata.id,
      rotationDegrees: variant.rotationDegrees,
      sockets: variant.sockets,
      weight: variant.weight ?? metadata.wfc.defaultWeight ?? 1
    });
  }
}

const palette = createPlanarPalette("reference-road-tiles", 3, 3, variants);
const result = solvePlanarWfc(palette, { width: 8, depth: 8, seed: 20260909, maxBacktracks: 10_000 });
if (result.status !== "solved") throw new Error(`${result.reason}: ${result.diagnostics.join("; ")}`);

const cells = new Map(result.cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
let seamsVerified = 0;
for (const cell of result.cells) {
  for (const [direction, columnOffset, rowOffset] of [
    ["east", 1, 0],
    ["north", 0, 1]
  ] as const) {
    const neighbor = cells.get(`${cell.column + columnOffset},${cell.row + rowOffset}`);
    if (!neighbor) continue;
    if (!arePlanarNeighborsCompatible(palette, cell.variant.id, direction, neighbor.variant.id)) {
      throw new Error(`Socket mismatch at ${cell.column},${cell.row} toward ${direction}.`);
    }
    seamsVerified += 1;
  }
}

console.log(JSON.stringify({ catalogAssets: folders.length, variants: variants.length, cells: result.cells.length, decisions: result.decisions, backtracks: result.backtracks, seed: result.seed, seamsVerified }, null, 2));
