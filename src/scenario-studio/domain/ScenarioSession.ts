import type { AssetManager } from "../../engine/AssetManager";
import type { SceneCatalog } from "../catalog/SceneCatalog";
import type { AgentCatalog } from "../catalog/AgentCatalog";
import type { AgentPhysicsInput, AgentTransform, PhysicsWorld } from "../physics/PhysicsWorld";
import type { AgentDraft, AgentPresenter, SceneObjectSnapshot, PlacementPreview, Ray3, Vector3Value } from "./agent";
import { agentFootprintContainsPoint, agentSupportsFootprint, assetEntry, authoredBounds, isDrivenVehicle, placementOriginY, scaledAgentCollision, validateAgentDraft } from "./agent";
import { AgentPopulation } from "./AgentPopulation";
import type { DriveCommand, PlaybackState } from "./playback";
import type { ScenePresentation, ScenePresenter } from "./ScenePresentation";
import { ScenarioDocument } from "./ScenarioDocument";
import { sameSceneReference, type SceneReference } from "./scene";
import { validateScenarioRecord, type ScenarioRecord } from "./scenarioRecord";
import { ScenarioSimulation } from "./ScenarioSimulation";
import { InProcessMiddleware, type Advertisement, type SimulationTime, type Subscription } from "../runtime/Middleware";
import { agentStateChannel, capabilityChannel, commandStatusChannel, keyboardChannel, lifecycleChannel, tickChannel, vehicleControlChannel, type CommandStatusMessage, type VehicleCommandMessage } from "../runtime/messages";
import type { ControllerDiagnostic, ControllerRuntime } from "../runtime/ManagedControllerClient";

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
  private readonly middleware = new InProcessMiddleware();
  private simulation: ScenarioSimulation | null = null;
  private runtimeAdvertisements: Advertisement[] = [];
  private runtimeSubscriptions: Subscription[] = [];
  private readonly permanentAdvertisements: Advertisement[];
  private readonly sessionId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `session-${Date.now()}`;
  private playbackStep = 0;
  private playbackTime = 0;

  constructor(
    readonly document: ScenarioDocument,
    private readonly catalog: SceneCatalog,
    private readonly agentCatalog: AgentCatalog,
    private readonly presenter: ScenePresenter,
    physics: Promise<PhysicsWorld>,
    private readonly engineKey: string,
    private readonly agentPresenter: AgentPresenter,
    private readonly assetManager: AssetManager,
    private readonly controllers: ControllerRuntime,
    private readonly onPopulationChanged: (agents: readonly SceneObjectSnapshot[]) => void = () => {},
    private readonly onPlaybackChanged: (state: PlaybackState, message?: string) => void = () => {},
    private readonly onControllerDiagnostic: (diagnostic: ControllerDiagnostic | CommandStatusMessage) => void = () => {}
  ) {
    this.presentation = presenter.createDefault();
    presenter.show(this.presentation);
    this.physics = physics;
    this.ready = physics.then(async (world) => { this.sceneRevision = await world.replaceScene(this.presentation.geometry, this.document.materialFriction); });
    void this.ready.catch(() => {});
    this.permanentAdvertisements = [this.middleware.advertise(lifecycleChannel), this.middleware.advertise(tickChannel), this.middleware.advertise(keyboardChannel), this.middleware.advertise(commandStatusChannel)];
  }

  get agents(): readonly SceneObjectSnapshot[] { return this.population.snapshots(); }
  get playback(): PlaybackState { return this.playbackState; }

  async open(record: ScenarioRecord): Promise<void> {
    if (this.disposed) throw new Error("Scenario session was disposed.");
    const stagedRecord = validateScenarioRecord(record);
    if (stagedRecord.engineKey !== this.engineKey) throw new Error(`Physics engine “${stagedRecord.engineKey}” is not available.`);
    this.resetPlaybackState();
    const request = ++this.generation;
    let scenePresentation: ScenePresentation | null = null;
    const agentPresentations: { agent: SceneObjectSnapshot; presentation: import("./agent").AgentPresentation }[] = [];
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
      await this.simulation?.resume();
      this.setPlaybackState("running");
      return;
    }
    if (this.playbackState !== "ready") throw new Error("Reset the scenario before playing again.");
    const generation = ++this.playbackGeneration;
    this.setPlaybackState("preparing");
    const agents = this.agents;
    try {
      const world = await this.physics;
      await this.ready;
      if (this.disposed || generation !== this.playbackGeneration) return;
      const physicsAgents = await this.resolvePhysicsInputs(agents);
      if (this.disposed || generation !== this.playbackGeneration) return;
      const resourceIds = await world.preparePlayback(physicsAgents, this.sceneRevision, generation);
      if (this.disposed || generation !== this.playbackGeneration) {
        await world.resetPlayback(agents, generation).catch(() => {});
        return;
      }
      this.middleware.beginRun(this.sessionId, generation);
      this.playbackStep = 0;
      this.playbackTime = 0;
      await this.createSimulation(agents, generation, world, resourceIds);
      const diagnostics = await this.controllers.start(this.sessionId, generation, this.document.controllers, this.document.controllerAssignments, agents.map((agent) => agent.id));
      if (this.disposed || generation !== this.playbackGeneration) return;
      for (const diagnostic of diagnostics) this.onControllerDiagnostic(diagnostic);
      this.setPlaybackState("running");
    } catch (error) {
      if (this.disposed || generation !== this.playbackGeneration) return;
      void this.disposeSimulation();
      await this.controllers.stop();
      const world = await this.physics.catch(() => null);
      await world?.resetPlayback(agents, generation).catch(() => {});
      this.setPlaybackState("error", error instanceof Error ? error.message : "Play failed.");
    }
  }

  pause(): void {
    if (this.playbackState !== "running") return;
    void this.simulation?.pause();
    this.setPlaybackState("paused");
  }

  reset(): void {
    if (this.disposed || this.playbackState === "ready") return;
    const generation = ++this.playbackGeneration;
    void this.disposeSimulation();
    void this.controllers.stop().then((diagnostics) => diagnostics.forEach((diagnostic) => this.onControllerDiagnostic(diagnostic)));
    const agents = this.agents;
    for (const agent of agents) this.agentPresenter.update(agent);
    this.playbackStep = 0;
    this.playbackTime = 0;
    this.setPlaybackState("ready");
    void this.physics.then((world) => world.resetPlayback(agents, generation)).catch(() => {});
  }

  driveWithKeyboard(command: DriveCommand): void {
    if (this.disposed || this.playbackState !== "running" || !this.simulation) return;
    const target = this.agents.find((agent) => agent.inputEligible && isDrivenVehicle(agent) && this.simulation!.registry.has(agent.id));
    if (!target) return;
    const time = this.simulationTime();
    this.middleware.publish(vehicleControlChannel(target.id), { type: "vehicle-command", correlationId: `keyboard:${this.playbackStep}`, source: "keyboard", sessionId: this.sessionId, generation: this.playbackGeneration, targetStep: this.playbackStep + 1, ...command }, time);
  }

  publishKeyboard(code: string, pressed: boolean): void {
    if (this.playbackState !== "running") return;
    this.middleware.publish(keyboardChannel, { type: "keyboard", code, pressed }, this.simulationTime());
  }

  updateMaterialFriction(): void {
    void this.physics.then((world) => world.updateGroundFriction(this.document.materialFriction)).catch(() => {});
  }

  async stepPlayback(dt: number): Promise<readonly AgentTransform[] | null> {
    if (this.disposed || this.playbackState !== "running" || !this.simulation) return null;
    const simulation = this.simulation;
    const generation = this.playbackGeneration;
    try {
      const world = await this.physics;
      const time = this.simulationTime();
      this.middleware.publish(tickChannel, { type: "tick", generation, step: this.playbackStep, timeSeconds: this.playbackTime, dt }, time);
      const controllerResult = await this.controllers.tick(this.playbackStep, this.playbackTime, dt);
      if (this.disposed || generation !== this.playbackGeneration || this.playbackState !== "running") return null;
      for (const diagnostic of controllerResult.diagnostics) this.onControllerDiagnostic(diagnostic);
      for (const command of controllerResult.commands) this.middleware.publish(vehicleControlChannel(command.agentId), command.message, time);
      // Sends every queued command's worker request synchronously and is not awaited here: its postMessage is
      // already in flight (and ordered ahead of stepPlayback's) by the time this call returns, so waiting for the
      // full round trip before stepping would only add latency without changing what gets applied this step.
      simulation.flushQueued();
      const snapshot = await world.stepPlayback(dt, generation);
      if (this.disposed || generation !== this.playbackGeneration) return null;
      this.playbackStep++;
      this.playbackTime += dt;
      simulation.ingest(snapshot.transforms);
      const stateTime = { step: this.playbackStep, seconds: this.playbackTime };
      for (const transform of snapshot.transforms) this.middleware.publish(agentStateChannel(transform.id), { type: "agent-state", agentId: transform.id, transform }, stateTime);
      return snapshot.transforms;
    } catch (error) {
      if (this.disposed || generation !== this.playbackGeneration) return null;
      void this.disposeSimulation();
      await this.controllers.stop();
      const world = await this.physics.catch(() => null);
      await world?.resetPlayback(this.agents, generation).catch(() => {});
      this.setPlaybackState("error", error instanceof Error ? error.message : "Playback step failed.");
      return null;
    }
  }

  /** Applies every live SceneObject's interpolated pose; call once per render frame regardless of when physics data last arrived. */
  presentPlayback(now: number): void { this.simulation?.present(now); }

  /** Resolves each physical-model vehicle's chassis hull from its real mesh; other agents pass through unchanged. */
  private async resolvePhysicsInputs(agents: readonly SceneObjectSnapshot[]): Promise<readonly AgentPhysicsInput[]> {
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
    if (this.playbackState === "ready") return;
    const generation = ++this.playbackGeneration;
    void this.disposeSimulation();
    void this.controllers.stop();
    this.playbackStep = 0;
    this.playbackTime = 0;
    this.setPlaybackState("ready");
    void this.physics.then((world) => world.resetPlayback(this.agents, generation)).catch(() => {});
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

  /** Builds one SceneObject per agent (Vehicle for drive-eligible vehicles, RigidObject otherwise) and wires keyboard/controller commands into it. */
  private async createSimulation(agents: readonly SceneObjectSnapshot[], generation: number, world: PhysicsWorld, resourceIds: readonly { readonly id: string; readonly resourceId: number }[]): Promise<void> {
    await this.disposeSimulation();
    const simulation = new ScenarioSimulation(generation);
    const resourceIdByAgent = new Map(resourceIds.map((entry) => [entry.id, entry.resourceId]));
    const time = { seconds: 0, step: 0 };
    for (const agent of agents) {
      const resourceId = resourceIdByAgent.get(agent.id);
      if (resourceId === undefined) continue;
      await simulation.spawn(agent, world, this.agentPresenter, resourceId);
      const capabilities = capabilityChannel(agent.id);
      this.runtimeAdvertisements.push(this.middleware.advertise(agentStateChannel(agent.id)), this.middleware.advertise(capabilities));
      this.middleware.publish(capabilities, { type: "capabilities", agentId: agent.id, capabilities: isDrivenVehicle(agent) ? ["vehicle.control"] : [] }, time);
      if (isDrivenVehicle(agent)) {
        this.runtimeSubscriptions.push(this.middleware.subscribe(vehicleControlChannel(agent.id), (event) => this.queueVehicleCommand(simulation, agent.id, event.message)));
      }
    }
    this.simulation = simulation;
  }

  private queueVehicleCommand(simulation: ScenarioSimulation, agentId: string, message: VehicleCommandMessage): void {
    simulation.queueDispatch(
      {
        objectId: agentId,
        resourceId: null,
        generation: message.generation,
        targetStep: message.targetStep,
        sequence: message.targetStep,
        action: { kind: "drive", command: message }
      },
      (accepted, statusMessage) => {
        const status: CommandStatusMessage = { type: "command-status", correlationId: message.correlationId, source: message.source, agentId, accepted, message: statusMessage };
        this.middleware.publish(commandStatusChannel, status, this.simulationTime());
        this.onControllerDiagnostic(status);
      }
    );
  }

  /** Nulls `this.simulation` synchronously so no new work is scheduled against it, then releases its objects and channels in the background. */
  private disposeSimulation(): Promise<void> {
    const simulation = this.simulation;
    this.simulation = null;
    for (const subscription of this.runtimeSubscriptions.splice(0)) subscription.dispose();
    for (const advertisement of this.runtimeAdvertisements.splice(0)) advertisement.dispose();
    return simulation ? simulation.dispose() : Promise.resolve();
  }

  private simulationTime(): SimulationTime { return { seconds: this.playbackTime, step: this.playbackStep }; }
  private setPlaybackState(state: PlaybackState, message?: string): void {
    this.playbackState = state;
    this.onPlaybackChanged(state, message);
    this.publishLifecycle();
  }
  private publishLifecycle(): void { this.middleware.publish(lifecycleChannel, { type: "lifecycle", state: this.playbackState, sessionId: this.sessionId, generation: this.playbackGeneration }, { seconds: this.playbackTime, step: this.playbackStep }); }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    ++this.playbackGeneration;
    await this.disposeSimulation();
    for (const advertisement of this.permanentAdvertisements) advertisement.dispose();
    this.middleware.dispose();
    await this.controllers.stop();
    this.presentation.dispose();
    this.population.clear();
    this.agentPresenter.clear();
    const world = await this.physics.catch(() => null);
    await world?.dispose();
  }
}

function placementChanged(current: SceneObjectSnapshot, draft: AgentDraft): boolean {
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
  agents: readonly SceneObjectSnapshot[],
  ignoreAgentId: string | undefined,
  sceneRevision: number
): PlacementPreview | null {
  if (ray.direction.y >= -0.0001) return null;
  let nearest: { distance: number; support: SceneObjectSnapshot; point: Vector3Value } | null = null;
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
