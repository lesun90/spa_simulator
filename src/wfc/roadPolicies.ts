import type { PlanarDirection, PlanarPolicySpec } from "./planarWfc";

/** Road-specific policy composition. The planar solver only understands generic roles and channels. */
export interface RoadNetworkPolicyConfig {
  maxJunctions?: number;
  maxDeadEnds?: number;
  requireConnectedRoads?: boolean;
  entrances?: readonly { direction: PlanarDirection; channel?: string; positions?: readonly number[] }[];
  forbidAdjacentJunctions?: boolean;
}

export function createRoadNetworkPolicies(config: RoadNetworkPolicyConfig = {}): PlanarPolicySpec[] {
  const policies: PlanarPolicySpec[] = [];
  if (config.maxJunctions !== undefined) policies.push({ type: "max-role-count", id: "road-junction-limit", role: "junction", max: config.maxJunctions });
  if (config.maxDeadEnds !== undefined) policies.push({ type: "max-role-count", id: "road-dead-end-limit", role: "dead-end", max: config.maxDeadEnds });
  if (config.requireConnectedRoads) policies.push({ type: "connected-channel", id: "road-connectivity", channel: "road" });
  if (config.forbidAdjacentJunctions) policies.push({ type: "forbid-role-adjacency", id: "road-junction-adjacency", sourceRole: "junction", neighborRole: "junction" });
  for (const [index, entrance] of (config.entrances ?? []).entries()) policies.push({ type: "required-boundary-port", id: `road-entrance-${index}`, direction: entrance.direction, channel: entrance.channel ?? "road", positions: entrance.positions });
  return policies;
}
