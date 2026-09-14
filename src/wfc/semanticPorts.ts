import type { AssetSemantics, RoadTopologyTag } from "./metadata/socketTypes";
import { planarDirections, type PlanarDirection } from "./planarWfc";

export function rotateSemanticPorts(sockets: AssetSemantics["sockets"] | undefined, rotationDegrees: number): Partial<Record<PlanarDirection, readonly string[]>> | undefined { if (!sockets) return undefined; const turns = ((rotationDegrees / 90) % 4 + 4) % 4; const directions: PlanarDirection[] = ["north", "east", "south", "west"]; const output: Partial<Record<PlanarDirection, readonly string[]>> = {}; for (const direction of directions) { const socket = sockets[direction]; if (socket?.type) output[directions[(directions.indexOf(direction) + turns) % 4]] = [socket.type]; } return output; }
export function roadTopologyPorts(topology: RoadTopologyTag | undefined): Partial<Record<PlanarDirection, readonly string[]>> | undefined { if (!topology) return undefined; return Object.fromEntries(Object.entries(topology.edges).map(([direction]) => [direction, ["road"]])) as Partial<Record<PlanarDirection, readonly string[]>>; }

export function mergeSemanticPorts(...maps: (Partial<Record<PlanarDirection, readonly string[]>> | undefined)[]) {
  if (maps.every((map) => !map)) return undefined;
  return Object.fromEntries(planarDirections.flatMap((direction) => {
    const channels = [...new Set(maps.flatMap((map) => map?.[direction] ?? []))];
    return channels.length ? [[direction, channels]] : [];
  }));
}
