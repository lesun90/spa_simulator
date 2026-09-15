import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import type { SceneReference } from "../../src/scenario-studio/domain/scene";
import type { ScenarioRecord } from "../../src/scenario-studio/domain/scenarioRecord";
import { PublishedScenes } from "./publishedScenes";
import { PublishedAgents } from "./agentCatalog";
import { ScenarioStore } from "./scenarioStore";

export function scenarioStudioRoutes(assetRoot: string, scenarioRoot: string) {
  const scenes = new PublishedScenes(join(assetRoot, "scenes"));
  const agents = new PublishedAgents(join(assetRoot, "agents"));
  const scenarios = new ScenarioStore(scenarioRoot);
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    try {
      if (method === "GET" && url.pathname === "/api/scenario-studio/scenes") {
        json(response, { scenes: await scenes.list() });
        return true;
      }
      if (method === "GET" && url.pathname === "/api/scenario-studio/agents") {
        json(response, { agents: await agents.list() });
        return true;
      }
      if (url.pathname === "/api/scenario-studio/scenarios" && method === "GET") {
        json(response, { scenarios: await scenarios.list() });
        return true;
      }
      const scenarioMatch = url.pathname.match(/^\/api\/scenario-studio\/scenarios\/([^/]+)$/);
      if (scenarioMatch) {
        const id = decodeURIComponent(scenarioMatch[1]);
        if (method === "GET") {
          json(response, { scenario: await scenarios.open(id) });
          return true;
        }
        if (method === "PUT") {
          const body = await readJson<{ scenario?: ScenarioRecord }>(request);
          if (!body.scenario) throw new Error("Scenario body is required.");
          if (body.scenario.id !== id) throw new Error("Route scenario ID does not match the scenario body ID.");
          json(response, { scenario: await scenarios.save(body.scenario) });
          return true;
        }
      }
      const match = url.pathname.match(/^\/api\/scenario-studio\/scene-package\/(manifest|model)$/);
      if (method === "GET" && match) {
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
      if (method === "GET" && assetMatch) {
        const decoded = decodeURIComponent(assetMatch[2]);
        const bytes = await (assetMatch[1] === "scenes" ? scenes : agents).source(decoded);
        const type = extname(decoded) === ".png" ? "image/png" : extname(decoded) === ".glb" ? "model/gltf-binary" : "application/octet-stream";
        binary(response, bytes, type);
        return true;
      }
      return false;
    } catch (error) {
      json(response, { error: error instanceof Error ? error.message : "Scenario Studio request failed." }, 400);
      return true;
    }
  };
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 2 * 1024 * 1024) throw new Error("Scenario request is too large.");
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; }
  catch { throw new Error("Scenario request body is not valid JSON."); }
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
