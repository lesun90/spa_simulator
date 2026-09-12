import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import { discoverAssetCatalog, importSharedAsset, type SharedImportRequest } from "./assetCatalog";
import { createEnvironmentExportCache, createEnvironmentImportStaging } from "./environmentRoutes";
import { createEnvironmentPackageStore } from "./environmentPackageStore";
import { createSceneStore } from "./sceneStore";
import type { Scene } from "../src/editor-core/scene";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import { validateSceneForSave, type ValidationResult } from "../src/editor-core/validation";

export function steerlabApiPlugin(): Plugin {
  const assetRoot = join(process.cwd(), "assets");
  const sceneRoot = process.env.STEERLAB_USER_DATA_DIR ?? join(homedir(), ".steerlab", "scenes");
  const store = createSceneStore(sceneRoot);
  const environmentStore = createEnvironmentPackageStore(sceneRoot);
  const environmentExports = createEnvironmentExportCache();
  const environmentImports = createEnvironmentImportStaging(sceneRoot);

  return {
    name: "steerlab-api",
    configureServer(server) {
      server.watcher.add(assetRoot);

      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/api/")) {
          next();
          return;
        }

        try {
          await mkdir(assetRoot, { recursive: true });
          const url = new URL(request.url, "http://localhost");
          const method = request.method ?? "GET";

          if (method === "GET" && url.pathname === "/api/health") {
            return sendJson(response, { app: "steerlab", phase: "phase-1-scene-editor" });
          }

          if (method === "GET" && url.pathname === "/api/assets") {
            return sendJson(response, { assets: await discoverAssetCatalog(assetRoot) });
          }

          if (method === "POST" && url.pathname === "/api/assets/shared-import") {
            const body = await readJson<SharedImportRequest>(request);
            return sendJson(response, { asset: await importSharedAsset(assetRoot, body) }, 201);
          }

          if (url.pathname === "/api/scenes" && method === "GET") {
            return sendJson(response, { scenes: await store.list() });
          }

          if (url.pathname === "/api/scenes" && method === "POST") {
            const body = await readJson<{ name?: string }>(request);
            return sendJson(response, { scene: await store.create(body.name?.trim() || "Untitled Scene") }, 201);
          }

          const sceneMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)$/);
          if (sceneMatch) {
            const id = decodeURIComponent(sceneMatch[1]);
            if (method === "GET") return sendJson(response, { scene: await store.open(id) });
            if (method === "PUT") {
              const body = await readJson<{ scene: Scene }>(request);
              const catalog = await discoverAssetCatalog(assetRoot);
              const result = validateSceneSaveRequest(id, body.scene, catalog);
              if (!result.valid) return sendJson(response, { error: result.diagnostics.join(" ") }, 400);
              return sendJson(response, { scene: await store.save(body.scene) });
            }
            if (method === "PATCH") return sendJson(response, { scene: await store.rename(id, (await readJson<{ name: string }>(request)).name) });
            if (method === "DELETE") {
              await store.delete(id);
              await environmentStore.remove(id);
              response.statusCode = 204;
              response.end();
              return;
            }
          }

          const duplicateMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/duplicate$/);
          if (duplicateMatch && method === "POST") {
            const sourceId = decodeURIComponent(duplicateMatch[1]);
            const duplicated = await store.duplicate(sourceId);
            await environmentStore.copy(sourceId, duplicated.id);
            return sendJson(response, { scene: duplicated }, 201);
          }

          const exportMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/export$/);
          if (exportMatch && method === "POST") {
            const body = await readJson<{ scene: Scene; options: { chunkSize: number; removeSeamFaces: boolean } }>(request);
            if (body.scene.id !== decodeURIComponent(exportMatch[1])) {
              return sendJson(response, { error: "Route scene ID does not match the scene body ID." }, 400);
            }
            const catalog = await discoverAssetCatalog(assetRoot);
            const result = await environmentExports.compile(body.scene, catalog, assetRoot, body.options);
            if (result.status === "error") return sendJson(response, { error: result.message }, 400);
            return sendJson(response, { exportId: result.exportId, manifest: result.manifest, metrics: result.metrics });
          }

          const exportModelMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/export\/([^/]+)\/model$/);
          if (exportModelMatch && method === "GET") {
            const glb = environmentExports.model(decodeURIComponent(exportModelMatch[2]));
            if (!glb) return sendJson(response, { error: "Not found" }, 404);
            return sendBinary(response, glb, "model/gltf-binary");
          }

          const importManifestMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/import\/manifest$/);
          if (importManifestMatch && method === "POST") {
            const id = decodeURIComponent(importManifestMatch[1]);
            await environmentImports.stageManifest(id, (await readBuffer(request)).toString("utf8"));
            response.statusCode = 204;
            response.end();
            return;
          }

          const importModelMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/import\/model$/);
          if (importModelMatch && method === "POST") {
            const id = decodeURIComponent(importModelMatch[1]);
            await environmentImports.stageModel(id, await readBuffer(request));
            response.statusCode = 204;
            response.end();
            return;
          }

          const importCommitMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/environment\/import\/commit$/);
          if (importCommitMatch && method === "POST") {
            const id = decodeURIComponent(importCommitMatch[1]);
            const result = await environmentImports.commit(id, environmentStore);
            if (result.status === "error") return sendJson(response, { error: result.diagnostics.join(" ") }, 400);
            const scene = await store.open(id);
            const updated = await store.save({ ...scene, environment: { sha256: result.sha256, manifestVersion: result.manifestVersion } });
            return sendJson(response, { scene: updated });
          }

          sendJson(response, { error: "Not found" }, 404);
        } catch {
          sendJson(response, { error: "Request failed." }, 500);
        }
      });
    }
  };
}

export function validateSceneSaveRequest(routeId: string, scene: Scene, catalog: AssetCatalogEntry[]): ValidationResult {
  const diagnostics: string[] = [];
  if (scene.id !== routeId) {
    diagnostics.push("Route scene ID does not match the scene body ID.");
  }

  diagnostics.push(...validateSceneForSave(scene, catalog).diagnostics);
  return { valid: diagnostics.length === 0, diagnostics };
}

function sendJson(response: { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }, body: unknown, status = 200) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function sendBinary(response: { statusCode: number; setHeader(name: string, value: string): void; end(body?: Buffer): void }, bytes: Uint8Array, contentType: string) {
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  response.end(Buffer.from(bytes));
}

async function readJson<T>(request: NodeJS.ReadableStream): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as T) : ({} as T);
}

async function readBuffer(request: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
