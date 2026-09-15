# Vehicle physics and ground materials design

Date: 2026-09-15

Status: Design draft for user review. Implementation has not started.

## Purpose and agreed scope

The Rapier playback landed in the previous commit (`feat: add Rapier playback and basic vehicle driving`) has three gaps this design closes:

1. Every ground collider gets Rapier's uniform default friction; grass, road, and water should grip differently.
2. The controlled vehicle is driven by directly overwriting its rigid body's linear/angular velocity each step, not by physics forces.
3. Nothing rotates or steers a vehicle's wheels — the 3D model's wheel nodes sit static during playback.

While scoping the friction fix, the request grew to include a real, non-hardcoded material catalog (a script derives it from asset data, not a name-guessing heuristic), a scenario-level friction setting per material, and vehicle-specific tunable physics parameters exposed in the Agent Inspector. All four pieces are interdependent — the tunable parameters replace what would otherwise be hardcoded constants in the vehicle-physics rewrite, and the material catalog replaces what would otherwise be a name-regex guess in the friction fix — so this single design covers all of them.

**Out of scope:**
- Human-agent-specific Agent Inspector fields. The inspector gains a per-category field mechanism, but only vehicle fields are populated now (the request explicitly said "let's work on vehicle for now").
- Physics-driven movement for non-controlled vehicle agents (parked/background vehicles). Only the single input-controlled agent gets the full wheel controller; everything else keeps today's simple dynamic-body behavior.
- Visual suspension travel (raising/lowering the `Suspension_*` nodes with wheel compression). The data will be available from Rapier's controller but wiring it into the renderer is flagged as future work to keep this change bounded.

## Current repository and reuse

- `src/scenario-studio/physics/physics.worker.ts` — `replaceScene()` builds one `RAPIER.ColliderDesc.trimesh(...)` per mesh with no `.setFriction()` call, so every collider uses Rapier's uniform default (0.5). `applyDriveForces()` computes a target speed from `throttle`/`brake`/`steering` and calls `setLinvel`/`setAngvel` directly — kinematic-style, not force-based. `collectTransforms()` returns only `{id, position, headingRadians}`, nothing per-wheel.
- `src/scenario-studio/physics/PhysicsWorld.ts` — `TriangleMeshDescription` and `SceneGeometryDescription` carry no material/friction field. `AgentTransform`/`PlaybackSnapshot` carry no wheel data.
- `src/scenario-studio/rendering/SceneGeometrySource.ts` — the actual producer of `SceneGeometryDescription`; walks the Three.js scene graph per mesh. `isWaterTriangle()` is the only existing "surface classification," a `/water/i` regex against mesh/material name used to split solid vs. sensor triangles.
- `@dimforge/rapier3d-compat@0.20.0` (already installed) ships `DynamicRayCastVehicleController` (`node_modules/@dimforge/rapier3d-compat/dist/control/ray_cast_vehicle_controller.d.ts`), a raycast wheel/suspension controller with per-wheel engine force, brake, steering angle, friction slip, and readable rotation/steering/suspension-length outputs. `World.createVehicleController(chassis)` constructs one. This is available today and avoids hand-rolling suspension physics.
- `assets/agents/vehicles/*/vehicle.json` (11 vehicles) already declares, per wheel (FL/FR/RL/RR), `wheelNode`/`steeringNode`/`suspensionNode` names, `position`, `radius`, and a `steerable` flag, plus chassis `collision.center`/`halfExtents` — verified present and matching the real GLB node names in every vehicle checked. None of this is read by any code today.
- `src/scenario-studio/rendering/AgentVisuals.ts` — `applyLiveTransforms()` is the playback render path; it only sets `object.position`/`object.rotation` on the whole agent root, no sub-node traversal.
- `src/scenario-studio/domain/agent.ts` — `AgentDraft`/`AgentSnapshot` is one flat shape for every agent category; no per-category extension point.
- `src/scenario-studio/ui/AgentInspectorPanel.ts` — field list (`FIELD_SPECS`) is a single flat array driving fixed `TextField`s; no per-category variation.
- `scripts/generateRoadTileWfcMetadata.ts` already extracts **real** per-triangle material names from each asset's GLB mesh materials (`materialResolver`/`materialName`, normalized via `normalizeToken`) and bakes them into every asset's per-direction socket signature strings (the `|v:...` segment), including the "top" direction, which samples the drivable top surface. This is untapped, real, non-hardcoded material data already sitting in every asset's `asset.json`.
- **In-flight precedent** (uncommitted in this working tree): a `roadWidthFraction` feature follows exactly the pipeline shape this design needs. `scripts/computeRoadWidthFraction.ts` derives a value from already-baked `asset.json` socket data (no GLB reload) and splices it into `wfc-pack.json`. It flows through `packTypes.ts`/`packShape.ts` (schema + validation) → `packCatalog.ts` (re-exported constant) → `EditorState`/`sceneFromGeneration.ts` (applied to a generated `Scene`) → `server/environmentRoutes.ts`'s `createEnvironmentExportCache` (the environment manifest export — this is "the scene exporter") → `server/scenarioStudio/publishedScenes.ts` (manifest metadata parsing) → `src/scenario-studio/domain/scene.ts`'s `SceneChoice` → `ScenarioHudFeature.ts` (UI field with a session-override map). The materials pipeline below reuses this exact shape.

## Ground materials and friction

**Material catalog script.** New `scripts/computeMaterialCatalog.ts`, run via a new `assets:road-materials` npm script, mirroring `computeRoadWidthFraction.ts`: it reads every asset's already-baked `asset.json`, decodes the `|v:...` visual-grid segment of each variant's socket signatures (the encoding `gridSignature` already writes — comma-separated tokens per row, `/`-separated rows), collects the distinct set of material tokens pack-wide (excluding `"empty"`), sorts them, and splices a `materials: string[]` field into `wfc-pack.json` using the same text-splice technique already used for `roadWidthFraction`. No GLB reloading, no new traversal of 3D geometry — it decodes data the existing generation script already produced.

**Schema.** `WfcPackDeclaration.materials?: readonly string[]` (`src/wfc/metadata/packTypes.ts`), added to the validated shape in `packShape.ts` (field `materials: strings`, added to the optional list). `packCatalog.ts` re-exports `export const packMaterials: readonly string[] = roadPack.materials ?? [];`, matching the existing `roadWidthFraction` export.

**Default frictions.** New `src/scenario-studio/domain/materialFriction.ts` exporting a constant table, `DEFAULT_MATERIAL_FRICTION: Readonly<Record<string, number>>`, with reasonable defaults for known tokens (asphalt/road ≈ 0.7, grass ≈ 0.9, water ≈ 0.05, sidewalk/curb ≈ 0.8, dirt/gravel ≈ 0.75, sand ≈ 0.6) and a `default` fallback (≈ 0.6) for any material not explicitly listed. This is a starting point; the scenario-level setting (below) lets a user override any value.

**Scene exporter.** `EnvironmentManifestMetadata` (`src/environment/types.ts`) gains `materials?: readonly string[]`. `server/environmentRoutes.ts`'s `createEnvironmentExportCache` populates it from `packMaterials`, the same treatment `roadWidthMeters` already gets. `server/scenarioStudio/publishedScenes.ts`'s `metadataFrom` parses and validates it the same way. `src/scenario-studio/domain/scene.ts`'s `SceneChoice` gains `readonly materials?: readonly string[]`.

**Scenario-level setting.** `ScenarioDocument`/`ScenarioRecord` gains `materialFriction: Readonly<Record<string, number>>`, seeded from `DEFAULT_MATERIAL_FRICTION` for whichever materials the active scene's `SceneChoice.materials` reports. The Scenario Studio UI gets one new row per material (a `TextField` per material name) in `ScenarioHudFeature`'s scene inspector, next to the existing road-width row, using the same commit-handler/override-map pattern already implemented for `roadWidthField`/`roadWidthOverrides` in that file. Confirmed placement: scenario-level, alongside road width (not a separate dedicated panel).

**Physics wiring.** `SceneGeometrySource` stamps each mesh's real Three.js material name onto a new `TriangleMeshDescription.material: string` field (no more regex guessing — this is the actual material name already available on the mesh, the same source `isWaterTriangle` already reads). `ScenarioSession` passes the scenario's `materialFriction` map down through `PhysicsWorld.replaceScene`. `physics.worker.ts`'s `replaceScene()` calls `.setFriction(materialFriction[mesh.material] ?? materialFriction.default ?? 0.5)` per collider instead of leaving Rapier's uniform default.

## Vehicle physics

Replace the controlled vehicle's direct `setLinvel`/`setAngvel` driving with Rapier's `DynamicRayCastVehicleController`.

**Setup (`preparePlayback`).** When the controlled agent's asset category is `"vehicles"`, build the chassis as a dynamic rigid body sized from the vehicle's `collision.center`/`halfExtents` (already authored per-vehicle in `vehicle.json`) at the agent's configured mass (see tunable parameters below), then `world.createVehicleController(chassisBody)` and `addWheel(...)` once per `vehicle.json` `wheels[]` entry: `chassisConnectionCs` = wheel `position`, `directionCs` = local −Y, `axleCs` = local +X (matches the asset's declared `axes.wheelSpin: "+X"`), `suspensionRestLength`/`radius` from the vehicle's tunable suspension parameters and authored wheel radius.

**Driving (`driveControlledAgent`).** Maps `DriveCommand.throttle`/`.brake` to `setWheelEngineForce`/`setWheelBrake` on all four wheels (all-wheel drive — the simplest robust default absent any authored drivetrain data; not tied to a specific vehicle type today, flagged as a default worth revisiting later, not a per-vehicle authored choice). `DriveCommand.steering` maps to `setWheelSteering` only on wheels where the corresponding `vehicle.json` entry has `steerable: true`, ramped toward the target angle at the vehicle's configured steering speed rather than snapping.

**Ground-material grip.** Because the raycast controller does not automatically consult a hit collider's `.friction()`, each step, before `updateVehicle(dt)`, the worker reads `controller.wheelGroundObject(i)?.friction()` from the previous step's contact and feeds it into `setWheelFrictionSlip(i, baseSlip * groundFriction)`. This is a one-frame-lagged but simple, verifiable way to make grass/road/water actually change grip.

**Non-controlled agents** (including parked/background vehicles) keep today's simple dynamic-cuboid body — no wheel controller, no behavior change, since nothing drives them today.

## Wheel visuals

`AgentVisuals.ts` loads each vehicle's `vehicle.json` once (cached by asset id) to resolve `Steering_*`/`Wheel_*` node names via `object.getObjectByName()`. The worker's per-frame output (`AgentTransform`, see below) carries a `wheels?: {steeringRadians, rotationRadians}[]` (FL/RL/FR/RR order) populated only for the controlled vehicle, read from `controller.wheelSteering(i)`/`controller.wheelRotation(i)`. `applyLiveTransforms()`, when a transform carries `wheels`, sets `steeringNode.rotation.y = steeringRadians` and `wheelNode.rotation.x = rotationRadians` per corner (matching the asset's declared spin axis). Visual suspension travel (moving `Suspension_*` nodes) is deferred — see Out of scope.

## Vehicle tuning parameters (Agent Inspector)

`AgentDraft`/`AgentSnapshot` gains an optional nested record, populated only when `asset.category === "vehicles"`:

```
vehicle: {
  maxEngineForceN: number;
  maxBrakeForceN: number;
  maxSteeringAngleDegrees: number;
  steeringSpeedDegreesPerSecond: number;
  suspensionStiffness: number;
  suspensionDamping: number;
  suspensionRestLength: number;
  suspensionMaxTravel: number;
  wheelFrictionSlip: number;
} | null
```

The existing shared `mass` field is reused as chassis mass — no duplicate field. `createAgentDraft` fills in default values for these when the asset is a vehicle; `validateAgentDraft` validates each (positive where physically required, `maxSteeringAngleDegrees` bounded to a sane range); `freezeDraft` extends to freeze the nested record.

`AgentInspectorPanel.ts`'s `FIELD_SPECS` splits into a common array (unchanged, all current fields) plus a vehicle-only array. Row layout is computed from the *visible* spec list for the current draft's `asset.category`, so vehicle rows only take space for vehicle agents. `loadFields`/`readFields`/`updateState` extend to read/write `draft.vehicle.*` only when present. This is a plain category check, not a new provider abstraction — with only two categories today and one (human) contributing zero extra fields, a generic per-type plugin mechanism would be speculative; adding a second populated category later means adding another spec array and one more branch, not restructuring.

`physics.worker.ts`'s vehicle-controller setup (above) reads these values instead of hardcoded constants — including replacing the existing `STEER_RATE`/`STEER_REFERENCE_SPEED` constants already in that file.

## Worker/client protocol changes

- `SceneGeometryDescription`'s `TriangleMeshDescription` (`PhysicsWorld.ts`) gains `material: string`.
- `PhysicsWorld.replaceScene` gains a `materialFriction: Readonly<Record<string, number>>` parameter, threaded through `RapierPhysicsWorld`, `PhysicsWorkerClient`, and the worker's `replaceScene` operation payload.
- `AgentTransform`/`PlaybackSnapshot` (`PhysicsWorld.ts`) gains optional `wheels?: readonly {steeringRadians: number; rotationRadians: number}[]`.
- `AgentSnapshot`/`AgentDraft` (`domain/agent.ts`) gains the optional `vehicle` record described above; this is persisted, so `ScenarioRecord` validation (`scenarioRecord.ts`) and `ScenarioDocument` need to accept and round-trip it.
- `EnvironmentManifestMetadata` (`environment/types.ts`), `SceneChoice` (`scenario-studio/domain/scene.ts`), and the `publishedScenes.ts` metadata parser gain `materials?: readonly string[]`.
- `ScenarioRecord`/`ScenarioDocument` gains `materialFriction: Readonly<Record<string, number>>`.

## Verification

Per project convention, no new unit tests unless requested. Verification is manual, in the running app:
- Generate or open a scene with grass, road, and water; confirm the friction rows appear in the scenario inspector with sensible defaults, and that editing a value changes vehicle grip on that surface during playback.
- Drive the controlled vehicle: confirm acceleration/braking feels force-driven (no velocity snapping), front wheels visibly steer, all four wheels visibly spin proportional to speed, and grip differs between grass/road/water.
- Select a vehicle asset in the Agent Inspector and confirm the vehicle-only fields appear (and don't appear for a human asset); edit a value (e.g. max steering angle) and confirm it changes in-scene behavior.
- Run `npm run assets:road-materials` and confirm `wfc-pack.json` gains a `materials` array matching the real material names used by the road-tile pack's assets.

## Assumptions and defaults worth flagging

- All-wheel drive is the default drivetrain for every vehicle, since no asset declares a drivetrain today. Revisit if a specific vehicle's authored data should override this later.
- Default numeric values for the new tunable vehicle fields (engine/brake force, suspension constants, etc.) are chosen for plausible arcade-driving feel and tuned by hand in-app; they are not derived from real vehicle specs.
- The one-frame lag in ground-friction lookup (reading last step's contact before this step's `updateVehicle`) is accepted as imperceptible rather than solved with a two-pass update.
