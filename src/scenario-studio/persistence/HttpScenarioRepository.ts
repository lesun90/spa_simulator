import { validateScenarioRecord, validateScenarioSummary, type ScenarioRecord, type ScenarioSummary } from "../domain/scenarioRecord";
import type { ScenarioRepository } from "./ScenarioRepository";

export class HttpScenarioRepository implements ScenarioRepository {
  async list(): Promise<readonly ScenarioSummary[]> {
    const payload = await request<{ scenarios?: unknown }>("/api/scenario-studio/scenarios");
    if (!Array.isArray(payload.scenarios)) throw new Error("Scenario list response is malformed.");
    return Object.freeze(payload.scenarios.map(validateScenarioSummary));
  }

  async open(id: string): Promise<ScenarioRecord> {
    const payload = await request<{ scenario?: unknown }>(`/api/scenario-studio/scenarios/${encodeURIComponent(id)}`);
    return validateScenarioRecord(payload.scenario);
  }

  async save(record: ScenarioRecord): Promise<ScenarioRecord> {
    const payload = await request<{ scenario?: unknown }>(`/api/scenario-studio/scenarios/${encodeURIComponent(record.id)}`, {
      method: "PUT",
      body: JSON.stringify({ scenario: record })
    });
    return validateScenarioRecord(payload.scenario);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<T>;
}

async function errorMessage(response: Response): Promise<string> {
  try { return (await response.json() as { error?: string }).error ?? `Scenario request failed (${response.status}).`; }
  catch { return `Scenario request failed (${response.status}).`; }
}
