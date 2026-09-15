import { agentBoundsOverlap, type AgentDraft, type AgentSnapshot } from "./agent";
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

  overlaps(draft: AgentDraft, ignoreId?: string): boolean {
    for (const instance of this.instances.values()) {
      const snapshot = instance.snapshot();
      if (snapshot.id !== ignoreId && agentBoundsOverlap(draft, snapshot)) return true;
    }
    return false;
  }

  hasDependents(supportId: string): boolean {
    for (const instance of this.instances.values()) {
      const support = instance.snapshot().pose.support;
      if (support?.kind === "agent" && support.id === supportId) return true;
    }
    return false;
  }

  clear(): readonly AgentSnapshot[] {
    const removed = this.snapshots();
    this.instances.clear();
    return removed;
  }

  replace(agents: readonly AgentSnapshot[]): void {
    const staged = new Map<string, AgentInstance>();
    let nextIdentity = 1;
    for (const agent of agents) {
      if (staged.has(agent.id)) throw new Error(`Agent ${agent.id} already exists.`);
      staged.set(agent.id, new AgentInstance(agent.id, agent));
      const numericIdentity = /^agent-(\d+)$/.exec(agent.id)?.[1];
      if (numericIdentity) nextIdentity = Math.max(nextIdentity, Number(numericIdentity) + 1);
    }
    this.instances.clear();
    for (const [id, instance] of staged) this.instances.set(id, instance);
    this.nextIdentity = nextIdentity;
  }
}
