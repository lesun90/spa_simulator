import type { AgentChoice } from "../domain/agent";
import type { AgentCatalog } from "./AgentCatalog";

export class HttpAgentCatalog implements AgentCatalog {
  async list(): Promise<readonly AgentChoice[]> {
    const response = await fetch("/api/scenario-studio/agents");
    if (!response.ok) throw new Error(await errorMessage(response));
    const payload = await response.json() as { agents?: unknown };
    if (!Array.isArray(payload.agents)) throw new Error("Agent catalog response is malformed.");
    return payload.agents as AgentChoice[];
  }
}

async function errorMessage(response: Response): Promise<string> {
  try { return (await response.json() as { error?: string }).error ?? `Request failed (${response.status}).`; }
  catch { return `Request failed (${response.status}).`; }
}
