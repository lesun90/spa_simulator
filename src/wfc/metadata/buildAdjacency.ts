import { oppositeDirections, wfcDirections, type WfcAdjacencyFile, type WfcDirection, type WfcSocketMatcher, type WfcVariantLike } from "./socketTypes";

export function buildAdjacency(variants: WfcVariantLike[], matcher: WfcSocketMatcher = exactSocketMatcher): WfcAdjacencyFile["adjacency"] {
  const adjacency: WfcAdjacencyFile["adjacency"] = {};
  const sortedVariants = [...variants].sort((a, b) => a.variantId.localeCompare(b.variantId));

  for (const variant of sortedVariants) {
    adjacency[variant.variantId] = emptyAdjacencyEntry();
    for (const direction of wfcDirections) {
      const opposite = oppositeDirections[direction];
      adjacency[variant.variantId][direction] = sortedVariants
        .filter((candidate) => matcher(variant.sockets[direction], candidate.sockets[opposite], direction))
        .map((candidate) => candidate.variantId);
    }
  }

  return adjacency;
}

export function exactSocketMatcher(a: string, b: string) {
  return a === b;
}

function emptyAdjacencyEntry(): Record<WfcDirection, string[]> {
  return {
    north: [],
    east: [],
    south: [],
    west: [],
    top: [],
    bottom: []
  };
}
