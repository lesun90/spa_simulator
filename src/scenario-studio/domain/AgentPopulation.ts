import type { AgentDraft, AgentSnapshot } from "./agent";
import { AgentInstance } from "./AgentInstance";

/** Allocates stable internal IDs and owns the authored agent collection. */
export class AgentPopulation {
  private readonly instances = new Map<string, AgentInstance>();
  private nextIdentity = 1;

  create(draft: AgentDraft): AgentInstance {
    return new AgentInstance(`agent-${this.nextIdentity++}`, draft);
  }

  commit(instance: AgentInstance): void {
    if (this.instances.has(instance.id)) throw new Error(`Agent ${instance.id} already exists.`);
    this.instances.set(instance.id, instance);
  }

  get(id: string): AgentInstance | null {
    return this.instances.get(id) ?? null;
  }

  remove(id: string): AgentSnapshot | null {
    const instance = this.instances.get(id);
    if (!instance) return null;
    this.instances.delete(id);
    return instance.snapshot();
  }

  snapshots(): readonly AgentSnapshot[] {
    return Object.freeze([...this.instances.values()].map((instance) => instance.snapshot()));
  }

  clear(): readonly AgentSnapshot[] {
    const removed = this.snapshots();
    this.instances.clear();
    return removed;
  }
}
