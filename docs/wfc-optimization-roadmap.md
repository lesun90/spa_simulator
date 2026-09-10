# WFC Optimization Roadmap

## Purpose

Track the work required to make Wave Function Collapse generation faster, more memory-efficient, and visually more coherent for the SPA simulator.

This roadmap applies to generic asset packs, while using `assets/3d-road-tiles` as the primary validation pack. The current road pack contains 302 source assets and 1,052 unique rotated WFC variants.

## Current State

| Area | Status | Notes |
| --- | --- | --- |
| Background solver worker | Complete | The browser UI remains responsive while solving. |
| Seeded deterministic solving | Complete | The same palette, grid, and seed produce the same layout. |
| Exact directional socket matching | Complete | Neighboring WFC variants must have equal opposite edge sockets. |
| Runtime direction convention | Complete | `north` maps to positive Z and `south` to negative Z, matching asset metadata and rendered placement. |
| Grid-size and tile-size integration | Complete | Layout dimensions and pitch derive from Scene Size and Cell Size. |
| Temporary viewport preview | Complete | Preview objects are separate from persisted scene objects. |
| Socket-aware propagation fast path | Complete | Exact socket palettes avoid the previous candidate-by-candidate compatibility scan. |
| Worker progress memory retention | Complete | The worker keeps only the latest snapshot used for preview playback. |
| Curated generation palette | In progress | The editor defaults to the named `road-basic` palette when available. |
| Variant weighting | Complete | Metadata weights resolve deterministically with palette-specific overrides. |
| Semantic map-quality constraints | In progress | Serializable generic policies run during search; road policy composition remains outside the generic solver. |
| Compact runtime socket representation | Complete | The worker receives compact typed arrays and numeric variant results. |
| Bitset domains and adjacency | In progress | Domains and adjacency are backed by typed-array bitsets. |
| Persistent initialized solver worker | Not started | A new worker still receives compact palette data for each generation. |
| Change-trail backtracking | Complete | Decisions restore only domains modified since the decision. |
| Staged region and road-graph generation | Not started | The whole map is currently generated in a single collapse pass. |
| Rendered seam regression test | Not started | Tests prove metadata compatibility, not final rendered pixels or geometry. |

## Baseline and Performance Findings

The road palette contains 1,052 variants. Before the socket-aware propagation fast path, propagating a constraint compared every candidate in a neighbor domain to every source candidate in the current domain. This became quadratic at large domains.

The current propagation path uses the exact socket IDs already present in each variant:

1. Gather the source domain's supported sockets for the direction.
2. Retain only neighbor variants whose opposite socket is supported.
3. Enqueue the neighbor only if its domain shrinks.

On the reference road verification scenario, this reduced the measured command runtime from approximately 19 seconds to approximately 3.4 seconds. The remaining command startup time includes `vite-node` and asset metadata loading; it is not exclusively solver time.

The UI worker also previously retained every propagation progress snapshot. A dense palette can produce many snapshots containing large lists of collapsed variants. It now retains only the final snapshot used for controlled preview playback.

## Quality Problem: Valid Seams Are Not Sufficient

A socket-compatible layout is not necessarily a good road layout. Exact geometry and material-edge matching prevents physical seam mismatch, but it cannot express higher-level intent such as road continuity, reasonable intersection frequency, terrain distribution, or bridge placement.

Future work must distinguish:

- **Seam compatibility:** two neighboring model boundaries can meet.
- **Semantic compatibility:** two neighboring tile roles make sense together.
- **Map quality:** the complete output forms an intentional and useful environment.

## Roadmap

## Phase 0: Correctness and Regression Safety

### 0.1 Runtime spatial convention

- [x] Match solver directions to GLB metadata directions.
- [x] Map north to positive Z and south to negative Z.
- [x] Update solver and road-pack verification checks to use the rendered coordinate convention.
- [x] Add an explicit regression test with asymmetric north and south sockets that fails if the axes are swapped.

### 0.2 Rendered seam validation

- [x] Load a solved layout with Three.js in a test harness.
- [x] Inspect transformed world-space bounds of every east-west and north-south pair.
- [x] Report the two variant IDs, grid positions, direction, and bounds delta for each mismatch.
- [ ] Sample boundary geometry beyond transformed bounds for shape-level seam validation.
- [ ] Capture a deterministic visual regression image for a small seeded road layout.
- [ ] Add asymmetric synthetic tiles whose north, east, south, and west edges are all distinct, then verify world-space seams after rotation and placement.
- [x] Retain the current global-axis socket ordering: north/south run from -X to +X and east/west run from -Z to +Z. Opposite sockets compare directly; do not add a mirror reversal.

### 0.3 Metadata sampling fidelity

- [ ] Replace projected-triangle AABB filling with conservative triangle-to-sample-cell intersection, so diagonal and curved boundaries do not gain false occupied cells.
- [ ] Interpolate each sloped triangle's height at the actual sample position rather than assigning its highest vertex to every covered cell.
- [ ] Regenerate all road-tile metadata and adjacency after the sampling changes.
- [ ] Measure changed socket classes and inspect a deterministic seam corpus before accepting the regenerated metadata.

**Known limitation:** the current rasterizer fills a cell when either the projected triangle or its full axis-aligned bounding box contains the cell centre. This may overstate geometry or material coverage for non-rectangular triangles. It also writes the maximum vertex height across an entire triangle, which can hide slope discontinuities. These limitations can produce metadata-compatible but visibly imperfect seams even with correct grid-direction mapping.

**Socket orientation contract:** metadata is encoded in fixed world axes, not in an outward-facing local frame. `north` is +Z, `south` is -Z, `east` is +X, and `west` is -X. Tangential sample order is fixed globally, so direct equality of opposite edge strings is the intended matching rule.

**Acceptance criteria**

- Every generated east-west seam matches in world X/Z space.
- Every generated north-south seam matches in world X/Z space.
- An intentionally swapped north/south convention fails automated verification.

## Phase 1: Curated and Weighted Palettes

### 1.1 Palette membership

- [x] Add explicit WFC generation palette membership to asset metadata.
- [x] Support named palettes, including `road-basic` and `road-urban`.
- [x] Exclude assets without curated membership by default in the editor.
- [x] Keep the palette mechanism generic for future asset categories.

Suggested metadata shape:

```json
{
  "wfc": {
    "paletteMembership": ["road-basic", "road-urban"],
    "variants": []
  }
}
```

### 1.2 Weights

- [x] Add a positive `weight` to each variant or asset-level default.
- [x] Preserve a deterministic weighted choice order for a given seed.
- [x] Give curated ordinary tiles higher weights than rare tiles.
- [x] Give rare curated features lower weights.
- [x] Allow a named palette to override a default weight.

Suggested defaults:

| Tile family | Relative weight |
| --- | ---: |
| Terrain / filler | 12 |
| Straight road | 10 |
| Corner | 6 |
| T junction | 2 |
| Cross junction | 1 |
| Dead end | 1 |
| Bridge / special feature | 1 |

**Acceptance criteria**

- A selected named palette can be generated without unrelated assets.
- Identical seed, palette, dimensions, and weights yield identical output.
- A distribution test verifies high-weight variants appear materially more often over many deterministic seeds.
- A curated road palette contains a reviewable number of variants, initially targeting 20 to 80 rather than 1,052.

## Phase 2: Semantic Constraints and Layout Quality

### 2.1 Tile roles

- [x] Add optional semantic roles independent of socket geometry.
- [x] Support reusable role strings and directional semantic channels.
- [x] Support role-specific placement policies without coupling the generic solver to road assets.

### 2.2 Constraints

- [x] Limit intersection density with a generic maximum-role-count policy.
- [x] Prevent unsupported adjacent junction patterns with a generic role-adjacency policy.
- [x] Limit dead ends through the same role-count policy.
- [ ] Prefer terrain around roads when no road continuation is intended.
- [x] Require one connected channel component when configured.
- [x] Add optional required entrances and exits at specified grid boundaries.
- [x] Apply constraints through injected serializable policies rather than road-specific branches inside the generic solver.

**Acceptance criteria**

- Generated maps can satisfy configured entrance, connectivity, and junction-density requirements.
- The solver reports which quality policy rejected a layout when no solution exists.
- A deterministic multi-seed test validates road connectivity and configured maximum dead-end/intersection counts.

## Phase 3: Runtime Data Compaction

### 3.1 Intern socket signatures

- [x] Convert verbose generated socket strings to compact, deterministic integer IDs at palette-build time.
- [x] Preserve original strings for diagnostics and metadata generation only.
- [x] Store per-variant directional socket IDs in worker-ready palette data.

Example runtime representation:

```ts
interface CompactPlanarVariant {
  id: number;
  assetIndex: number;
  rotationQuarterTurns: 0 | 1 | 2 | 3;
  sockets: Uint32Array;
  weight: number;
}
```

### 3.2 Reduce worker transfer cost

- [x] Transfer compact typed arrays rather than nested objects with repeated socket strings.
- [x] Expose compact palette byte and distinct-socket metrics for instrumentation.
- [x] Cache prepared palettes by catalog array identity and selected named palette.

**Acceptance criteria**

- The worker payload contains no repeated verbose edge signature strings.
- Palette initialization time and memory are measured in a browser performance test.
- The same compact palette produces the same solved result as the current reference implementation for matching inputs.

## Phase 4: High-Performance Solver Representation

### 4.1 Bitset domains

- [x] Replace `Set<string>` cell domains with bitsets backed by typed arrays.
- [x] Precompute compatible variant masks for each direction.
- [x] Implement cardinality and entropy operations using bit counts.
- [x] Preserve an explicit reference-solver API for equivalence tests.

For 1,052 variants, one domain requires 33 `Uint32` words. A 10×10 grid requires 3,300 words before solver bookkeeping.

### 4.2 Efficient propagation

- [x] Use precomputed compatible masks.
- [x] Avoid allocating arrays and `Set` instances in the propagation inner loop.
- [x] Use an indexed typed-array queue rather than repeated `Array.shift()` calls.
- [x] Emit progress at decision, backtrack, and solved checkpoints rather than domain mutations.

### 4.3 Backtracking trail

- [x] Replace full-grid snapshots with a change trail.
- [x] Record a cell's previous domain only once per decision level.
- [x] Restore only modified cells when backtracking.
- [ ] Measure allocation and peak memory during difficult seeds.

**Acceptance criteria**

- The optimized solver returns the same results as the reference solver for a corpus of palettes, sizes, and seeds.
- The optimized solver performs no per-candidate collection allocation in the propagation inner loop.
- A 10×10 curated road layout completes within an agreed interactive target on supported hardware.

## Phase 5: Persistent Worker and Responsive Visualization

### 5.1 Persistent initialized worker

- [ ] Keep one WFC worker alive for the editor session.
- [ ] Initialize or refresh its palette only when the catalog or selected palette changes.
- [ ] Send generation requests containing only dimensions, seed, and policies.
- [ ] Support cancellation when a scene closes or a newer generation supersedes the prior one.

### 5.2 Bounded real progress playback

- [ ] Record actual solver checkpoints at decision boundaries and backtrack events.
- [ ] Bound checkpoint memory and message frequency.
- [ ] Replay checkpoints at a readable cadence in the preview renderer.
- [ ] Display decisions, propagations, and backtracks distinctly in the HUD.
- [ ] Keep preview objects transient and separate from persisted scene objects.

**Acceptance criteria**

- Regenerating with an unchanged palette does not retransfer or rebuild the palette.
- Cancelling stops visual playback and prevents a stale result from modifying the scene.
- Preview visibly advances through actual decision/backtrack checkpoints before final placement.

## Phase 6: Staged Environment Generation

- [ ] Generate a coarse region map first: terrain, road district, water, plaza, or urban zone.
- [ ] Generate a road graph satisfying connectivity and boundary requirements.
- [ ] Fill each region using its smaller compatible tile palette.
- [ ] Add decorative assets after structural generation rather than including them in the structural WFC palette.
- [ ] Allow each stage to report diagnostics and use its own deterministic seed derived from the scene seed.

**Acceptance criteria**

- Structural road generation remains connected independently of decorative placement.
- Individual stages can be rerun without invalidating unrelated stages.
- The generated scene is more coherent than a single-pass mixed palette under qualitative review and deterministic metrics.

## Measurement Plan

Record the following for each target palette and grid size:

| Metric | Meaning |
| --- | --- |
| Palette assets | Number of source assets admitted to the generation palette. |
| Palette variants | Number of rotated WFC candidates. |
| Distinct socket IDs | Number of interned edge classes. |
| Worker payload bytes | Structured-clone or transfer size sent per initialization/request. |
| Solve duration | Worker time from request receipt to final result. |
| Total generation duration | Time from UI request to final scene placement. |
| Decisions | Number of cell choices made. |
| Backtracks | Number of rejected decision branches. |
| Peak domain memory | Maximum solver memory attributable to cell domains and backtracking. |
| Seam failures | Rendered seam mismatches; must be zero. |
| Road components | Number of connected road components when a connected layout is required. |
| Junction and dead-end counts | Map-quality indicators. |

Initial performance targets should be agreed after recording browser measurements on supported hardware. Do not use development-server startup or first-time model download time as solver-only measurements.

## Verification Matrix

| Layer | Verification |
| --- | --- |
| Metadata generator | Deterministic sockets, valid rotations, diagnostics, adjacency references. |
| Palette builder | Correct named-palette membership, weights, and compact socket IDs. |
| Reference solver | Socket-compatible seams, determinism, failure diagnostics. |
| Optimized solver | Output equivalence to reference solver across a seed corpus. |
| Semantic policy | Connectivity, allowed role adjacency, intersection/dead-end limits. |
| Worker | Payload size, cancellation, stale-result rejection, bounded progress messages. |
| Renderer | World-space seam checks and deterministic visual regression capture. |
| Editor integration | One atomic undoable final replacement, no preview persistence. |

## Implementation Principles

- Keep generic solving logic independent of Three.js, asset I/O, editor state, and HUD rendering.
- Inject palette and policy data into the solver rather than adding road-specific conditionals to generic code.
- Keep source metadata descriptive and portable; derive compact runtime data at the boundary.
- Add an optimization only with a regression test against the reference behavior.
- Do not treat socket compatibility as a substitute for semantic layout quality.
- Keep preview progress bounded so visualization never becomes the dominant source of generation time.

## Decision Log

| Date | Decision | Status |
| --- | --- | --- |
| 2026-09-10 | Use exact directional edge sockets derived from GLB geometry/material samples for generic WFC compatibility. | Adopted |
| 2026-09-10 | Derive WFC dimensions and tile pitch from existing Scene Size and Cell Size settings. | Adopted |
| 2026-09-10 | Solve in a browser worker and render previews separately from persisted scene objects. | Adopted |
| 2026-09-10 | Correct north/south solver offsets to align metadata's positive/negative Z convention with rendered scene coordinates. | Adopted |
| 2026-09-10 | Prioritize curated weighted palettes and semantic constraints before a full bitset solver rewrite. | Proposed |
