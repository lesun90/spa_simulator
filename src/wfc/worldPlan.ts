import type { PlanarDirection } from "./planarWfc";

export type RegionZoneRole = "terrain" | "park" | "built" | "water";

export interface GridCell {
  column: number;
  row: number;
}

export interface WorldBounds {
  width: number;
  depth: number;
}

export interface MacroRegion {
  id: string;
  column: number;
  row: number;
  bounds: WorldBounds & GridCell;
  zone: RegionZoneRole;
}

export interface MacroRegionGraph {
  regions: readonly MacroRegion[];
  neighbors: Readonly<Record<string, readonly string[]>>;
}

export interface RoadPortal {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  from: GridCell & { direction: PlanarDirection };
  to: GridCell & { direction: PlanarDirection };
}

export interface PrimaryRoute {
  regionIds: readonly string[];
  portals: readonly RoadPortal[];
}

export interface PlannedRoadCell extends GridCell {
  directions: readonly PlanarDirection[];
}

export interface LocalCorridorPlan {
  regionId: string;
  cells: readonly PlannedRoadCell[];
}

export interface WorldPlan {
  bounds: WorldBounds;
  graph: MacroRegionGraph;
  route: PrimaryRoute;
  corridors: readonly LocalCorridorPlan[];
}
