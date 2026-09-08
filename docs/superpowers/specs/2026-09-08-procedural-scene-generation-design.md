# Procedural Scene Generation Design

**Status:** Finalized for implementation planning

## Goal

Add procedural scene generation to the editor so a user can generate a reusable semantic city from labeled asset packs, resolve that city into placed scene objects, and keep the resulting semantic representation available for future simulation systems.

The feature must not create one-off scripts for one specific scene. Asset packs provide reusable metadata and optional reusable materialization logic. The generator creates an asset-visual-independent city first, then resolves that city into concrete asset instances.

## Non-Goals

- No natural-language prompt-to-scene workflow in the first implementation.
- No arbitrary user-authored script execution from the browser.
- No full Wave Function Collapse rule-authoring UI in the first implementation; the asset metadata schema must stay compatible with future horizontal and vertical adjacency editing.
- No simulation runtime behavior, traffic AI, physics, or pathfinding implementation.
- No automatic semantic labeling during every generation run.

## Existing Context

The current editor stores scenes as JSON files containing grid settings, environment settings, and concrete `SceneObject` instances. Objects reference catalog asset IDs and are rendered by Three.js through the viewport layer.

The shared asset library is discovered from `assets/`. Each asset folder has `asset.json`, and may include a `.glb`, a module, and thumbnails. This feature extends that metadata with generator-oriented semantics while keeping asset files colocated.

The current editor normalizes placed object `Y` positions to zero. The procedural generation implementation must change that constraint before applying stacked or elevated generated placements.

## Design Principles

- Generate meaning before meshes.
- Store scene objects for rendering and editing.
- Store semantic city data for simulation and regeneration.
- Keep generator logic data-driven and reusable across compatible packs.
- Treat asset labels as reviewable metadata, not unquestioned truth.
- Support 3D placement from the start: height, stacking, anchors, bridges, facade attachments, and roof props.
- Keep simulation logic independent from asset visuals. Asset visuals are presentation; reviewed asset metadata is a generator contract; `semanticCity` is the simulation-readable source of truth.

## User Flow

In the Project Panel, add a procedural generation area:

1. User uses the built-in Grid City generator. A future version can add a generator selector.
2. User chooses a supported primary asset pack.
3. The editor auto-scans compatible asset packs and shows whether the usable set covers roads, buildings, vegetation, stacking, and traffic signs.
4. User reviews asset semantic-label status.
5. User runs one-time asset labeling if needed.
6. User sets scene width, depth, and cell size.
7. User starts visible WFC playback.
8. User receives the final generated city applied to the active generated layer.

The first implementation should support replacing the active generated layer. A later version can add append/merge behavior once conflict handling is designed.

## Project Panel V1 Scope

The first Project Panel implementation should keep controls minimal while showing the generation process:

- Primary asset pack selector.
- Asset-set readiness summary.
- Scene width and depth inputs.
- Cell size input.
- Generate Scene button.
- WFC playback view showing materialization progress.
- Diagnostics panel for unresolved cells, rejected candidates, and metadata issues.

The supported primary asset-pack options are:

- `assets/city-kit-roads`
- `assets/3d-road-tiles`

These are not hard-coded directly into the UI. The server scans the asset root for pack-level manifests, validates each pack for generator compatibility, and returns supported packs plus diagnostics. The selected primary pack supplies the preferred road visual style. The server also scans all compatible manifests to form a complete generation asset set for buildings, vegetation, stackable building parts, and traffic signs.

Generation should use the selected asset set's validated semantic metadata to materialize visuals. Scene size and cell size become both the active scene grid settings and the bounds used by `SemanticCity.bounds`.

When the user clicks Generate Scene:

1. Validate the selected asset set has enough semantic metadata for roads, buildings, vegetation, stacking, and traffic signs.
2. Generate an asset-independent semantic city and navigation graph for the requested size/cell size.
3. Run WFC materialization visibly in the Project Panel, showing cells/placements as they collapse into visual asset choices.
4. Resolve semantic map entities into visual `SceneObject` placements using the selected asset set.
5. Replace the active generated layer with the new `semanticCity`, materialization mapping, and objects in one undoable command.
6. Show diagnostics if required roles, sockets, stacking metadata, traffic-sign metadata, rejected candidates, unresolved cells, or assets are missing.

Seed controls, density controls, vertical complexity controls, and in-app label review remain part of the broader design but are not required for this first UI slice. WFC playback is required in V1, but full WFC rule authoring remains out of scope.

## Asset Pack Discovery

Each generator-compatible asset pack must have an `asset-pack.json` manifest at the asset pack root. The Project Panel asset-pack selector is populated by scanning `assets/*/asset-pack.json`.

Example:

```json
{
  "schemaVersion": 1,
  "id": "3d-road-tiles",
  "label": "3D Road Tiles",
  "generatorCompatibility": {
    "cityGrid": {
      "supported": true,
      "roles": ["road.surface"],
      "requiredSocketTypes": ["road"],
      "supportsRotation": true,
      "supportsVerticalPlacement": false
    }
  },
  "assets": [
    {
      "id": "3d-road-tiles.road-tile-012",
      "path": "road-tile-012",
      "roles": ["road.surface"]
    }
  ]
}
```

The manifest is a pack-level index and capability declaration. It exists so the UI can answer, “can this folder be used by this generator?” without scanning every asset on every render.

Discovery rules:

- The server scans asset pack roots under `assets/`.
- A folder is generator-selectable only when it has a valid `asset-pack.json` and can serve as a primary pack for the selected generator.
- The manifest path determines the pack root. The manifest must not define its own root path.
- The manifest must list the assets the pack intends to expose to generation.
- Every listed asset must exist and must have valid `asset.json` semantic metadata.
- `generatorCompatibility.cityGrid.supported` must be true for the V1 generator.
- The pack must provide the required semantic roles and socket types for the selected generator.
- The server returns unsupported packs with diagnostics for tooling, but the Project Panel disables them.
- The two initial supported primary manifests are `assets/city-kit-roads/asset-pack.json` and `assets/3d-road-tiles/asset-pack.json`.
- The server also computes a `GenerationAssetSet` from all valid manifests so the selected primary road pack can be combined with compatible building, vegetation, stacking, and traffic-sign packs.

The manifest does not replace per-asset `asset.json`; it summarizes and constrains it. Per-asset metadata remains the source for footprint, sockets, rotation, stacking, anchors, review status, and confidence.

```ts
interface GenerationAssetSet {
  primaryPackId: string;
  packIds: string[];
  capabilities: {
    roads: CapabilityStatus;
    buildings: CapabilityStatus;
    vegetation: CapabilityStatus;
    stacking: CapabilityStatus;
    trafficSigns: CapabilityStatus;
  };
  diagnostics: string[];
}

interface CapabilityStatus {
  required: boolean;
  available: boolean;
  assetCount: number;
  diagnostics: string[];
}
```

## Asset Semantic Labeling

Each asset can have loose display/search `tags` and a strict `semantics` block in `asset.json`. The labeling script added under `scripts/` is the offline path for creating this metadata. The editor reads the saved metadata; it does not ask AI during generation.

The generator must not infer behavior from GLB geometry, rendered meshes, thumbnails, or filenames. AI may inspect visuals once to propose metadata, but generation consumes only validated metadata. Loose top-level `tags` are for search and filtering; strict `semantics` is the generator contract.

Semantic metadata rules:

- Every generator-compatible asset must declare `semantics.schemaVersion`.
- Every semantic asset must declare `kind` from a known enum.
- New asset types must be additive: introduce new `kind`, `roles`, socket types, and optional capability validators without changing the meaning of existing fields.
- Visual connectivity must use typed `sockets`, not free-form tags.
- Rotation, footprint, stacking, and anchors must be explicit.
- Unknown semantic fields must be ignored for forward compatibility.
- Missing or invalid required fields must make the asset unavailable to generation.
- AI-generated labels default to `reviewStatus: "needs_review"`.
- Generation may use `needs_review` metadata only when the user explicitly allows it.

Example road tile:

```json
{
  "id": "3d-road-tiles.road-tile-012",
  "label": "Road Tile 012",
  "category": "3d-road-tiles",
  "tags": ["road", "asphalt", "two-lane"],
  "semantics": {
    "schemaVersion": 1,
    "kind": "road_tile",
    "label": "Straight two-lane road tile",
    "description": "Grid road segment with opposite road exits.",
    "roles": ["road.surface"],
    "sockets": {
      "north": { "type": "road", "lanes": 2, "agents": ["vehicle"] },
      "south": { "type": "road", "lanes": 2, "agents": ["vehicle"] }
    },
    "rotation": { "allowed": true, "stepDegrees": 90 },
    "footprint": { "width": 1, "depth": 1, "height": 0.1 },
    "stacking": { "allowed": false },
    "wfc": {
      "weight": 3,
      "preferNeighbors": [
        { "direction": "east", "roles": ["sidewalk"] },
        { "direction": "west", "roles": ["sidewalk"] }
      ]
    },
    "anchors": [],
    "confidence": 0.86,
    "reviewStatus": "needs_review"
  }
}
```

`sockets` describe the asset in its unrotated local orientation. At resolution time, the materializer can rotate the asset and compute effective socket directions. A straight north-south tile can satisfy an east-west road requirement with `rotationY = 90`.

Example stackable building part:

```json
{
  "semantics": {
    "schemaVersion": 1,
    "kind": "building_part",
    "label": "Modular mid-rise floor",
    "roles": ["building.floor"],
    "sockets": {
      "top": { "type": "stack", "accepts": ["building.floor", "building.roof"] },
      "bottom": { "type": "stack", "accepts": ["building.base", "building.floor"] }
    },
    "rotation": { "allowed": true, "stepDegrees": 90 },
    "footprint": { "width": 2, "depth": 2, "height": 3 },
    "stacking": { "allowed": true },
    "wfc": {
      "weight": 4,
      "requiresSupport": true,
      "maxStackHeight": 8,
      "allowedZones": ["commercial", "residential"],
      "requiresFrontage": ["road", "sidewalk"]
    },
    "anchors": [
      {
        "id": "top",
        "position": { "x": 0, "y": 3, "z": 0 },
        "accepts": ["building_part", "roof_prop"]
      }
    ],
    "confidence": 0.78,
    "reviewStatus": "needs_review"
  }
}
```

The editor should expose label status later, but review and correction can begin as direct `asset.json` edits.

The first schema version should define these socket directions:

```ts
type SocketDirection = "north" | "east" | "south" | "west" | "top" | "bottom" | "front" | "back" | "left" | "right";
```

`north/east/south/west` support road, sidewalk, wall, fence, and tile adjacency. `top/bottom` support vertical stacking. `front/back/left/right` support facade attachments such as doors, signs, awnings, and storefront props.

Semantic labeling must stay future-proof as new asset types are added. The schema should have a stable core plus type-specific extensions:

```ts
interface AssetSemantics {
  schemaVersion: number;
  kind: AssetSemanticKind;
  label: string;
  description?: string;
  roles: string[];
  sockets?: Partial<Record<SocketDirection, SocketDefinition>>;
  rotation: RotationRule;
  footprint: Footprint;
  stacking?: StackingRule;
  anchors?: AnchorDefinition[];
  wfc?: WfcRules;
  extensions?: Record<string, unknown>;
  confidence: number;
  reviewStatus: "needs_review" | "approved";
}
```

```ts
type AssetSemanticKind =
  | "road_tile"
  | "building"
  | "building_part"
  | "vegetation"
  | "traffic_sign"
  | "prop"
  | "vehicle"
  | "character"
  | "terrain"
  | "unknown";

interface SocketDefinition {
  type: string;
  profile?: string;
  lanes?: number;
  agents?: AgentKind[];
  accepts?: string[];
}

interface RotationRule {
  allowed: boolean;
  stepDegrees: 1 | 5 | 15 | 30 | 45 | 90 | 180 | 360;
}

interface Footprint {
  width: number;
  depth: number;
  height: number;
}

interface StackingRule {
  allowed: boolean;
  maxHeight?: number;
  requiresSupport?: boolean;
}

interface AnchorDefinition {
  id: string;
  position: Vector3Data;
  accepts: string[];
}
```

Known V1 kinds are `road_tile`, `building`, `building_part`, `vegetation`, `traffic_sign`, `prop`, `vehicle`, `character`, `terrain`, and `unknown`. Future kinds such as `sidewalk`, `parking_space`, `traffic_light`, `bridge`, `barrier`, `sensor`, `charging_station`, or `simulation_marker` should be added by registering a validator for that kind and documenting its required roles/sockets. Existing generators ignore unknown kinds unless they declare support for them. Type-specific fields should go under a namespaced key in `extensions`, for example `extensions.avSensor`, so new kinds do not pollute the core schema.

## WFC Materialization Rules

The V1 materializer uses a WFC-style collapse process. Per-asset `wfc` rules are optional materialization hints. Sockets, roles, footprint, rotation, stacking, anchors, semantic zones, and traffic-control data provide the base constraints when an asset has no `wfc` block.

WFC rules help choose, rotate, stack, attach, and scatter visual assets. They must not define the semantic road network, AV route graph, lane connectivity, traffic-control truth, or simulator behavior.

WFC rules live inside `asset.json` semantics because they describe how a visual asset can be arranged with other visual assets. The semantic city remains asset-independent. The materializer may use WFC rules to produce better `VisualPlacement` choices for a generated layer.

```ts
interface WfcRules {
  weight?: number;
  forbidNeighbors?: NeighborRule[];
  preferNeighbors?: NeighborRule[];
  allowedZones?: string[];
  forbiddenZones?: string[];
  requiresFrontage?: string[];
  minDistanceByRole?: Record<string, number>;
  maxCountPerZone?: Record<string, number>;
  randomYaw?: boolean;
  requiresSupport?: boolean;
  maxStackHeight?: number;
  attachTo?: string[];
  placementSide?: Array<"left" | "right" | "both">;
  faceToward?: "road" | "incoming_lane" | "away_from_road" | "random";
}

interface NeighborRule {
  direction: SocketDirection;
  roles?: string[];
  socketTypes?: string[];
  socketProfiles?: string[];
}
```

WFC compatibility rules:

- Sockets are the primary adjacency rule.
- Adjacent assets are compatible when touching sockets have compatible `type`, `profile`, and required role constraints.
- Rotation transforms socket directions before matching.
- `weight` biases variant frequency without making a variant mandatory.
- `forbidNeighbors` blocks combinations even when sockets match.
- `preferNeighbors` biases layout when multiple valid placements exist.
- `requiresSupport` prevents floating stacked assets.
- `maxStackHeight` constrains vertical repetition.
- Distance and zone rules are evaluated against semantic placements and semantic zones, not against mesh bounds.
- Unknown WFC fields are ignored for forward compatibility.

Asset-type guidance:

- Roads use WFC primarily for connectivity, curb/sidewalk adjacency, medians, transitions, and visual variants.
- Buildings use WFC for lot fit, frontage, stack support, roof/floor/base compatibility, facade attachments, and zone suitability.
- Vegetation uses WFC for spacing, zone suitability, random yaw, and exclusion from roadways/intersections.
- Traffic signs use WFC for roadside attachment, lane/node applicability, side of travel, distance from intersections, and facing incoming lanes.
- Random props use WFC for scatter rules, allowed zones, forbidden zones, frequency weights, and minimum distances from similar props or safety-critical assets.

V1 must expose WFC in action as playback/debug UI. This is not a rule-authoring editor. It is a visible execution trace of the materializer so users can understand how the generated scene was assembled.

Playback requirements:

- Show the semantic layout phase before asset materialization begins.
- Show WFC candidate counts for cells or placements when available.
- Show collapse events as selected visual assets appear in the viewport or mini-map.
- Highlight unresolved cells or placements.
- Highlight rejected candidates with short reasons when the user selects a diagnostic row.
- Allow pause/resume and restart generation with the same inputs.
- Restarting with the same inputs must produce the same collapse sequence unless the user changes seed or metadata.
- Keep the final generated scene as the normal end state.
- Do not persist playback-only UI state in scene JSON.

```ts
interface GenerationTraceEvent {
  step: number;
  phase: "semantic_layout" | "wfc_materialization" | "asset_resolution" | "validation" | "apply";
  kind: "started" | "candidate_count" | "collapsed" | "rejected" | "unresolved" | "diagnostic" | "completed";
  message: string;
  semanticPlacementId?: string;
  cell?: { x: number; y: number; z: number };
  selectedAssetId?: string;
  candidateAssetIds?: string[];
  rejectedAssetIds?: string[];
  reason?: string;
}
```

Trace events are runtime/debug output. The generated layer may persist summary diagnostics, but it should not persist the full event stream unless a future debug-export feature asks for it.

Examples:

```json
{
  "kind": "vegetation",
  "roles": ["vegetation.tree"],
  "footprint": { "width": 1, "depth": 1, "height": 4 },
  "wfc": {
    "weight": 6,
    "allowedZones": ["park", "residential"],
    "forbiddenZones": ["roadway", "intersection"],
    "minDistanceByRole": {
      "vegetation.tree": 2,
      "road.surface": 1
    },
    "randomYaw": true
  }
}
```

```json
{
  "kind": "traffic_sign",
  "roles": ["traffic.sign.stop"],
  "wfc": {
    "attachTo": ["intersection.approach"],
    "placementSide": ["right"],
    "minDistanceByRole": {
      "traffic.sign.stop": 4
    },
    "faceToward": "incoming_lane"
  }
}
```

```json
{
  "kind": "prop",
  "roles": ["street.furniture.bench"],
  "wfc": {
    "weight": 2,
    "allowedZones": ["sidewalk", "park"],
    "forbiddenZones": ["roadway", "intersection"],
    "minDistanceByRole": {
      "street.furniture.bench": 3,
      "traffic.sign": 1
    },
    "randomYaw": true
  }
}
```

## Semantic City Model

Extend `Scene` with an optional semantic layer:

```ts
interface Scene {
  id: string;
  name: string;
  description: string;
  grid: GridDefinition;
  background: SurfaceAppearance;
  ground: SurfaceAppearance;
  objects: SceneObject[];
  semanticCity?: SemanticCity;
  generatedLayers?: GeneratedSceneLayer[];
}
```

`objects` remain the renderable source for the current editor. `semanticCity` is asset-visual-independent data for the generated map. It describes roads, lanes, intersections, navigation graph, blocks, lots, buildings, vegetation, props, stacked parts, and attachment relationships.

```ts
interface SemanticCity {
  id: string;
  schemaVersion: number;
  generatorId: string;
  generatorVersion: string;
  seed: number;
  generatorOptions: CityGeneratorOptions;
  bounds: { width: number; depth: number; cellSize: number };
  generatedAt: string;
  roads: SemanticRoad[];
  intersections: SemanticIntersection[];
  lanes: SemanticLane[];
  laneConnections: SemanticLaneConnection[];
  trafficControls: SemanticTrafficControl[];
  blocks: SemanticBlock[];
  lots: SemanticLot[];
  placements: SemanticPlacement[];
  spawnPoints: SemanticSpawnPoint[];
  destinations: SemanticDestination[];
  navigableGraph: NavigationGraph;
}

interface SemanticBlock {
  id: string;
  polygon: Vector3Data[];
  zone: "residential" | "commercial" | "industrial" | "park" | "mixed_use";
  lotIds: string[];
}

interface SemanticLot {
  id: string;
  blockId: string;
  polygon: Vector3Data[];
  zone: SemanticBlock["zone"];
  frontageRoadId?: string;
}

interface SemanticRoad {
  id: string;
  roadClass: "local" | "arterial" | "highway" | "service";
  centerline: Vector3Data[];
  width: number;
  speedLimit: number;
  laneIds: string[];
}

interface SemanticLane {
  id: string;
  roadId: string;
  centerline: Vector3Data[];
  direction: "forward" | "backward";
  allowedAgents: AgentKind[];
  speedLimit: number;
}

interface NavigationGraph {
  nodes: NavigationNode[];
  edges: NavigationEdge[];
}

interface NavigationNode {
  id: string;
  position: Vector3Data;
  kind: "intersection" | "lane_start" | "lane_end" | "merge" | "turn" | "spawn" | "destination";
}

interface NavigationEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  laneId?: string;
  length: number;
  speedLimit: number;
  allowedAgents: AgentKind[];
  turn?: "left" | "right" | "straight" | "u_turn";
}

interface SemanticPlacement {
  id: string;
  role: "road" | "intersection" | "building" | "building_part" | "vegetation" | "traffic_sign" | "prop" | "vehicle" | "character";
  assetRole: string;
  position: { x: number; y: number; z: number };
  rotationY: number;
  footprint: { width: number; depth: number; height: number };
  parentId?: string;
  anchorId?: string;
  level?: number;
}

interface GeneratedSceneLayer {
  id: string;
  semanticCityId: string;
  generatorId: string;
  generatorVersion: string;
  assetSet: {
    primaryPackId: string;
    packIds: string[];
    materializerVersion: string;
  };
  objectIds: string[];
  visualPlacements: VisualPlacement[];
  diagnostics: string[];
}

interface VisualPlacement {
  id: string;
  semanticPlacementId: string;
  objectId: string;
  assetId: string;
  position: Vector3Data;
  rotationY: number;
  scale: number;
}
```

Generated scene objects should carry enough provenance to support layer replacement:

```ts
interface SceneObject {
  id: string;
  assetId: string;
  name: string;
  position: Vector3Data;
  rotationY: number;
  scale: number;
  source?: {
    type: "manual" | "generated";
    layerId?: string;
    semanticPlacementId?: string;
  };
}
```

Existing objects without `source` are treated as manual. Replacing the active generated layer deletes only objects whose `source.type` is `"generated"` and whose `source.layerId` matches that layer.

Concrete `SceneObject` placement is derived from `GeneratedSceneLayer.visualPlacements`. `SemanticPlacement` remains asset-free; it describes what exists in the city, not which asset renders it. Semantic placements without resolved visual placements are diagnostics, not renderable objects.

Future AV route planning must consume `semanticCity.navigableGraph`, `roads`, `lanes`, `spawnPoints`, and `destinations`. It must not inspect `Scene.objects`, asset IDs, Three.js meshes, or GLB geometry to discover road topology.

## Roadmap Data Contract

The generated city must be usable as a future AV simulator road map. The saved `semanticCity` is the map data contract.

Coordinate and unit rules:

- Positions use the editor's world coordinates.
- `x` and `z` are horizontal ground-plane coordinates.
- `y` is vertical height.
- Distances, widths, lengths, and heights are stored in scene world units.
- `SemanticCity.bounds.cellSize` records the grid-to-world conversion used during generation.
- Road and lane centerlines must be ordered polylines.

Graph invariants:

- Every `SemanticRoad.laneIds` entry must refer to an existing `SemanticLane`.
- Every `SemanticLane.roadId` must refer to an existing `SemanticRoad`.
- Every navigation edge must refer to existing navigation nodes.
- Every edge with `laneId` must refer to an existing lane.
- Edge `length` must be positive.
- Lane direction and graph edge direction must agree.
- Intersections own turn connectivity through `laneConnections` and graph edges.
- Spawn points and destinations must map to navigation nodes.
- Traffic controls must reference existing roads, lanes, intersections, or graph nodes.

Minimum AV-ready fields:

```ts
type AgentKind = "vehicle" | "pedestrian" | "bicycle";

interface CityGeneratorOptions {
  width: number;
  depth: number;
  cellSize: number;
  seed?: number;
  roadDensity?: number;
  buildingDensity?: number;
  vegetationDensity?: number;
  verticalComplexity?: number;
}

interface SemanticIntersection {
  id: string;
  position: Vector3Data;
  roadIds: string[];
  laneConnectionIds: string[];
  trafficControlIds: string[];
}

interface SemanticLaneConnection {
  id: string;
  fromLaneId: string;
  toLaneId: string;
  intersectionId?: string;
  turn: "left" | "right" | "straight" | "u_turn" | "merge";
  yieldRequired: boolean;
}

interface SemanticTrafficControl {
  id: string;
  kind: "stop_sign" | "yield_sign" | "traffic_light" | "speed_limit" | "crosswalk";
  position: Vector3Data;
  appliesToLaneIds: string[];
  appliesToNodeIds: string[];
}

interface SemanticSpawnPoint {
  id: string;
  agentKind: AgentKind;
  nodeId: string;
  position: Vector3Data;
  headingRadians: number;
}

interface SemanticDestination {
  id: string;
  agentKind: AgentKind;
  nodeId: string;
  position: Vector3Data;
}
```

## Generator Pack Contract

Generator packs expose reusable logic. They produce semantic city data and materialization diagnostics. They operate on semantic metadata, not asset visuals or hard-coded scene object lists.

```ts
export const generatorPack = {
  id: "city.grid.v1",
  label: "Grid City",
  requiredCapabilities: ["roads", "buildings", "vegetation", "stacking", "trafficSigns"],
  requiredRoles: ["road.surface", "building.base", "building.floor", "vegetation", "traffic.sign"],
  requiredSocketTypes: ["road", "stack"],

  generateSemanticCity(options) {
    return semanticCity;
  },

  materialize(semanticCity, assetSet) {
    return { layer, objects, diagnostics };
  }
};
```

The first generator should be a built-in grid city generator. It should support:

- Deterministic seed.
- Grid-aligned road network.
- Road-tile grammar using sockets plus rotation.
- Blocks and lots derived from roads.
- AV-ready lanes, lane connections, spawn points, destinations, and navigation graph.
- Building placement by lot and zone.
- Optional stacked building parts using footprint height and anchors.
- Traffic sign placement tied to traffic controls and applicable lanes/nodes.
- Vegetation and props placed by semantic rules.
- Diagnostics when no asset satisfies a semantic role.

Asset-pack-specific scripts may provide materializer overrides, but they must remain reusable for the pack and avoid embedding one scene layout.

## Data Flow

```text
asset.json semantics
  -> asset semantics catalog
  -> generator options
  -> generateSemanticCity()
  -> materialize() + GenerationTraceEvent stream
  -> Project Panel WFC playback view
  -> Scene.semanticCity + Scene.generatedLayers + Scene.objects
  -> editor history command
  -> save scene JSON
```

Generation should create one editor command so the user can undo the applied generated scene. WFC playback state should be temporary and not saved. The applied output is the first persistent state.

## Project Panel UI

V1 UI:

- Primary asset pack selector populated from scanned `asset-pack.json` manifests. V1 initially recognizes `assets/city-kit-roads` and `assets/3d-road-tiles` as primary road-style packs when their manifests validate.
- Asset-set readiness summary for roads, buildings, vegetation, stacking, and traffic signs.
- Scene width and depth inputs.
- Cell size input.
- Generate Scene button.
- WFC playback panel with phase label, progress, pause/resume, restart, and diagnostic selection.

The Generate Scene button is disabled until the selected asset set satisfies all required V1 capabilities. During generation it enters a playback state and prevents duplicate submissions. If a generated layer already exists, the action text should make replacement clear before it runs, for example "Regenerate Layer".

The WFC playback panel should remain compact enough for the existing Project tab. It should summarize progress first and reveal detailed rejected-candidate reasons only when a user selects a diagnostic item. The viewport should show visible placement updates; the panel should explain what phase the user is seeing.

Future UI:

Add a generator section to the Project Panel:

- Generator pack selector.
- Seed input with randomize control.
- Block size range.
- Road density control.
- Building density control.
- Vegetation density control.
- Vertical complexity control.
- Apply action.
- Export generation trace action.
- Full WFC rule-authoring UI.

If assets are unlabeled, show a clear status and disable generation for required semantics that are missing. The UI should point users to the labeling script until in-app label review exists.

## Error Handling

- Missing required semantics: block apply and show diagnostics.
- Missing or invalid asset-pack manifest: disable that pack in the selector and show diagnostics.
- Invalid semantic metadata: exclude that asset from generation and show the exact schema issue.
- Low-confidence labels: allow WFC playback only when the user explicitly allows needs-review metadata, and mark the generated result as needing review.
- No matching road tile for a required topology: keep semantic road data, omit the render object, and report the missing topology.
- WFC stall or contradiction: stop playback, highlight unresolved cells/placements, keep semantic city data, and avoid applying incomplete visual objects unless the user explicitly allows partial output.
- Invalid generator output: reject it before mutating editor history.
- Save validation must allow `semanticCity` only when it matches the expected schema.
- Save validation must keep generated layer references consistent: every `GeneratedSceneLayer.objectIds` entry must exist in `Scene.objects`, every generated object must refer back to its layer, and every visual placement must map to an existing semantic placement and object.

## Testing and Verification

Follow the project preference: do not add unit tests unless explicitly requested. Verify the first implementation directly in the product experience:

- Label a small asset pack in dry-run mode.
- Confirm `assets/city-kit-roads` and `assets/3d-road-tiles` appear in the Project Panel only when their pack manifests validate.
- Generate a small city from labeled assets.
- Confirm roads use correct rotations from sockets.
- Confirm route-navigation data is present without needing asset IDs or mesh inspection.
- Confirm stacked assets have non-zero Y positions and parent/anchor relationships.
- Confirm WFC playback shows semantic layout, materialization progress, collapsed placements, unresolved placements, and diagnostics.
- Confirm pause/resume/restart work without corrupting the final generated layer.
- Confirm manual objects survive regeneration and only the active generated layer is replaced.
- Apply generation, undo, redo, save, reload.
- Confirm scene JSON contains renderable objects, `semanticCity`, and generated-layer materialization data.

## Implementation Order

1. Define shared semantic metadata schema and semantic city TypeScript types.
2. Define the asset-pack manifest schema and add manifests for `assets/city-kit-roads` and `assets/3d-road-tiles`.
3. Update the asset-labeling script to emit the strict `schemaVersion`, `roles`, `sockets`, `rotation`, `stacking`, and optional `wfc` metadata shape.
4. Extend asset metadata discovery to pass through and validate `semantics`.
5. Add server-side asset-pack scanning and compatibility diagnostics.
6. Extend scene normalization and validation for optional `semanticCity` and `generatedLayers`.
7. Allow generated scene objects to preserve non-zero `Y` positions for elevated and stacked assets.
8. Add built-in grid city generator and WFC-capable materializer that emits `GenerationTraceEvent` records.
9. Add temporary WFC playback state and viewport/panel visualization.
10. Add an editor command for applying generated scene output.
11. Add Project Panel V1 controls: supported primary asset pack, asset-set readiness, scene width/depth, cell size, Generate Scene, and WFC playback.
12. Verify in the browser with `assets/city-kit-roads` and `assets/3d-road-tiles`.
