import { chromium } from "@playwright/test";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { basename, extname, join, relative, resolve, sep } from "node:path";

const MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);
const MODULE_EXTENSIONS = new Set([".js"]);
const IMAGE_EXTENSIONS = new Set([".png"]);
const DEFAULT_SIZE = 256;

interface AssetPreview {
  folder: string;
  id: string;
  label: string;
  modelFile?: string;
  moduleFile?: string;
  outputFile: string;
  skipped: boolean;
}

interface CliOptions {
  assetRoot: string;
  size: number;
  force: boolean;
  limit?: number;
  outputName?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    assetRoot: "assets",
    size: DEFAULT_SIZE,
    force: false
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
        options.assetRoot = next();
        break;
      case "--size":
        options.size = positiveInt(next(), "--size");
        break;
      case "--limit":
        options.limit = positiveInt(next(), "--limit");
        break;
      case "--output-name":
        options.outputName = next();
        break;
      case "--force":
        options.force = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { ...options, assetRoot: resolve(options.assetRoot) };
}

function positiveInt(value: string, option: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer.`);
  return parsed;
}

function printHelp() {
  console.log(`Generate PNG thumbnails for shared assets.

Usage:
  npx vite-node scripts/generateAssetThumbnails.ts [options]

Options:
  --asset-root <path>   Asset root to scan. Default: assets
  --size <pixels>      Square thumbnail size. Default: ${DEFAULT_SIZE}
  --output-name <name> Fixed output file name per asset folder. Default: <asset-folder>.png
  --force              Re-render even when a PNG thumbnail already exists.
  --limit <count>      Only process the first N discovered assets.
  --help               Show this help.
`);
}

async function discoverAssets(options: CliOptions): Promise<AssetPreview[]> {
  const folders = await discoverAssetFolders(options.assetRoot);
  const previews: AssetPreview[] = [];

  for (const folder of folders.sort()) {
    const names = await readdir(folder);
    const modelFile = names.find((name) => MODEL_EXTENSIONS.has(extname(name).toLowerCase()));
    const moduleFile = names.find((name) => MODULE_EXTENSIONS.has(extname(name).toLowerCase()));
    if (!modelFile && !moduleFile) continue;

    const folderName = basename(folder);
    const existingPng = names.find((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()));
    const outputName = options.outputName ?? existingPng ?? `${folderName}.png`;
    const outputFile = join(folder, outputName);
    const skipped = Boolean(existingPng && !options.force);
    const relativeFolder = relative(options.assetRoot, folder).split(sep).join(".");

    previews.push({
      folder,
      id: relativeFolder,
      label: labelFromId(relativeFolder),
      modelFile: modelFile ? join(folder, modelFile) : undefined,
      moduleFile: moduleFile ? join(folder, moduleFile) : undefined,
      outputFile,
      skipped
    });
  }

  return typeof options.limit === "number" ? previews.slice(0, options.limit) : previews;
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
    if (
      directory !== assetRoot &&
      fileNames.some((name) => MODEL_EXTENSIONS.has(extname(name).toLowerCase()) || MODULE_EXTENSIONS.has(extname(name).toLowerCase()))
    ) {
      folders.push(directory);
    }

    await Promise.all(children.filter((child) => child.isDirectory()).map((child) => visit(join(directory, child.name))));
  }

  await visit(assetRoot);
  return folders;
}

function labelFromId(id: string) {
  return id
    .split(".")
    .at(-1)!
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function createStaticServer(root: string) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      const filePath = resolve(root, pathname.slice(1));

      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        send(response, 403, "Forbidden");
        return;
      }

      const info = await stat(filePath);
      if (!info.isFile()) {
        send(response, 404, "Not found");
        return;
      }

      response.writeHead(200, { "access-control-allow-origin": "*", "content-type": mimeType(filePath) });
      createReadStream(filePath).pipe(response);
    } catch {
      send(response, 404, "Not found");
    }
  });

  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start preview server.");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  };
}

function send(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "access-control-allow-origin": "*", "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

function mimeType(filePath: string) {
  switch (extname(filePath).toLowerCase()) {
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".glb":
      return "model/gltf-binary";
    case ".gltf":
      return "model/gltf+json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function toServerPath(filePath: string) {
  return `/${relative(process.cwd(), filePath).split(sep).map(encodeURIComponent).join("/")}`;
}

async function renderThumbnails(previews: AssetPreview[], options: CliOptions) {
  const server = await createStaticServer(process.cwd());
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ viewport: { width: options.size, height: options.size }, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => console.error(`preview page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`preview console error: ${message.text()}`);
    });
    await page.setContent(renderPageHtml(options.size, server.origin));
    await page.waitForFunction(() => typeof window.renderAssetThumbnail === "function");

    let rendered = 0;
    let skipped = 0;
    let failed = 0;

    for (const preview of previews) {
      if (preview.skipped) {
        skipped += 1;
        console.log(`skip ${relative(process.cwd(), preview.outputFile)}`);
        continue;
      }

      try {
        const dataUrl = await page.evaluate(
          async ({ asset, origin }) => {
            return window.renderAssetThumbnail({ ...asset, origin });
          },
          {
            origin: server.origin,
            asset: {
              label: preview.label,
              modelUrl: preview.modelFile ? `${server.origin}${toServerPath(preview.modelFile)}` : undefined,
              moduleUrl: preview.moduleFile ? `${server.origin}${toServerPath(preview.moduleFile)}` : undefined
            }
          }
        );
        const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
        await mkdir(preview.folder, { recursive: true });
        await writeFile(preview.outputFile, bytes);
        rendered += 1;
        console.log(`wrote ${relative(process.cwd(), preview.outputFile)}`);
      } catch (error) {
        failed += 1;
        console.error(`error ${preview.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { rendered, skipped, failed };
  } finally {
    await browser.close();
    await server.close();
  }
}

function renderPageHtml(size: number, origin: string) {
  const threeUrl = `${origin}/node_modules/three/build/three.module.js`;
  const loaderUrl = `${origin}/node_modules/three/examples/jsm/loaders/GLTFLoader.js`;

  return `<!doctype html>
<html>
  <body style="margin:0;background:transparent">
    <canvas id="thumbnail" width="${size}" height="${size}"></canvas>
    <script type="importmap">
      {
        "imports": {
          "three": ${JSON.stringify(threeUrl)}
        }
      }
    </script>
    <script type="module">
      import * as THREE from ${JSON.stringify(threeUrl)};
      import { GLTFLoader } from ${JSON.stringify(loaderUrl)};

      const canvas = document.getElementById("thumbnail");
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(${size}, ${size}, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const loader = new GLTFLoader();

      window.renderAssetThumbnail = async ({ label, modelUrl, moduleUrl, origin }) => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0xb7bdc8, 2.2));

        const key = new THREE.DirectionalLight(0xffffff, 1.7);
        key.position.set(3, 5, 4);
        scene.add(key);

        const fill = new THREE.DirectionalLight(0xd8ecff, 0.45);
        fill.position.set(-3, 2, -4);
        scene.add(fill);

        let object;
        if (moduleUrl) {
          const mod = await import(moduleUrl);
          if (!mod.createAsset) throw new Error("Module does not export createAsset.");
          const directoryUrl = moduleUrl.split("/").slice(0, -1).join("/");
          object = await mod.createAsset({ THREE, directoryUrl, modelUrl });
        } else if (modelUrl) {
          object = (await loader.loadAsync(modelUrl)).scene;
        } else {
          throw new Error("Asset has no renderable model or module.");
        }

        object.name = label;
        frameObject(object, camera);
        scene.add(object);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        disposeObject(object);
        return canvas.toDataURL("image/png");
      };

      function frameObject(object, camera) {
        object.updateWorldMatrix(true, true);
        const initialBox = new THREE.Box3().setFromObject(object);
        const initialSize = initialBox.getSize(new THREE.Vector3());
        const maxDimension = Math.max(initialSize.x, initialSize.y, initialSize.z, 0.001);
        object.scale.multiplyScalar(1.8 / maxDimension);

        object.updateWorldMatrix(true, true);
        const scaledBox = new THREE.Box3().setFromObject(object);
        const center = scaledBox.getCenter(new THREE.Vector3());
        object.position.x -= center.x;
        object.position.z -= center.z;
        object.position.y -= scaledBox.min.y;

        object.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(object);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const target = new THREE.Vector3(0, box.min.y + box.getSize(new THREE.Vector3()).y * 0.48, 0);
        const radius = Math.max(sphere.radius, 0.4);
        const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.18;
        const direction = new THREE.Vector3(2.8, 2.1, 3.2).normalize();

        camera.near = Math.max(0.01, distance / 100);
        camera.far = distance * 100;
        camera.position.copy(target).addScaledVector(direction, distance);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
      }

      function disposeObject(object) {
        object.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
          for (const material of materials) {
            for (const value of Object.values(material)) {
              if (value && value.isTexture) value.dispose();
            }
            material.dispose();
          }
        });
      }
    </script>
  </body>
</html>`;
}

async function main() {
  const options = parseArgs(process.argv);
  const previews = await discoverAssets(options);
  if (previews.length === 0) {
    console.log(`No renderable assets found in ${relative(process.cwd(), options.assetRoot) || "."}`);
    return;
  }

  const result = await renderThumbnails(previews, options);
  console.log(`Done. Rendered ${result.rendered}, skipped ${result.skipped}, failed ${result.failed}.`);
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
