import type { AgentChoice } from "../domain/agent";

export interface AgentCatalog {
  list(): Promise<readonly AgentChoice[]>;
}
