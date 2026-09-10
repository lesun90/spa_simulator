import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { buildAdjacency } from "../src/wfc/metadata/buildAdjacency";
import { DEFAULT_WFC_TILE_SIZE } from "../src/wfc/sceneLayout";
import { wfcDirections, type RoadTopologyTag, type WfcDirection, type WfcMetadata, type WfcSocketMap, type WfcVariant } from "../src/wfc/metadata/socketTypes";

const DEFAULT_ASSET_ROOT = "assets/3d-road-tiles";
const GRID_SIZE = 16;
const EMPTY_CELL = "empty";
const POSITION_EPSILON_RATIO = 1 / 1000;
const TOP_SURFACE_NORMAL_Y_MIN = 0.65;

interface CliOptions {
  assetRoot: string;
  limit?: number;
  dryRun: boolean;
}

interface AssetFolder {
  folder: string;
  assetJsonFile: string;
  metadata: Record<string, unknown>;
  modelFile?: string;
}

type ExistingRoadTopology = ReadonlyMap<number, RoadTopologyTag>;

interface BoundarySample {
  geometry: string[][];
  visual: string[][];
  height: string[][];
}

interface TriangleSample {
  points: THREE.Vector3[];
  material: string;
}

interface TileSamples {
  bounds: THREE.Box3;
  height: number;
  triangles: TriangleSample[];
}

type PlaneAxis = "x" | "y" | "z";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    assetRoot: resolve(DEFAULT_ASSET_ROOT),
    dryRun: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };

    switch (arg) {
      case "--asset-root":
        options.assetRoot = resolve(next());
        break;
      case "--limit":
        options.limit = positiveInt(next(), "--limit");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function positiveInt(value: string, option: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer.`);
  return parsed;
}

function printHelp() {
  console.log(`
Generate WFC socket metadata for any single-cell GLB tile pack.

Usage:
  npx vite-node scripts/generateRoadTileWfcMetadata.ts [options]

Options:
  --asset-root <path>  Tile asset folder. Defaults to ${DEFAULT_ASSET_ROOT}
  --limit <count>      Only process the first N discovered assets.
  --dry-run            Print a summary without writing asset.json or adjacency output.
`);
}

async function main() {
  const options = parseArgs(process.argv);
  const folders = await discoverAssetFolders(options);
  const allVariants: WfcVariant[] = [];
  const diagnostics: string[] = [];
  let changed = 0;

  for (const asset of folders) {
    const { wfc, variants } = await generateWfcMetadata(asset);
    allVariants.push(...variants);

    if (options.dryRun) {
      console.log(`${assetId(asset)}: ${wfc.variants.length} variants, height ${wfc.height}, diagnostics ${wfc.diagnostics.length}`);
      continue;
    }

    const nextMetadata = { ...asset.metadata, wfc: { ...wfc, defaultWeight: existingDefaultWeight(asset.metadata.wfc) } };
    await writeJson(asset.assetJsonFile, nextMetadata);
    changed += 1;
  }

  const adjacency = buildAdjacency(allVariants);
  diagnostics.push(...validateAdjacencyReferences(adjacency, allVariants));
  const adjacencyFile = {
    version: 1 as const,
    assetRoot: relative(process.cwd(), options.assetRoot).split(sep).join("/"),
    generatedFrom: "asset.json#wfc.variants.sockets",
    adjacency,
    diagnostics
  };

  if (options.dryRun) {
    console.log(`dry run: ${allVariants.length} variants, ${Object.keys(adjacency).length} adjacency entries`);
  } else {
    await writeJson(join(options.assetRoot, "wfc-adjacency.json"), adjacencyFile);
    console.log(`updated ${changed} asset.json files and ${relative(process.cwd(), join(options.assetRoot, "wfc-adjacency.json"))}`);
  }
}

function existingDefaultWeight(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as { defaultWeight?: unknown }).defaultWeight;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function existingRoadTopologies(metadata: Record<string, unknown>): ExistingRoadTopology {
  const variants = (metadata.wfc as { variants?: unknown } | undefined)?.variants;
  if (!Array.isArray(variants)) return new Map();
  return new Map(variants.flatMap((variant) => {
    if (!variant || typeof variant !== "object") return [];
    const value = variant as { rotationDegrees?: unknown; roadTopology?: unknown };
    if (typeof value.rotationDegrees !== "number" || !isRoadTopologyTag(value.roadTopology)) return [];
    return [[value.rotationDegrees, value.roadTopology] as const];
  }));
}

function isRoadTopologyTag(value: unknown): value is RoadTopologyTag {
  if (!value || typeof value !== "object") return false;
  const tag = value as { kind?: unknown; edges?: unknown };
  return typeof tag.kind === "string" && !!tag.edges && typeof tag.edges === "object";
}

async function discoverAssetFolders(options: CliOptions): Promise<AssetFolder[]> {
  const entries = await readdir(options.assetRoot, { withFileTypes: true });
  const folders: AssetFolder[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    if (!entry.isDirectory()) continue;
    const folder = join(options.assetRoot, entry.name);
    const names = await readdir(folder);
    const assetJsonFile = join(folder, "asset.json");
    const modelName = names.find((name) => extname(name).toLowerCase() === ".glb");
    folders.push({
      folder,
      assetJsonFile,
      metadata: JSON.parse(await readFile(assetJsonFile, "utf8")) as Record<string, unknown>,
      modelFile: modelName ? join(folder, modelName) : undefined
    });
  }

  return typeof options.limit === "number" ? folders.slice(0, options.limit) : folders;
}

async function generateWfcMetadata(asset: AssetFolder): Promise<{ wfc: WfcMetadata; variants: WfcVariant[] }> {
  const diagnostics: string[] = [];
  const id = assetId(asset);
  const existingRoadTopology = existingRoadTopologies(asset.metadata);

  if (!asset.modelFile) {
    diagnostics.push("missing GLB model file");
    const wfc = { height: 0, variants: [], diagnostics };
    return { wfc, variants: [] };
  }

  const baseTile = await loadTileSamples(asset.modelFile);
  const footprint = baseTile.bounds.getSize(new THREE.Vector3());
  if (Math.abs(footprint.x - DEFAULT_WFC_TILE_SIZE) > 0.001 || Math.abs(footprint.z - DEFAULT_WFC_TILE_SIZE) > 0.001) {
    diagnostics.push(`Footprint ${round(footprint.x)} × ${round(footprint.z)} does not fill a ${DEFAULT_WFC_TILE_SIZE} × ${DEFAULT_WFC_TILE_SIZE} WFC cell; available for manual placement only.`);
    return { wfc: { height: round(baseTile.height), variants: [], diagnostics }, variants: [] };
  }
  const variants: WfcVariant[] = [];
  const seenSocketSets = new Map<string, number>();

  for (const rotationDegrees of [0, 90, 180, 270]) {
    const tile = rotateTileSamples(baseTile, rotationDegrees);
    const sockets = generateSocketMap(tile);
    const key = JSON.stringify(sockets);
    const existingRotation = seenSocketSets.get(key);

    if (existingRotation !== undefined) {
      diagnostics.push(`rotation ${rotationDegrees} duplicates rotation ${existingRotation}; variant omitted`);
      continue;
    }

    seenSocketSets.set(key, rotationDegrees);
    variants.push({
      variantId: `${id}@r${rotationDegrees}`,
      rotationDegrees,
      sockets,
      ...(existingRoadTopology.get(rotationDegrees) ? { roadTopology: existingRoadTopology.get(rotationDegrees) } : {})
    });
  }

  const baseSockets = generateSocketMap(baseTile);
  for (const direction of wfcDirections) {
    if (baseSockets[direction].includes(`${EMPTY_CELL}`)) diagnostics.push(`${direction} boundary contains empty sample cells`);
  }

  const wfc = {
    height: round(baseTile.height),
    variants,
    diagnostics
  };
  return { wfc, variants };
}

async function loadTileSamples(modelFile: string): Promise<TileSamples> {
  const data = await readFile(modelFile);
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader["parseAsync"]>>>((resolveLoaded, reject) => {
    new GLTFLoader().parse(arrayBuffer, "", resolveLoaded, reject);
  });
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(scene);
  const triangles: TriangleSample[] = [];

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;

    const index = geometry.getIndex();
    const materialForTriangle = materialResolver(object);
    const triangleCount = index ? index.count / 3 : position.count / 3;

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const points = [0, 1, 2].map((corner) => {
        const vertexIndex = index ? index.getX(triangleIndex * 3 + corner) : triangleIndex * 3 + corner;
        return new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(object.matrixWorld);
      });
      triangles.push({ points, material: materialForTriangle(triangleIndex) });
    }
  });

  return {
    bounds,
    height: bounds.max.y - bounds.min.y,
    triangles
  };
}

function generateSocketMap(tile: TileSamples): WfcSocketMap {
  const epsilon = Math.max(tile.bounds.getSize(new THREE.Vector3()).length() * POSITION_EPSILON_RATIO, 0.0001);

  return Object.fromEntries(
    wfcDirections.map((direction) => {
      const boundarySignature = socketSignature(sampleBoundary(tile, direction, epsilon));
      const signature =
        direction === "top" || direction === "bottom"
          ? boundarySignature
          : `${boundarySignature}|e:${topEdgeSignature(tile, direction)}`;
      return [direction, signature];
    })
  ) as WfcSocketMap;
}

function materialResolver(mesh: THREE.Mesh) {
  const material = mesh.material;
  if (!Array.isArray(material)) return () => materialName(material);

  const groups = [...mesh.geometry.groups].sort((a, b) => a.start - b.start);
  return (triangleIndex: number) => {
    const indexOffset = triangleIndex * 3;
    const group = groups.find((candidate) => indexOffset >= candidate.start && indexOffset < candidate.start + candidate.count);
    return materialName(material[group?.materialIndex ?? 0]);
  };
}

function materialName(material: THREE.Material | undefined) {
  return normalizeToken(material?.name || material?.type || "material");
}

function sampleBoundary(tile: TileSamples, direction: WfcDirection, epsilon: number): BoundarySample {
  const sample = createEmptyBoundarySample();
  const plane = boundaryPlane(tile.bounds, direction);

  for (const triangle of tile.triangles) {
    if (!triangleTouchesPlane(triangle, plane, epsilon)) continue;

    const projected = triangle.points.map((point) => projectToBoundary(point, tile.bounds, direction));
    const minU = Math.min(...projected.map((point) => point.u));
    const maxU = Math.max(...projected.map((point) => point.u));
    const minV = Math.min(...projected.map((point) => point.v));
    const maxV = Math.max(...projected.map((point) => point.v));
    const startU = clampGridIndex(Math.floor(minU * GRID_SIZE));
    const endU = clampGridIndex(Math.floor(maxU * GRID_SIZE));
    const startV = clampGridIndex(Math.floor(minV * GRID_SIZE));
    const endV = clampGridIndex(Math.floor(maxV * GRID_SIZE));

    for (let v = startV; v <= endV; v += 1) {
      for (let u = startU; u <= endU; u += 1) {
        const center = { u: (u + 0.5) / GRID_SIZE, v: (v + 0.5) / GRID_SIZE };
        if (pointInProjectedTriangle(center, projected)) {
          sample.geometry[v][u] = "solid";
          sample.visual[v][u] = triangle.material;
        }
      }
    }
  }

  return sample;
}

function createEmptyBoundarySample(): BoundarySample {
  return {
    geometry: Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => EMPTY_CELL)),
    visual: Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => EMPTY_CELL)),
    height: Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => EMPTY_CELL))
  };
}

function boundaryPlane(bounds: THREE.Box3, direction: WfcDirection): { axis: PlaneAxis; value: number } {
  switch (direction) {
    case "north":
      return { axis: "z" as const, value: bounds.max.z };
    case "east":
      return { axis: "x" as const, value: bounds.max.x };
    case "south":
      return { axis: "z" as const, value: bounds.min.z };
    case "west":
      return { axis: "x" as const, value: bounds.min.x };
    case "top":
      return { axis: "y" as const, value: bounds.max.y };
    case "bottom":
      return { axis: "y" as const, value: bounds.min.y };
  }
}

function triangleTouchesPlane(triangle: TriangleSample, plane: { axis: PlaneAxis; value: number }, epsilon: number) {
  return triangle.points.every((point) => Math.abs(point[plane.axis] - plane.value) <= epsilon);
}

function projectToBoundary(point: THREE.Vector3, bounds: THREE.Box3, direction: WfcDirection) {
  // Neighboring tiles share a footprint, not a maximum height. Normalizing each
  // side to its own height stretched a flat grass edge differently from the same
  // grass edge on a road tile whose curb extends higher inside the tile.
  const verticalExtent = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
  const vertical = normalized(point.y, 0, verticalExtent);
  switch (direction) {
    case "north":
      return { u: normalized(point.x, bounds.min.x, bounds.max.x), v: vertical };
    case "south":
      return { u: normalized(point.x, bounds.min.x, bounds.max.x), v: vertical };
    case "east":
      return { u: normalized(point.z, bounds.min.z, bounds.max.z), v: vertical };
    case "west":
      return { u: normalized(point.z, bounds.min.z, bounds.max.z), v: vertical };
    case "top":
    case "bottom":
      return { u: normalized(point.x, bounds.min.x, bounds.max.x), v: normalized(point.z, bounds.min.z, bounds.max.z) };
  }
}

function normalized(value: number, min: number, max: number) {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function clampGridIndex(value: number) {
  return Math.min(GRID_SIZE - 1, Math.max(0, value));
}

function pointInProjectedTriangle(point: { u: number; v: number }, triangle: Array<{ u: number; v: number }>) {
  const [a, b, c] = triangle;
  const denominator = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v);
  if (Math.abs(denominator) < Number.EPSILON) return false;

  const alpha = ((b.v - c.v) * (point.u - c.u) + (c.u - b.u) * (point.v - c.v)) / denominator;
  const beta = ((c.v - a.v) * (point.u - c.u) + (a.u - c.u) * (point.v - c.v)) / denominator;
  const gamma = 1 - alpha - beta;
  return alpha >= -0.001 && beta >= -0.001 && gamma >= -0.001;
}

function socketSignature(sample: BoundarySample) {
  return `g:${gridSignature(sample.geometry)}|v:${gridSignature(sample.visual)}`;
}

/** Sample the actual seam, not an inset row or a triangle's highest vertex.
 * Interpolating the surface plane makes ramps meet flat roads at their true height.
 */
function topEdgeSignature(tile: TileSamples, direction: WfcDirection) {
  const geometry: string[] = [];
  const visual: string[] = [];
  const heights: string[] = [];
  const inset = 0.000001;
  for (let index = 0; index < GRID_SIZE; index += 1) {
    const along = (index + 0.5) / GRID_SIZE;
    const u = direction === "east" ? 1 - inset : direction === "west" ? inset : along;
    const v = direction === "north" ? 1 - inset : direction === "south" ? inset : along;
    const x = THREE.MathUtils.lerp(tile.bounds.min.x, tile.bounds.max.x, u);
    const z = THREE.MathUtils.lerp(tile.bounds.min.z, tile.bounds.max.z, v);
    let height = -Infinity;
    let material = EMPTY_CELL;
    for (const triangle of tile.triangles) {
      const [a, b, c] = triangle.points;
      const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
      if (normal.y < TOP_SURFACE_NORMAL_Y_MIN) continue;
      const projected = triangle.points.map((point) => ({ u: point.x, v: point.z }));
      if (!pointInProjectedTriangle({ u: x, v: z }, projected)) continue;
      const y = a.y - (normal.x * (x - a.x) + normal.z * (z - a.z)) / normal.y;
      if (y < height - 0.00001) continue;
      height = y;
      material = triangle.material;
    }
    geometry.push(Number.isFinite(height) ? "solid" : EMPTY_CELL);
    visual.push(material);
    heights.push(Number.isFinite(height) ? heightToken(height) : EMPTY_CELL);
  }
  return `g:${gridSignature([geometry])}|v:${gridSignature([visual])}|h:${gridSignature([heights])}`;
}

function gridSignature(grid: string[][], tokenNormalizer: (value: string) => string = normalizeToken) {
  return grid.map((row) => row.map(tokenNormalizer).join(",")).join("/");
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "unnamed";
}

function heightToken(value: number) {
  return `y${Number(value.toFixed(3))}`;
}

function rotateTileSamples(tile: TileSamples, rotationDegrees: number): TileSamples {
  if (rotationDegrees === 0) return tile;

  const center = tile.bounds.getCenter(new THREE.Vector3());
  const matrix = new THREE.Matrix4()
    .makeTranslation(-center.x, -center.y, -center.z)
    .premultiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(rotationDegrees)))
    .premultiply(new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
  const triangles = tile.triangles.map((triangle) => ({
    material: triangle.material,
    points: triangle.points.map((point) => point.clone().applyMatrix4(matrix))
  }));
  const bounds = new THREE.Box3();

  for (const triangle of triangles) {
    for (const point of triangle.points) bounds.expandByPoint(point);
  }

  return {
    bounds,
    height: bounds.max.y - bounds.min.y,
    triangles
  };
}

function validateAdjacencyReferences(adjacency: Record<string, Record<WfcDirection, string[]>>, variants: WfcVariant[]) {
  const variantIds = new Set(variants.map((variant) => variant.variantId));
  const diagnostics: string[] = [];

  for (const [variantId, entry] of Object.entries(adjacency)) {
    for (const direction of wfcDirections) {
      for (const candidate of entry[direction]) {
        if (!variantIds.has(candidate)) diagnostics.push(`${variantId}.${direction} references unknown variant ${candidate}`);
      }
    }
  }

  return diagnostics;
}

function assetId(asset: AssetFolder) {
  const id = asset.metadata.id;
  return typeof id === "string" ? id : `3d-road-tiles.${basename(asset.folder)}`;
}

function round(value: number) {
  return Number(value.toFixed(6));
}

async function writeJson(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
