/// <reference lib="webworker" />

import { solvePlanarWfc, type PlanarWfcPalette, type PlanarWfcRequest, type PlanarWfcResult } from "./planarWfc";
import { compactVariantId, type CompactPlanarDescriptor, type CompactPlanarPalette } from "./compactPlanarWfc";

import { planScenicWorld } from "./scenicWorldPlan";
import { policiesFromWorldPlan } from "./worldPlanPolicies";
import type { WorldPlan } from "./worldPlan";

interface SolveMessage {
  type: "solve";
  compact: CompactPlanarPalette;
  request: PlanarWfcRequest;
  worldPlan?: WorldPlan;
  descriptors?: readonly CompactPlanarDescriptor[];
}
interface CompactCell { column: number; row: number; variantIndex: number; }
type ResultMessage =
  | { type: "progress"; decisions: number; backtracks: number; collapsedCells: number; cells: readonly CompactCell[]; checkpoint: string }
  | { type: "result"; result: PlanarWfcResult | { status: "solved"; seed: number; cells: readonly CompactCell[]; decisions: number; backtracks: number } };

self.onmessage = ({ data }: MessageEvent<SolveMessage>) => {
  if (data.type !== "solve") return;
  const palette = expandCompactPalette(data.compact, data.descriptors);
  let request = data.request;
  if (data.worldPlan) {
    try {
      const plan = planScenicWorld(data.worldPlan, palette, request.seed);
      request = { ...request, policies: [...(request.policies ?? []), ...policiesFromWorldPlan(plan)] };
      self.postMessage({ type: "plan", plan: { ...plan, tiles: plan.tiles?.map((cell) => ({ ...cell, variantIds: cell.variantIds.map((id) => data.descriptors![Number(id)].id) })) } });
    } catch (error) {
      self.postMessage({ type: "result", result: { status: "failed", seed: request.seed, reason: "quality-policy", diagnostics: [error instanceof Error ? error.message : "Scenery planning failed"] } } satisfies ResultMessage);
      return;
    }
  }
  const result = solvePlanarWfc(palette, request, {
    onProgress: (progress) => self.postMessage({
      type: "progress", decisions: progress.decisions, backtracks: progress.backtracks,
      collapsedCells: progress.collapsedCells, checkpoint: progress.checkpoint,
      cells: progress.cells.map((cell) => ({ column: cell.column, row: cell.row, variantIndex: Number(cell.variant.id) }))
    })
  });
  if (result.status === "failed") { self.postMessage({ type: "result", result } satisfies ResultMessage); return; }
  self.postMessage({ type: "result", result: {
    status: "solved", seed: result.seed, decisions: result.decisions, backtracks: result.backtracks,
    cells: result.cells.map((cell) => ({ column: cell.column, row: cell.row, variantIndex: Number(cell.variant.id) }))
  } } satisfies ResultMessage);
};

function expandCompactPalette(compact: CompactPlanarPalette, descriptors?: readonly CompactPlanarDescriptor[]) {
  const words = Math.ceil(compact.variantCount / 32);
  const directions = ["north", "east", "south", "west"] as const;
  const variants = Array.from({ length: compact.variantCount }, (_, index) => ({
    id: compactVariantId(index), assetId: descriptors?.[index].assetId ?? "", rotationDegrees: descriptors?.[index].rotationDegrees ?? 0, weight: compact.weights[index], roles: compact.roles[index], semanticPorts: compact.semanticPorts[index],
    sockets: { north: String(compact.socketIds[index * 4]), east: String(compact.socketIds[index * 4 + 1]), south: String(compact.socketIds[index * 4 + 2]), west: String(compact.socketIds[index * 4 + 3]), top: "", bottom: "" }
  }));
  const adjacency = Object.fromEntries(variants.map((variant, variantIndex) => [variant.id, Object.fromEntries(directions.map((direction, directionIndex) => {
    const offset = (variantIndex * 4 + directionIndex) * words;
    const matches: string[] = [];
    for (let word = 0; word < words; word++) {
      let bits = compact.compatibility[offset + word];
      while (bits) { const bit = 31 - Math.clz32(bits & -bits); matches.push(compactVariantId(word * 32 + bit)); bits &= bits - 1; }
    }
    return [direction, matches];
  }))]));
  return { id: "compact", tileWidth: 1, tileDepth: 1, variants, adjacency: adjacency as unknown as PlanarWfcPalette["adjacency"], usesExactSocketMatching: false };
}

export {};
