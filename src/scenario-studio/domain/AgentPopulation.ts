import { agentBoundsOverlap, type AgentDraft, type SceneObjectSnapshot } from "./agent";
import { SceneObjectInstance } from "./SceneObjectInstance";

/** Allocates stable internal IDs and owns the authored agent collection. */
export class AgentPopulation {
  private readonly instances = new Map<string, SceneObjectInstance>();
  private nextIdentity = 1;

  create(draft: AgentDraft): SceneObjectInstance {
    return new SceneObjectInstance(`agent-${this.nextIdentity++}`, draft);
  }

  commit(instance: SceneObjectInstance): void {
    if (this.instances.has(instance.id)) throw new Error(`Agent ${instance.id} already exists.`);
    this.instances.set(instance.id, instance);
  }

  get(id: string): SceneObjectInstance | null {
    return this.instances.get(id) ?? null;
  }

  remove(id: string): SceneObjectSnapshot | null {
    const instance = this.instances.get(id);
    if (!instance) return null;
    this.instances.delete(id);
    return instance.snapshot();
  }

  snapshots(): readonly SceneObjectSnapshot[] {
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

  clear(): readonly SceneObjectSnapshot[] {
    const removed = this.snapshots();
    this.instances.clear();
    return removed;
  }

  replace(agents: readonly SceneObjectSnapshot[]): void {
    const staged = new Map<string, SceneObjectInstance>();
    let nextIdentity = 1;
    for (const agent of agents) {
      if (staged.has(agent.id)) throw new Error(`Agent ${agent.id} already exists.`);
      staged.set(agent.id, new SceneObjectInstance(agent.id, agent));
      const numericIdentity = /^agent-(\d+)$/.exec(agent.id)?.[1];
      if (numericIdentity) nextIdentity = Math.max(nextIdentity, Number(numericIdentity) + 1);
    }
    this.instances.clear();
    for (const [id, instance] of staged) this.instances.set(id, instance);
    this.nextIdentity = nextIdentity;
  }
}
