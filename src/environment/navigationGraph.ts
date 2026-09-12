import type { AssetCatalogEntry } from "../editor-core/assets";
import type { WfcPlanarDirection } from "../wfc/metadata/socketTypes";
import { oppositeDirections } from "../wfc/metadata/socketTypes";
import { mergeSemanticPorts, roadTopologyPorts, rotateSemanticPorts } from "../wfc/sceneLayout";
import type { EnvironmentManifestCell, EnvironmentManifestNavigationEdge, EnvironmentManifestNavigationNode, SceneRecipe } from "./types";

const PLANAR_DIRECTIONS: readonly WfcPlanarDirection[] = ["north", "east", "south", "west"];
const DIRECTION_OFFSETS: Record<WfcPlanarDirection, { column: number; row: number }> = {
  north: { column: 0, row: -1 },
  south: { column: 0, row: 1 },
  east: { column: 1, row: 0 },
  west: { column: -1, row: 0 }
};

export interface NavigationGraph {
  nodes: EnvironmentManifestNavigationNode[];
  edges: EnvironmentManifestNavigationEdge[];
}

/** Builds one navigation node per cell and a road edge between adjacent cells whose rotated ports both carry "road". */
export function buildNavigationGraph(cells: readonly EnvironmentManifestCell[], _recipe: SceneRecipe, assets: readonly AssetCatalogEntry[]): NavigationGraph {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const cellsByCoordinate = new Map(cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
  const rotatedPortsByCellId = new Map(cells.map((cell) => [cell.id, rotatedPortsForCell(cell, assetsById)]));

  const nodes: EnvironmentManifestNavigationNode[] = cells.map((cell) => ({
    id: `nav_${cell.id}`,
    cellId: cell.id,
    position: cell.transform.position,
    channels: roadChannelsForCell(rotatedPortsByCellId.get(cell.id)),
    featureTags: []
  }));

  const edges: EnvironmentManifestNavigationEdge[] = [];
  for (const cell of cells) {
    const ports = rotatedPortsByCellId.get(cell.id);
    for (const direction of PLANAR_DIRECTIONS) {
      if (!ports?.[direction]?.includes("road")) continue;
      const offset = DIRECTION_OFFSETS[direction];
      const neighbor = cellsByCoordinate.get(`${cell.column + offset.column},${cell.row + offset.row}`);
      if (!neighbor) continue;
      const oppositeDirection = oppositeDirections[direction] as WfcPlanarDirection;
      const neighborPorts = rotatedPortsByCellId.get(neighbor.id);
      if (!neighborPorts?.[oppositeDirection]?.includes("road")) continue;
      if (direction !== "north" && direction !== "east") continue; // visit each pair once

      edges.push({
        id: `nav_edge_${cell.id}_${neighbor.id}`,
        fromNodeId: `nav_${cell.id}`,
        toNodeId: `nav_${neighbor.id}`,
        direction,
        channel: "road",
        cost: distance(cell.transform.position, neighbor.transform.position),
        bidirectional: true
      });
    }
  }

  return { nodes, edges };
}

/** Channels a cell exposes, derived from the SAME merged, rotation-aware port map used for edge matching, so a cell's `channels` field never disagrees with which directions actually carry "road" in rotatedPortsForCell. */
function roadChannelsForCell(ports: Partial<Record<WfcPlanarDirection, readonly string[]>> | undefined): string[] {
  const channels = new Set<string>();
  for (const values of Object.values(ports ?? {})) {
    for (const value of values ?? []) channels.add(value);
  }
  return [...channels];
}

/**
 * Converts the cell's radian rotationY back to the degrees rotateSemanticPorts expects, and merges
 * BOTH sources of road connectivity the real WFC generation pipeline merges (see sceneLayout.ts's
 * paletteFromAssets): rotation-aware `semantics.sockets` AND the cell's specific WFC variant's
 * `roadTopology.edges` (which is how every real road-tile asset in this repo actually encodes
 * connectivity — most have no `semantics` field at all).
 */
function rotatedPortsForCell(cell: EnvironmentManifestCell, assetsById: ReadonlyMap<string, AssetCatalogEntry>): Partial<Record<WfcPlanarDirection, readonly string[]>> | undefined {
  const asset = assetsById.get(cell.sourceAssetId);
  if (!asset) return undefined;
  const rotationDegrees = Math.round((cell.transform.rotationY * 180) / Math.PI);
  const variant = asset.wfc?.variants.find((candidate) => candidate.variantId === cell.variantId);
  return mergeSemanticPorts(roadTopologyPorts(variant?.roadTopology), rotateSemanticPorts(asset.semantics?.sockets, rotationDegrees));
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
