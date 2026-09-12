import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import type { SceneReference } from "../../src/scenario-studio/domain/scene";
import { PublishedScenes } from "./publishedScenes";

export function scenarioStudioRoutes(assetRoot: string) {
  const scenes = new PublishedScenes(join(assetRoot, "scenes"));
  const agents = new PublishedScenes(join(assetRoot, "agents"));
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method !== "GET") return false;
    try {
      if (url.pathname === "/api/scenario-studio/scenes") {
        json(response, { scenes: await scenes.list() });
        return true;
      }
      const match = url.pathname.match(/^\/api\/scenario-studio\/scene-package\/(manifest|model)$/);
      if (match) {
        const key = url.searchParams.get("key") ?? "";
        const choice = (await scenes.list()).find((item) => item.reference.key === key);
        if (!choice) throw new Error("Scene package not found.");
        if (!choice.available) throw new Error(choice.diagnostics.join(" "));
        const reference: SceneReference = {
          ...choice.reference,
          manifestSha256: url.searchParams.get("manifestSha256") ?? "",
          modelSha256: url.searchParams.get("modelSha256") ?? ""
        };
        const packageData = await scenes.load(reference);
        if (match[1] === "manifest") json(response, packageData.manifest);
        else binary(response, packageData.glb, "model/gltf-binary");
        return true;
      }
      const assetMatch = url.pathname.match(/^\/scenario-assets\/(scenes|agents)\/(.+)$/);
      if (assetMatch) {
        const decoded = decodeURIComponent(assetMatch[2]);
        const bytes = await (assetMatch[1] === "scenes" ? scenes : agents).source(decoded);
        const type = extname(decoded) === ".png" ? "image/png" : extname(decoded) === ".glb" ? "model/gltf-binary" : "application/octet-stream";
        binary(response, bytes, type);
        return true;
      }
      return false;
    } catch (error) {
      json(response, { error: error instanceof Error ? error.message : "Scene request failed." }, 400);
      return true;
    }
  };
}

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(value));
}

function binary(response: ServerResponse, bytes: Uint8Array, type: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", type);
  response.end(Buffer.from(bytes));
}
