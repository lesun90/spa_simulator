import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Derives what fraction of a road tile's edge is drivable surface, from the boundary socket
 * samples `generateRoadTileWfcMetadata.ts` already baked into the straight-road tile's asset.json
 * (real geometry sampled once at generation time, not re-measured here). Writes the result into
 * wfc-pack.json as `roadWidthFraction`, a pack-wide constant: every straight tile in a road-tile
 * pack shares the same module width, so this only needs computing once, not per scene export.
 */
const packRoot = "assets/scene_element/3d-road-tiles";
const ROAD_SURFACE_MATERIAL = "asphalt";

interface WfcPackDeclarationShape {
  profiles: { "road-scene"?: { scenic?: { straightRoad?: string } } };
}

interface AssetMetadataShape {
  wfc?: { variants?: Array<{ sockets: Record<string, string> }> };
}

async function main() {
  const pack = JSON.parse(await readFile(join(packRoot, "wfc-pack.json"), "utf8")) as WfcPackDeclarationShape;
  const straightRoadId = pack.profiles["road-scene"]?.scenic?.straightRoad;
  if (!straightRoadId) throw new Error("wfc-pack.json has no profiles.road-scene.scenic.straightRoad to sample.");

  const folder = straightRoadId.split(".").at(-1)!;
  const asset = JSON.parse(await readFile(join(packRoot, folder, "asset.json"), "utf8")) as AssetMetadataShape;
  const variant = asset.wfc?.variants?.[0];
  if (!variant) throw new Error(`${straightRoadId} has no WFC variants to sample.`);

  const fraction = roadSurfaceFraction(variant.sockets);
  if (fraction === null) throw new Error(`Could not find a ${ROAD_SURFACE_MATERIAL} boundary sample on any edge of ${straightRoadId}.`);

  const raw = await readFile(join(packRoot, "wfc-pack.json"), "utf8");
  const updated = raw.replace(/"dimensions": \{/, `"roadWidthFraction": ${fraction},\n  "dimensions": {`);
  await writeFile(join(packRoot, "wfc-pack.json"), updated);
  console.log(`${straightRoadId}: roadWidthFraction = ${fraction}`);
}

/** Scans each planar edge's visual sample grid for the first row that carries road surface, and returns its coverage fraction. */
function roadSurfaceFraction(sockets: Record<string, string>): number | null {
  for (const direction of ["north", "east", "south", "west"]) {
    const socket = sockets[direction];
    const visual = socket?.split("|v:")[1]?.split("|")[0];
    if (!visual) continue;
    for (const row of visual.split("/")) {
      const samples = row.split(",");
      const surfaceCount = samples.filter((sample) => sample === ROAD_SURFACE_MATERIAL).length;
      if (surfaceCount > 0) return surfaceCount / samples.length;
    }
  }
  return null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
