import type { AssetCatalogEntry } from "../editor-core/assets";
import type { WfcPlanarDirection } from "../wfc/metadata/socketTypes";
import { oppositeDirections } from "../wfc/metadata/socketTypes";
import { rotateSemanticPorts } from "../wfc/sceneLayout";
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
    channels: roadChannelsForCell(cell, assetsById),
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

function roadChannelsForCell(cell: EnvironmentManifestCell, assetsById: ReadonlyMap<string, AssetCatalogEntry>): string[] {
  const sockets = assetsById.get(cell.sourceAssetId)?.semantics?.sockets ?? {};
  const channels = new Set<string>();
  for (const socket of Object.values(sockets)) {
    if (socket?.type) channels.add(socket.type);
  }
  return [...channels];
}

/** Converts the cell's radian rotationY back to the degrees rotateSemanticPorts expects, and rotates the asset's authored (rotation-0) sockets to their world-facing directions for this placement. */
function rotatedPortsForCell(cell: EnvironmentManifestCell, assetsById: ReadonlyMap<string, AssetCatalogEntry>): Partial<Record<WfcPlanarDirection, readonly string[]>> | undefined {
  const asset = assetsById.get(cell.sourceAssetId);
  if (!asset?.semantics) return undefined;
  const rotationDegrees = Math.round((cell.transform.rotationY * 180) / Math.PI);
  return rotateSemanticPorts(asset.semantics.sockets, rotationDegrees);
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
