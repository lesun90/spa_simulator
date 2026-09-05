import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".ktx2"]);
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

interface SidecarFile {
  sourceFile: string;
  targetRelativePath: string;
}

export interface BuildAssetFolderOptions {
  assetRoot: string;
  category: string;
  glbFile: string;
  assetName?: string;
  label?: string;
  textureFiles?: string[];
  sidecarFiles?: SidecarFile[];
  thumbnailFile?: string;
  overwrite?: boolean;
}

export interface ImportTempAssetsOptions {
  tempRoot: string;
  assetRoot: string;
  overwrite?: boolean;
}

export interface BuiltAssetFolder {
  id: string;
  label: string;
  category: string;
  folder: string;
}

export async function buildAssetFolder(options: BuildAssetFolderOptions): Promise<BuiltAssetFolder> {
  const category = categorySlug(options.category || "imports");
  const assetName = slug(options.assetName ?? basename(options.glbFile, extname(options.glbFile)));
  const label = options.label ?? labelFromAssetName(assetName);
  const folder = join(options.assetRoot, category, assetName);
  const modelFile = join(folder, `${assetName}.glb`);
  const id = `${category}.${assetName}`;

  if (!options.overwrite && (await exists(modelFile))) {
    throw new Error(`Asset already exists: ${relative(process.cwd(), folder)}`);
  }

  if (options.overwrite) {
    await rm(folder, { recursive: true, force: true });
  }

  await mkdir(folder, { recursive: true });
  const sourceGlb = await readModelAsGlb(options.glbFile);
  const embedded = await embedGlbTextureImages(sourceGlb, [
    ...uniquePaths(options.textureFiles ?? []).map((file) => ({ sourceFile: file, targetRelativePath: basename(file) })),
    ...uniqueSidecarFiles(options.sidecarFiles ?? [])
  ]);
  if (embedded) {
    await writeFile(modelFile, embedded.glb);
  } else {
    await writeFile(modelFile, sourceGlb);
  }

  await copySidecarFiles(folder, uniquePaths(options.textureFiles ?? []).filter((file) => !embedded?.embeddedSourceFiles.has(file)));

  if (options.thumbnailFile) {
    await copyFile(options.thumbnailFile, join(folder, basename(options.thumbnailFile)));
  }

  await writeFile(join(folder, "asset.json"), `${JSON.stringify({ id, label, category }, null, 2)}\n`);
  return { id, label, category, folder };
}

export async function importTempAssets(options: ImportTempAssetsOptions): Promise<BuiltAssetFolder[]> {
  const entries = await readdir(options.tempRoot, { withFileTypes: true });
  const kitFolders = entries.filter((entry) => entry.isDirectory()).map((entry) => join(options.tempRoot, entry.name));
  const built: BuiltAssetFolder[] = [];

  for (const kitFolder of kitFolders.sort()) {
    const baseCategory = normalizeCategoryName(basename(kitFolder));
    const glbFiles = await findFiles(kitFolder, (file) => [".glb", ".gltf"].includes(extname(file).toLowerCase()));
    const textureFiles = await findTextureFiles(join(kitFolder, "Models"));
    const previewFiles = await findFiles(join(kitFolder, "Previews"), (file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()));
    const previewByAsset = new Map(previewFiles.map((file) => [basename(file, extname(file)), file]));

    for (const glbFile of glbFiles.sort()) {
      const sourceAssetName = slug(basename(glbFile, extname(glbFile)));
      const variant = variantSuffix(sourceAssetName);
      const assetName = variant ? sourceAssetName.replace(/-[a-z]$/i, "") : sourceAssetName;
      const category = variant ? `${baseCategory}-${variant}` : baseCategory;
      const sidecarFiles = textureSidecarsForAsset(glbFile, sourceAssetName, textureFiles);
      built.push(
        await buildAssetFolder({
          assetRoot: options.assetRoot,
          category,
          glbFile,
          assetName,
          textureFiles: [],
          sidecarFiles: sidecarFiles.relativeFiles,
          thumbnailFile: previewByAsset.get(sourceAssetName),
          overwrite: options.overwrite
        })
      );
    }
  }

  return built.sort((a, b) => a.id.localeCompare(b.id));
}

export function normalizeCategoryName(name: string) {
  return slug(name.replace(/_(?:\d+(?:\.\d+)?)$/, ""));
}

export function labelFromAssetName(assetName: string) {
  return assetName
    .split("-")
    .filter(Boolean)
    .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function variantSuffix(assetName: string) {
  const match = assetName.match(/-([a-z])$/);
  return match ? match[1].toUpperCase() : undefined;
}

function textureSidecarsForAsset(glbFile: string, assetName: string, textureFiles: string[]) {
  const variant = variantSuffix(assetName);
  const variantToken = variant ? `-${variant.toLowerCase()}` : undefined;
  const relativeFiles: SidecarFile[] = [];
  const flatFiles: string[] = [];

  for (const file of textureFiles) {
    const relativePath = relative(dirname(glbFile), file);
    if (!relativePath.startsWith("..") && !relativePath.startsWith("/") && !relativePath.startsWith("\\")) {
      relativeFiles.push({ sourceFile: file, targetRelativePath: relativePath });
    } else if (!variantToken || basename(file, extname(file)).toLowerCase().endsWith(variantToken)) {
      flatFiles.push(file);
    }
  }

  return { relativeFiles, flatFiles };
}

async function copySidecarFiles(folder: string, files: string[]) {
  for (const file of files) {
    await copyFile(file, join(folder, basename(file)));
  }
}

async function findFiles(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return findFiles(path, predicate);
      return entry.isFile() && predicate(path) ? [path] : [];
    })
  );
  return files.flat();
}

async function findTextureFiles(modelsRoot: string) {
  return findFiles(modelsRoot, (file) => {
    const parts = file.split(/[\\/]/);
    return parts.includes("Textures") && IMAGE_EXTENSIONS.has(extname(file).toLowerCase());
  });
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths)];
}

function uniqueSidecarFiles(files: SidecarFile[]) {
  const byTarget = new Map<string, SidecarFile>();
  for (const file of files) {
    byTarget.set(file.targetRelativePath, file);
  }
  return [...byTarget.values()];
}

async function readModelAsGlb(modelFile: string) {
  if (extname(modelFile).toLowerCase() === ".gltf") return convertGltfToGlb(modelFile);
  return readFile(modelFile);
}

async function convertGltfToGlb(gltfFile: string) {
  const json = JSON.parse(await readFile(gltfFile, "utf8")) as {
    buffers?: Array<{ byteLength?: number; uri?: string }>;
    bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength?: number }>;
  };
  const sourceBuffers = json.buffers ?? [];
  const chunks: Buffer[] = [];
  const bufferOffsets: number[] = [];

  for (const buffer of sourceBuffers) {
    const nextOffset = align4(chunks.reduce((length, chunk) => length + chunk.length, 0));
    const padding = nextOffset - chunks.reduce((length, chunk) => length + chunk.length, 0);
    if (padding > 0) chunks.push(Buffer.alloc(padding));

    bufferOffsets.push(nextOffset);
    chunks.push(await readGltfBuffer(gltfFile, buffer));
  }

  for (const bufferView of json.bufferViews ?? []) {
    const bufferIndex = bufferView.buffer ?? 0;
    bufferView.byteOffset = (bufferView.byteOffset ?? 0) + (bufferOffsets[bufferIndex] ?? 0);
    bufferView.buffer = 0;
  }

  const bin = Buffer.concat(chunks);
  json.buffers = [{ byteLength: bin.length }];
  return writeGlb(json, bin);
}

async function readGltfBuffer(gltfFile: string, buffer: { uri?: string }) {
  if (!buffer.uri) return Buffer.alloc(0);
  if (buffer.uri.startsWith("data:")) return bufferFromDataUri(buffer.uri);
  return readFile(join(dirname(gltfFile), normalizeUri(buffer.uri)));
}

function bufferFromDataUri(uri: string) {
  const marker = ";base64,";
  const markerIndex = uri.indexOf(marker);
  if (markerIndex === -1) throw new Error("Only base64 glTF data URIs are supported.");
  return Buffer.from(uri.slice(markerIndex + marker.length), "base64");
}

async function embedGlbTextureImages(glb: Buffer, textureFiles: SidecarFile[]) {
  const parsed = parseGlb(glb);
  if (!parsed) return undefined;

  const texturesByUri = new Map(textureFiles.map((file) => [normalizeUri(file.targetRelativePath), file.sourceFile]));
  const texturesByName = new Map(textureFiles.map((file) => [basename(file.targetRelativePath), file.sourceFile]));
  const json = parsed.json as {
    buffers?: Array<{ byteLength?: number }>;
    bufferViews?: Array<Record<string, unknown>>;
    images?: Array<{ uri?: string; bufferView?: number; mimeType?: string }>;
  };

  let bin = parsed.bin;
  let changed = false;
  const embeddedSourceFiles = new Set<string>();
  json.bufferViews ??= [];
  json.buffers ??= [{ byteLength: bin.length }];

  for (const image of json.images ?? []) {
    if (!image.uri || image.uri.startsWith("data:")) continue;
    const normalizedUri = normalizeUri(image.uri);
    const imageFile = texturesByUri.get(normalizedUri) ?? texturesByName.get(basename(normalizedUri));
    if (!imageFile) continue;

    const imageBytes = await readFile(imageFile);
    const byteOffset = align4(bin.length);
    if (byteOffset > bin.length) {
      bin = Buffer.concat([bin, Buffer.alloc(byteOffset - bin.length)]);
    }
    const bufferView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: imageBytes.length });
    bin = Buffer.concat([bin, imageBytes]);

    delete image.uri;
    image.bufferView = bufferView;
    image.mimeType = mimeTypeForImage(imageFile);
    embeddedSourceFiles.add(imageFile);
    changed = true;
  }

  if (!changed) return undefined;
  json.buffers[0].byteLength = bin.length;
  return { glb: writeGlb(json, bin), embeddedSourceFiles };
}

function parseGlb(glb: Buffer) {
  if (glb.length < 20 || glb.readUInt32LE(0) !== GLB_MAGIC || glb.readUInt32LE(4) !== 2) return undefined;
  const jsonLength = glb.readUInt32LE(12);
  const jsonType = glb.readUInt32LE(16);
  if (jsonType !== JSON_CHUNK_TYPE) return undefined;

  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength;
  if (jsonEnd > glb.length) return undefined;
  const json = JSON.parse(glb.subarray(jsonStart, jsonEnd).toString("utf8").trimEnd()) as unknown;

  const binHeader = jsonEnd;
  if (binHeader + 8 > glb.length) return { json, bin: Buffer.alloc(0) };
  const binLength = glb.readUInt32LE(binHeader);
  const binType = glb.readUInt32LE(binHeader + 4);
  if (binType !== BIN_CHUNK_TYPE) return { json, bin: Buffer.alloc(0) };
  return { json, bin: glb.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function writeGlb(json: unknown, bin: Buffer) {
  const jsonBuffer = padBuffer(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binBuffer = padBuffer(bin, 0x00);
  const length = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
  const glb = Buffer.alloc(length);
  glb.writeUInt32LE(GLB_MAGIC, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(length, 8);
  glb.writeUInt32LE(jsonBuffer.length, 12);
  glb.writeUInt32LE(JSON_CHUNK_TYPE, 16);
  jsonBuffer.copy(glb, 20);
  glb.writeUInt32LE(binBuffer.length, 20 + jsonBuffer.length);
  glb.writeUInt32LE(BIN_CHUNK_TYPE, 24 + jsonBuffer.length);
  binBuffer.copy(glb, 28 + jsonBuffer.length);
  return glb;
}

function padBuffer(buffer: Buffer, padByte: number) {
  const paddedLength = align4(buffer.length);
  return paddedLength === buffer.length ? buffer : Buffer.concat([buffer, Buffer.alloc(paddedLength - buffer.length, padByte)]);
}

function align4(value: number) {
  return Math.ceil(value / 4) * 4;
}

function normalizeUri(uri: string) {
  return uri.replace(/\\/g, "/");
}

function mimeTypeForImage(file: string) {
  switch (extname(file).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ktx2":
      return "image/ktx2";
    default:
      return "image/png";
  }
}

async function exists(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
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

function categorySlug(value: string) {
  const variantMatch = value.match(/^(.*)-([a-z])$/i);
  if (variantMatch) {
    return `${slug(variantMatch[1])}-${variantMatch[2].toUpperCase()}`;
  }
  return slug(value);
}

interface CliOptions {
  tempRoot?: string;
  assetRoot: string;
  glbFile?: string;
  category?: string;
  assetName?: string;
  label?: string;
  textureFiles: string[];
  textureRoot?: string;
  thumbnailFile?: string;
  overwrite: boolean;
}

export async function runCli(argv: string[]) {
  const options = parseArgs(argv);
  const assetRoot = resolve(options.assetRoot);

  if (options.glbFile) {
    if (!options.category) throw new Error("--category is required with --glb");
    const textureFiles = [
      ...options.textureFiles.map((file) => resolve(file)),
      ...(options.textureRoot
        ? await findFiles(resolve(options.textureRoot), (file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
        : [])
    ];
    const entry = await buildAssetFolder({
      assetRoot,
      category: options.category,
      glbFile: resolve(options.glbFile),
      assetName: options.assetName,
      label: options.label,
      textureFiles,
      thumbnailFile: options.thumbnailFile ? resolve(options.thumbnailFile) : undefined,
      overwrite: options.overwrite
    });
    console.log(`Built ${entry.id} at ${relative(process.cwd(), entry.folder)}`);
    return;
  }

  const entries = await importTempAssets({
    tempRoot: resolve(options.tempRoot ?? "temp_assets"),
    assetRoot,
    overwrite: options.overwrite
  });
  console.log(`Imported ${entries.length} assets into ${relative(process.cwd(), assetRoot)}`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    assetRoot: "assets",
    textureFiles: [],
    overwrite: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case "--temp-root":
        options.tempRoot = next();
        break;
      case "--asset-root":
        options.assetRoot = next();
        break;
      case "--glb":
        options.glbFile = next();
        break;
      case "--category":
        options.category = next();
        break;
      case "--asset-name":
        options.assetName = next();
        break;
      case "--label":
        options.label = next();
        break;
      case "--texture":
        options.textureFiles.push(next());
        break;
      case "--texture-root":
        options.textureRoot = next();
        break;
      case "--thumbnail":
        options.thumbnailFile = next();
        break;
      case "--overwrite":
        options.overwrite = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run assets:import -- [--temp-root temp_assets] [--asset-root assets] [--overwrite]
  npm run assets:import -- --glb model.glb --category vehicles [--texture texture.png] [--texture-root textures] [--thumbnail preview.png] [--overwrite]
`);
}
