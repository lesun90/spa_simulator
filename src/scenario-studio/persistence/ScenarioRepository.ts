import type { ScenarioRecord, ScenarioSummary } from "../domain/scenarioRecord";

export interface ScenarioRepository {
  list(): Promise<readonly ScenarioSummary[]>;
  open(id: string): Promise<ScenarioRecord>;
  save(record: ScenarioRecord): Promise<ScenarioRecord>;
}
