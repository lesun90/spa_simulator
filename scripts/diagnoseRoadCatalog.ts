import { discoverAssetCatalog } from "../server/assetCatalog";
import { createWorldPlan } from "../src/wfc/worldPlanner";
import { policiesFromWorldPlan } from "../src/wfc/worldPlanPolicies";
import { paletteFromAssets } from "../src/wfc/sceneLayout";
import type { PlanarDirection, PlanarPolicySpec, PlanarWfcPalette, PlanarWfcVariant } from "../src/wfc/planarWfc";

const directions: readonly PlanarDirection[] = ["north", "east", "south", "west"];
const assets = await discoverAssetCatalog("assets");
const palette = paletteFromAssets("catalog", assets, { tileWidth: 1, tileDepth: 1 });
const roadPalette = paletteFromAssets("roads", assets, { tileWidth: 1, tileDepth: 1, category: "3d-road-tiles" });
const scenePalette = paletteFromAssets("road-scene", assets, { tileWidth: 1, tileDepth: 1, purpose: "road-scene" });
const plan = createWorldPlan({ width: 10, depth: 10, seed: 1345, roadCoverage: 0.5 });
const policies = policiesFromWorldPlan(plan);

const roadVariants = palette.variants.filter((variant) => hasRoadEdge(variant));
const reviewedRoadVariants = roadPalette.variants.filter((variant) => hasRoadEdge(variant));
const candidatesByShape = new Map<string, PlanarWfcVariant[]>();
for (const variant of roadVariants) {
  const key = roadDirections(variant).join(",");
  candidatesByShape.set(key, [...(candidatesByShape.get(key) ?? []), variant]);
}

const exactPolicies = policies.filter((policy): policy is Extract<PlanarPolicySpec, { type: "exact-cell-ports" }> => policy.type === "exact-cell-ports");
const policyCandidates = exactPolicies.map((policy) => {
  const required = policy.ports.map((port) => port.direction).sort().join(",");
  const candidates = roadVariants.filter((variant) => roadDirections(variant).join(",") === required);
  return { id: policy.id, shape: required, candidates: candidates.length, compatible: candidates.filter((variant) => allEdgesHaveRoadCandidate(palette, variant)).length };
});

const plannedShapes = Object.fromEntries([...new Set(policyCandidates.map((entry) => entry.shape))]
  .sort()
  .map((shape) => [shape, {
    candidates: candidatesByShape.get(shape)?.length ?? 0,
    compatible: (candidatesByShape.get(shape) ?? []).filter((variant) => allEdgesHaveRoadCandidate(palette, variant)).length,
    variants: (candidatesByShape.get(shape) ?? []).map((variant) => ({
      id: variant.id,
      compatibleRoadEdges: Object.fromEntries(roadDirections(variant).map((direction) => [direction, roadNeighbors(palette, variant, direction)]))
    }))
  }]));

console.log(JSON.stringify({
  catalog: { assets: assets.length, variants: palette.variants.length, roadVariants: roadVariants.length, reviewedRoadVariants: reviewedRoadVariants.length },
  activeRoadScene: {
    variants: scenePalette.variants.length,
    roadVariants: scenePalette.variants.filter(hasRoadEdge).length,
    terrainVariants: scenePalette.variants.filter((variant) => !hasRoadEdge(variant) && variant.roles?.includes("terrain.ground")).length
  },
  roadOnlyCompatibility: reviewedRoadVariants.map((variant) => ({
    id: variant.id,
    shape: roadDirections(variant).join(","),
    adjacentRoadEdges: Object.fromEntries(roadDirections(variant).map((direction) => [direction, roadNeighbors(roadPalette, variant, direction).length]))
  })).filter((entry) => entry.shape.includes(",")),
  route: { regions: plan.route.regionIds.length, corridorCells: exactPolicies.length, plannedShapes },
  unsatisfiableCells: policyCandidates.filter((entry) => entry.compatible === 0),
  sampleCandidates: policyCandidates.filter((entry) => entry.compatible > 0).slice(0, 8)
}, null, 2));

function hasRoadEdge(variant: PlanarWfcVariant) {
  return directions.some((direction) => variant.semanticPorts?.[direction]?.includes("road"));
}
function roadDirections(variant: PlanarWfcVariant) {
  return directions.filter((direction) => variant.semanticPorts?.[direction]?.includes("road")).sort();
}
function allEdgesHaveRoadCandidate(palette: PlanarWfcPalette, variant: PlanarWfcVariant) {
  return roadDirections(variant).every((direction) => roadNeighbors(palette, variant, direction).length > 0);
}
function roadNeighbors(palette: PlanarWfcPalette, variant: PlanarWfcVariant, direction: PlanarDirection) {
  return (palette.adjacency[variant.id]?.[direction] ?? []).filter((candidateId) => {
    const candidate = palette.variants.find((entry) => entry.id === candidateId);
    return candidate?.semanticPorts?.[opposite(direction)]?.includes("road");
  });
}
function opposite(direction: PlanarDirection): PlanarDirection {
  return { north: "south", east: "west", south: "north", west: "east" }[direction];
}
