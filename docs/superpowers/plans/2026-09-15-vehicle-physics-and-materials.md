# Vehicle Physics and Ground Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the controlled vehicle drive on real forces through a per-wheel Rapier controller with visible steering/spinning wheels, and make ground friction vary by real material (grass/road/water/…), all tunable from Scenario Studio.

**Architecture:** A new `materials` catalog is derived (by script) from data `generateRoadTileWfcMetadata.ts` already bakes into each asset, and flows through the existing environment-manifest export pipeline into a scenario-level friction map. `physics.worker.ts`'s vehicle body is rebuilt on Rapier's `DynamicRayCastVehicleController`, driven by per-agent tunable parameters newly added to `AgentDraft`, using per-wheel node metadata newly read from each vehicle's already-authored `vehicle.json`. The renderer applies the worker's per-wheel steering/spin output to those same named nodes.

**Tech Stack:** TypeScript, Three.js, `@dimforge/rapier3d-compat@0.20.0` (`DynamicRayCastVehicleController`), Vite/vite-node, Node fs scripts.

**Spec:** `docs/superpowers/specs/2026-09-15-vehicle-physics-and-materials-design.md`

## Global Constraints

- No new unit tests unless a task explicitly says so (project convention: verify directly in the running app). Where an existing test file constructs a fixture literal of a type this plan changes, update that fixture — do not add new test files.
- Every new struct field added to a type with existing literal fixtures in tests must be optional, or the fixture sites must be updated in the same task (checked per task below).
- Run `npm run build` (`tsc --noEmit && vite build`) at the end of every task to confirm the whole program still compiles; each task's steps show the exact command.
- Follow the codebase's existing validate/freeze/normalize conventions (see `src/scenario-studio/domain/scenarioRecord.ts`, `src/wfc/metadata/packShape.ts`) rather than introducing new validation styles.

---

## File Structure

New files:
- `scripts/computeMaterialCatalog.ts` — derives the pack's material list from already-baked asset metadata, no GLB reload.
- `src/scenario-studio/domain/materialFriction.ts` — default friction table + material-token normalizer, shared by the renderer and the physics wiring.

Modified files (grouped by task below): `package.json`, `src/wfc/metadata/packTypes.ts`, `src/wfc/metadata/packShape.ts`, `src/wfc/metadata/packCatalog.ts`, `src/environment/types.ts`, `server/environmentRoutes.ts`, `server/scenarioStudio/publishedScenes.ts`, `src/scenario-studio/domain/scene.ts`, `src/scenario-studio/domain/agent.ts`, `server/scenarioStudio/agentCatalog.ts`, `src/scenario-studio/domain/scenarioRecord.ts`, `src/scenario-studio/ui/AgentInspectorPanel.ts`, `src/scenario-studio/domain/ScenarioDocument.ts`, `src/scenario-studio/ui/ScenarioHudFeature.ts`, `src/scenario-studio/physics/PhysicsWorld.ts`, `src/scenario-studio/rendering/SceneGeometrySource.ts`, `src/scenario-studio/physics/RapierPhysicsWorld.ts`, `src/scenario-studio/physics/PhysicsWorkerClient.ts`, `src/scenario-studio/physics/physics.worker.ts`, `src/scenario-studio/domain/ScenarioSession.ts`, `src/scenario-studio/rendering/AgentVisuals.ts`.

---

### Task 1: Material catalog script and WFC pack schema

**Files:**
- Create: `scripts/computeMaterialCatalog.ts`
- Modify: `src/wfc/metadata/packTypes.ts` (near `roadWidthFraction`)
- Modify: `src/wfc/metadata/packShape.ts:26-31` (the `declaration` shape)
- Modify: `src/wfc/metadata/packCatalog.ts:8-9` (constant exports)
- Modify: `package.json` (`scripts` block, near `assets:road-width`)

**Interfaces:**
- Produces: `packMaterials: readonly string[]` exported from `src/wfc/metadata/packCatalog.ts`, consumed by Task 2.

- [ ] **Step 1: Add the script**

`scripts/computeMaterialCatalog.ts` decodes the `|v:...` visual-grid segments that `generateRoadTileWfcMetadata.ts`'s `gridSignature`/`socketSignature` already bake into every asset's `asset.json` socket strings (format: rows joined by `/`, cells joined by `,`; planar directions additionally nest a `|e:g:...|v:...|h:...` edge-strip segment — splitting the whole string on `|` still isolates every `v:`-prefixed segment cleanly since tokens never contain `|`). No GLB reload needed — mirrors the shape of `scripts/computeRoadWidthFraction.ts`.

```typescript
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Derives the full set of real material tokens used anywhere in the pack, from the visual-grid
 * segments generateRoadTileWfcMetadata.ts already bakes into every asset's socket signatures
 * (real GLB mesh material names, normalized — see that script's materialResolver/normalizeToken).
 * Writes the sorted list into wfc-pack.json as `materials`, a pack-wide catalog other tooling
 * (the environment exporter, Scenario Studio's friction editor) can read without hardcoding names.
 */
const packRoot = "assets/scene_element/3d-road-tiles";
const EMPTY_CELL = "empty";

interface AssetMetadataShape {
  wfc?: { variants?: Array<{ sockets?: Record<string, string> }> };
}

async function main() {
  const entries = await readdir(packRoot, { withFileTypes: true });
  const materials = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const raw = await readFile(join(packRoot, entry.name, "asset.json"), "utf8").catch(() => null);
    if (!raw) continue;
    const asset = JSON.parse(raw) as AssetMetadataShape;
    for (const variant of asset.wfc?.variants ?? []) {
      for (const socket of Object.values(variant.sockets ?? {})) collectMaterials(socket, materials);
    }
  }

  const sorted = [...materials].sort();
  const packPath = join(packRoot, "wfc-pack.json");
  const raw = await readFile(packPath, "utf8");
  const updated = raw.includes('"materials":')
    ? raw.replace(/"materials":\s*\[[^\]]*\]/, `"materials": ${JSON.stringify(sorted)}`)
    : raw.replace(/"dimensions": \{/, `"materials": ${JSON.stringify(sorted)},\n  "dimensions": {`);
  await writeFile(packPath, updated);
  console.log(`wfc-pack.json: materials = ${sorted.join(", ") || "(none found)"}`);
}

/** Splits a socket signature on "|"; every segment prefixed "v:" (the outer face grid and, for
 * planar directions, the nested edge-strip grid alike) is a visual/material sample grid. */
function collectMaterials(socket: string, into: Set<string>): void {
  for (const segment of socket.split("|")) {
    if (!segment.startsWith("v:")) continue;
    for (const row of segment.slice(2).split("/")) for (const token of row.split(",")) {
      if (token && token !== EMPTY_CELL) into.add(token);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Extend the pack schema**

In `src/wfc/metadata/packTypes.ts`, in `WfcPackDeclaration` right after the existing `roadWidthFraction?: number;` line:

```typescript
  /** Every distinct real material token found anywhere in the pack's assets (see computeMaterialCatalog.ts). */
  materials?: readonly string[];
```

In `src/wfc/metadata/packShape.ts`, the `declaration` shape (currently ends `independentPlacementDimensions: "boolean", roadWidthFraction: "number"` with a matching `optional` array) becomes:

```typescript
const declaration: Shape = { fields: {
  id: "string", version: "number", dimensions: { fields: { sourceTileWidth: "number", sourceTileDepth: "number" } },
  capabilities: strings, defaultProfile: "string", profiles: { record: profile }, socketNamespace: "string",
  catalogProfiles: { fields: { generic: "string", automatic: "string" } }, triggerCategory: "string", inferredRoles: strings,
  independentPlacementDimensions: "boolean", roadWidthFraction: "number", materials: strings
}, optional: ["socketNamespace", "catalogProfiles", "triggerCategory", "inferredRoles", "independentPlacementDimensions", "roadWidthFraction", "materials"] };
```

(`strings` is already defined at the top of the file as `{ array: "string" }`.)

In `src/wfc/metadata/packCatalog.ts`, right after the existing `roadWidthFraction` export:

```typescript
/** Every real material token used anywhere in the road-tile pack, derived by scripts/computeMaterialCatalog.ts. */
export const packMaterials: readonly string[] = roadPack.materials ?? [];
```

- [ ] **Step 3: Register the npm script**

In `package.json`, in the `scripts` block, right after `"assets:road-width": "vite-node scripts/computeRoadWidthFraction.ts",`:

```json
    "assets:road-materials": "vite-node scripts/computeMaterialCatalog.ts",
```

- [ ] **Step 4: Run the script and verify the catalog**

Run: `npm run assets:road-materials`
Expected: prints `wfc-pack.json: materials = ...` listing real tokens (e.g. `asphalt`, `grass`, ...), and `git diff assets/scene_element/3d-road-tiles/wfc-pack.json` shows one new `"materials": [...]` line. Run it a second time and confirm the diff doesn't grow (the `"materials":` replace branch keeps it idempotent).

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/computeMaterialCatalog.ts src/wfc/metadata/packTypes.ts src/wfc/metadata/packShape.ts src/wfc/metadata/packCatalog.ts package.json assets/scene_element/3d-road-tiles/wfc-pack.json
git commit -m "feat: derive a real material catalog for the road-tile pack"
```

---

### Task 2: Default friction table and scene-exporter materials metadata

**Files:**
- Create: `src/scenario-studio/domain/materialFriction.ts`
- Modify: `src/environment/types.ts:92-96` (`EnvironmentManifestMetadata`)
- Modify: `server/environmentRoutes.ts:1-11,56-66` (import + manifest metadata)
- Modify: `server/scenarioStudio/publishedScenes.ts:104-157` (`metadataFrom` + helpers)
- Modify: `src/scenario-studio/domain/scene.ts:1-20` (`SceneChoice`)

**Interfaces:**
- Consumes: `packMaterials` from Task 1.
- Produces: `DEFAULT_MATERIAL_FRICTION: Readonly<Record<string, number>>` and `normalizeMaterialToken(value: string): string` from `materialFriction.ts`, used by Tasks 6 and 7. `SceneChoice.materials?: readonly string[]`, used by Task 6.

- [ ] **Step 1: Add the default friction table**

Create `src/scenario-studio/domain/materialFriction.ts`:

```typescript
/** Starting-point grip per real material token (see scripts/computeMaterialCatalog.ts); a
 * scenario's own materialFriction map (ScenarioDocument) overrides these per material. */
export const DEFAULT_MATERIAL_FRICTION: Readonly<Record<string, number>> = Object.freeze({
  asphalt: 0.7,
  road: 0.7,
  concrete: 0.75,
  sidewalk: 0.8,
  curb: 0.8,
  grass: 0.9,
  dirt: 0.75,
  gravel: 0.75,
  sand: 0.6,
  water: 0.05,
  default: 0.6
});

export function frictionForMaterial(material: string, overrides: Readonly<Record<string, number>>): number {
  return overrides[material] ?? DEFAULT_MATERIAL_FRICTION[material] ?? DEFAULT_MATERIAL_FRICTION.default;
}

/** Same normalization generateRoadTileWfcMetadata.ts's normalizeToken applies at pack-build time,
 * duplicated here (not imported — that script is a Node build tool, not part of the browser bundle)
 * so a mesh's live material name matches the catalog's tokens. */
export function normalizeMaterialToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "unnamed";
}
```

- [ ] **Step 2: Add `materials` to the environment manifest metadata type**

In `src/environment/types.ts`, in `EnvironmentManifestMetadata`, right after the existing `roadWidthMeters?: number;` line:

```typescript
  materials?: readonly string[];
```

- [ ] **Step 3: Populate it in the exporter**

In `server/environmentRoutes.ts`, add the import alongside the other `../src/...` imports (after the `EnvironmentManifest` type import):

```typescript
import { packMaterials } from "../src/wfc/metadata/packCatalog";
```

Then in the `metadata` object literal (currently ending `...(scene.roadWidth > 0 ? { roadWidthMeters: scene.roadWidth } : {})`), add:

```typescript
          ...(scene.roadWidth > 0 ? { roadWidthMeters: scene.roadWidth } : {}),
          ...(packMaterials.length ? { materials: packMaterials } : {})
```

- [ ] **Step 4: Parse it in the published-scenes metadata reader**

In `server/scenarioStudio/publishedScenes.ts`, extend the return type and body of `metadataFrom` (currently at line 104):

```typescript
function metadataFrom(value: unknown, diagnostics: string[]): {
  name?: string;
  optional: { description?: string; sceneSize?: number; cellSize?: number; seed?: number; roadWidthMeters?: number; materials?: readonly string[] };
} {
  if (value === undefined) return { optional: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push("Manifest metadata must be an object.");
    return { optional: {} };
  }
  const record = value as Record<string, unknown>;
  const name = nonEmptyString(record.name, "name", diagnostics);
  const description = optionalString(record.description, "description", diagnostics);
  const sceneSize = optionalPositiveNumber(record.sceneSize, "sceneSize", diagnostics);
  const cellSize = optionalPositiveNumber(record.cellSize, "cellSize", diagnostics);
  const seed = optionalSeed(record.seed, diagnostics);
  const roadWidthMeters = optionalPositiveNumber(record.roadWidthMeters, "roadWidthMeters", diagnostics);
  const materials = optionalStringArray(record.materials, "materials", diagnostics);
  return {
    ...(name ? { name } : {}),
    optional: {
      ...(description ? { description } : {}),
      ...(sceneSize !== undefined ? { sceneSize } : {}),
      ...(cellSize !== undefined ? { cellSize } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(roadWidthMeters !== undefined ? { roadWidthMeters } : {}),
      ...(materials !== undefined ? { materials } : {})
    }
  };
}
```

Add the helper next to `optionalSeed` (end of file):

```typescript
function optionalStringArray(value: unknown, name: string, diagnostics: string[]): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())) return value;
  diagnostics.push(`Manifest metadata.${name} must be an array of non-empty strings when present.`);
  return undefined;
}
```

- [ ] **Step 5: Thread it onto `SceneChoice`**

In `src/scenario-studio/domain/scene.ts`, in `SceneChoice`, right after the existing `readonly roadWidthMeters?: number;` line:

```typescript
  readonly materials?: readonly string[];
```

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 7: Verify end-to-end**

Run `npm run dev`, open `/scenario_studio`, and confirm the network response from `GET /api/scenario-studio/scenes` includes a `materials` array on scenes built from the road-tile pack (DevTools Network tab, or `curl http://localhost:5173/api/scenario-studio/scenes | python3 -m json.tool` while the dev server runs). This confirms the pipeline from Task 1's `wfc-pack.json.materials` through the exporter to the scene-choice API.

- [ ] **Step 8: Commit**

```bash
git add src/scenario-studio/domain/materialFriction.ts src/environment/types.ts server/environmentRoutes.ts server/scenarioStudio/publishedScenes.ts src/scenario-studio/domain/scene.ts
git commit -m "feat: expose the real material catalog through the scene exporter"
```

---

### Task 3: Vehicle wheel metadata in the agent asset catalog

**Files:**
- Modify: `src/scenario-studio/domain/agent.ts:19-34` (`AgentAssetReference`, new `WheelDescriptor`)
- Modify: `server/scenarioStudio/agentCatalog.ts:7-12,56-95` (`VehicleMetadata`, `readChoice`)
- Modify: `src/scenario-studio/domain/scenarioRecord.ts:119-141` (`validateAgentAsset`)

**Interfaces:**
- Produces: `WheelDescriptor` and `AgentAssetReference.wheels?: readonly WheelDescriptor[]` from `agent.ts`, consumed by Tasks 9 and 10. Order is whatever order `vehicle.json`'s `wheels` array declares — later tasks pair `asset.wheels[i]` with per-frame wheel output by index, never by a hardcoded corner name.

- [ ] **Step 1: Add `WheelDescriptor` and extend `AgentAssetReference`**

In `src/scenario-studio/domain/agent.ts`, right after the `Ray3` interface (before `PlacementHit`):

```typescript
export interface WheelDescriptor {
  readonly id: string;
  readonly wheelNode: string;
  readonly steeringNode: string;
  readonly suspensionNode: string;
  readonly position: Vector3Value;
  readonly radius: number;
  readonly steerable: boolean;
}
```

In `AgentAssetReference`, right after the existing `readonly collision: { ... };` block:

```typescript
  readonly wheels?: readonly WheelDescriptor[];
```

- [ ] **Step 2: Parse `vehicle.json`'s `wheels` array server-side**

In `server/scenarioStudio/agentCatalog.ts`, extend `VehicleMetadata` (currently lines 7-12):

```typescript
interface VehicleWheelMetadata {
  id?: unknown;
  wheelNode?: unknown;
  steeringNode?: unknown;
  suspensionNode?: unknown;
  position?: unknown;
  radius?: unknown;
  steerable?: unknown;
}

interface VehicleMetadata {
  model?: unknown;
  units?: unknown;
  bounds?: { min?: unknown; max?: unknown };
  collision?: { type?: unknown; center?: unknown; halfExtents?: unknown };
  wheels?: unknown;
}
```

In `readChoice`, right after the existing collision-half-extents line (`const collisionHalfExtents = vector(...)`), add wheel parsing:

```typescript
    const wheels = Array.isArray(vehicle.wheels) ? vehicle.wheels.map((item, index) => wheelDescriptor(item as VehicleWheelMetadata, index, diagnostics)).filter((item): item is WheelDescriptor => item !== null) : undefined;
```

Add the import for `WheelDescriptor` at the top (extend the existing `agent` type import):

```typescript
import type { AgentAssetReference, AgentChoice, Vector3Value, WheelDescriptor } from "../../src/scenario-studio/domain/agent";
```

Add the helper function near `vector` at the bottom of the file:

```typescript
function wheelDescriptor(value: VehicleWheelMetadata, index: number, diagnostics: string[]): WheelDescriptor | null {
  const label = `Vehicle wheel #${index}`;
  if (typeof value.id !== "string" || !value.id.trim()) { diagnostics.push(`${label} id is required.`); return null; }
  if (typeof value.wheelNode !== "string" || !value.wheelNode.trim()) { diagnostics.push(`${label} wheelNode is required.`); return null; }
  if (typeof value.steeringNode !== "string" || !value.steeringNode.trim()) { diagnostics.push(`${label} steeringNode is required.`); return null; }
  if (typeof value.suspensionNode !== "string" || !value.suspensionNode.trim()) { diagnostics.push(`${label} suspensionNode is required.`); return null; }
  const position = vector(value.position, `${label} position`, diagnostics, { x: 0, y: 0.3, z: 0 });
  if (typeof value.radius !== "number" || !Number.isFinite(value.radius) || value.radius <= 0) { diagnostics.push(`${label} radius must be a positive number.`); return null; }
  if (typeof value.steerable !== "boolean") { diagnostics.push(`${label} steerable must be a boolean.`); return null; }
  return { id: value.id, wheelNode: value.wheelNode, steeringNode: value.steeringNode, suspensionNode: value.suspensionNode, position, radius: value.radius, steerable: value.steerable };
}
```

Finally, include `wheels` on the returned `asset` object (right after `collision: { center: collisionCenter, halfExtents: collisionHalfExtents }`):

```typescript
      collision: { center: collisionCenter, halfExtents: collisionHalfExtents },
      ...(wheels?.length ? { wheels } : {})
```

- [ ] **Step 3: Round-trip `wheels` through persisted scenario records**

In `src/scenario-studio/domain/scenarioRecord.ts`, `validateAgentAsset` (currently lines 119-141) reconstructs `AgentAssetReference` from raw JSON on scenario load — extend it so a vehicle's wheel metadata survives a save/reload cycle. Add, right before the closing `return Object.freeze({...})`:

```typescript
  const wheels = source.wheels === undefined ? undefined : validateWheelList(source.wheels);
```

And add `...(wheels ? { wheels } : {})` to the returned object literal, right after `collision: { center: ..., halfExtents: collisionHalfExtents }`.

Add these two helpers near `validateAgentAsset` (they reuse the file's existing `record`, `requiredText`, `vector`, `positive` helpers):

```typescript
function validateWheelList(value: unknown): WheelDescriptor[] {
  if (!Array.isArray(value)) throw new Error("Agent asset wheels must be an array.");
  return value.map(validateWheel);
}

function validateWheel(value: unknown): WheelDescriptor {
  const source = record(value, "Agent asset wheel");
  return Object.freeze({
    id: requiredText(source.id, "Wheel ID", 32),
    wheelNode: requiredText(source.wheelNode, "Wheel node name", 128),
    steeringNode: requiredText(source.steeringNode, "Steering node name", 128),
    suspensionNode: requiredText(source.suspensionNode, "Suspension node name", 128),
    position: vector(source.position, "Wheel position"),
    radius: positive(source.radius, "Wheel radius"),
    steerable: typeof source.steerable === "boolean" ? source.steerable : (() => { throw new Error("Wheel steerable flag must be a boolean."); })()
  });
}
```

Update the `WheelDescriptor` import at the top of `scenarioRecord.ts`:

```typescript
import { validateAgentDraft, type AgentAssetReference, type AgentSnapshot, type Vector3Value, type WheelDescriptor } from "./agent";
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Verify wheel metadata reaches the client**

Run `npm run dev`, open `/scenario_studio`, and inspect `GET /api/scenario-studio/agents` (DevTools Network, or `curl http://localhost:5173/api/scenario-studio/agents | python3 -m json.tool`). Confirm every vehicle asset (sedan, tesla-model-3, pickup, etc.) now has a `wheels` array with 4 entries carrying real node names (`Wheel_FL`, `Steering_FL`, `Suspension_FL`, …) — these already exist verbatim in each `assets/agents/vehicles/*/vehicle.json`, so this step is checking they now flow through, not that they're newly authored.

- [ ] **Step 6: Commit**

```bash
git add src/scenario-studio/domain/agent.ts server/scenarioStudio/agentCatalog.ts src/scenario-studio/domain/scenarioRecord.ts
git commit -m "feat: surface authored vehicle wheel metadata through the agent catalog"
```

---

### Task 4: Vehicle tuning parameters data model

**Files:**
- Modify: `src/scenario-studio/domain/agent.ts:52-140` (`AgentDraft`, `createAgentDraft`, `validateAgentDraft`, `freezeDraft`)
- Modify: `src/scenario-studio/domain/scenarioRecord.ts:89-117` (`validateAgentSnapshot`)

**Interfaces:**
- Produces: `VehicleTuning` and `AgentDraft.vehicle: VehicleTuning | null`, consumed by Task 5 (Inspector UI) and Task 9 (physics worker).

- [ ] **Step 1: Add `VehicleTuning` and the default constant**

In `src/scenario-studio/domain/agent.ts`, right after `AgentPose`/before `AgentSupportReference` (or any point before `AgentDraft`):

```typescript
export interface VehicleTuning {
  readonly maxEngineForceN: number;
  readonly maxBrakeForceN: number;
  readonly maxSteeringAngleDegrees: number;
  readonly steeringSpeedDegreesPerSecond: number;
  readonly suspensionStiffness: number;
  readonly suspensionDamping: number;
  readonly suspensionRestLength: number;
  readonly suspensionMaxTravel: number;
  readonly wheelFrictionSlip: number;
}

const DEFAULT_VEHICLE_TUNING: VehicleTuning = Object.freeze({
  maxEngineForceN: 4000,
  maxBrakeForceN: 6000,
  maxSteeringAngleDegrees: 35,
  steeringSpeedDegreesPerSecond: 120,
  suspensionStiffness: 24,
  suspensionDamping: 2.3,
  suspensionRestLength: 0.12,
  suspensionMaxTravel: 0.2,
  wheelFrictionSlip: 1.6
});
```

- [ ] **Step 2: Add the field to `AgentDraft`**

Right after `readonly mass: number;` in `AgentDraft`:

```typescript
  readonly vehicle: VehicleTuning | null;
```

- [ ] **Step 3: Default it in `createAgentDraft`**

`createAgentDraft` currently returns a `freezeDraft({...})` literal ending `inputEligible: true`. Add, right before that line:

```typescript
    vehicle: asset.category === "vehicles" ? DEFAULT_VEHICLE_TUNING : null,
```

- [ ] **Step 4: Validate it in `validateAgentDraft`**

Right before the final `return freezeDraft({ ...draft, name: draft.name.trim() });` line, add:

```typescript
  if (draft.vehicle) validateVehicleTuning(draft.vehicle);
```

Add the helper function near the file's other small validators (`positive`, `finiteVector`):

```typescript
function validateVehicleTuning(vehicle: VehicleTuning): void {
  positive(vehicle.maxEngineForceN, "Vehicle max engine force");
  positive(vehicle.maxBrakeForceN, "Vehicle max brake force");
  if (!Number.isFinite(vehicle.maxSteeringAngleDegrees) || vehicle.maxSteeringAngleDegrees <= 0 || vehicle.maxSteeringAngleDegrees >= 90) {
    throw new Error("Vehicle max steering angle must be between 0 and 90 degrees.");
  }
  positive(vehicle.steeringSpeedDegreesPerSecond, "Vehicle steering speed");
  positive(vehicle.suspensionStiffness, "Vehicle suspension stiffness");
  positive(vehicle.suspensionDamping, "Vehicle suspension damping");
  positive(vehicle.suspensionRestLength, "Vehicle suspension rest length");
  positive(vehicle.suspensionMaxTravel, "Vehicle suspension max travel");
  positive(vehicle.wheelFrictionSlip, "Vehicle wheel friction slip");
}
```

- [ ] **Step 5: Freeze it in `freezeDraft`**

`freezeDraft` currently returns an object literal starting `name: draft.name, scale: draft.scale, mass: draft.mass, inputEligible: draft.inputEligible, ...`. Add, right after `mass: draft.mass,`:

```typescript
    vehicle: draft.vehicle ? Object.freeze({ ...draft.vehicle }) : null,
```

- [ ] **Step 6: Round-trip `vehicle` through persisted scenario records**

In `src/scenario-studio/domain/scenarioRecord.ts`, `validateAgentSnapshot` (lines 89-117) currently returns an `Object.freeze({...})` ending `inputEligible: source.inputEligible`. Add, right after `mass: numeric(source.mass, "Agent mass"),`:

```typescript
    vehicle: source.vehicle === null || source.vehicle === undefined ? null : validateVehicleTuningRecord(source.vehicle),
```

Add the helper near `validateAgentAsset`:

```typescript
function validateVehicleTuningRecord(value: unknown): VehicleTuning {
  const source = record(value, "Vehicle tuning");
  return Object.freeze({
    maxEngineForceN: positive(source.maxEngineForceN, "Vehicle max engine force"),
    maxBrakeForceN: positive(source.maxBrakeForceN, "Vehicle max brake force"),
    maxSteeringAngleDegrees: numeric(source.maxSteeringAngleDegrees, "Vehicle max steering angle"),
    steeringSpeedDegreesPerSecond: positive(source.steeringSpeedDegreesPerSecond, "Vehicle steering speed"),
    suspensionStiffness: positive(source.suspensionStiffness, "Vehicle suspension stiffness"),
    suspensionDamping: positive(source.suspensionDamping, "Vehicle suspension damping"),
    suspensionRestLength: positive(source.suspensionRestLength, "Vehicle suspension rest length"),
    suspensionMaxTravel: positive(source.suspensionMaxTravel, "Vehicle suspension max travel"),
    wheelFrictionSlip: positive(source.wheelFrictionSlip, "Vehicle wheel friction slip")
  });
}
```

Update the type import at the top of `scenarioRecord.ts` to include `VehicleTuning`:

```typescript
import { validateAgentDraft, type AgentAssetReference, type AgentSnapshot, type Vector3Value, type VehicleTuning, type WheelDescriptor } from "./agent";
```

Note: `freezeRecord` (in the same file) already re-runs every agent through `validateAgentDraft`, which now validates `vehicle` too (Step 4) — no separate change needed there.

- [ ] **Step 7: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors. (`tests/objectTransform.test.ts` only ever builds `AgentDraft`s via `createAgentDraft`, never a raw literal, so it needs no fixture update — confirm by re-running the typecheck, which would fail on a missing-field literal if one existed.)

- [ ] **Step 8: Verify defaults apply**

Run `npm run dev`, open `/scenario_studio`, select a vehicle asset (e.g. sedan) in the agent browser, and confirm `createAgentDraft` no longer throws (place the agent normally) — this is exercised implicitly by placing any vehicle in the scene.

- [ ] **Step 9: Commit**

```bash
git add src/scenario-studio/domain/agent.ts src/scenario-studio/domain/scenarioRecord.ts
git commit -m "feat: add tunable vehicle physics parameters to the agent draft"
```

---

### Task 5: Agent Inspector vehicle-only fields

**Files:**
- Modify: `src/scenario-studio/ui/AgentInspectorPanel.ts` (whole file touched: `FIELD_SPECS`, `fields`, layout, read/load/update)

**Interfaces:**
- Consumes: `AgentDraft.vehicle`/`VehicleTuning` from Task 4.

- [ ] **Step 1: Split the field specs**

Replace the single `FIELD_SPECS` constant and `AgentFieldKey` type (lines 13-25) with a common array plus a vehicle-only array:

```typescript
type AgentFieldKey = "name" | "x" | "y" | "z" | "scale" | "heading" | "mass" | "slope" | "clearance";
type VehicleFieldKey = "maxEngineForceN" | "maxBrakeForceN" | "maxSteeringAngleDegrees" | "steeringSpeedDegreesPerSecond" | "suspensionStiffness" | "suspensionDamping" | "suspensionRestLength" | "suspensionMaxTravel" | "wheelFrictionSlip";

const FIELD_SPECS: ReadonlyArray<{ key: AgentFieldKey; label: string; help: string }> = [
  { key: "name", label: "Name", help: "The name used to identify this agent instance." },
  { key: "x", label: "Position X", help: "East-west position in scene meters." },
  { key: "y", label: "Position Y", help: "Vertical position in meters; placement seats it automatically." },
  { key: "z", label: "Position Z", help: "North-south position in scene meters." },
  { key: "scale", label: "Scale", help: "Uniform size multiplier for the model and collision bounds." },
  { key: "heading", label: "Heading °", help: "Rotation around the vertical axis, measured in degrees." },
  { key: "mass", label: "Mass kg", help: "Mass used when Play creates this agent's physics body." },
  { key: "slope", label: "Max slope °", help: "Steepest surface that may support this agent." },
  { key: "clearance", label: "Clearance m", help: "Vertical gap between the agent and its support." }
];

const VEHICLE_FIELD_SPECS: ReadonlyArray<{ key: VehicleFieldKey; label: string; help: string }> = [
  { key: "maxEngineForceN", label: "Engine force N", help: "Maximum forward drive force applied to the wheels." },
  { key: "maxBrakeForceN", label: "Brake force N", help: "Maximum braking force applied to the wheels." },
  { key: "maxSteeringAngleDegrees", label: "Steer angle °", help: "Maximum steering wheel lock angle." },
  { key: "steeringSpeedDegreesPerSecond", label: "Steer speed °/s", help: "How fast the front wheels sweep toward the target steering angle." },
  { key: "suspensionStiffness", label: "Suspension stiff.", help: "Suspension spring stiffness; higher resists compression more." },
  { key: "suspensionDamping", label: "Suspension damp.", help: "Suspension damping; higher settles bounce faster." },
  { key: "suspensionRestLength", label: "Suspension rest m", help: "Suspension length when the wheel is unloaded." },
  { key: "suspensionMaxTravel", label: "Suspension travel m", help: "Maximum suspension compression distance." },
  { key: "wheelFrictionSlip", label: "Tire grip", help: "Base tire traction, multiplied by the ground material's friction." }
];
```

- [ ] **Step 2: Build both field sets and track visibility**

Replace the `fieldLabels`/`helpButtons`/`fields` declarations and their constructor initialization (lines 35-37, 65-69) so both spec arrays are covered:

```typescript
  private readonly fieldLabels: HudText[];
  private readonly helpButtons: Button[];
  private readonly fields: Record<AgentFieldKey, TextField>;
  private readonly vehicleFieldLabels: HudText[];
  private readonly vehicleHelpButtons: Button[];
  private readonly vehicleFields: Record<VehicleFieldKey, TextField>;
```

In the constructor, right after the existing `this.fields = ...` line:

```typescript
    this.vehicleFieldLabels = VEHICLE_FIELD_SPECS.map(({ label }) => text(label, 10.5, "600", theme.textMutedStrong.css));
    this.vehicleHelpButtons = VEHICLE_FIELD_SPECS.map(({ help }) => new Button({ x: 0, y: 0, width: 20, height: 20 }, interaction, {
      label: "?", fontSize: 11, paddingX: 0, onClick: () => this.setStatus(help)
    }));
    this.vehicleFields = Object.fromEntries(VEHICLE_FIELD_SPECS.map(({ key }) => [key, new TextField({ x: 0, y: 0, width: 1, height: 30 }, interaction, { numeric: true })])) as typeof this.vehicleFields;
```

Extend the `this.root.add(...)` call to also add the vehicle widgets' roots: append `...this.vehicleFieldLabels.map((item) => item.root), ...this.vehicleHelpButtons.map((item) => item.root), ...Object.values(this.vehicleFields).map((item) => item.root)`.

- [ ] **Step 3: Compute the visible spec list and lay it out**

Add a private helper (near `currentDraft`):

```typescript
  private visibleVehicleSpecs(): typeof VEHICLE_FIELD_SPECS {
    return this.currentDraft()?.asset.category === "vehicles" ? VEHICLE_FIELD_SPECS : [];
  }
```

In `layout()`, after the existing `FIELD_SPECS.forEach(...)` row-positioning block (which ends at `const detailY = start + FIELD_SPECS.length * row + 2;`), insert vehicle rows between the common fields and the detail labels, and push `detailY` down by however many vehicle rows are visible:

```typescript
    const vehicleSpecs = this.visibleVehicleSpecs();
    const vehicleStart = start + FIELD_SPECS.length * row;
    this.vehicleFieldLabels.forEach((label, index) => label.setFrame({ x, y: vehicleStart + index * row, width: 63 }));
    this.vehicleHelpButtons.forEach((button, index) => button.setRect({ x: x + 64, y: vehicleStart - 5 + index * row, width: 20, height: 20 }));
    VEHICLE_FIELD_SPECS.forEach(({ key }, index) => this.vehicleFields[key].setRect({ x: x + 91, y: vehicleStart - 8 + index * row, width: Math.max(width - 91, 1), height: 30 }));
    const detailY = vehicleStart + vehicleSpecs.length * row + 2;
```

(The `detailY` line that already existed is replaced by this one — everything below it, `collisionLabel`/`eligibilityLabel`/`status`/button rects, is unchanged and now simply reads the recomputed `detailY`.)

- [ ] **Step 4: Read/load/clear the vehicle fields**

In `readFields()`, right before the final `return freezeDraft({...})`, compute the vehicle patch:

```typescript
    const vehicleNumber = (key: VehicleFieldKey) => Number(this.vehicleFields[key].getValue());
    const vehicle = base.vehicle ? {
      maxEngineForceN: vehicleNumber("maxEngineForceN"),
      maxBrakeForceN: vehicleNumber("maxBrakeForceN"),
      maxSteeringAngleDegrees: vehicleNumber("maxSteeringAngleDegrees"),
      steeringSpeedDegreesPerSecond: vehicleNumber("steeringSpeedDegreesPerSecond"),
      suspensionStiffness: vehicleNumber("suspensionStiffness"),
      suspensionDamping: vehicleNumber("suspensionDamping"),
      suspensionRestLength: vehicleNumber("suspensionRestLength"),
      suspensionMaxTravel: vehicleNumber("suspensionMaxTravel"),
      wheelFrictionSlip: vehicleNumber("wheelFrictionSlip")
    } : null;
```

and add `vehicle,` to the returned `freezeDraft({...})` literal.

In `loadFields()`, append:

```typescript
    if (draft.vehicle) for (const { key } of VEHICLE_FIELD_SPECS) this.vehicleFields[key].setValue(format(draft.vehicle[key]));
```

In `clearFields()`, extend the loop to also clear vehicle fields: `for (const field of [...Object.values(this.fields), ...Object.values(this.vehicleFields)]) field.setValue("");`.

- [ ] **Step 5: Show/hide vehicle rows in `updateState()`**

In `updateState()`, right after the existing `for (const button of this.helpButtons) button.root.visible = Boolean(draft);` line, add:

```typescript
    const vehicleVisible = this.visibleVehicleSpecs().length > 0;
    for (const field of Object.values(this.vehicleFields)) field.root.visible = vehicleVisible;
    for (const label of this.vehicleFieldLabels) label.root.visible = vehicleVisible;
    for (const button of this.vehicleHelpButtons) button.root.visible = vehicleVisible;
```

- [ ] **Step 6: Update `update()` and `dispose()`**

In `update(dt)`, extend the loop to also tick vehicle fields: `for (const field of [...Object.values(this.fields), ...Object.values(this.vehicleFields)]) field.update(dt);`.

In `dispose()`, extend the disposal loop similarly: add `for (const label of this.vehicleFieldLabels) label.dispose(); for (const button of this.vehicleHelpButtons) button.dispose(); for (const field of Object.values(this.vehicleFields)) field.dispose();`.

- [ ] **Step 7: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, open `/scenario_studio`. Select a vehicle asset (e.g. sedan): confirm 9 extra rows (Engine force N, Brake force N, …) appear below Clearance, pre-filled with the Task 4 defaults, and that editing one and clicking Add/Apply doesn't throw. Select a non-vehicle asset (any human/pedestrian asset) and confirm the vehicle rows are hidden and the panel doesn't leave a gap where they'd be.

- [ ] **Step 9: Commit**

```bash
git add src/scenario-studio/ui/AgentInspectorPanel.ts
git commit -m "feat: show vehicle tuning fields in the Agent Inspector"
```

---

### Task 6: Scenario-level material friction setting

**Files:**
- Modify: `src/scenario-studio/domain/ScenarioDocument.ts` (whole file)
- Modify: `src/scenario-studio/domain/scenarioRecord.ts:6-13,22-52,67-76` (`ScenarioRecord`, validate/freeze)
- Modify: `src/scenario-studio/ui/ScenarioHudFeature.ts` (materials rows, mirroring the existing road-width row; extend the `ScenarioActions` interface)
- Modify: `src/scenario-studio/ScenarioStudioApp.ts:127-169` (implement the two new `ScenarioActions` methods)

**Note on architecture:** `ScenarioHudFeature` never touches `ScenarioSession`/`ScenarioDocument` directly — it only calls through the injected `ScenarioActions` interface (see its existing `rename`/`create`/`open`/`save`/`play`/`pause`/`reset`, implemented as an object literal in `ScenarioStudioApp.ts` around line 127). Material friction follows the same boundary: two new `ScenarioActions` methods, not a raw session reference on the HUD.

**Interfaces:**
- Consumes: `SceneChoice.materials` (Task 2), `DEFAULT_MATERIAL_FRICTION` (Task 2).
- Produces: `ScenarioDocument.materialFriction: Readonly<Record<string, number>>` and `ScenarioDocument.setMaterialFriction(material: string, value: number): void`, consumed by Task 8.

- [ ] **Step 1: Add `materialFriction` to `ScenarioRecord` and validate it**

In `src/scenario-studio/domain/scenarioRecord.ts`, add to `ScenarioRecord` (right after `readonly agents: readonly AgentSnapshot[];`):

```typescript
  readonly materialFriction: Readonly<Record<string, number>>;
```

In `validateScenarioRecord`, right after `const engineKey = identity(...)`, add (lenient on absence — old saved scenarios predate this field):

```typescript
  const materialFriction = source.materialFriction === undefined ? {} : materialFrictionMap(source.materialFriction);
```

and add `materialFriction` to the final `return freezeRecord({ version: SCENARIO_RECORD_VERSION, id, name, sceneReference, engineKey, agents, materialFriction });`.

In `freezeRecord`, add `materialFriction: Object.freeze({ ...value.materialFriction }),` to its returned object literal.

Add the helper near the other small validators:

```typescript
function materialFrictionMap(value: unknown): Record<string, number> {
  const source = record(value, "Scenario material friction");
  const result: Record<string, number> = {};
  for (const [material, friction] of Object.entries(source)) result[material] = positive(friction, `Friction for material "${material}"`);
  return result;
}
```

- [ ] **Step 2: Own `materialFriction` on `ScenarioDocument`**

Read the current `src/scenario-studio/domain/ScenarioDocument.ts` first — it's a small class (`identity`, `scenarioName`, `physicsEngineKey`, `activeScene`, `authoredAgents`, `modified`) with a constructor validating a `ScenarioRecord`, getters, `rename`/`replaceScene`/`replaceAgents`/`toRecord`/`replaceWith`/`markSaved`, and a `newScenarioRecord` factory. Add a private field, getter, and mutator following the exact same pattern as `replaceAgents`:

```typescript
  private materialFrictionOverrides: Readonly<Record<string, number>> = Object.freeze({});
```

(declared alongside the other private fields, e.g. right after `private authoredAgents`)

In the constructor, right after `this.authoredAgents = valid.agents;`:

```typescript
    this.materialFrictionOverrides = valid.materialFriction;
```

Add the getter (near `get agents()`):

```typescript
  get materialFriction(): Readonly<Record<string, number>> { return this.materialFrictionOverrides; }
```

Add the mutator (near `replaceAgents`):

```typescript
  setMaterialFriction(material: string, friction: number): void {
    if (!Number.isFinite(friction) || friction <= 0) throw new Error("Material friction must be a positive number.");
    if (this.materialFrictionOverrides[material] === friction) return;
    this.materialFrictionOverrides = Object.freeze({ ...this.materialFrictionOverrides, [material]: friction });
    this.modified = true;
  }
```

Extend `toRecord()` to include it: add `materialFriction: this.materialFrictionOverrides` to the object passed to `freezeRecord`.

Extend `replaceWith(record)` to also set `this.materialFrictionOverrides = valid.materialFriction;` (mirroring how it sets `this.authoredAgents`).

Extend `newScenarioRecord(...)` to include `materialFriction: {}` in its returned `freezeRecord({...})` literal.

- [ ] **Step 3: Extend `ScenarioActions` with material-friction methods**

In `src/scenario-studio/ui/ScenarioHudFeature.ts`, add to the `ScenarioActions` interface (right after the existing `reset(): void;` line):

```typescript
  materialFriction(): Readonly<Record<string, number>>;
  setMaterialFriction(material: string, value: number): void;
```

In `src/scenario-studio/ScenarioStudioApp.ts`, add two entries to the `ScenarioActions` object literal passed into `ScenarioHudFeature`'s constructor (right after the existing `reset: () => this.session.reset()` line — note the trailing comma needs to move):

```typescript
        reset: () => this.session.reset(),
        materialFriction: () => this.session.document.materialFriction,
        setMaterialFriction: (material, value) => { this.session.document.setMaterialFriction(material, value); }
```

(Task 8 Step 6 revisits this `setMaterialFriction` action to also push the value live into the running physics world, once `ScenarioSession.updateMaterialFriction()` exists — this task's version only persists the value on the document, which is enough for it to compile and for the value to take effect the next time the scene reloads.)

- [ ] **Step 4: Add material friction rows to the scene inspector**

Read the current `src/scenario-studio/ui/ScenarioHudFeature.ts` first — the `roadWidthField`/`roadWidthOverrides`/`roadWidthFieldRect`/`activeRoadWidthMeters`/`candidateRoadWidthMeters`/`commitRoadWidth` block (added by the in-flight road-width work) is the pattern to mirror, with one difference: friction values persist on the scenario document via the `ScenarioActions.materialFriction()`/`setMaterialFriction()` methods just added, not in a session-only override map, per the approved design.

Add private state (near `roadWidthOverrides`):

```typescript
  private readonly materialFrictionLabels = new Map<string, HudText>();
  private readonly materialFrictionFields = new Map<string, TextField>();
```

Add a method that rebuilds the row widgets to match the currently-inspected scene's material list, called from `refresh()` right after the existing `this.roadWidthField.setValue(...)` line:

```typescript
  private syncMaterialFrictionRows(): void {
    const materials = this.candidate?.materials ?? [];
    for (const [material, field] of this.materialFrictionFields) if (!materials.includes(material)) {
      field.dispose(); this.materialFrictionFields.delete(material);
      this.materialFrictionLabels.get(material)?.dispose(); this.materialFrictionLabels.delete(material);
    }
    materials.forEach((material, index) => {
      let field = this.materialFrictionFields.get(material);
      if (!field) {
        field = new TextField(this.materialFrictionFieldRect(index), this.interaction, {
          numeric: true, placeholder: "0.6", onCommit: (value) => this.commitMaterialFriction(material, value)
        }, "");
        this.materialFrictionFields.set(material, field);
        this.right.root.add(field.root);
      }
      field.setRect(this.materialFrictionFieldRect(index));
      field.setValue(String(frictionForMaterial(material, this.scenarioActions.materialFriction())));
      let label = this.materialFrictionLabels.get(material);
      if (!label) {
        label = new HudText(this.materialFrictionLabelRect(index), { size: 11.5, weight: "600", color: theme.textMutedStrong.css });
        label.setText(material);
        this.materialFrictionLabels.set(material, label);
        this.right.root.add(label.root);
      }
      label.setFrame(this.materialFrictionLabelRect(index));
    });
  }

  private materialFrictionRowCount(): number { return this.candidate?.materials?.length ?? 0; }

  private materialFrictionFieldRect(index: number): Rect {
    const field = this.roadWidthFieldRect();
    return { x: field.x, y: field.y + (index + 1) * (CONTROL_HEIGHT_STEP), width: field.width, height: 26 };
  }

  private materialFrictionLabelRect(index: number): Rect {
    const field = this.materialFrictionFieldRect(index);
    return { x: field.x - 100, y: field.y, width: 100, height: 26 };
  }

  private commitMaterialFriction(material: string, value: string): void {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) this.scenarioActions.setMaterialFriction(material, parsed);
    this.materialFrictionFields.get(material)?.setValue(String(frictionForMaterial(material, this.scenarioActions.materialFriction())));
  }
```

Add the constant `CONTROL_HEIGHT_STEP = 30` near the file's other layout constants, and import `frictionForMaterial` from `../domain/materialFriction`.

Because the material rows now occupy space below the road-width row, shift the fixed-position labels that come after it. In the `layout()`/`refresh()` array that positions `["detailKey", 255, ...], ["detailVersion", 287, ...], ["detailHash", 313, ...], ["diagnostic", 367, ...]`, change each of those four fixed Y values to add `this.materialFrictionRowCount() * CONTROL_HEIGHT_STEP` (e.g. `255 + this.materialFrictionRowCount() * CONTROL_HEIGHT_STEP`), and call `this.syncMaterialFrictionRows()` before that positioning loop runs so the row count used is current.

In `dispose()`, add disposal of any remaining rows: `for (const field of this.materialFrictionFields.values()) field.dispose(); for (const label of this.materialFrictionLabels.values()) label.dispose();`.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open `/scenario_studio`, browse a scene built from the road-tile pack. Confirm one friction row per real material appears below Road width, pre-filled with `DEFAULT_MATERIAL_FRICTION` values; edit one, and confirm reopening the scenario (New, then reselect) keeps the edited value (round-trips through `ScenarioDocument`/`ScenarioRecord`).

- [ ] **Step 7: Commit**

```bash
git add src/scenario-studio/domain/ScenarioDocument.ts src/scenario-studio/domain/scenarioRecord.ts src/scenario-studio/ui/ScenarioHudFeature.ts src/scenario-studio/ScenarioStudioApp.ts
git commit -m "feat: add a scenario-level material friction setting"
```

---

### Task 7: Real per-triangle material tagging in scene geometry

**Files:**
- Modify: `src/scenario-studio/physics/PhysicsWorld.ts:4-8` (`TriangleMeshDescription`)
- Modify: `src/scenario-studio/rendering/SceneGeometrySource.ts` (`extract`, `appendGeometry`)

**Interfaces:**
- Consumes: `normalizeMaterialToken` from Task 2.
- Produces: `TriangleMeshDescription.material: string`, consumed by Task 8.

- [ ] **Step 1: Add the field**

In `src/scenario-studio/physics/PhysicsWorld.ts`, add to `TriangleMeshDescription`:

```typescript
  readonly material: string;
```

- [ ] **Step 2: Stamp the real material name per mesh**

In `src/scenario-studio/rendering/SceneGeometrySource.ts`, add the import:

```typescript
import { normalizeMaterialToken } from "../domain/materialFriction";
```

Add a helper next to `isWaterTriangle` that resolves the same material Three.js object `isWaterTriangle` already looks at, for a given triangle's starting index:

```typescript
function triangleMaterialName(mesh: THREE.Mesh, indexOffset: number): string {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const group = mesh.geometry.groups.find((candidate) => indexOffset >= candidate.start && indexOffset < candidate.start + candidate.count);
  const material = materials[group?.materialIndex ?? 0];
  return normalizeMaterialToken(material?.name || mesh.name || "unnamed");
}
```

`extract()` currently builds one `TriangleMeshDescription` per mesh (mixing every triangle that shares the same `water` classification), so a single dominant material name per extracted mesh is enough here (per-triangle granularity isn't needed — `physics.worker.ts` sets friction per collider, and `appendGeometry` already produces one collider per mesh). Take the first non-water triangle's material as representative. In `extract()`, right after the `const point = new THREE.Vector3();` line, add:

```typescript
  let material = "unnamed";
```

Inside the loop, right after the existing `if (isWaterTriangle(mesh, first) !== water) continue;` line, add:

```typescript
    if (material === "unnamed") material = triangleMaterialName(mesh, first);
```

And add `material,` to the final `return { label, vertices: ..., indices: ... };` object literal.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors (note: `RapierPhysicsWorld.ts`'s `cloneMeshes` helper spreads each mesh with `{ ...mesh, vertices: ..., indices: ... }`, which already carries `material` through unchanged — no edit needed there).

- [ ] **Step 4: Commit**

```bash
git add src/scenario-studio/physics/PhysicsWorld.ts src/scenario-studio/rendering/SceneGeometrySource.ts
git commit -m "feat: tag scene geometry meshes with their real material name"
```

---

### Task 8: Ground friction wiring in the physics worker

**Files:**
- Modify: `src/scenario-studio/physics/PhysicsWorld.ts:34-50` (`PhysicsWorld` interface: `replaceScene` signature, new `updateGroundFriction`)
- Modify: `src/scenario-studio/physics/RapierPhysicsWorld.ts:9-13`
- Modify: `src/scenario-studio/physics/PhysicsWorkerClient.ts`
- Modify: `src/scenario-studio/physics/physics.worker.ts` (`replaceScene`, new `updateGroundFriction`, module state)
- Modify: `src/scenario-studio/domain/ScenarioSession.ts:41,77,108` (thread `materialFriction` through; new live-update method)
- Modify: `src/scenario-studio/ScenarioStudioApp.ts` (the `setMaterialFriction` action also pushes the live update)

**Interfaces:**
- Consumes: `frictionForMaterial`, `DEFAULT_MATERIAL_FRICTION` (Task 2), `TriangleMeshDescription.material` (Task 7), `ScenarioDocument.materialFriction` (Task 6).
- Produces: `PhysicsWorld.updateGroundFriction(materialFriction: Readonly<Record<string, number>>): Promise<void>`, and `replaceScene`'s new second parameter, both consumed only within this task and Task 6's UI.

- [ ] **Step 1: Extend the `PhysicsWorld` interface**

In `src/scenario-studio/physics/PhysicsWorld.ts`, change:

```typescript
  replaceScene(scene: SceneGeometryDescription): Promise<number>;
```

to:

```typescript
  replaceScene(scene: SceneGeometryDescription, materialFriction: Readonly<Record<string, number>>): Promise<number>;
  /** Re-applies friction to the current ground colliders in place, without rebuilding geometry or disturbing agent colliders. */
  updateGroundFriction(materialFriction: Readonly<Record<string, number>>): Promise<void>;
```

- [ ] **Step 2: Thread it through `RapierPhysicsWorld`**

In `src/scenario-studio/physics/RapierPhysicsWorld.ts`, change the `replaceScene` method:

```typescript
  replaceScene(scene: SceneGeometryDescription, materialFriction: Readonly<Record<string, number>>): Promise<number> {
    const cloneMeshes = (meshes: readonly SceneGeometryDescription["meshes"][number][]) => meshes.map((mesh) => ({ ...mesh, vertices: mesh.vertices.slice(), indices: mesh.indices.slice() }));
    const copy = { ...scene, meshes: cloneMeshes(scene.meshes), nonSupportingMeshes: cloneMeshes(scene.nonSupportingMeshes ?? []) };
    return this.client.replaceScene(copy, materialFriction);
  }
  updateGroundFriction(materialFriction: Readonly<Record<string, number>>): Promise<void> { return this.client.updateGroundFriction(materialFriction); }
```

- [ ] **Step 3: Thread it through `PhysicsWorkerClient`**

In `src/scenario-studio/physics/PhysicsWorkerClient.ts`, change the `replaceScene` operation variant:

```typescript
  | { type: "replaceScene"; scene: SceneGeometryDescription; materialFriction: Readonly<Record<string, number>> }
```

Add a new variant right after it:

```typescript
  | { type: "updateGroundFriction"; materialFriction: Readonly<Record<string, number>> }
```

Change the `replaceScene` method:

```typescript
  replaceScene(scene: SceneGeometryDescription, materialFriction: Readonly<Record<string, number>>): Promise<number> { return this.request({ type: "replaceScene", scene, materialFriction }); }
```

Add, right after it:

```typescript
  updateGroundFriction(materialFriction: Readonly<Record<string, number>>): Promise<void> { return this.request({ type: "updateGroundFriction", materialFriction }); }
```

- [ ] **Step 4: Apply friction in the worker's `replaceScene`, and add live re-friction**

In `src/scenario-studio/physics/physics.worker.ts`, add module-level state right after `const environmentHandles = new Map<number, string>();`:

```typescript
const environmentMaterials = new Map<number, string>();
```

Add the import: extend the existing domain import line to bring in nothing new here (friction table import goes separately):

```typescript
import { DEFAULT_MATERIAL_FRICTION } from "../domain/materialFriction";
```

Change the `replaceScene` function signature and body. It currently creates colliders via `RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices)` for both the `nextHandles` loop and returns `++sceneRevision`. Update:

```typescript
function replaceScene(scene: SceneGeometryDescription, materialFriction: Readonly<Record<string, number>>): number {
  const next = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const nextHandles = new Set<number>();
  const nextLabels = new Map<number, string>();
  const nextMaterials = new Map<number, string>();
  const nextNonSupportingHandles = new Set<number>();
  try {
    if (scene.kind === "default-ground") {
      const ground = scene.defaultGround;
      if (!ground || !Number.isFinite(ground.width) || !Number.isFinite(ground.depth) || !Number.isFinite(ground.y) || ground.width <= 0 || ground.depth <= 0) {
        throw new Error("Default ground geometry is invalid.");
      }
      const collider = next.createCollider(RAPIER.ColliderDesc.cuboid(ground.width / 2, 0.05, ground.depth / 2).setTranslation(0, ground.y - 0.05, 0).setFriction(DEFAULT_MATERIAL_FRICTION.default));
      nextHandles.add(collider.handle);
      nextLabels.set(collider.handle, "scene:default-ground");
    } else {
      if (!scene.meshes.length) throw new Error("The imported scene has no supported solid geometry.");
      for (const [index, mesh] of scene.meshes.entries()) {
        if (mesh.vertices.length < 9 || mesh.indices.length < 3) continue;
        const friction = materialFriction[mesh.material] ?? DEFAULT_MATERIAL_FRICTION[mesh.material] ?? DEFAULT_MATERIAL_FRICTION.default;
        const collider = next.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices).setFriction(friction));
        nextHandles.add(collider.handle);
        nextLabels.set(collider.handle, `scene:${index}:${mesh.label}`);
        nextMaterials.set(collider.handle, mesh.material);
      }
      for (const mesh of scene.nonSupportingMeshes ?? []) {
        if (mesh.vertices.length < 9 || mesh.indices.length < 3) continue;
        const collider = next.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices).setSensor(true));
        nextNonSupportingHandles.add(collider.handle);
      }
      if (!nextHandles.size) throw new Error("The imported scene has no supported solid triangles.");
    }
  } catch (error) {
    next.free();
    throw error;
  }
  next.step();
  world?.free();
  world = next;
  environmentHandles.clear();
  for (const [handle, label] of nextLabels) environmentHandles.set(handle, label);
  environmentMaterials.clear();
  for (const [handle, material] of nextMaterials) environmentMaterials.set(handle, material);
  nonSupportingHandles.clear();
  for (const handle of nextNonSupportingHandles) nonSupportingHandles.add(handle);
  agentColliders.clear();
  clearPlaybackState();
  return ++sceneRevision;
}

function updateGroundFriction(materialFriction: Readonly<Record<string, number>>): void {
  const active = requireWorld();
  for (const [handle, material] of environmentMaterials) {
    const collider = active.colliders.get(handle);
    if (!collider) continue;
    collider.setFriction(materialFriction[material] ?? DEFAULT_MATERIAL_FRICTION[material] ?? DEFAULT_MATERIAL_FRICTION.default);
  }
}
```

Update `dispose()` to also clear the new map: add `environmentMaterials.clear();` alongside the existing `environmentHandles.clear();`.

Update the `dispatch` switch's `replaceScene` case and add the new `updateGroundFriction` case:

```typescript
    case "replaceScene": return replaceScene(operation.scene, operation.materialFriction);
```

```typescript
    case "updateGroundFriction": updateGroundFriction(operation.materialFriction); return undefined;
```

- [ ] **Step 5: Pass the scenario's friction map from `ScenarioSession`**

In `src/scenario-studio/domain/ScenarioSession.ts`, update the three `world.replaceScene(...)` call sites to pass `this.document.materialFriction`:

Line 41 (constructor): `this.ready = physics.then(async (world) => { this.sceneRevision = await world.replaceScene(this.presentation.geometry, this.document.materialFriction); });`

Line 77 (`open`): `const nextRevision = await world.replaceScene(scenePresentation.geometry, this.document.materialFriction);`

Line 108 (`replaceScene`): `const nextRevision = await world.replaceScene(prepared.geometry, this.document.materialFriction);`

Add a new method for live updates, near `drive()`:

```typescript
  updateMaterialFriction(): void {
    void this.physics.then((world) => world.updateGroundFriction(this.document.materialFriction)).catch(() => {});
  }
```

- [ ] **Step 6: Call the live update when a friction field is committed**

In `src/scenario-studio/ScenarioStudioApp.ts`, update the `setMaterialFriction` action added in Task 6 Step 3:

```typescript
        setMaterialFriction: (material, value) => {
          this.session.document.setMaterialFriction(material, value);
          this.session.updateMaterialFriction();
        }
```

- [ ] **Step 7: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, open `/scenario_studio`, open a scene, and confirm it still loads (this exercises `replaceScene`'s new required second parameter end-to-end). Edit a material friction value in the inspector and confirm no console error appears (exercises `updateGroundFriction`). Full behavioral confirmation (grip actually differing per surface) happens in Task 9's verification, once the vehicle controller consumes collider friction.

- [ ] **Step 9: Commit**

```bash
git add src/scenario-studio/physics/PhysicsWorld.ts src/scenario-studio/physics/RapierPhysicsWorld.ts src/scenario-studio/physics/PhysicsWorkerClient.ts src/scenario-studio/physics/physics.worker.ts src/scenario-studio/domain/ScenarioSession.ts src/scenario-studio/ScenarioStudioApp.ts
git commit -m "feat: apply real per-material ground friction in the physics worker"
```

---

### Task 9: Vehicle physics via Rapier's `DynamicRayCastVehicleController`

**Files:**
- Modify: `src/scenario-studio/physics/PhysicsWorld.ts:22-32` (`AgentTransform.wheels`)
- Modify: `src/scenario-studio/physics/physics.worker.ts` (`PlaybackBody`, `preparePlayback`, `stepPlayback`, `driveControlledAgent`, `collectTransforms`, remove old vehicle-specific constants)

**Interfaces:**
- Consumes: `AgentAssetReference.wheels` (Task 3), `AgentDraft.vehicle`/`VehicleTuning` (Task 4).
- Produces: `AgentTransform.wheels?: readonly {steeringRadians: number; rotationRadians: number}[]`, consumed by Task 10. Array order matches `agent.asset.wheels` order (index-paired, not corner-named).

- [ ] **Step 1: Add wheel output to `AgentTransform`**

In `src/scenario-studio/physics/PhysicsWorld.ts`, add to `AgentTransform`:

```typescript
  readonly wheels?: readonly { readonly steeringRadians: number; readonly rotationRadians: number }[];
```

- [ ] **Step 2: Track vehicle controllers per playback body**

In `physics.worker.ts`, `PlaybackBody` currently is `{ body, kind, localCenter }`. Extend it:

```typescript
interface PlaybackBody {
  readonly body: RAPIER.RigidBody;
  readonly kind: "generic" | "vehicle";
  readonly localCenter: Vector3Value;
  readonly controller?: RAPIER.DynamicRayCastVehicleController;
  readonly wheelCount: number;
}
```

- [ ] **Step 3: Build the vehicle controller in `preparePlayback`**

`preparePlayback` currently creates one dynamic body + one cuboid collider per agent (friction hardcoded to `1`) uniformly, regardless of vehicle-ness. Split the vehicle case out. Replace the body of the `for (const agent of agents)` loop:

```typescript
  for (const agent of agents) {
    const kind: "generic" | "vehicle" = agent.asset.category === "vehicles" ? "vehicle" : "generic";
    const localCenter = scaledAgentCollision(agent).center;
    const half = scaledAgentCollision(agent).halfExtents;
    const center = collisionCenter(agent, agent.pose.position, agent.pose.headingRadians);
    const body = active.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(center.x, center.y, center.z)
      .setRotation(rotation(agent.pose.headingRadians))
      .setLinearDamping(kind === "vehicle" ? 0.02 : 0.15)
      .setAngularDamping(kind === "vehicle" ? 0.3 : 0.6));
    active.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(agent.mass).setFriction(1), body);

    if (kind === "vehicle" && agent.vehicle && agent.asset.wheels?.length) {
      const controller = active.createVehicleController(body);
      controller.indexUpAxis = 1;
      controller.indexForwardAxis = 2;
      for (const wheel of agent.asset.wheels) {
        const local = { x: wheel.position.x - localCenter.x, y: wheel.position.y - localCenter.y, z: wheel.position.z - localCenter.z };
        controller.addWheel(local, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, agent.vehicle.suspensionRestLength, wheel.radius);
      }
      agent.asset.wheels.forEach((_, index) => {
        controller.setWheelSuspensionStiffness(index, agent.vehicle!.suspensionStiffness);
        controller.setWheelSuspensionCompression(index, agent.vehicle!.suspensionDamping);
        controller.setWheelSuspensionRelaxation(index, agent.vehicle!.suspensionDamping);
        controller.setWheelMaxSuspensionTravel(index, agent.vehicle!.suspensionMaxTravel);
        controller.setWheelFrictionSlip(index, agent.vehicle!.wheelFrictionSlip);
      });
      playbackBodies.set(agent.id, { body, kind, localCenter, controller, wheelCount: agent.asset.wheels.length });
    } else {
      playbackBodies.set(agent.id, { body, kind, localCenter, wheelCount: 0 });
    }
    if (agent.id === controlledAgentId) controlledKind = kind;
  }
```

(`indexUpAxis`/`indexForwardAxis` match the codebase's Y-up, Z-forward convention already used by `rotate`/`rotation`/`collisionCenter` elsewhere in this file. `wheel.position` in `vehicle.json`/`AgentAssetReference.wheels` is relative to the vehicle's own origin, same frame as `scaledAgentCollision(agent).center`/`halfExtents` — subtracting `localCenter` re-expresses it relative to the chassis collider's center, which is where the rigid body's local frame is anchored.)

- [ ] **Step 4: Drive via engine force / brake / steering instead of velocity**

Replace the whole `applyDriveForces` function. It currently mutates `entry.body` directly for one hardcoded controlled body using `ENGINE_ACCEL`/`MAX_FORWARD_SPEED`/etc. Those constants (`ENGINE_ACCEL`, `MAX_FORWARD_SPEED`, `MAX_REVERSE_SPEED`, `BRAKE_DECAY_PER_SECOND`, `LATERAL_GRIP`, `STEER_RATE`, `STEER_REFERENCE_SPEED`) are now superseded for vehicles by each agent's own `VehicleTuning` — remove all seven constant declarations (lines 11-17) and replace the function:

```typescript
const wheelSteeringRadians = new Map<string, number>();

function applyDriveForces(agents: readonly AgentSnapshot[]): void {
  if (!controlledBodyId) return;
  const entry = playbackBodies.get(controlledBodyId);
  const agent = agents.find((candidate) => candidate.id === controlledBodyId);
  if (!entry?.controller || !agent?.vehicle || !agent.asset.wheels) return;
  const tuning = agent.vehicle;
  const maxSteeringRadians = tuning.maxSteeringAngleDegrees * Math.PI / 180;
  const targetSteering = driveCommand.steering * maxSteeringRadians;
  const currentSteering = wheelSteeringRadians.get(controlledBodyId) ?? 0;
  const steeringStep = tuning.steeringSpeedDegreesPerSecond * Math.PI / 180 * FIXED_STEP;
  const nextSteering = Math.abs(targetSteering - currentSteering) <= steeringStep ? targetSteering : currentSteering + Math.sign(targetSteering - currentSteering) * steeringStep;
  wheelSteeringRadians.set(controlledBodyId, nextSteering);

  agent.asset.wheels.forEach((wheel, index) => {
    entry.controller!.setWheelEngineForce(index, driveCommand.throttle * tuning.maxEngineForceN);
    entry.controller!.setWheelBrake(index, driveCommand.brake * tuning.maxBrakeForceN);
    if (wheel.steerable) entry.controller!.setWheelSteering(index, nextSteering);
    const groundFriction = entry.controller!.wheelGroundObject(index)?.friction() ?? 1;
    entry.controller!.setWheelFrictionSlip(index, tuning.wheelFrictionSlip * groundFriction);
  });
  entry.controller!.updateVehicle(FIXED_STEP);
}
```

(Reading `wheelGroundObject(index)?.friction()` from the *previous* `updateVehicle` call before setting this step's `wheelFrictionSlip`, then calling `updateVehicle` — one-step lag, per the design doc's accepted tradeoff.)

Update `stepPlayback`'s loop to pass `agents` through — but `stepPlayback`'s signature only receives `dt`/`generation` today, not `agents`. The worker needs the current agents list at drive time; `playbackBodies` doesn't retain `AgentSnapshot`, only `PlaybackBody`. Store the prepared agents at `preparePlayback` time instead of threading them through every step: add module state `let preparedAgents: readonly AgentSnapshot[] = [];` near `playbackBodies`, set it at the end of `preparePlayback` (`preparedAgents = agents;`), clear it in `clearPlaybackState()` (`preparedAgents = [];`), and change `stepPlayback`'s loop body from `applyDriveForces();` to `applyDriveForces(preparedAgents);`.

- [ ] **Step 5: Emit per-wheel transforms**

Replace `collectTransforms`'s push call to include `wheels` when the body has a controller:

```typescript
function collectTransforms(): AgentTransform[] {
  const transforms: AgentTransform[] = [];
  for (const [id, entry] of playbackBodies) {
    const translation = entry.body.translation();
    const rot = entry.body.rotation();
    const heading = 2 * Math.atan2(rot.y, rot.w);
    const offset = rotate(entry.localCenter.x, entry.localCenter.z, heading);
    const wheels = entry.controller ? Array.from({ length: entry.wheelCount }, (_, index) => ({
      steeringRadians: entry.controller!.wheelSteering(index) ?? 0,
      rotationRadians: entry.controller!.wheelRotation(index) ?? 0
    })) : undefined;
    transforms.push({
      id,
      position: { x: translation.x - offset.x, y: translation.y - entry.localCenter.y, z: translation.z - offset.z },
      headingRadians: heading,
      ...(wheels ? { wheels } : {})
    });
  }
  return transforms;
}
```

- [ ] **Step 6: Clean up controllers on teardown**

`teardownPlaybackBodies` currently only removes rigid bodies. Vehicle controllers are owned by the Rapier `World` and freed with it, but should be explicitly removed when torn down independently of a full `dispose()`. Update:

```typescript
function teardownPlaybackBodies(active: RAPIER.World): void {
  for (const { body, controller } of playbackBodies.values()) {
    if (controller) active.removeVehicleController(controller);
    active.removeRigidBody(body);
  }
  playbackBodies.clear();
}
```

Also clear the new steering-memory map in `clearPlaybackState()`: add `wheelSteeringRadians.clear();`.

- [ ] **Step 7: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, open `/scenario_studio`, place a vehicle (e.g. sedan) as the input-eligible agent, click Play, and drive with the keyboard. Confirm: the vehicle accelerates/decelerates smoothly (not instantly snapping to a target velocity — push forward and release, and it should coast rather than stop dead), it turns while moving, and it doesn't visibly fall through or bounce erratically on the ground (suspension behaving). This is the core "car should use physics to move" verification; wheel visuals land in Task 10.

- [ ] **Step 9: Commit**

```bash
git add src/scenario-studio/physics/PhysicsWorld.ts src/scenario-studio/physics/physics.worker.ts
git commit -m "feat: drive the controlled vehicle with a real per-wheel physics controller"
```

---

### Task 10: Wheel visuals — steering and spin

**Files:**
- Modify: `src/scenario-studio/rendering/AgentVisuals.ts`

**Interfaces:**
- Consumes: `AgentTransform.wheels` (Task 9), `AgentAssetReference.wheels` (Task 3).

- [ ] **Step 1: Cache resolved wheel nodes per instance**

Add a private field near the other instance maps:

```typescript
  private readonly wheelNodes = new Map<string, ReadonlyArray<{ steering: THREE.Object3D; wheel: THREE.Object3D } | null>>();
```

Add a private helper that resolves and caches nodes for one agent the first time it's needed:

```typescript
  private resolveWheelNodes(id: string): ReadonlyArray<{ steering: THREE.Object3D; wheel: THREE.Object3D } | null> | null {
    const cached = this.wheelNodes.get(id);
    if (cached) return cached;
    const object = this.instances.get(id);
    const wheels = this.agents.get(id)?.asset.wheels;
    if (!object || !wheels?.length) return null;
    const resolved = wheels.map((wheel) => {
      const steering = object.getObjectByName(wheel.steeringNode);
      const wheelNode = object.getObjectByName(wheel.wheelNode);
      return steering && wheelNode ? { steering, wheel: wheelNode } : null;
    });
    this.wheelNodes.set(id, resolved);
    return resolved;
  }
```

- [ ] **Step 2: Apply steering/spin during live playback**

`applyLiveTransforms` currently only sets `object.position`/`object.rotation` per transform. Extend it:

```typescript
  applyLiveTransforms(transforms: readonly AgentTransform[]): void {
    for (const transform of transforms) {
      const object = this.instances.get(transform.id);
      if (!object) continue;
      object.position.set(transform.position.x, transform.position.y, transform.position.z);
      object.rotation.set(0, transform.headingRadians, 0);
      if (transform.wheels) {
        const nodes = this.resolveWheelNodes(transform.id);
        transform.wheels.forEach((wheel, index) => {
          const node = nodes?.[index];
          if (!node) return;
          node.steering.rotation.y = wheel.steeringRadians;
          node.wheel.rotation.x = wheel.rotationRadians;
        });
      }
      object.updateMatrixWorld(true);
    }
  }
```

- [ ] **Step 3: Clear the cache when an instance is removed**

In `remove(id)`, right after `this.instances.delete(id);`, add:

```typescript
    this.wheelNodes.delete(id);
```

In `clear()`, the existing loop already calls `this.remove(id)` for every instance, so the cache is cleared there too — no separate change needed.

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open `/scenario_studio`, place a vehicle, Play, and drive. Confirm: front wheels visibly turn left/right with steering input (and only the front pair, since `steerable: false` on the rear entries in every `vehicle.json` means the rear `steering` node never gets written — verify it stays at its authored angle), and all four wheels visibly spin faster as speed increases, direction reversing in reverse gear.

- [ ] **Step 6: Commit**

```bash
git add src/scenario-studio/rendering/AgentVisuals.ts
git commit -m "feat: animate vehicle wheel steering and spin during playback"
```

---

### Task 11: End-to-end verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full manual walkthrough**

Run `npm run dev`, open `/scenario_studio`, and work through, in order:
1. Generate or open a scene that includes grass and road (and water, if the pack's WFC generation produces it) — confirm the scenario inspector lists real material names with friction fields (Task 6).
2. Place a vehicle, open the Agent Inspector, confirm the 9 vehicle tuning fields appear and are editable (Task 5).
3. Set the vehicle as input-eligible (or confirm it's auto-selected as the sole placed agent), click Play.
4. Drive across grass, then road: confirm the vehicle's handling (how much it slides under hard steering/braking) visibly differs between the two surfaces — this is the full loop from Task 6's friction setting through Task 8's worker wiring through Task 9's `wheelGroundObject().friction()` lookup.
5. Confirm wheels steer and spin throughout (Task 10).
6. Click Reset, then Play again, and confirm the vehicle behaves the same way on the second run (no leaked state from the vehicle controller — exercises Task 9 Step 6's teardown).

- [ ] **Step 2: Full rebuild check**

Run: `npm run build`
Expected: no TypeScript errors, Vite build succeeds.

- [ ] **Step 3: Report**

No commit for this task — it's a checklist, not a code change. If any sub-step fails, return to the task that owns the broken piece, fix it, and re-run that task's own verification before resuming here.
