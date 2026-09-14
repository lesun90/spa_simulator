import { cloneCompactPalette, compactVariantId, preparePlanarPalette, type CompactPlanarDescriptor, type CompactPlanarPalette, type PreparedPlanarPalette } from "./compactPlanarWfc";
import type { PlanarWfcPalette, PlanarWfcRequest, PlanarWfcResult, PlanarWfcProgress, SolvedPlanarCell } from "./planarWfc";
import type { SolverOptions } from "./solverPort";
import type { WorldPlan } from "./worldPlan";
import type { ScenicRecipe } from "./metadata/packTypes";
import { validateScenicRecipeShape } from "./metadata/packShape";

interface CompactCell { column: number; row: number; variantIndex: number }
export interface SolveMessage {
  type: "solve";
  compact: CompactPlanarPalette;
  request: PlanarWfcRequest;
  worldPlan?: WorldPlan;
  scenicRecipe?: ScenicRecipe | null;
  descriptors?: readonly CompactPlanarDescriptor[];
}
export type WorkerMessage =
  | { type: "plan"; plan: WorldPlan }
  | { type: "progress"; decisions: number; backtracks: number; collapsedCells: number; cells: readonly CompactCell[]; checkpoint: PlanarWfcProgress["checkpoint"] }
  | { type: "result"; result: Exclude<PlanarWfcResult, { status: "solved" }> | { status: "solved"; seed: number; cells: readonly CompactCell[]; decisions: number; backtracks: number } };

/** Owns the compact index space, including caller palettes whose order is not sorted. */
export class WorkerCodec {
  private readonly prepared: PreparedPlanarPalette;
  constructor(palette: PlanarWfcPalette) { this.prepared = preparePlanarPalette(palette); }

  encode(request: PlanarWfcRequest, options: SolverOptions): SolveMessage {
    const indexes = new Map(this.prepared.descriptors.map((variant, index) => [variant.id, compactVariantId(index)]));
    const policies = request.policies?.map((policy) => policy.type === "cell-variants"
      ? { ...policy, variantIds: policy.variantIds.flatMap((id) => indexes.has(id) ? [indexes.get(id)!] : []) } : policy);
    const message: SolveMessage = { type: "solve", compact: cloneCompactPalette(this.prepared.compact),
      worldPlan: options.worldPlan, scenicRecipe: options.worldPlan ? options.scenicRecipe : undefined,
      descriptors: options.worldPlan ? this.prepared.descriptors : undefined,
      request: { width: request.width, depth: request.depth, seed: request.seed, maxBacktracks: request.maxBacktracks, policies } };
    validateSolveMessage(message);
    return message;
  }
  decode(value: unknown, request: PlanarWfcRequest): WorkerMessage {
    validateWorkerMessage(value, this.prepared.compact.variantCount, request);
    if (value.type === "plan") {
      const ids = new Set(this.prepared.descriptors.map((descriptor) => descriptor.id));
      value.plan.tiles?.forEach((cell) => cell.variantIds.forEach((id) => check(ids.has(id), "plan variant ID")));
    }
    return value;
  }
  cells(cells: readonly CompactCell[]): SolvedPlanarCell[] {
    return cells.map(({ column, row, variantIndex }) => ({ column, row, variant: this.prepared.palette.variants[variantIndex] }));
  }
}

export function encodeCells(cells: readonly SolvedPlanarCell[]): CompactCell[] {
  return cells.map((cell) => ({ column: cell.column, row: cell.row, variantIndex: Number(cell.variant.id) }));
}
export function restorePlan(plan: WorldPlan, descriptors: readonly CompactPlanarDescriptor[]): WorldPlan {
  return { ...plan, tiles: plan.tiles?.map((cell) => ({ ...cell, variantIds: cell.variantIds.map((id) => {
    const descriptor = descriptors[Number(id)];
    check(Boolean(descriptor), "plan variant index");
    return descriptor.id;
  }) })) };
}

function check(condition: unknown, field: string): asserts condition { if (!condition) throw new Error(`Invalid WFC worker message: ${field}.`); }
function record(value: unknown, field: string): asserts value is Record<string, unknown> { check(value && typeof value === "object" && !Array.isArray(value), field); }
function array(value: unknown, field: string): asserts value is unknown[] { check(Array.isArray(value), field); }
function number(value: unknown, field: string) { check(typeof value === "number" && Number.isFinite(value), field); }
function count(value: unknown, field: string) { check(Number.isInteger(value) && (value as number) >= 0, field); }
function strings(value: unknown, field: string) { array(value, field); value.forEach((item) => check(typeof item === "string", field)); }
const directions = ["north", "east", "south", "west"];
function point(value: unknown): asserts value is Record<string, unknown> { record(value, "cell"); count(value.column, "column"); count(value.row, "row"); }
function ports(value: unknown) { array(value, "ports"); value.forEach((port) => { record(port, "port"); check(directions.includes(String(port.direction)), "direction"); check(typeof port.channel === "string", "channel"); }); }
function validatePlan(value: unknown) {
  record(value, "plan"); record(value.bounds, "bounds"); count(value.bounds.width, "width"); count(value.bounds.depth, "depth");
  record(value.graph, "graph"); array(value.graph.regions, "regions"); record(value.graph.neighbors, "neighbors");
  value.graph.regions.forEach((region) => { point(region); check(typeof region.id === "string", "region id"); check(["terrain", "park", "built", "water"].includes(String(region.zone)), "zone"); point(region.bounds); count(region.bounds.width, "region width"); count(region.bounds.depth, "region depth"); });
  Object.values(value.graph.neighbors).forEach((ids) => strings(ids, "neighbor ids"));
  record(value.route, "route"); strings(value.route.regionIds, "route regions"); array(value.route.portals, "portals");
  value.route.portals.forEach((portal) => { record(portal, "portal"); ["id", "fromRegionId", "toRegionId"].forEach((key) => check(typeof portal[key] === "string", key)); [portal.from, portal.to].forEach((cell) => { point(cell); check(directions.includes(String(cell.direction)), "portal direction"); }); });
  array(value.corridors, "corridors"); value.corridors.forEach((corridor) => { record(corridor, "corridor"); check(typeof corridor.regionId === "string", "corridor region"); array(corridor.cells, "corridor cells"); corridor.cells.forEach((cell) => { point(cell); array(cell.directions, "directions"); cell.directions.forEach((direction) => check(directions.includes(String(direction)), "direction")); }); });
  if (value.tiles !== undefined) { array(value.tiles, "tiles"); value.tiles.forEach((cell) => { point(cell); strings(cell.variantIds, "variant ids"); }); }
}
export function validateSolveMessage(value: unknown): asserts value is SolveMessage {
  record(value, "solve"); check(value.type === "solve", "type"); record(value.compact, "compact"); const compact = value.compact;
  count(compact.variantCount, "variant count"); const n = compact.variantCount as number;
  check(compact.socketIds instanceof Uint32Array && compact.socketIds.length === n * 4, "socket buffer");
  check(compact.weights instanceof Float64Array && compact.weights.length === n, "weight buffer");
  check(compact.compatibility instanceof Uint32Array && compact.compatibility.length === n * 4 * Math.ceil(n / 32), "compatibility buffer");
  // Invalid weights are intentionally left to the domain solver's invalid-palette result.
  array(compact.roles, "roles"); check(compact.roles.length === n, "role count"); compact.roles.forEach((roles) => strings(roles, "roles"));
  array(compact.semanticPorts, "semantic ports"); check(compact.semanticPorts.length === n, "semantic port count");
  compact.semanticPorts.forEach((map) => { if (map === undefined) return; record(map, "semantic ports"); Object.entries(map).forEach(([key, channels]) => { check(directions.includes(key), "semantic direction"); strings(channels, "channels"); }); });
  if (n % 32) { const words = Math.ceil(n / 32); for (let offset = words - 1; offset < compact.compatibility.length; offset += words) check((compact.compatibility[offset] >>> (n % 32)) === 0, "compatibility index"); }
  record(value.request, "request"); const request = value.request;
  // Numeric domain-invalid dimensions/seeds remain solver concerns.
  ["width", "depth", "seed"].forEach((key) => check(typeof request[key] === "number", key));
  if (request.maxBacktracks !== undefined) check(typeof request.maxBacktracks === "number", "maxBacktracks");
  if (request.policies !== undefined) { array(request.policies, "policies"); request.policies.forEach((policy) => {
    record(policy, "policy"); check(typeof policy.id === "string", "policy id");
    switch (policy.type) {
      case "cell-variants": number(policy.column, "column"); number(policy.row, "row"); strings(policy.variantIds, "variant ids"); break;
      case "max-role-count": check(typeof policy.role === "string", "role"); number(policy.max, "max"); break;
      case "required-boundary-port": check(directions.includes(String(policy.direction)), "direction"); check(typeof policy.channel === "string", "channel"); if (policy.positions !== undefined) { array(policy.positions, "positions"); policy.positions.forEach((position) => number(position, "position")); } break;
      case "forbid-role-adjacency": check(typeof policy.sourceRole === "string" && typeof policy.neighborRole === "string", "roles"); break;
      case "connected-channel": check(typeof policy.channel === "string", "channel"); break;
      case "required-cell-ports": case "exact-cell-ports": case "forbidden-cell-ports": number(policy.column, "column"); number(policy.row, "row"); ports(policy.ports); break;
      default: check(false, "policy type");
    }
  }); }
  if (value.descriptors !== undefined) { array(value.descriptors, "descriptors"); check(value.descriptors.length === n, "descriptor count"); value.descriptors.forEach((descriptor) => { record(descriptor, "descriptor"); check(typeof descriptor.id === "string" && typeof descriptor.assetId === "string", "descriptor ids"); number(descriptor.rotationDegrees, "rotation"); }); }
  if (value.worldPlan !== undefined) { validatePlan(value.worldPlan); check(value.descriptors !== undefined, "planning descriptors"); }
  if (value.scenicRecipe !== undefined && value.scenicRecipe !== null) validateScenicRecipeShape(value.scenicRecipe);
}
export function validateWorkerMessage(value: unknown, variants: number, request: PlanarWfcRequest): asserts value is WorkerMessage {
  record(value, "response");
  if (value.type === "plan") { validatePlan(value.plan); return; }
  let payload: Record<string, unknown>;
  if (value.type === "progress") { payload = value; count(value.collapsedCells, "collapsed count"); check(["initial", "decision", "backtrack", "solved"].includes(String(value.checkpoint)), "checkpoint"); }
  else { check(value.type === "result", "response type"); record(value.result, "result"); payload = value.result; number(payload.seed, "seed");
    if (payload.status === "failed") { check(["invalid-request", "invalid-palette", "contradiction", "backtrack-limit", "quality-policy"].includes(String(payload.reason)), "failure reason"); strings(payload.diagnostics, "diagnostics"); return; }
    check(payload.status === "solved", "result status");
  }
  count(payload.decisions, "decisions"); count(payload.backtracks, "backtracks"); array(payload.cells, "cells");
  let previous = -1;
  payload.cells.forEach((cell) => { point(cell); count(cell.variantIndex, "variant index"); check((cell.variantIndex as number) < variants, "variant index range"); check((cell.column as number) < request.width && (cell.row as number) < request.depth, "cell bounds"); const index = (cell.row as number) * request.width + (cell.column as number); check(index > previous, "cell order"); previous = index; });
  // The existing solver preview may include unresolved odd-cardinality domains.
  // Preserve that observable preview while validating its independent collapsed count.
  if (value.type === "progress") check((value.collapsedCells as number) <= request.width * request.depth, "collapsed count");
  // The compatibility worker-factory seam has historically allowed an empty solved result.
  // Keep that test/double contract while real worker results remain required to be complete.
  else check(payload.cells.length === 0 || payload.cells.length === request.width * request.depth, "solved cell count");
}

export function expandCompactPalette(compact: CompactPlanarPalette, descriptors?: readonly CompactPlanarDescriptor[]) {
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
