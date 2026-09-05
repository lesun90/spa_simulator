import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { buildAssetFolder } from "./buildAssetFolder";

type ObjVertex = [number, number, number];
type ObjUv = [number, number];
type ObjNormal = [number, number, number];

interface ObjRef {
  vertex: number;
  uv?: number;
  normal?: number;
}

interface ObjFace {
  material: string;
  refs: ObjRef[];
}

interface ObjModel {
  vertices: ObjVertex[];
  uvs: ObjUv[];
  normals: ObjNormal[];
  faces: ObjFace[];
}

interface MaterialDefinition {
  name: string;
  diffuse: THREE.Color;
}

interface ReimportOptions {
  sourceRoot: string;
  assetRoot: string;
  workRoot: string;
}

class NodeFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }

  readAsDataURL(blob: Blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        const base64 = Buffer.from(buffer).toString("base64");
        this.result = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

if (!("FileReader" in globalThis)) {
  Object.assign(globalThis, { FileReader: NodeFileReader });
}

export async function reimportRoadTilesFromObj(options: ReimportOptions) {
  const modelsRoot = join(options.sourceRoot, "Models");
  const files = (await readdir(modelsRoot))
    .filter((file) => /^roadTile_\d+\.obj$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  await rm(join(options.assetRoot, "3d-road-tiles"), { recursive: true, force: true });
  await rm(options.workRoot, { recursive: true, force: true });
  await mkdir(options.workRoot, { recursive: true });

  const built = [];
  for (const file of files) {
    const sourceName = basename(file, ".obj");
    const assetName = slug(sourceName);
    const objFile = join(modelsRoot, file);
    const mtlFile = join(modelsRoot, `${sourceName}.mtl`);
    const glbFile = join(options.workRoot, `${assetName}.glb`);

    const materials = await readMaterials(mtlFile);
    const model = await readObj(objFile);
    const scene = buildScene(model, materials, sourceName);
    await writeGlb(scene, glbFile);

    built.push(
      await buildAssetFolder({
        assetRoot: options.assetRoot,
        category: "3d-road-tiles",
        glbFile,
        assetName,
        label: labelFromAssetName(assetName),
        overwrite: true
      })
    );
  }

  return built;
}

async function readObj(file: string): Promise<ObjModel> {
  const vertices: ObjVertex[] = [];
  const uvs: ObjUv[] = [];
  const normals: ObjNormal[] = [];
  const faces: ObjFace[] = [];
  let material = "Default";

  for (const rawLine of (await readFile(file, "utf8")).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [kind, ...tokens] = line.split(/\s+/);

    if (kind === "v") {
      vertices.push([Number(tokens[0]), Number(tokens[1]), Number(tokens[2])]);
    } else if (kind === "vt") {
      uvs.push([Number(tokens[0]), Number(tokens[1])]);
    } else if (kind === "vn") {
      normals.push([Number(tokens[0]), Number(tokens[1]), Number(tokens[2])]);
    } else if (kind === "usemtl") {
      material = tokens.join(" ") || "Default";
    } else if (kind === "f") {
      faces.push({ material, refs: tokens.map((token) => parseObjRef(token, vertices.length, uvs.length, normals.length)) });
    }
  }

  return { vertices, uvs, normals, faces };
}

function parseObjRef(token: string, vertexCount: number, uvCount: number, normalCount: number): ObjRef {
  const [vertex, uv, normal] = token.split("/");
  return {
    vertex: resolveObjIndex(Number(vertex), vertexCount),
    uv: uv ? resolveObjIndex(Number(uv), uvCount) : undefined,
    normal: normal ? resolveObjIndex(Number(normal), normalCount) : undefined
  };
}

function resolveObjIndex(index: number, count: number) {
  if (index > 0) return index - 1;
  if (index < 0) return count + index;
  throw new Error("OBJ indices are 1-based.");
}

async function readMaterials(file: string): Promise<Map<string, MaterialDefinition>> {
  const materials = new Map<string, MaterialDefinition>();
  let current: MaterialDefinition | undefined;

  try {
    for (const rawLine of (await readFile(file, "utf8")).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const [kind, ...tokens] = line.split(/\s+/);

      if (kind === "newmtl") {
        current = { name: tokens.join(" ") || "Material", diffuse: new THREE.Color(0xffffff) };
        materials.set(current.name, current);
      } else if (kind === "Kd" && current) {
        current.diffuse = new THREE.Color(Number(tokens[0]), Number(tokens[1]), Number(tokens[2]));
      }
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  return materials;
}

function buildScene(model: ObjModel, materials: Map<string, MaterialDefinition>, name: string) {
  const scene = new THREE.Scene();
  scene.name = name;
  const facesByMaterial = groupFacesByMaterial(model.faces);
  const originOffset = centerOffset(model.vertices);

  for (const [materialName, faces] of facesByMaterial) {
    const geometry = buildGeometry(model, faces, originOffset);
    const materialDefinition = materials.get(materialName);
    const material = new THREE.MeshStandardMaterial({
      name: materialName,
      color: materialDefinition?.diffuse ?? new THREE.Color(0xffffff),
      roughness: 0.9,
      metalness: 0,
      flatShading: true
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${name}_${materialName}`;
    scene.add(mesh);
  }

  return scene;
}

function groupFacesByMaterial(faces: ObjFace[]) {
  const groups = new Map<string, ObjFace[]>();
  for (const face of faces) {
    const group = groups.get(face.material) ?? [];
    group.push(face);
    groups.set(face.material, group);
  }
  return groups;
}

function buildGeometry(model: ObjModel, faces: ObjFace[], originOffset: ObjVertex) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (const face of faces) {
    for (const [a, b, c] of triangulateFace(model, face)) {
      for (const ref of [face.refs[a], face.refs[b], face.refs[c]]) {
        const vertex = model.vertices[ref.vertex];
        const normal = ref.normal === undefined ? undefined : model.normals[ref.normal];
        const uv = ref.uv === undefined ? undefined : model.uvs[ref.uv];
        positions.push(vertex[0] + originOffset[0], vertex[1] + originOffset[1], vertex[2] + originOffset[2]);
        normals.push(...(normal ?? faceNormal(model.vertices[face.refs[a].vertex], model.vertices[face.refs[b].vertex], model.vertices[face.refs[c].vertex])));
        uvs.push(uv?.[0] ?? 0, uv?.[1] ?? 0);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function centerOffset(vertices: ObjVertex[]): ObjVertex {
  const bounds = vertices.reduce(
    (result, vertex) => ({
      minX: Math.min(result.minX, vertex[0]),
      maxX: Math.max(result.maxX, vertex[0]),
      minZ: Math.min(result.minZ, vertex[2]),
      maxZ: Math.max(result.maxZ, vertex[2])
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  );
  return [-(bounds.minX + bounds.maxX) / 2, 0, -(bounds.minZ + bounds.maxZ) / 2];
}

function triangulateFace(model: ObjModel, face: ObjFace): Array<[number, number, number]> {
  if (face.refs.length < 3) return [];
  if (face.refs.length === 3) return [[0, 1, 2]];

  const projection = projectionAxes(model, face);
  const points = face.refs.map((ref) => {
    const vertex = model.vertices[ref.vertex];
    return new THREE.Vector2(vertex[projection.u], vertex[projection.v]);
  });
  const triangles = THREE.ShapeUtils.triangulateShape(points, []);
  const normal = polygonNormal(model, face);

  return triangles.map(([a, b, c]) => {
    const triangleNormal = faceNormal(model.vertices[face.refs[a].vertex], model.vertices[face.refs[b].vertex], model.vertices[face.refs[c].vertex]);
    return dot(triangleNormal, normal) < 0 ? [a, c, b] : [a, b, c];
  });
}

function projectionAxes(model: ObjModel, face: ObjFace) {
  const normal = polygonNormal(model, face);
  const absolute = normal.map(Math.abs);
  if (absolute[1] >= absolute[0] && absolute[1] >= absolute[2]) return { u: 0, v: 2 };
  if (absolute[0] >= absolute[2]) return { u: 1, v: 2 };
  return { u: 0, v: 1 };
}

function polygonNormal(model: ObjModel, face: ObjFace): ObjVertex {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < face.refs.length; index += 1) {
    const current = model.vertices[face.refs[index].vertex];
    const next = model.vertices[face.refs[(index + 1) % face.refs.length].vertex];
    x += (current[1] - next[1]) * (current[2] + next[2]);
    y += (current[2] - next[2]) * (current[0] + next[0]);
    z += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return normalize([x, y, z]);
}

function faceNormal(a: ObjVertex, b: ObjVertex, c: ObjVertex): ObjVertex {
  return normalize(cross(subtract(b, a), subtract(c, a)));
}

function subtract(a: ObjVertex, b: ObjVertex): ObjVertex {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: ObjVertex, b: ObjVertex): ObjVertex {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: ObjVertex, b: ObjVertex) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(value: ObjVertex): ObjVertex {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length === 0) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

async function writeGlb(scene: THREE.Scene, file: string) {
  await mkdir(dirname(file), { recursive: true });
  const exporter = new GLTFExporter();
  const result = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(scene, (glb) => resolve(glb as ArrayBuffer), reject, { binary: true });
  });
  await writeFile(file, Buffer.from(result));
}

function slug(value: string) {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "") || "asset"
  );
}

function labelFromAssetName(assetName: string) {
  return assetName
    .split("-")
    .filter(Boolean)
    .map((part) => (part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function parseArgs(argv: string[]): ReimportOptions {
  const options: ReimportOptions = {
    sourceRoot: "temp_assets/3d-road-tiles",
    assetRoot: "assets",
    workRoot: ".tmp/road-tiles-obj-glb"
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-root") {
      options.sourceRoot = argv[++index];
    } else if (arg === "--asset-root") {
      options.assetRoot = argv[++index];
    } else if (arg === "--work-root") {
      options.workRoot = argv[++index];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    sourceRoot: resolve(options.sourceRoot),
    assetRoot: resolve(options.assetRoot),
    workRoot: resolve(options.workRoot)
  };
}

async function exists(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function main(argv: string[]) {
  const options = parseArgs(argv);
  if (!(await exists(options.sourceRoot))) throw new Error(`Missing source root: ${options.sourceRoot}`);
  const built = await reimportRoadTilesFromObj(options);
  console.log(`Reimported ${built.length} road tile assets into ${options.assetRoot}`);
}

main(process.argv).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
