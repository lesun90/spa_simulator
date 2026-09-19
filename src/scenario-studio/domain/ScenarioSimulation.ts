import { isDrivenVehicle, type AgentPresenter, type AgentSnapshot } from "./agent";
import type { AgentTransform, PhysicsWorld } from "../physics/PhysicsWorld";
import { SceneObjectRegistry } from "./SceneObjectRegistry";
import { Vehicle } from "./Vehicle";
import { RigidObject } from "./RigidObject";
import type { BodyPose, SceneObjectActionEnvelope, VehiclePoseFrame, VisualObjectPoseFrame } from "./SceneObjectPorts";

/** Below this the render delay adapts down; above it, up — keeps interpolation tight when physics keeps pace, forgiving when it doesn't. */
const INITIAL_RENDER_DELAY_MS = 33;
const MIN_RENDER_DELAY_MS = 16;
const MAX_RENDER_DELAY_MS = 250;

function headingToQuaternion(headingRadians: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(headingRadians / 2), z: 0, w: Math.cos(headingRadians / 2) };
}

/** Authored placement, before any physics tick has run; the object briefly presents this until the first real pose arrives. */
function authoredPose(agent: AgentSnapshot, generation: number, topologyVersion: number): VehiclePoseFrame | VisualObjectPoseFrame {
  const body: BodyPose = { worldPositionMeters: agent.pose.position, worldOrientation: headingToQuaternion(agent.pose.headingRadians) };
  if (!isDrivenVehicle(agent)) return { resourceId: 0, generation, physicsStep: 0, topologyVersion, body };
  const wheels = (agent.asset.wheels ?? []).map((wheel) => ({ wheelId: wheel.id, suspensionBody: body, steeringBody: body, tireBody: body }));
  return { resourceId: 0, generation, physicsStep: 0, topologyVersion, chassis: body, wheels };
}

function transformToPose(transform: AgentTransform, generation: number, physicsStep: number, topologyVersion: number): VehiclePoseFrame | VisualObjectPoseFrame {
  const body: BodyPose = { worldPositionMeters: transform.position, worldOrientation: transform.rotation };
  if (!transform.wheels) return { resourceId: 0, generation, physicsStep, topologyVersion, body };
  return { resourceId: 0, generation, physicsStep, topologyVersion, chassis: body, wheels: transform.wheels };
}

/**
 * Owns the live SceneObjectRegistry for one playback run: builds a SceneObject per agent right after
 * `preparePlayback` succeeds, feeds it physics-derived poses every tick, and presents interpolated
 * poses every render frame. Physics stays the sole authority for a physical vehicle's pose; this
 * class never integrates, derives, or reconstructs motion of its own.
 */
export class ScenarioSimulation {
  readonly registry = new SceneObjectRegistry();
  private topologyVersion = 0;
  private step = 0;
  private lastIngestAtMs: number | null = null;
  private renderDelayMs = INITIAL_RENDER_DELAY_MS;
  private previousTickAtMs = 0;
  private currentTickAtMs = 0;

  constructor(private readonly generation: number) {}

  async spawn(agent: AgentSnapshot, world: PhysicsWorld, presenter: AgentPresenter, resourceId: number): Promise<void> {
    const pose = authoredPose(agent, this.generation, this.topologyVersion);
    if (isDrivenVehicle(agent)) {
      const presentation = presenter.createVehiclePresentationPort(agent);
      await this.registry.spawn(agent.id, presentation, async () =>
        new Vehicle(agent.id, presentation, this.generation, pose as VehiclePoseFrame, world.createVehiclePhysicsPort(resourceId)));
    } else {
      const presentation = presenter.createBodyPresentationPort(agent);
      await this.registry.spawn(agent.id, presentation, async () =>
        new RigidObject(agent.id, presentation, this.generation, pose as VisualObjectPoseFrame, world.createRigidBodyPhysicsPort(resourceId)));
    }
    this.topologyVersion += 1;
  }

  async remove(id: string): Promise<void> {
    await this.registry.remove(id);
    this.topologyVersion += 1;
  }

  queueDispatch(envelope: SceneObjectActionEnvelope, onSettled: (accepted: boolean, message: string) => void): void {
    this.registry.queueDispatch(envelope, onSettled);
  }

  /** Sends every queued action ahead of the physics step; call immediately before `world.stepPlayback`. */
  flushQueued(): void { this.registry.flushQueued(); }

  /** Records this tick's physics-derived poses; call with the transforms `world.stepPlayback` just returned. */
  ingest(transforms: readonly AgentTransform[]): void {
    this.step += 1;
    const now = performance.now();
    if (this.lastIngestAtMs !== null) {
      // Track the physics round trip's own cadence and stay a little ahead of it, so interpolation rarely
      // runs out of "current" data (which would otherwise freeze the pose until the next snapshot arrives).
      const interval = now - this.lastIngestAtMs;
      const target = Math.min(Math.max(interval * 1.25, MIN_RENDER_DELAY_MS), MAX_RENDER_DELAY_MS);
      this.renderDelayMs += (target - this.renderDelayMs) * 0.2;
    }
    this.lastIngestAtMs = now;
    this.previousTickAtMs = this.currentTickAtMs;
    this.currentTickAtMs = now;
    for (const transform of transforms) {
      if (!this.registry.has(transform.id)) continue;
      this.registry.acceptPose(transform.id, transformToPose(transform, this.generation, this.step, this.topologyVersion));
    }
  }

  /** Applies every live object's interpolated pose; call once per render frame regardless of when physics data last arrived. */
  present(now: number): void {
    const span = this.currentTickAtMs - this.previousTickAtMs;
    const alpha = span > 0 ? Math.min(Math.max((now - this.renderDelayMs - this.previousTickAtMs) / span, 0), 1) : 1;
    this.registry.presentAll(alpha);
  }

  async pause(): Promise<void> { await this.registry.pauseAll(); this.registry.clearQueued(); }
  async resume(): Promise<void> { await this.registry.resumeAll(); }

  async dispose(): Promise<void> { await this.registry.disposeAll(); }
}
