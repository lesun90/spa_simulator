import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoadTopologyKind, RoadTopologyTag, WfcPlanarDirection } from "../src/wfc/metadata/socketTypes";
import { reviewedRoadTopologyKinds } from "../src/wfc/metadata/reviewedRoadTopology";

const assetRoot = "assets/3d-road-tiles";
const directionOrder: readonly WfcPlanarDirection[] = ["north", "east", "south", "west"];
const reviewedKinds = reviewedRoadTopologyKinds;

interface AssetMetadata {
  wfc?: {
    variants?: Array<{
      sockets: Record<WfcPlanarDirection | "top" | "bottom", string>;
      roadTopology?: RoadTopologyTag;
    }>;
  };
}

async function main() {
  const folders = (await readdir(assetRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^road-tile-\d{3}$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const counts: Partial<Record<RoadTopologyKind, number>> = {};

  for (const folder of folders) {
    const id = folder.name.slice(-3);
    const file = join(assetRoot, folder.name, "asset.json");
    const metadata = JSON.parse(await readFile(file, "utf8")) as AssetMetadata;
    const kind = reviewedKinds[id];
    for (const variant of metadata.wfc?.variants ?? []) {
      if (!kind) {
        delete variant.roadTopology;
        continue;
      }
      const edges = roadEdges(variant.sockets, kind);
      const expectedEdges = edgeCountFor(kind);
      if (Object.keys(edges).length !== expectedEdges) {
        throw new Error(`road-tile-${id}: ${kind} expects ${expectedEdges} road edges, but variant has ${Object.keys(edges).length}.`);
      }
      variant.roadTopology = { kind, edges };
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    await writeFile(file, `${JSON.stringify(metadata, null, 2)}\n`);
  }

  console.log(JSON.stringify({ reviewedAssets: Object.keys(reviewedKinds).length, taggedVariants: Object.values(counts).reduce((total, count) => total + count, 0), counts }, null, 2));
}

function roadEdges(sockets: Record<WfcPlanarDirection | "top" | "bottom", string>, kind: RoadTopologyKind): RoadTopologyTag["edges"] {
  const directions = directionOrder.filter((direction) => sockets[direction].includes("asphalt"));
  if (!directions.length && kind === "straight") directions.push(...(sockets.north === sockets.south ? ["north", "south"] : ["east", "west"]));
  if (!directions.length) throw new Error(`Cannot derive ${kind} road edges from an unmarked socket map.`);
  return Object.fromEntries(directions.map((direction) => [direction, "road"]));
}

function edgeCountFor(kind: RoadTopologyKind) {
  if (kind === "dead-end") return 1;
  if (kind === "t-junction") return 3;
  if (kind === "four-way") return 4;
  return 2;
}

void main();
