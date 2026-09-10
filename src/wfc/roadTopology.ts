import {
  createPlanarPalette,
  solvePlanarWfc,
  type PlanarDirection,
  type PlanarPolicySpec,
  type PlanarWfcVariant
} from "./planarWfc";

export interface RoadTopologyRequest {
  width: number;
  depth: number;
  seed: number;
}

interface RoadTopologyCell {
  column: number;
  row: number;
  ports: readonly PlanarDirection[];
}

const directions: readonly PlanarDirection[] = ["north", "east", "south", "west"];

/**
 * Solves an abstract road-network palette first, then turns the selected directional ports into
 * constraints for the concrete asset WFC pass. The abstract palette only exposes road shapes for
 * which the supplied concrete asset variants have an exact semantic-port equivalent.
 */
export function createRoadTopologyPolicies(
  request: RoadTopologyRequest,
  concreteVariants: readonly PlanarWfcVariant[] = []
): PlanarPolicySpec[] {
  if (request.width < 3 || request.depth < 3) return [];

  const availableShapes = roadShapesFromVariants(concreteVariants);
  const topologyVariants = createTopologyVariants(availableShapes);
  if (topologyVariants.length < 2) return [];

  const palette = createPlanarPalette("road-topology", 1, 1, topologyVariants);
  const center = {
    column: Math.floor(request.width / 2),
    row: Math.floor(request.depth / 2)
  };
  const anchor = selectAnchorShape(availableShapes);
  if (!anchor) return [];

  const boundaryPolicies = boundaryRoadPolicies(request.width, request.depth);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const seed = (request.seed + attempt * 0x9e3779b9) >>> 0;
    const solved = solvePlanarWfc(palette, {
      width: request.width,
      depth: request.depth,
      seed,
      maxBacktracks: request.width * request.depth * 16,
      policies: [
        ...boundaryPolicies,
        {
          type: "required-cell-ports",
          id: "road-topology-anchor",
          column: center.column,
          row: center.row,
          ports: anchor.map((direction) => ({ direction, channel: "road" }))
        },
        {
          type: "forbidden-cell-ports",
          id: "road-topology-anchor-shape",
          column: center.column,
          row: center.row,
          ports: directions
            .filter((direction) => !anchor.includes(direction))
            .map((direction) => ({ direction, channel: "road" }))
        }
      ]
    });
    if (solved.status !== "solved") continue;

    const topology = solved.cells
      .map((cell) => ({
        column: cell.column,
        row: cell.row,
        ports: directions.filter((direction) =>
          cell.variant.semanticPorts?.[direction]?.includes("road")
        )
      }))
      .filter((cell) => cell.ports.length > 0);
    if (!isSingleCyclicNetwork(topology, request.width, request.depth)) continue;
    return concretePoliciesFromTopology(topology, request.width, request.depth);
  }

  return [];
}

function roadShapesFromVariants(variants: readonly PlanarWfcVariant[]) {
  const shapes = new Map<string, readonly PlanarDirection[]>();
  for (const variant of variants) {
    const ports = directions.filter((direction) =>
      variant.semanticPorts?.[direction]?.includes("road")
    );
    if (ports.length >= 2) shapes.set(shapeId(ports), ports);
  }
  return [...shapes.values()];
}

function createTopologyVariants(shapes: readonly (readonly PlanarDirection[])[]) {
  return [
    {
      id: "empty",
      assetId: "empty",
      rotationDegrees: 0,
      // Keep the network sparse: roads expand only where needed to complete a cycle.
      weight: 12,
      sockets: socketMap([]),
      semanticPorts: {}
    },
    ...shapes.map((ports) => ({
      id: `road-${shapeId(ports)}`,
      assetId: `road-${shapeId(ports)}`,
      rotationDegrees: 0,
      weight: topologyWeight(ports.length),
      sockets: socketMap(ports),
      semanticPorts: Object.fromEntries(ports.map((direction) => [direction, ["road"]])) as Partial<Record<PlanarDirection, readonly string[]>>
    }))
  ];
}

function socketMap(ports: readonly PlanarDirection[]) {
  return {
    north: ports.includes("north") ? "road" : "empty",
    east: ports.includes("east") ? "road" : "empty",
    south: ports.includes("south") ? "road" : "empty",
    west: ports.includes("west") ? "road" : "empty",
    top: "top",
    bottom: "bottom"
  };
}

function topologyWeight(portCount: number) {
  if (portCount === 2) return 0.12;
  if (portCount === 3) return 0.02;
  return 0.006;
}

function selectAnchorShape(shapes: readonly (readonly PlanarDirection[])[]) {
  return [...shapes]
    .sort((a, b) => b.length - a.length || shapeId(a).localeCompare(shapeId(b)))
    .at(0);
}

function boundaryRoadPolicies(width: number, depth: number): PlanarPolicySpec[] {
  const policies: PlanarPolicySpec[] = [];
  for (let column = 0; column < width; column += 1) {
    policies.push({ type: "forbidden-cell-ports", id: `road-boundary-south-${column}`, column, row: 0, ports: [{ direction: "south", channel: "road" }] });
    policies.push({ type: "forbidden-cell-ports", id: `road-boundary-north-${column}`, column, row: depth - 1, ports: [{ direction: "north", channel: "road" }] });
  }
  for (let row = 0; row < depth; row += 1) {
    policies.push({ type: "forbidden-cell-ports", id: `road-boundary-west-${row}`, column: 0, row, ports: [{ direction: "west", channel: "road" }] });
    policies.push({ type: "forbidden-cell-ports", id: `road-boundary-east-${row}`, column: width - 1, row, ports: [{ direction: "east", channel: "road" }] });
  }
  return policies;
}

function concretePoliciesFromTopology(topology: readonly RoadTopologyCell[], _width: number, _depth: number) {
  return topology.map((cell) => ({
    type: "exact-cell-ports" as const,
    id: `road-topology-cell-${cell.column}-${cell.row}`,
    column: cell.column,
    row: cell.row,
    ports: cell.ports.map((direction) => ({ direction, channel: "road" }))
  }));
}

function isSingleCyclicNetwork(cells: readonly RoadTopologyCell[], width: number, depth: number) {
  const minimumCells = Math.max(8, Math.floor((width * depth) / 8));
  if (cells.length < minimumCells) return false;
  const byIndex = new Map(cells.map((cell) => [cell.row * width + cell.column, cell]));
  let edges = 0;
  for (const cell of cells) {
    for (const direction of cell.ports) {
      const neighbor = adjacentCell(cell, direction);
      const other = byIndex.get(neighbor.row * width + neighbor.column);
      if (!other || !other.ports.includes(opposite(direction))) return false;
      if (direction === "north" || direction === "east") edges += 1;
    }
  }
  const seen = new Set<number>();
  const queue = [cells[0]];
  while (queue.length) {
    const current = queue.shift()!;
    const index = current.row * width + current.column;
    if (seen.has(index)) continue;
    seen.add(index);
    for (const direction of current.ports) {
      const neighbor = adjacentCell(current, direction);
      const next = byIndex.get(neighbor.row * width + neighbor.column);
      if (next) queue.push(next);
    }
  }
  return seen.size === cells.length && edges >= cells.length;
}

function adjacentCell(cell: RoadTopologyCell, direction: PlanarDirection) {
  if (direction === "north") return { column: cell.column, row: cell.row + 1 };
  if (direction === "east") return { column: cell.column + 1, row: cell.row };
  if (direction === "south") return { column: cell.column, row: cell.row - 1 };
  return { column: cell.column - 1, row: cell.row };
}

function opposite(direction: PlanarDirection): PlanarDirection {
  if (direction === "north") return "south";
  if (direction === "east") return "west";
  if (direction === "south") return "north";
  return "east";
}

function shapeId(ports: readonly PlanarDirection[]) {
  return [...ports].sort().join("-");
}
