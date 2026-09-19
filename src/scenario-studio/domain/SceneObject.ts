import type { PresentationPort, SceneObjectAction, SceneObjectActionEnvelope, SceneObjectPoseFrame } from "./SceneObjectPorts";

type SceneObjectState = "ready" | "running" | "paused" | "removing" | "disposed";

/**
 * One authoritative runtime object per live entity. Owns identity, lifecycle validation, the
 * two-frame pose buffer, and presentation; a physics-bearing subtype additionally owns a physics
 * port. `resetPhysics`/`releasePhysics` default to no-ops rather than staying abstract, since a
 * purely visual subtype (no physics port) must not be forced to implement physics lifecycle hooks
 * it has nothing to do with.
 */
export abstract class SceneObject<TPose extends SceneObjectPoseFrame> {
  private previousPose: TPose;
  private currentPose: TPose;
  private generation: number;
  private state: SceneObjectState = "ready";
  private lastSequence = -1;

  constructor(
    readonly id: string,
    private readonly presentation: PresentationPort<TPose>,
    initialGeneration: number,
    initialPose: TPose
  ) {
    this.generation = initialGeneration;
    this.previousPose = initialPose;
    this.currentPose = initialPose;
  }

  async dispatch(envelope: SceneObjectActionEnvelope): Promise<void> {
    if (this.state === "removing" || this.state === "disposed") throw new Error(`SceneObject ${this.id} is ${this.state} and cannot accept actions.`);
    if (envelope.objectId !== this.id) throw new Error(`Action addressed to ${envelope.objectId} delivered to ${this.id}.`);
    if (envelope.generation !== this.generation) throw new Error(`Action generation ${envelope.generation} is stale; current is ${this.generation}.`);
    if (envelope.sequence <= this.lastSequence) throw new Error(`Action sequence ${envelope.sequence} is stale or duplicate; last accepted was ${this.lastSequence}.`);
    this.lastSequence = envelope.sequence;
    await this.applyAction(envelope.action);
  }

  acceptPhysicsPose(pose: TPose): void {
    if (pose.generation !== this.generation) return;
    if (pose.topologyVersion < this.currentPose.topologyVersion) return;
    this.previousPose = this.currentPose;
    this.currentPose = pose;
  }

  present(interpolationAlpha: number): void {
    if (this.state === "disposed") return;
    this.presentation.applyPose(this.previousPose, this.currentPose, interpolationAlpha);
  }

  async pause(): Promise<void> {
    if (this.state !== "running") return;
    this.state = "paused";
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") return;
    this.state = "running";
  }

  async reset(generation: number): Promise<void> {
    this.generation = generation;
    this.lastSequence = -1;
    await this.resetPhysics();
    this.presentation.reset();
    this.state = "ready";
  }

  async dispose(): Promise<void> {
    if (this.state === "disposed") return;
    this.state = "disposed";
    await this.releasePhysics();
    this.presentation.release();
  }

  protected currentGeneration(): number { return this.generation; }
  protected setState(state: SceneObjectState): void { this.state = state; }

  protected abstract applyAction(action: SceneObjectAction): Promise<void>;
  protected async resetPhysics(): Promise<void> {}
  protected async releasePhysics(): Promise<void> {}
}
