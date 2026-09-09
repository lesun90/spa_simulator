import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { assetLabelFromId } from "../src/editor-core/assets";
import type { WfcMetadata } from "../src/wfc/metadata/socketTypes";

interface AssetMetadata {
  id?: string;
  label?: string;
  category?: string;
  tags?: string[];
  wfc?: WfcMetadata;
}

export interface SharedImportRequest {
  id: string;
  label: string;
  category: string;
  folderName: string;
  overwrite?: boolean;
  files: Array<{ name: string; contentBase64: string }>;
}

export async function discoverAssetCatalog(assetRoot: string): Promise<AssetCatalogEntry[]> {
  const folders = await discoverAssetFolders(assetRoot);
  const rootModels = await discoverRootModelFiles(assetRoot);
  const entries = await Promise.all([
    ...folders.map((folder) => normalizeAssetFolder(assetRoot, folder)),
    ...rootModels.map((modelFile) => normalizeRootModelAsset(assetRoot, modelFile))
  ]);
  const duplicateIds = findDuplicateIds(entries);

  return entries
    .map((entry) =>
      duplicateIds.has(entry.id)
        ? { ...entry, diagnostics: [...(entry.diagnostics ?? []), `Duplicate asset ID ${entry.id}.`] }
        : entry
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function importSharedAsset(assetRoot: string, request: SharedImportRequest): Promise<AssetCatalogEntry> {
  const category = slug(request.category || "imports");
  const folder = slug(request.folderName || request.label || request.id);
  const target = join(assetRoot, category, folder);
  await mkdir(target, { recursive: true });

  const existing = await readdir(target).catch((): string[] => []);
  const collisions = request.files.filter((file) => existing.includes(file.name));
  if (collisions.length > 0 && !request.overwrite) {
    throw new Error("Asset import would overwrite an existing file.");
  }

  const metadataFile = `${folder}.js`;
  const hasModule = request.files.some((file) => file.name.endsWith(".js"));
  const hasModel = request.files.some((file) => file.name.endsWith(".glb"));
  const files = hasModule
    ? request.files
    : hasModel
      ? [
          ...request.files,
          {
            name: "asset.json",
            contentBase64: Buffer.from(JSON.stringify({ id: request.id, label: request.label, category }, null, 2)).toString("base64")
          }
        ]
    : [
        ...request.files,
        {
          name: metadataFile,
          contentBase64: Buffer.from(
            `export const metadata = ${JSON.stringify({ id: request.id, label: request.label, category }, null, 2)};\nexport function createAsset({ THREE }) {\n  const group = new THREE.Group();\n  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0x7d8aa2, roughness: 0.7 }));\n  mesh.position.y = 0.4;\n  group.add(mesh);\n  return group;\n}\n`
          ).toString("base64")
        }
      ];

  for (const file of files) {
    await writeFile(join(target, file.name), Buffer.from(file.contentBase64, "base64"));
  }

  const catalog = await discoverAssetCatalog(assetRoot);
  const imported = catalog.find((entry) => entry.id === request.id || entry.id === `${category}.${folder}`);
  if (!imported) {
    throw new Error("Imported asset could not be added to the catalog.");
  }
  return imported;
}

async function discoverAssetFolders(assetRoot: string) {
  const folders: string[] = [];

  async function visit(directory: string) {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    const fileNames = children.filter((child) => child.isFile()).map((child) => child.name);
    if (directory !== assetRoot && fileNames.some((name) => name.endsWith(".js") || name.endsWith(".glb") || name.endsWith(".png"))) {
      folders.push(directory);
    }

    await Promise.all(children.filter((child) => child.isDirectory()).map((child) => visit(join(directory, child.name))));
  }

  await visit(assetRoot);
  return folders;
}

async function discoverRootModelFiles(assetRoot: string) {
  try {
    const children = await readdir(assetRoot, { withFileTypes: true });
    return children.filter((child) => child.isFile() && child.name.endsWith(".glb")).map((child) => child.name);
  } catch {
    return [];
  }
}

async function normalizeRootModelAsset(assetRoot: string, modelFile: string): Promise<AssetCatalogEntry> {
  const names = await readdir(assetRoot);
  const id = basename(modelFile, extname(modelFile));
  const thumbnailFile = names.includes(`${id}.png`) ? `${id}.png` : undefined;

  return {
    id,
    label: assetLabelFromId(id),
    category: "uncategorized",
    tags: [],
    source: "shared",
    implementation: "glb",
    modelUrl: `/assets/${encodeURIComponent(modelFile)}`,
    thumbnailUrl: thumbnailFile ? `/assets/${encodeURIComponent(thumbnailFile)}` : undefined,
    diagnostics: []
  };
}

async function normalizeAssetFolder(assetRoot: string, folder: string): Promise<AssetCatalogEntry> {
  const names = await readdir(folder);
  const relativeFolder = relative(assetRoot, folder);
  const defaultId = relativeFolder.split(sep).join(".");
  const category = relativeFolder.split(sep)[0] ?? "uncategorized";
  const moduleFile = names.find((name) => name.endsWith(".js"));
  const glbFile = names.find((name) => name.endsWith(".glb"));
  const pngFile = names.find((name) => name.endsWith(".png"));
  const metadataFile = names.includes("asset.json") ? "asset.json" : undefined;
  const diagnostics: string[] = [];
  const metadata = moduleFile
    ? await readModuleMetadata(join(folder, moduleFile), diagnostics)
    : metadataFile
      ? await readJsonMetadata(join(folder, metadataFile), diagnostics)
      : {};
  const id = metadata.id ?? defaultId;
  const urlBase = `/assets/${relativeFolder.split(sep).map(encodeURIComponent).join("/")}`;

  if (moduleFile && !(await fileContainsCreateAsset(join(folder, moduleFile)))) {
    diagnostics.push(`${moduleFile} does not export createAsset.`);
  }

  return {
    id,
    label: metadata.label ?? assetLabelFromId(id),
    category: metadata.category ?? category,
    tags: metadata.tags ?? [],
    source: "shared",
    implementation: moduleFile ? "module" : glbFile ? "glb" : "placeholder",
    moduleUrl: moduleFile ? `${urlBase}/${encodeURIComponent(moduleFile)}` : undefined,
    modelUrl: glbFile ? `${urlBase}/${encodeURIComponent(glbFile)}` : undefined,
    thumbnailUrl: pngFile ? `${urlBase}/${encodeURIComponent(pngFile)}` : undefined,
    wfc: metadata.wfc,
    diagnostics
  };
}

async function readModuleMetadata(filePath: string, diagnostics: string[]): Promise<AssetMetadata> {
  try {
    const source = await readFile(filePath, "utf8");
    const match = source.match(/export\s+const\s+metadata\s*=\s*({[\s\S]*?});?/m);
    if (!match) {
      diagnostics.push("Module does not export metadata.");
      return {};
    }

    return Function(`"use strict"; return (${match[1]});`)() as AssetMetadata;
  } catch {
    diagnostics.push("Module metadata could not be read.");
    return {};
  }
}

async function readJsonMetadata(filePath: string, diagnostics: string[]): Promise<AssetMetadata> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as AssetMetadata;
  } catch {
    diagnostics.push("Asset metadata could not be read.");
    return {};
  }
}

async function fileContainsCreateAsset(filePath: string) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const source = await readFile(filePath, "utf8");
    return /export\s+(async\s+)?function\s+createAsset|export\s+const\s+createAsset/.test(source);
  } catch {
    return false;
  }
}

function findDuplicateIds(entries: AssetCatalogEntry[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      duplicates.add(entry.id);
    }
    seen.add(entry.id);
  }

  return duplicates;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "asset";
}
