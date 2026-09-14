import { freezeDraft, validateAgentDraft, type AgentDraft, type AgentSnapshot } from "./agent";

/** Owns one authored agent's stable identity and validated configuration. */
export class AgentInstance {
  private draft: AgentDraft;

  constructor(readonly id: string, draft: AgentDraft) {
    if (!id.trim()) throw new Error("Agent ID is required.");
    this.draft = validateAgentDraft(draft);
  }

  snapshot(): AgentSnapshot {
    return Object.freeze({ id: this.id, ...freezeDraft(this.draft) });
  }

  replace(draft: AgentDraft): void {
    this.draft = validateAgentDraft(draft);
  }
}
