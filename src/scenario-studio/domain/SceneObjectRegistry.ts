import type { SceneObject } from "./SceneObject";
import type { PresentationPort, SceneObjectActionEnvelope, SceneObjectPoseFrame } from "./SceneObjectPorts";

interface QueuedDispatch {
  readonly envelope: SceneObjectActionEnvelope;
  readonly onSettled: (accepted: boolean, message: string) => void;
}

/**
 * Owns lookup, spawn/remove transactions, and action delivery for every live SceneObject. Does not
 * inspect subtype internals: every action reaches its target through the one generic `dispatch`
 * entry point SceneObject already exposes.
 */
export class SceneObjectRegistry {
  private readonly objects = new Map<string, SceneObject<any>>();
  private readonly queued = new Map<string, QueuedDispatch>();

  has(id: string): boolean { return this.objects.has(id); }

  async spawn(id: string, presentation: PresentationPort<any>, build: () => Promise<SceneObject<any>>): Promise<string> {
    if (this.objects.has(id)) throw new Error(`SceneObject ${id} already registered.`);
    let prepared = false;
    try {
      await presentation.prepare();
      prepared = true;
      const object = await build();
      this.objects.set(id, object);
      presentation.activate();
      return id;
    } catch (error) {
      if (prepared) presentation.release();
      throw error;
    }
  }

  async dispatch(envelope: SceneObjectActionEnvelope): Promise<void> {
    const object = this.objects.get(envelope.objectId);
    if (!object) throw new Error(`No live SceneObject for ${envelope.objectId}.`);
    await object.dispatch(envelope);
  }

  /**
   * Stores the latest action per object for this tick without sending anything yet — last write per
   * object wins, matching one command in flight per object per tick. Callers that need per-command
   * acceptance feedback (e.g. publishing it back over a status channel) get it through `onSettled`.
   */
  queueDispatch(envelope: SceneObjectActionEnvelope, onSettled: (accepted: boolean, message: string) => void): void {
    this.queued.set(envelope.objectId, { envelope, onSettled });
  }

  /**
   * Sends every queued action's underlying request synchronously, without awaiting its round trip, so
   * each one is ordered ahead of whatever physics step the caller issues right after this returns.
   */
  flushQueued(): void {
    for (const [id, { envelope, onSettled }] of this.queued) {
      this.queued.delete(id);
      this.dispatch(envelope).then(
        () => onSettled(true, "Command accepted."),
        (error) => onSettled(false, error instanceof Error ? error.message : "Command was rejected.")
      );
    }
  }

  clearQueued(): void { this.queued.clear(); }

  async remove(id: string): Promise<void> {
    const object = this.objects.get(id);
    if (!object) return; // repeated removal is a no-op
    this.objects.delete(id); // reject later dispatch immediately; SceneObject.dispose sequences physics release before presentation release
    await object.dispose();
  }

  presentAll(alpha: number): void {
    for (const object of this.objects.values()) object.present(alpha);
  }

  acceptPose(id: string, pose: SceneObjectPoseFrame): void {
    (this.objects.get(id) as SceneObject<SceneObjectPoseFrame> | undefined)?.acceptPhysicsPose(pose);
  }

  async pauseAll(): Promise<void> { for (const object of this.objects.values()) await object.pause(); }
  async resumeAll(): Promise<void> { for (const object of this.objects.values()) await object.resume(); }
  async resetAll(generation: number): Promise<void> { for (const object of this.objects.values()) await object.reset(generation); }

  async disposeAll(): Promise<void> {
    for (const object of this.objects.values()) await object.dispose();
    this.objects.clear();
    this.queued.clear();
  }
}
