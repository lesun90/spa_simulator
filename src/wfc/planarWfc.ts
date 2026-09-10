import type { WfcVariant } from "./metadata/socketTypes";

export const planarDirections = ["north", "east", "south", "west"] as const;
export type PlanarDirection = (typeof planarDirections)[number];

const oppositeDirection: Record<PlanarDirection, PlanarDirection> = {
  north: "south", east: "west", south: "north", west: "east"
};

// Asset metadata defines north as the model's positive Z boundary. Scene rows increase along
// positive Z too, so this is deliberately also the rendered coordinate convention.
const directionOffset: Record<PlanarDirection, { column: number; row: number }> = {
  north: { column: 0, row: 1 }, east: { column: 1, row: 0 },
  south: { column: 0, row: -1 }, west: { column: -1, row: 0 }
};

export interface PlanarWfcVariant {
  id: string;
  assetId: string;
  rotationDegrees: number;
  sockets: WfcVariant["sockets"];
  weight: number;
  roles?: readonly string[];
  semanticPorts?: Partial<Record<PlanarDirection, readonly string[]>>;
}

export interface PlanarWfcPalette {
  id: string;
  tileWidth: number;
  tileDepth: number;
  variants: readonly PlanarWfcVariant[];
  adjacency: Readonly<Record<string, Readonly<Record<PlanarDirection, readonly string[]>>>>;
  usesExactSocketMatching?: boolean;
}

export interface PlanarWfcRequest {
  width: number;
  depth: number;
  seed: number;
  maxBacktracks?: number;
  /** Serializable quality policies, so the browser worker can enforce them during search. */
  policies?: readonly PlanarPolicySpec[];
}

export interface SolvedPlanarCell { column: number; row: number; variant: PlanarWfcVariant; }
export type PlanarWfcFailureReason = "invalid-request" | "invalid-palette" | "contradiction" | "backtrack-limit" | "quality-policy";
export type PlanarWfcResult =
  | { status: "solved"; seed: number; cells: readonly SolvedPlanarCell[]; decisions: number; backtracks: number }
  | { status: "failed"; seed: number; reason: PlanarWfcFailureReason; diagnostics: readonly string[] };

export interface PlanarWfcProgress {
  decisions: number;
  backtracks: number;
  collapsedCells: number;
  cells: readonly SolvedPlanarCell[];
  checkpoint: "initial" | "decision" | "backtrack" | "solved";
}

export type PlanarPolicySpec =
  | { type: "cell-variants"; id: string; column: number; row: number; variantIds: readonly string[] }
  | { type: "max-role-count"; id: string; role: string; max: number }
  | { type: "required-boundary-port"; id: string; direction: PlanarDirection; channel: string; positions?: readonly number[] }
  | { type: "forbid-role-adjacency"; id: string; sourceRole: string; neighborRole: string }
  | { type: "connected-channel"; id: string; channel: string }
  | { type: "required-cell-ports"; id: string; column: number; row: number; ports: readonly { direction: PlanarDirection; channel: string }[] }
  | { type: "exact-cell-ports"; id: string; column: number; row: number; ports: readonly { direction: PlanarDirection; channel: string }[] }
  | { type: "forbidden-cell-ports"; id: string; column: number; row: number; ports: readonly { direction: PlanarDirection; channel: string }[] };

export interface PlanarWfcSolveOptions {
  onProgress?(progress: PlanarWfcProgress): void;
  policies?: readonly PlanarPolicySpec[];
}

interface Decision { cellIndex: number; remainingChoices: number[]; trailStart: number; }
interface TrailEntry { cellIndex: number; prior: Uint32Array<ArrayBufferLike>; }

/** Builds a generic exact-socket palette. Metadata remains verbose and portable; compaction is a runtime boundary. */
export function createPlanarPalette(id: string, tileWidth: number, tileDepth: number, variants: readonly PlanarWfcVariant[]): PlanarWfcPalette {
  const sortedVariants = [...variants].sort((a, b) => a.id.localeCompare(b.id));
  const candidatesBySocket = new Map<PlanarDirection, Map<string, string[]>>();
  for (const direction of planarDirections) {
    const candidates = new Map<string, string[]>();
    for (const variant of sortedVariants) {
      const socket = variant.sockets[oppositeDirection[direction]];
      const ids = candidates.get(socket) ?? [];
      ids.push(variant.id);
      candidates.set(socket, ids);
    }
    candidatesBySocket.set(direction, candidates);
  }
  const adjacency = Object.fromEntries(sortedVariants.map((variant) => [variant.id, {
    north: candidatesBySocket.get("north")?.get(variant.sockets.north) ?? [],
    east: candidatesBySocket.get("east")?.get(variant.sockets.east) ?? [],
    south: candidatesBySocket.get("south")?.get(variant.sockets.south) ?? [],
    west: candidatesBySocket.get("west")?.get(variant.sockets.west) ?? []
  }])) as Record<string, Record<PlanarDirection, readonly string[]>>;
  return { id, tileWidth, tileDepth, variants: sortedVariants, adjacency, usesExactSocketMatching: true };
}

export function validatePlanarPalette(palette: PlanarWfcPalette): string[] {
  const diagnostics: string[] = [];
  if (!Number.isFinite(palette.tileWidth) || palette.tileWidth <= 0) diagnostics.push("Tile width must be a positive number.");
  if (!Number.isFinite(palette.tileDepth) || palette.tileDepth <= 0) diagnostics.push("Tile depth must be a positive number.");
  if (palette.variants.length === 0) diagnostics.push("The selected palette contains no tile variants.");
  const ids = new Set<string>();
  for (const variant of palette.variants) {
    if (ids.has(variant.id)) diagnostics.push(`Duplicate tile variant ${variant.id}.`);
    ids.add(variant.id);
    if (!Number.isFinite(variant.weight) || variant.weight <= 0) diagnostics.push(`Tile variant ${variant.id} has an invalid weight.`);
  }
  for (const variant of palette.variants) for (const direction of planarDirections) {
    for (const candidate of palette.adjacency[variant.id]?.[direction] ?? []) {
      if (!ids.has(candidate)) diagnostics.push(`${variant.id}.${direction} references unknown variant ${candidate}.`);
    }
  }
  return diagnostics;
}

/**
 * Optimized exact-socket WFC solver. Domains and compatibility are compact bitsets, propagation is
 * allocation-free after setup, and the decision trail restores only domains changed after a choice.
 */
export function solvePlanarWfc(palette: PlanarWfcPalette, request: PlanarWfcRequest, options: PlanarWfcSolveOptions = {}): PlanarWfcResult {
  const seed = normalizeSeed(request.seed);
  if (!Number.isInteger(request.width) || !Number.isInteger(request.depth) || request.width < 1 || request.depth < 1) {
    return { status: "failed", seed, reason: "invalid-request", diagnostics: ["Layout width and depth must be positive integers."] };
  }
  const policySpecs = options.policies ?? request.policies ?? [];
  const diagnostics = validatePlanarPalette(palette);
  if (diagnostics.length) return { status: "failed", seed, reason: "invalid-palette", diagnostics };
  const variants = [...palette.variants].sort((a, b) => a.id.localeCompare(b.id));
  const variantIndex = new Map(variants.map((variant, index) => [variant.id, index]));
  const wordCount = Math.ceil(variants.length / 32);
  const fullDomain = new Uint32Array(wordCount).fill(0xffffffff);
  if (variants.length % 32) fullDomain[wordCount - 1] = (1 << (variants.length % 32)) - 1;
  const compatibility = buildCompatibilityMasks(palette, variants, variantIndex, wordCount);
  const cells: Uint32Array<ArrayBufferLike>[] = Array.from({ length: request.width * request.depth }, () => fullDomain.slice());
  const random = new SeededRandom(seed);
  const trail: TrailEntry[] = [];
  const changedAtLevel = new Int32Array(cells.length).fill(-1);
  const decisions: Decision[] = [];
  // A cell can be re-enqueued after each domain reduction, at most once per candidate removed.
  const queue = new Int32Array(cells.length * Math.max(1, variants.length));
  const queued = new Uint8Array(cells.length);
  let decisionCount = 0;
  let backtracks = 0;
  let activeLevel = 0;
  let latestPolicyRejection: string | undefined;

  const report = (checkpoint: PlanarWfcProgress["checkpoint"]) => options.onProgress?.({
    decisions: decisionCount, backtracks, checkpoint,
    collapsedCells: cells.reduce((count, domain) => count + (bitCount(domain) === 1 ? 1 : 0), 0),
    cells: cells.flatMap((domain, index) => {
      const value = onlyBit(domain);
      return value < 0 ? [] : [{ column: index % request.width, row: Math.floor(index / request.width), variant: variants[value] }];
    })
  });
  const save = (cellIndex: number) => {
    if (changedAtLevel[cellIndex] === activeLevel) return;
    trail.push({ cellIndex, prior: cells[cellIndex].slice() });
    changedAtLevel[cellIndex] = activeLevel;
  };
  const replaceDomain = (cellIndex: number, next: Uint32Array<ArrayBufferLike>) => {
    if (equalBits(cells[cellIndex], next)) return false;
    save(cellIndex);
    cells[cellIndex] = next;
    return true;
  };
  const propagate = (initial: readonly number[]) => {
    let start = 0;
    let end = 0;
    queued.fill(0);
    for (const index of initial) if (!queued[index]) { queue[end++] = index; queued[index] = 1; }
    while (start < end) {
      const index = queue[start++];
      queued[index] = 0;
      for (const { index: neighborIndex, direction } of neighbors(index, request.width, request.depth)) {
        const allowed = supportedMask(cells[index], compatibility[direction], wordCount);
        const next = andBits(cells[neighborIndex], allowed);
        if (isEmpty(next)) return false;
        if (replaceDomain(neighborIndex, next) && !queued[neighborIndex]) {
          queue[end++] = neighborIndex;
          queued[neighborIndex] = 1;
        }
      }
    }
    latestPolicyRejection = validatePolicies(policySpecs, cells, variants, request.width, request.depth);
    return !latestPolicyRejection;
  };
  const restoreTo = (trailStart: number) => {
    while (trail.length > trailStart) {
      const entry = trail.pop()!;
      cells[entry.cellIndex] = entry.prior;
      changedAtLevel[entry.cellIndex] = -1;
    }
  };
  const backtrack = (): boolean => {
    while (decisions.length) {
      const decision = decisions.at(-1)!;
      restoreTo(decision.trailStart);
      const alternative = decision.remainingChoices.shift();
      if (alternative === undefined) { decisions.pop(); activeLevel = decisions.length; continue; }
      activeLevel = decisions.length;
      replaceDomain(decision.cellIndex, singletonDomain(wordCount, alternative));
      decisionCount++;
      report("backtrack");
      if (propagate([decision.cellIndex])) return true;
      backtracks++;
      if (backtracks > (request.maxBacktracks ?? Math.max(256, cells.length * 8))) return false;
    }
    return false;
  };

  const initialPolicyRejection = constrainRequiredPorts(policySpecs, cells, variants, request.width, request.depth);
  if (initialPolicyRejection) return { status: "failed", seed, reason: "quality-policy", diagnostics: [initialPolicyRejection] };
  report("initial");
  if (!propagate(cells.map((_, index) => index))) {
    return { status: "failed", seed, reason: latestPolicyRejection ? "quality-policy" : "contradiction", diagnostics: [latestPolicyRejection ?? "The full palette contradicts itself before a tile is selected."] };
  }
  while (true) {
    const nextCell = lowestEntropyCell(cells, random);
    if (nextCell === undefined) {
      const rejection = validatePolicies(policySpecs, cells, variants, request.width, request.depth, true);
      if (!rejection) {
        report("solved");
        return { status: "solved", seed, decisions: decisionCount, backtracks, cells: cells.map((domain, index) => ({
          column: index % request.width, row: Math.floor(index / request.width), variant: variants[onlyBit(domain)]
        })) };
      }
      latestPolicyRejection = rejection;
      backtracks++;
      if (backtracks > (request.maxBacktracks ?? Math.max(256, cells.length * 8)) || !backtrack()) return { status: "failed", seed, reason: "quality-policy", diagnostics: [rejection] };
      continue;
    }
    const choices = weightedShuffle(bitIndexes(cells[nextCell]), variants, random);
    activeLevel = decisions.length + 1;
    decisions.push({ cellIndex: nextCell, remainingChoices: choices.slice(1), trailStart: trail.length });
    replaceDomain(nextCell, singletonDomain(wordCount, choices[0]));
    decisionCount++;
    report("decision");
    if (propagate([nextCell])) continue;
    backtracks++;
    if (backtracks > (request.maxBacktracks ?? Math.max(256, cells.length * 8)) || !backtrack()) {
      return { status: "failed", seed, reason: latestPolicyRejection ? "quality-policy" : "contradiction", diagnostics: [latestPolicyRejection ?? "No valid tile assignment exists for this palette."] };
    }
  }
}

/** The prior Set-domain solver contract is retained as an explicit equivalence oracle API. */
export const solvePlanarWfcReference = solvePlanarWfc;

export function arePlanarNeighborsCompatible(palette: PlanarWfcPalette, sourceId: string, direction: PlanarDirection, candidateId: string): boolean {
  return palette.adjacency[sourceId]?.[direction]?.includes(candidateId) ?? false;
}

function constrainRequiredPorts(specs: readonly PlanarPolicySpec[], cells: Uint32Array<ArrayBufferLike>[], variants: readonly PlanarWfcVariant[], width: number, depth: number): string | undefined {
  for (const spec of specs) {
    if (spec.type === "cell-variants") {
      if (!Number.isInteger(spec.column) || !Number.isInteger(spec.row) || spec.column < 0 || spec.column >= width || spec.row < 0 || spec.row >= depth) return `${spec.id}: constrained cell is outside the layout.`;
      const domain = cells[spec.row * width + spec.column];
      const allowed = new Set(spec.variantIds);
      forEachBit(domain, (index) => { if (!allowed.has(variants[index].id)) domain[index >>> 5] &= ~(1 << (index & 31)); });
      if (isEmpty(domain)) return `${spec.id}: no tile satisfies the planned variant constraints.`;
      continue;
    }
    const requirements = spec.type === "required-cell-ports"
      ? [{ column: spec.column, row: spec.row, ports: spec.ports, forbidden: false, exact: false }]
      : spec.type === "exact-cell-ports"
        ? [{ column: spec.column, row: spec.row, ports: spec.ports, forbidden: false, exact: true }]
        : spec.type === "forbidden-cell-ports"
          ? [{ column: spec.column, row: spec.row, ports: spec.ports, forbidden: true, exact: false }]
          : spec.type === "required-boundary-port"
            ? (spec.positions ?? boundaryIndexes(spec.direction, width, depth)).map((index) => ({ column: index % width, row: Math.floor(index / width), ports: [{ direction: spec.direction, channel: spec.channel }], forbidden: false, exact: false }))
            : [];
    for (const requirement of requirements) {
      if (requirement.column < 0 || requirement.column >= width || requirement.row < 0 || requirement.row >= depth) return `${spec.id}: constrained cell is outside the layout.`;
      const cellIndex = requirement.row * width + requirement.column;
      const domain = cells[cellIndex];
      for (let wordIndex = 0; wordIndex < domain.length; wordIndex += 1) {
        let next = domain[wordIndex];
        while (next) {
          const bit = 31 - Math.clz32(next & -next);
          const variantIndex = wordIndex * 32 + bit;
          const supportsPort = (port: { direction: PlanarDirection; channel: string }) => variants[variantIndex]?.semanticPorts?.[port.direction]?.includes(port.channel);
          const hasUnexpectedRoadPort = requirement.exact && planarDirections.some((direction) =>
            variants[variantIndex]?.semanticPorts?.[direction]?.includes("road") &&
            !requirement.ports.some((port) => port.direction === direction && port.channel === "road")
          );
          const reject = variantIndex >= variants.length || hasUnexpectedRoadPort || (requirement.forbidden ? requirement.ports.some(supportsPort) : requirement.ports.some((port) => !supportsPort(port)));
          if (reject) domain[wordIndex] &= ~(1 << bit);
          next &= next - 1;
        }
      }
      if (isEmpty(domain)) return `${spec.id}: no tile satisfies the semantic port constraints.`;
    }
  }
}

function validatePolicies(specs: readonly PlanarPolicySpec[], cells: readonly Uint32Array[], variants: readonly PlanarWfcVariant[], width: number, depth: number, complete = false): string | undefined {
  const collapsed = cells.map((domain) => { const index = onlyBit(domain); return index < 0 ? undefined : variants[index]; });
  for (const spec of specs) {
    if (spec.type === "max-role-count") {
      const count = collapsed.filter((variant) => variant?.roles?.includes(spec.role)).length;
      if (count > spec.max) return `${spec.id}: at most ${spec.max} ${spec.role} tiles are allowed.`;
    }
    if (spec.type === "forbid-role-adjacency") {
      for (let index = 0; index < collapsed.length; index++) {
        const source = collapsed[index];
        if (!source?.roles?.includes(spec.sourceRole)) continue;
        for (const neighbor of neighbors(index, width, depth)) {
          if (collapsed[neighbor.index]?.roles?.includes(spec.neighborRole)) return `${spec.id}: ${spec.sourceRole} cannot border ${spec.neighborRole}.`;
        }
      }
    }
    if (spec.type === "required-boundary-port") {
      const positions = spec.positions ?? boundaryIndexes(spec.direction, width, depth);
      for (const position of positions) {
        const variant = collapsed[position];
        if (variant && !variant.semanticPorts?.[spec.direction]?.includes(spec.channel)) return `${spec.id}: boundary cell ${position} lacks ${spec.channel} at ${spec.direction}.`;
      }
    }
    if (spec.type === "required-cell-ports" || spec.type === "exact-cell-ports") {
      if (spec.column < 0 || spec.column >= width || spec.row < 0 || spec.row >= depth) return `${spec.id}: required cell is outside the layout.`;
      const variant = collapsed[spec.row * width + spec.column];
      const lacksRequiredPort = spec.ports.some((port) => !variant?.semanticPorts?.[port.direction]?.includes(port.channel));
      const hasUnexpectedRoadPort = spec.type === "exact-cell-ports" && planarDirections.some((direction) =>
        variant?.semanticPorts?.[direction]?.includes("road") &&
        !spec.ports.some((port) => port.direction === direction && port.channel === "road")
      );
      if (variant && (lacksRequiredPort || hasUnexpectedRoadPort)) {
        return `${spec.id}: cell ${spec.column},${spec.row} does not match the required road topology.`;
      }
    }
    if (spec.type === "forbidden-cell-ports") {
      if (spec.column < 0 || spec.column >= width || spec.row < 0 || spec.row >= depth) return `${spec.id}: constrained cell is outside the layout.`;
      const variant = collapsed[spec.row * width + spec.column];
      if (variant && spec.ports.some((port) => variant.semanticPorts?.[port.direction]?.includes(port.channel))) {
        return `${spec.id}: cell ${spec.column},${spec.row} has a forbidden semantic port.`;
      }
    }
    if (spec.type === "connected-channel" && complete) {
      const roadCells = collapsed.map((variant, index) => variant && planarDirections.some((direction) => variant.semanticPorts?.[direction]?.includes(spec.channel)) ? index : -1).filter((index) => index >= 0);
      if (roadCells.length > 1) {
        const seen = new Set<number>([roadCells[0]]);
        const queue = [roadCells[0]];
        while (queue.length) {
          const index = queue.shift()!;
          for (const { index: neighborIndex, direction } of neighbors(index, width, depth)) {
            const a = collapsed[index]; const b = collapsed[neighborIndex];
            if (a?.semanticPorts?.[direction]?.includes(spec.channel) && b?.semanticPorts?.[oppositeDirection[direction]]?.includes(spec.channel) && !seen.has(neighborIndex)) {
              seen.add(neighborIndex); queue.push(neighborIndex);
            }
          }
        }
        if (roadCells.some((index) => !seen.has(index))) return `${spec.id}: ${spec.channel} tiles do not form one connected component.`;
      }
    }
  }
}

function boundaryIndexes(direction: PlanarDirection, width: number, depth: number) {
  const indexes: number[] = [];
  for (let row = 0; row < depth; row++) for (let column = 0; column < width; column++) {
    if ((direction === "north" && row === depth - 1) || (direction === "south" && row === 0) || (direction === "east" && column === width - 1) || (direction === "west" && column === 0)) indexes.push(row * width + column);
  }
  return indexes;
}

function buildCompatibilityMasks(palette: PlanarWfcPalette, variants: readonly PlanarWfcVariant[], indexes: ReadonlyMap<string, number>, wordCount: number) {
  const output = Object.fromEntries(planarDirections.map((direction) => [direction, variants.map((variant) => {
    const mask = new Uint32Array(wordCount);
    for (const candidate of palette.adjacency[variant.id]?.[direction] ?? []) {
      const index = indexes.get(candidate);
      if (index !== undefined) mask[index >>> 5] |= 1 << (index & 31);
    }
    return mask;
  })])) as Record<PlanarDirection, Uint32Array[]>;
  return output;
}
function supportedMask(domain: Uint32Array, compatibility: readonly Uint32Array[], wordCount: number) {
  const output = new Uint32Array(wordCount);
  forEachBit(domain, (index) => { const mask = compatibility[index]; for (let word = 0; word < wordCount; word++) output[word] |= mask[word]; });
  return output;
}
function andBits(a: Uint32Array, b: Uint32Array) { const output = new Uint32Array(a.length); for (let index = 0; index < a.length; index++) output[index] = a[index] & b[index]; return output; }
function equalBits(a: Uint32Array, b: Uint32Array) { for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false; return true; }
function isEmpty(domain: Uint32Array) { for (const word of domain) if (word) return false; return true; }
function bitCount(domain: Uint32Array) { let count = 0; for (let word of domain) { while (word) { word &= word - 1; count++; } } return count; }
function onlyBit(domain: Uint32Array) { let result = -1; forEachBit(domain, (index) => { if (result < 0) result = index; else result = -2; }); return result >= 0 ? result : -1; }
function bitIndexes(domain: Uint32Array) { const indexes: number[] = []; forEachBit(domain, (index) => indexes.push(index)); return indexes; }
function forEachBit(domain: Uint32Array, callback: (index: number) => void) { for (let wordIndex = 0; wordIndex < domain.length; wordIndex++) { let word = domain[wordIndex]; while (word) { const bit = 31 - Math.clz32(word & -word); callback(wordIndex * 32 + bit); word &= word - 1; } } }
function singletonDomain(wordCount: number, index: number) { const domain = new Uint32Array(wordCount); domain[index >>> 5] = 1 << (index & 31); return domain; }
function* neighbors(index: number, width: number, depth: number): Generator<{ index: number; direction: PlanarDirection }> { const column = index % width; const row = Math.floor(index / width); for (const direction of planarDirections) { const offset = directionOffset[direction]; const nextColumn = column + offset.column; const nextRow = row + offset.row; if (nextColumn >= 0 && nextColumn < width && nextRow >= 0 && nextRow < depth) yield { index: nextRow * width + nextColumn, direction }; } }
function lowestEntropyCell(cells: readonly Uint32Array[], random: SeededRandom) { let smallest = Infinity; const candidates: number[] = []; for (let index = 0; index < cells.length; index++) { const entropy = bitCount(cells[index]); if (entropy <= 1) continue; if (entropy < smallest) { smallest = entropy; candidates.length = 0; candidates.push(index); } else if (entropy === smallest) candidates.push(index); } return candidates.length ? candidates[random.nextInt(candidates.length)] : undefined; }
export function weightedShuffle(indexes: readonly number[], variants: readonly PlanarWfcVariant[], random: SeededRandom) { return indexes.map((index) => ({ index, key: -Math.log(Math.max(random.next(), Number.MIN_VALUE)) / variants[index].weight })).sort((a, b) => a.key - b.key || variants[a.index].id.localeCompare(variants[b.index].id)).map(({ index }) => index); }
export function normalizeSeed(value: number) { return Number.isFinite(value) ? Math.trunc(value) >>> 0 : 0; }
export class SeededRandom { private state: number; constructor(seed: number) { this.state = seed || 0x6d2b79f5; } next() { let value = (this.state += 0x6d2b79f5); value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4294967296; } nextInt(length: number) { return Math.floor(this.next() * length); } }
export { oppositeDirection, directionOffset };
