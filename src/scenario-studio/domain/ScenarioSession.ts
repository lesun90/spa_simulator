import type { AssetManager } from "../../engine/AssetManager";
import type { SceneCatalog } from "../catalog/SceneCatalog";
import type { AgentCatalog } from "../catalog/AgentCatalog";
import type { AgentPhysicsInput, AgentTransform, PhysicsWorld } from "../physics/PhysicsWorld";
import type { AgentDraft, AgentPresenter, AgentSnapshot, PlacementPreview, Ray3, Vector3Value } from "./agent";
import { agentFootprintContainsPoint, agentSupportsFootprint, assetEntry, authoredBounds, placementOriginY, scaledAgentCollision, validateAgentDraft } from "./agent";
import { AgentPopulation } from "./AgentPopulation";
import type { DriveCommand, PlaybackState } from "./playback";
import { validateDriveCommand } from "./playback";
import type { ScenePresentation, ScenePresenter } from "./ScenePresentation";
import { ScenarioDocument } from "./ScenarioDocument";
import { sameSceneReference, type SceneReference } from "./scene";
import { validateScenarioRecord, type ScenarioRecord } from "./scenarioRecord";

/** Coordinates transactional scene and agent commits while rejecting obsolete asynchronous work. */
export class ScenarioSession {
  private generation = 0;
  private disposed = false;
  private presentation: ScenePresentation;
  private readonly population = new AgentPopulation();
  private readonly physics: Promise<PhysicsWorld>;
  private readonly ready: Promise<void>;
  private sceneRevision = 0;
  private playbackState: PlaybackState = "ready";
  private playbackGeneration = 0;
  private controlledAgentId: string | null = null;

  constructor(
    readonly document: ScenarioDocument,
    private readonly catalog: SceneCatalog,
    private readonly agentCatalog: AgentCatalog,
    private readonly presenter: ScenePresenter,
    physics: Promise<PhysicsWorld>,
    private readonly engineKey: string,
    private readonly agentPresenter: AgentPresenter,
    private readonly assetManager: AssetManager,
    private readonly onPopulationChanged: (agents: readonly AgentSnapshot[]) => void = () => {},
    private readonly onPlaybackChanged: (state: PlaybackState, message?: string) => void = () => {}
  ) {
    this.presentation = presenter.createDefault();
    presenter.show(this.presentation);
    this.physics = physics;
    this.ready = physics.then(async (world) => { this.sceneRevision = await world.replaceScene(this.presentation.geometry, this.document.materialFriction); });
    void this.ready.catch(() => {});
  }

  get agents(): readonly AgentSnapshot[] { return this.population.snapshots(); }
  get playback(): PlaybackState { return this.playbackState; }
  get controlledAgent(): string | null { return this.controlledAgentId; }

  async open(record: ScenarioRecord): Promise<void> {
    if (this.disposed) throw new Error("Scenario session was disposed.");
    const stagedRecord = validateScenarioRecord(record);
    if (stagedRecord.engineKey !== this.engineKey) throw new Error(`Physics engine “${stagedRecord.engineKey}” is not available.`);
    this.resetPlaybackState();
    const request = ++this.generation;
    let scenePresentation: ScenePresentation | null = null;
    const agentPresentations: { agent: AgentSnapshot; presentation: import("./agent").AgentPresentation }[] = [];
    try {
      const [world, choices, sceneData] = await Promise.all([
        this.physics,
        stagedRecord.agents.length ? this.agentCatalog.list() : Promise.resolve([]),
        stagedRecord.sceneReference ? this.catalog.load(stagedRecord.sceneReference) : Promise.resolve(null)
      ]);
      const agents = stagedRecord.agents.map((agent) => {
        const choice = choices.find((item) => item.asset.id === agent.asset.id && item.asset.key === agent.asset.key);
        if (!choice?.available) throw new Error(`Agent asset “${agent.asset.label}” is missing or unavailable.`);
        if (choice.asset.modelSha256 !== agent.asset.modelSha256 || choice.asset.metadataSha256 !== agent.asset.metadataSha256) {
          throw new Error(`Agent asset “${agent.asset.label}” changed since this scenario was saved.`);
        }
        return Object.freeze({ ...agent, asset: choice.asset });
      });
      const stagedPopulation = new AgentPopulation();
      stagedPopulation.replace(agents);
      scenePresentation = sceneData ? await this.presenter.prepare(sceneData) : this.presenter.createDefault();
      for (const agent of agents) agentPresentations.push({ agent, presentation: await this.agentPresenter.prepare(agent) });
      await this.ready;
      if (this.disposed || request !== this.generation) throw new Error("The scenario open result is stale. Try again.");
      const nextRevision = await world.replaceScene(scenePresentation.geometry, this.document.materialFriction);
      if (this.disposed || request !== this.generation) throw new Error("The scenario open result is stale. Try again.");

      this.presenter.show(scenePresentation);
      const oldPresentation = this.presentation;
      this.presentation = scenePresentation;
      scenePresentation = null;
      this.agentPresenter.clear();
      this.population.replace(agents);
      for (const staged of agentPresentations.splice(0)) this.agentPresenter.show(staged.agent, staged.presentation);
      this.sceneRevision = nextRevision;
      this.document.replaceWith({ ...stagedRecord, agents });
      this.onPopulationChanged(this.agents);
      oldPresentation.dispose();
    } finally {
      scenePresentation?.dispose();
      for (const staged of agentPresentations) staged.presentation.dispose();
    }
  }

  async replaceScene(reference: SceneReference): Promise<void> {
    if (this.disposed) return;
    if (sameSceneReference(this.document.sceneReference, reference)) return;
    this.resetPlaybackState();
    const request = ++this.generation;
    let prepared: ScenePresentation | null = null;
    try {
      const [data, world] = await Promise.all([this.catalog.load(reference), this.physics]);
      prepared = await this.presenter.prepare(data);
      await this.ready;
      if (this.disposed || request !== this.generation) return;
      const nextRevision = await world.replaceScene(prepared.geometry, this.document.materialFriction);
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
    const scenePreview = await (await this.physics).previewAgentPlacement(validDraft, ray, ignoreAgentId);
    const authoredPreview = previewAuthoredSupport(validDraft, ray, this.agents, ignoreAgentId, this.sceneRevision);
    const preview = nearestPreview(validDraft, ray, scenePreview, authoredPreview);
    if (!preview.valid || !preview.pose) return preview;
    const candidate = validateAgentDraft({ ...validDraft, pose: preview.pose });
    return this.population.overlaps(candidate, ignoreAgentId)
      ? { ...preview, valid: false, reason: "This position overlaps another agent." }
      : preview;
  }

  async placeAgent(draft: AgentDraft, ray: Ray3): Promise<void> {
    this.assertAuthoringAllowed();
    const validDraft = validateAgentDraft(draft);
    const request = this.generation;
    const preview = await this.previewAgentPlacement(validDraft, ray);
    if (!preview.valid || !preview.pose) throw new Error(preview.reason ?? "Agent placement is invalid.");
    await this.commitAgent({ ...validDraft, pose: preview.pose }, preview.sceneRevision, request);
  }

  async updateAgent(id: string, draft: AgentDraft, placementRay?: Ray3): Promise<void> {
    this.assertAuthoringAllowed();
    const instance = this.population.get(id);
    if (!instance) throw new Error("The selected agent no longer exists.");
    const validDraft = validateAgentDraft(draft);
    const current = instance.snapshot();
    if (!placementChanged(current, validDraft)) {
      instance.replace(validateAgentDraft({ ...validDraft, pose: { ...validDraft.pose, support: current.pose.support } }));
      this.agentPresenter.update(instance.snapshot());
      this.syncDocument();
      return;
    }
    if (this.population.hasDependents(id)) {
      throw new Error("Move or delete the agents resting on this agent before transforming it.");
    }
    const ray: Ray3 = placementRay ?? { origin: { x: validDraft.pose.position.x, y: validDraft.pose.position.y + 100, z: validDraft.pose.position.z }, direction: { x: 0, y: -1, z: 0 } };
    const preview = await this.previewAgentPlacement(validDraft, ray, id);
    if (!preview.valid || !preview.pose) throw new Error(preview.reason ?? "Agent transform is invalid.");
    const committed = validateAgentDraft({ ...validDraft, pose: preview.pose });
    instance.replace(committed);
    this.agentPresenter.update(instance.snapshot());
    this.syncDocument();
  }

  async duplicateAgent(id: string): Promise<string> {
    this.assertAuthoringAllowed();
    const source = this.population.get(id)?.snapshot();
    if (!source) throw new Error("The selected agent no longer exists.");
    const spacingX = source.collision.halfExtents.x * source.scale * 2 + 0.6;
    const spacingZ = source.collision.halfExtents.z * source.scale * 2 + 0.6;
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
    this.assertAuthoringAllowed();
    if (!this.population.get(id)) return;
    if (this.population.hasDependents(id)) {
      throw new Error("Move or delete the agents resting on this agent before deleting it.");
    }
    this.population.remove(id);
    this.agentPresenter.remove(id);
    this.syncDocument();
  }

  async play(): Promise<void> {
    if (this.disposed) throw new Error("Scenario session was disposed.");
    if (this.playbackState === "running" || this.playbackState === "preparing") return;
    if (this.playbackState === "paused") {
      this.playbackState = "running";
      this.onPlaybackChanged(this.playbackState);
      return;
    }
    if (this.playbackState !== "ready") throw new Error("Reset the scenario before playing again.");
    this.playbackState = "preparing";
    this.onPlaybackChanged(this.playbackState);
    const generation = ++this.playbackGeneration;
    const agents = this.agents;
    const controlledAgentId = agents.find((agent) => agent.inputEligible)?.id ?? null;
    try {
      const world = await this.physics;
      await this.ready;
      if (this.disposed || generation !== this.playbackGeneration) return;
      const physicsAgents = await this.resolvePhysicsInputs(agents);
      if (this.disposed || generation !== this.playbackGeneration) return;
      await world.preparePlayback(physicsAgents, controlledAgentId, this.sceneRevision, generation);
      if (this.disposed || generation !== this.playbackGeneration) {
        await world.resetPlayback(agents, generation).catch(() => {});
        return;
      }
      this.controlledAgentId = controlledAgentId;
      this.playbackState = "running";
      this.onPlaybackChanged(this.playbackState);
    } catch (error) {
      if (this.disposed || generation !== this.playbackGeneration) return;
      this.playbackState = "error";
      this.controlledAgentId = null;
      this.onPlaybackChanged(this.playbackState, error instanceof Error ? error.message : "Play failed.");
    }
  }

  pause(): void {
    if (this.playbackState !== "running") return;
    this.playbackState = "paused";
    this.onPlaybackChanged(this.playbackState);
  }

  reset(): void {
    if (this.disposed || this.playbackState === "ready") return;
    const generation = ++this.playbackGeneration;
    this.playbackState = "ready";
    this.controlledAgentId = null;
    const agents = this.agents;
    for (const agent of agents) this.agentPresenter.update(agent);
    this.onPlaybackChanged(this.playbackState);
    void this.physics.then((world) => world.resetPlayback(agents, generation)).catch(() => {});
  }

  drive(command: DriveCommand): void {
    if (this.disposed || this.playbackState !== "running") return;
    const generation = this.playbackGeneration;
    const validated = validateDriveCommand(command);
    void this.physics.then((world) => world.driveControlledAgent(validated, generation)).catch((error) => {
      if (this.disposed || generation !== this.playbackGeneration) return;
      this.playbackState = "error";
      this.controlledAgentId = null;
      this.onPlaybackChanged(this.playbackState, error instanceof Error ? error.message : "Drive command failed.");
    });
  }

  updateMaterialFriction(): void {
    void this.physics.then((world) => world.updateGroundFriction(this.document.materialFriction)).catch(() => {});
  }

  async stepPlayback(dt: number): Promise<readonly AgentTransform[] | null> {
    if (this.disposed || this.playbackState !== "running") return null;
    const generation = this.playbackGeneration;
    try {
      const world = await this.physics;
      const snapshot = await world.stepPlayback(dt, generation);
      if (this.disposed || generation !== this.playbackGeneration) return null;
      return snapshot.transforms;
    } catch (error) {
      if (this.disposed || generation !== this.playbackGeneration) return null;
      this.playbackState = "error";
      this.controlledAgentId = null;
      this.onPlaybackChanged(this.playbackState, error instanceof Error ? error.message : "Playback step failed.");
      return null;
    }
  }

  /** Resolves each physical-model vehicle's chassis hull from its real mesh; other agents pass through unchanged. */
  private async resolvePhysicsInputs(agents: readonly AgentSnapshot[]): Promise<readonly AgentPhysicsInput[]> {
    return Promise.all(agents.map(async (agent) => {
      if (agent.vehiclePhysicsModel !== "physical" || !agent.asset.wheels?.length) return agent;
      const excludeNodeNames = new Set(agent.asset.wheels.map((wheel) => wheel.wheelNode));
      const chassisHullPoints = await this.assetManager.getChassisHullPoints(assetEntry(agent), excludeNodeNames).catch(() => undefined);
      return chassisHullPoints ? { ...agent, chassisHullPoints } : agent;
    }));
  }

  private assertAuthoringAllowed(): void {
    if (this.disposed) throw new Error("Scenario session was disposed.");
    if (this.playbackState !== "ready") throw new Error("Pause playback and Reset before editing agents.");
  }

  private resetPlaybackState(): void {
    if (this.playbackState === "ready" && this.controlledAgentId === null) return;
    ++this.playbackGeneration;
    this.playbackState = "ready";
    this.controlledAgentId = null;
    this.onPlaybackChanged(this.playbackState);
  }

  private async commitAgent(draft: AgentDraft, revision: number, request: number): Promise<string> {
    const instance = this.population.create(draft);
    const snapshot = instance.snapshot();
    const presentation = await this.agentPresenter.prepare(snapshot);
    try {
      if (this.disposed || request !== this.generation || revision !== this.sceneRevision) throw new Error("The placement result is stale. Try again.");
      this.agentPresenter.show(snapshot, presentation);
      this.population.commit(instance);
      this.syncDocument();
      return instance.id;
    } catch (error) {
      presentation.dispose();
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
    ++this.playbackGeneration;
    this.presentation.dispose();
    this.population.clear();
    this.agentPresenter.clear();
    const world = await this.physics.catch(() => null);
    await world?.dispose();
  }
}

function placementChanged(current: AgentSnapshot, draft: AgentDraft): boolean {
  const epsilon = 0.000001;
  return Math.abs(current.scale - draft.scale) > epsilon ||
    Math.abs(current.pose.headingRadians - draft.pose.headingRadians) > epsilon ||
    Math.abs(current.pose.position.x - draft.pose.position.x) > epsilon ||
    Math.abs(current.pose.position.y - draft.pose.position.y) > epsilon ||
    Math.abs(current.pose.position.z - draft.pose.position.z) > epsilon;
}

function previewAuthoredSupport(
  draft: AgentDraft,
  ray: Ray3,
  agents: readonly AgentSnapshot[],
  ignoreAgentId: string | undefined,
  sceneRevision: number
): PlacementPreview | null {
  if (ray.direction.y >= -0.0001) return null;
  let nearest: { distance: number; support: AgentSnapshot; point: Vector3Value } | null = null;
  for (const support of agents) {
    if (support.id === ignoreAgentId) continue;
    const bounds = authoredBounds(support);
    const distance = (bounds.max.y - ray.origin.y) / ray.direction.y;
    if (distance < 0 || (nearest && distance >= nearest.distance)) continue;
    const point = addScaled(ray.origin, ray.direction, distance);
    if (!agentFootprintContainsPoint(support, point)) continue;
    nearest = { distance, support, point };
  }
  if (!nearest) return null;
  const pose = {
    position: { ...nearest.point, y: placementOriginY(draft, nearest.point.y) },
    headingRadians: draft.pose.headingRadians,
    support: { kind: "agent" as const, id: nearest.support.id }
  };
  const supported = agentSupportsFootprint(nearest.support, { ...draft, pose });
  return {
    valid: supported,
    pose,
    reason: supported ? null : "The agent footprint is not fully supported by this object.",
    sceneRevision
  };
}

function nearestPreview(draft: AgentDraft, ray: Ray3, scene: PlacementPreview, authored: PlacementPreview | null): PlacementPreview {
  if (!authored?.pose) return scene;
  if (!scene.pose) return authored;
  return previewDistance(draft, ray, authored) < previewDistance(draft, ray, scene) ? authored : scene;
}

function previewDistance(draft: AgentDraft, ray: Ray3, preview: PlacementPreview): number {
  if (!preview.pose) return Number.POSITIVE_INFINITY;
  const collision = scaledAgentCollision(draft);
  const surfaceY = preview.pose.position.y + collision.center.y - collision.halfExtents.y - draft.placement.clearance;
  const numerator = (preview.pose.position.x - ray.origin.x) * ray.direction.x +
    (surfaceY - ray.origin.y) * ray.direction.y +
    (preview.pose.position.z - ray.origin.z) * ray.direction.z;
  const denominator = ray.direction.x ** 2 + ray.direction.y ** 2 + ray.direction.z ** 2;
  return numerator / Math.max(denominator, 0.0001);
}

function addScaled(a: Vector3Value, b: Vector3Value, scale: number): Vector3Value {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}
