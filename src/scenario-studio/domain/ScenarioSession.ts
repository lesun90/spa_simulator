import type { SceneCatalog } from "../catalog/SceneCatalog";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { AgentDraft, AgentPresenter, AgentSnapshot, PlacementPreview, Ray3 } from "./agent";
import { validateAgentDraft } from "./agent";
import { AgentPopulation } from "./AgentPopulation";
import type { ScenePresentation, ScenePresenter } from "./ScenePresentation";
import { ScenarioDocument } from "./ScenarioDocument";
import { sameSceneReference, type SceneReference } from "./scene";

/** Coordinates transactional scene and agent commits while rejecting obsolete asynchronous work. */
export class ScenarioSession {
  private generation = 0;
  private disposed = false;
  private presentation: ScenePresentation;
  private readonly population = new AgentPopulation();
  private readonly physics: Promise<PhysicsWorld>;
  private readonly ready: Promise<void>;
  private sceneRevision = 0;

  constructor(
    readonly document: ScenarioDocument,
    private readonly catalog: SceneCatalog,
    private readonly presenter: ScenePresenter,
    physics: Promise<PhysicsWorld>,
    private readonly agentPresenter: AgentPresenter,
    private readonly onPopulationChanged: (agents: readonly AgentSnapshot[]) => void = () => {}
  ) {
    this.presentation = presenter.createDefault();
    presenter.show(this.presentation);
    this.physics = physics;
    this.ready = physics.then(async (world) => { this.sceneRevision = await world.replaceScene(this.presentation.geometry); });
    void this.ready.catch(() => {});
  }

  get agents(): readonly AgentSnapshot[] { return this.population.snapshots(); }

  async replaceScene(reference: SceneReference): Promise<void> {
    if (this.disposed) return;
    if (sameSceneReference(this.document.sceneReference, reference)) return;
    const request = ++this.generation;
    let prepared: ScenePresentation | null = null;
    try {
      const [data, world] = await Promise.all([this.catalog.load(reference), this.physics]);
      prepared = await this.presenter.prepare(data);
      await this.ready;
      if (this.disposed || request !== this.generation) return;
      const nextRevision = await world.replaceScene(prepared.geometry);
      if (this.disposed) return;
      this.presenter.show(prepared);
      const old = this.presentation;
      this.presentation = prepared;
      prepared = null;
      this.sceneRevision = nextRevision;
      this.population.clear();
      this.document.replaceAgents([]);
      this.agentPresenter.clear();
      this.onPopulationChanged(this.agents);
      this.document.replaceScene(reference);
      old.dispose();
    } finally {
      prepared?.dispose();
    }
  }

  async previewAgentPlacement(draft: AgentDraft, ray: Ray3, ignoreAgentId?: string): Promise<PlacementPreview> {
    const validDraft = validateAgentDraft(draft);
    await this.ready;
    if (this.disposed) throw new Error("Scenario session was disposed.");
    return (await this.physics).previewAgentPlacement(validDraft, ray, ignoreAgentId);
  }

  async placeAgent(draft: AgentDraft, ray: Ray3): Promise<void> {
    const validDraft = validateAgentDraft(draft);
    const request = this.generation;
    const preview = await this.previewAgentPlacement(validDraft, ray);
    if (!preview.valid || !preview.pose) throw new Error(preview.reason ?? "Agent placement is invalid.");
    await this.commitAgent({ ...validDraft, pose: preview.pose }, preview.sceneRevision, request);
  }

  async updateAgent(id: string, draft: AgentDraft): Promise<void> {
    const instance = this.population.get(id);
    if (!instance) throw new Error("The selected agent no longer exists.");
    const validDraft = validateAgentDraft(draft);
    const ray: Ray3 = { origin: { x: validDraft.pose.position.x, y: validDraft.pose.position.y + 100, z: validDraft.pose.position.z }, direction: { x: 0, y: -1, z: 0 } };
    const preview = await this.previewAgentPlacement(validDraft, ray, id);
    if (!preview.valid || !preview.pose) throw new Error(preview.reason ?? "Agent transform is invalid.");
    if (Math.abs(preview.pose.position.y - validDraft.pose.position.y) > 0.5) throw new Error("Agent position must remain seated on a support surface.");
    const committed = validateAgentDraft({ ...validDraft, pose: preview.pose });
    const snapshot = Object.freeze({ id, ...committed });
    await (await this.physics).updateAgent(snapshot, preview.sceneRevision);
    instance.replace(committed);
    this.agentPresenter.update(instance.snapshot());
    this.syncDocument();
  }

  async duplicateAgent(id: string): Promise<string> {
    const source = this.population.get(id)?.snapshot();
    if (!source) throw new Error("The selected agent no longer exists.");
    const spacingX = source.collision.halfExtents.x * 2 + 0.6;
    const spacingZ = source.collision.halfExtents.z * 2 + 0.6;
    const offsets = [[spacingX, 0], [-spacingX, 0], [0, spacingZ], [0, -spacingZ]];
    for (const [x, z] of offsets) {
      const draft = validateAgentDraft({ ...source, name: `${source.name} copy`, pose: { ...source.pose, position: { x: source.pose.position.x + x, y: source.pose.position.y, z: source.pose.position.z + z } } });
      const ray: Ray3 = { origin: { x: draft.pose.position.x, y: draft.pose.position.y + 100, z: draft.pose.position.z }, direction: { x: 0, y: -1, z: 0 } };
      const preview = await this.previewAgentPlacement(draft, ray);
      if (!preview.valid || !preview.pose) continue;
      return this.commitAgent({ ...draft, pose: preview.pose }, preview.sceneRevision, this.generation);
    }
    throw new Error("No supported, non-overlapping position is available beside this agent.");
  }

  async deleteAgent(id: string): Promise<void> {
    if (!this.population.get(id)) return;
    await (await this.physics).removeAgent(id);
    this.population.remove(id);
    this.agentPresenter.remove(id);
    this.syncDocument();
  }

  private async commitAgent(draft: AgentDraft, revision: number, request: number): Promise<string> {
    const instance = this.population.create(draft);
    const snapshot = instance.snapshot();
    const presentation = await this.agentPresenter.prepare(snapshot);
    let physicsCommitted = false;
    try {
      if (this.disposed || request !== this.generation || revision !== this.sceneRevision) throw new Error("The placement result is stale. Try again.");
      await (await this.physics).addAgent(snapshot, revision);
      physicsCommitted = true;
      if (this.disposed || request !== this.generation) throw new Error("The placement result is stale. Try again.");
      this.agentPresenter.show(snapshot, presentation);
      this.population.commit(instance);
      this.syncDocument();
      return instance.id;
    } catch (error) {
      presentation.dispose();
      if (physicsCommitted) await (await this.physics).removeAgent(instance.id);
      throw error;
    }
  }

  private syncDocument(): void {
    this.document.replaceAgents(this.agents);
    this.onPopulationChanged(this.agents);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.presentation.dispose();
    this.population.clear();
    this.agentPresenter.clear();
    const world = await this.physics.catch(() => null);
    await world?.dispose();
  }
}
