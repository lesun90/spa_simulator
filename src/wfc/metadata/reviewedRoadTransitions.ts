import { oppositeDirection, planarDirections, type PlanarWfcPalette } from "../planarWfc";

/**
 * Reviewed structural seams and capped curb terminations. These exceptions
 * are specific model assemblies, never wildcard sockets. The generic catalog
 * retains strict full-boundary matching.
 */
export function withReviewedRoadTransitions(palette: PlanarWfcPalette): PlanarWfcPalette {
  const centers = palette.variants.filter((variant) => /\.road-tile-(027|034)$/.test(variant.assetId));
  const crosswalks = palette.variants.filter((variant) => variant.assetId === "3d-road-tiles.road-tile-025");
  const adjacency = Object.fromEntries(Object.entries(palette.adjacency).map(([id, edges]) => [id,
    Object.fromEntries(planarDirections.map((direction) => [direction, [...edges[direction]]]))
  ])) as Record<string, Record<(typeof planarDirections)[number], string[]>>;
  // Solid abutments may meet hollow bridge/ramp sides below the surface. Only
  // these reviewed structural pieces can use this rule, and the complete top
  // profile (geometry, materials AND absolute heights) must still match exactly.
  const structures = new Set(["154", "161", "164", "165", "170", "171", "180", "184", "191", "194", "197", "207", "231"].map((id) => `3d-road-tiles.road-tile-${id}`));
  for (const source of palette.variants.filter((variant) => structures.has(variant.assetId))) {
    for (const direction of planarDirections) {
      const profile = source.sockets[direction].split("|e:")[1];
      if (!profile) continue;
      for (const neighbor of palette.variants) {
        if (neighbor.sockets[oppositeDirection[direction]].split("|e:")[1] !== profile) continue;
        adjacency[source.id][direction].push(neighbor.id);
        adjacency[neighbor.id][oppositeDirection[direction]].push(source.id);
      }
    }
  }
  // Tile 242's dry sides have their own closed stone end caps. The final
  // 0.375m of curb rises 0.08m above adjacent grass: an intentional curb end,
  // not a gap. Match only reviewed dry grass faces, with shoreline corners
  // oriented toward the mouth's full-water side.
  const ground = palette.variants.find((variant) => variant.assetId.endsWith("road-tile-163"));
  const water = palette.variants.find((variant) => variant.assetId.endsWith("road-tile-001"));
  const caps = new Set(["163", "243", "284", "252"].map((id) => `3d-road-tiles.road-tile-${id}`));
  for (const mouth of palette.variants.filter((variant) => variant.assetId.endsWith("road-tile-242"))) {
    const lake = planarDirections.find((direction) => mouth.sockets[direction] === water?.sockets[direction]);
    if (!lake || !ground) continue;
    for (const direction of planarDirections) {
      if (mouth.semanticPorts?.[direction]?.includes("water")) continue;
      for (const cap of palette.variants.filter((variant) => caps.has(variant.assetId))) {
        const opposite = oppositeDirection[direction];
        if (cap.sockets[opposite] !== ground.sockets[opposite]) continue;
        if (cap.assetId !== ground.assetId && !cap.semanticPorts?.[lake]?.includes("water")) continue;
        adjacency[mouth.id][direction].push(cap.id);
        adjacency[cap.id][opposite].push(mouth.id);
      }
    }
  }
  for (const center of centers) {
    for (const direction of planarDirections) {
      if (!center.semanticPorts?.[direction]?.includes("road")) continue;
      // Junction arms must terminate in a crosswalk, never another center.
      adjacency[center.id][direction] = [];
      for (const crosswalk of crosswalks) {
        if (!crosswalk.semanticPorts?.[oppositeDirection[direction]]?.includes("road")) continue;
        adjacency[center.id][direction].push(crosswalk.id);
        adjacency[crosswalk.id][oppositeDirection[direction]].push(center.id);
      }
    }
  }
  // Remove the old reverse edges too: compatibility must be reciprocal.
  const byId = new Map(palette.variants.map((variant) => [variant.id, variant]));
  for (const [id, edges] of Object.entries(adjacency)) for (const direction of planarDirections) {
    edges[direction] = [...new Set(edges[direction])].filter((other) => byId.has(other) && adjacency[other][oppositeDirection[direction]].includes(id));
  }
  return { ...palette, adjacency, usesExactSocketMatching: false };
}
