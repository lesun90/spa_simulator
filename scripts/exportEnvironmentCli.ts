import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverAssetCatalog } from "../server/assetCatalog";
import { compileEnvironmentPackage } from "../src/environment/compiler";
import { canonicalJson } from "../src/environment/manifestEncoder";
import { buildSceneRecipe } from "../src/environment/sceneRecipe";
import { sceneFromGeneration } from "../src/environment/sceneFromGeneration";
import { generateWfcScene } from "../src/wfc/sceneGenerator";

export interface ExportCliOptions {
  width: number;
  depth: number;
  cellSize: number;
  seed: number;
  chunkSize: number;
  output: string;
  removeSeamFaces: boolean;
  assetRoot: string;
  force: boolean;
}

export function parseExportArgs(argv: string[]): ExportCliOptions {
  let width: number | undefined;
  let depth: number | undefined;
  let size: number | undefined;
  let cellSize: number | undefined;
  let seed: number | undefined;
  let output: string | undefined;
  let chunkSize = 10;
  let removeSeamFaces = false;
  let assetRoot = "./assets";
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case "--width":
        width = Number.parseInt(next(), 10);
        break;
      case "--depth":
        depth = Number.parseInt(next(), 10);
        break;
      case "--size":
        size = Number.parseInt(next(), 10);
        break;
      case "--cell-size":
        cellSize = Number.parseFloat(next());
        break;
      case "--seed":
        seed = Number.parseInt(next(), 10);
        break;
      case "--chunk-size":
        chunkSize = Number.parseInt(next(), 10);
        break;
      case "--output":
        output = next();
        break;
      case "--asset-root":
        assetRoot = next();
        break;
      case "--remove-seam-faces":
        removeSeamFaces = true;
        break;
      case "--force":
        force = true;
        break;
      case "--help":
        printExportHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (size !== undefined && (width !== undefined || depth !== undefined)) {
    throw new Error("--size cannot be combined with --width or --depth");
  }
  const resolvedWidth = size ?? width;
  const resolvedDepth = size ?? depth;
  if (!isIntegerInRange(resolvedWidth, 1, 100)) throw new Error("--width must be an integer from 1 through 100");
  if (!isIntegerInRange(resolvedDepth, 1, 100)) throw new Error("--depth must be an integer from 1 through 100");
  if (!(typeof cellSize === "number" && Number.isFinite(cellSize) && cellSize > 0)) throw new Error("--cell-size must be greater than zero");
  if (!isIntegerInRange(seed, 0, 0xffffffff)) throw new Error("--seed must be an unsigned 32-bit integer");
  if (!isIntegerInRange(chunkSize, 0, Number.MAX_SAFE_INTEGER)) throw new Error("--chunk-size must be zero or a positive integer");
  if (!output) throw new Error("--output is required");

  return { width: resolvedWidth, depth: resolvedDepth, cellSize, seed: seed!, chunkSize, output, removeSeamFaces, assetRoot, force };
}

function isIntegerInRange(value: number | undefined, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function printExportHelp() {
  console.log(`Usage:
  npm run scene:export -- --width 100 --depth 100 --cell-size 1 --seed 12345 --output ./exports/city-12345 [--chunk-size 10] [--remove-seam-faces] [--asset-root ./assets] [--force]
  npm run scene:export -- --size 100 --cell-size 1 --seed 12345 --output ./exports/city-12345
`);
}

export async function writePackageFiles(outputDir: string, manifestJson: string, glb: Uint8Array, force: boolean): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const manifestPath = join(outputDir, "environment.json");
  const glbPath = join(outputDir, "environment.glb");

  if (!force) {
    const existing = await readdir(outputDir);
    if (existing.includes("environment.json") || existing.includes("environment.glb")) {
      throw new Error("Output directory already contains an environment package; pass --force to replace it.");
    }
  }

  const stagingDir = await mkdtemp(join(outputDir, ".environment-export-"));
  try {
    await writeFile(join(stagingDir, "environment.json"), manifestJson, "utf8");
    await writeFile(join(stagingDir, "environment.glb"), glb);
    await rename(join(stagingDir, "environment.json"), manifestPath);
    await rename(join(stagingDir, "environment.glb"), glbPath);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

const GENERATOR_VERSION = "0.1.0";

export async function runExportCli(argv: string[]): Promise<void> {
  const options = parseExportArgs(argv);
  const assets = await discoverAssetCatalog(options.assetRoot);

  const request = { width: options.width, depth: options.depth, seed: options.seed, tileWidth: options.cellSize, tileDepth: options.cellSize };
  const generation = await generateWfcScene(assets, request);
  if (generation.status === "failed") {
    throw new Error(generation.roadScene ? `Road scene infeasible (seed ${options.seed}): ${generation.diagnostics[0]}` : generation.diagnostics[0]);
  }

  const scene = sceneFromGeneration(generation, request);
  const recipe = buildSceneRecipe(scene, assets);

  const compiled = await compileEnvironmentPackage(recipe, assets, {
    chunkSize: options.chunkSize,
    removeInternalSeamFaces: options.removeSeamFaces,
    assetRoot: options.assetRoot,
    source: "cli",
    generatorVersion: GENERATOR_VERSION
  });
  if ("status" in compiled) throw new Error(compiled.diagnostics[0]);

  await writePackageFiles(options.output, canonicalJson(compiled.manifest), compiled.glb, options.force);

  console.log(
    [
      `cells=${compiled.metrics.cellCount}`,
      `objects=${compiled.metrics.objectCount}`,
      `chunks=${compiled.metrics.chunkCount}`,
      `meshes=${compiled.metrics.meshCount}`,
      `instancedMeshes=${compiled.metrics.instancedMeshCount}`,
      `drawCallEstimate=${compiled.metrics.meshCount + compiled.metrics.instancedMeshCount}`,
      `triangles=${compiled.metrics.triangleCount}`,
      `removedSeamTriangles=${compiled.metrics.removedSeamTriangleCount}`,
      `glbBytes=${compiled.metrics.glbByteLength}`,
      `seed ${options.seed}`,
      `elapsedMs=${compiled.metrics.elapsedMs}`
    ].join(" ")
  );
}
