import type { AgentSnapshot } from "../domain/agent";
import { validateDriveCommand } from "../domain/playback";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { Advertisement, Middleware, SimulationTime, Subscription } from "./Middleware";
import { vehicleControlChannel, type CommandStatusMessage, type VehicleCommandMessage } from "./messages";

export interface CommandContext { readonly sessionId: string; readonly generation: number; readonly step: number; readonly time: SimulationTime; }
export interface AgentComponent { readonly key: string; readonly capabilities: readonly string[]; setContext(context: CommandContext): void; flush(): Promise<void>; clear(): void; dispose(): void; }

export class VehicleComponent implements AgentComponent {
  readonly key = "vehicle";
  readonly capabilities = Object.freeze(["vehicle.control"]);
  private readonly advertisement: Advertisement;
  private readonly subscription: Subscription;
  private context: CommandContext | null = null;
  private pending: Promise<void> = Promise.resolve();
  private queued: VehicleCommandMessage | null = null;
  private disposed = false;

  constructor(readonly agentId: string, middleware: Middleware, private readonly physics: PhysicsWorld, private readonly publishStatus: (status: CommandStatusMessage, time: SimulationTime) => void) {
    const control = vehicleControlChannel(agentId);
    this.advertisement = middleware.advertise(control);
    this.subscription = middleware.subscribe(control, (event) => this.applyCommand(event.message));
  }
  setContext(context: CommandContext): void { this.context = context; }
  /**
   * Sends the queued command's worker request synchronously (before returning) so its postMessage lands ahead of
   * the stepPlayback request the caller issues right after flush() returns, without making the caller wait for
   * the driveAgent round trip itself — halving per-step physics latency versus awaiting it first.
   */
  flush(): Promise<void> {
    const message = this.queued;
    this.queued = null;
    if (!message) return this.pending;
    const context = this.context;
    try {
      if (!context || message.sessionId !== context.sessionId || message.generation !== context.generation || message.targetStep !== context.step + 1) throw new Error("Command became stale before its target step.");
      const command = validateDriveCommand(message);
      const sent = this.physics.driveAgent(this.agentId, command, context.generation);
      this.pending = this.pending.then(() => sent).then(
        () => this.status(message, true, "Command accepted.", context.time),
        (error) => this.status(message, false, error instanceof Error ? error.message : "Drive command failed.", context.time)
      );
    } catch (error) { this.status(message, false, error instanceof Error ? error.message : "Command was rejected.", context?.time ?? { seconds: 0, step: 0 }); }
    return this.pending;
  }
  clear(): void { const context = this.context; this.context = null; this.queued = null; if (context) this.pending = this.pending.then(() => this.physics.driveAgent(this.agentId, { throttle: 0, steering: 0, brake: 0 }, context.generation)).catch(() => {}); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.clear(); this.subscription.dispose(); this.advertisement.dispose(); }

  private applyCommand(message: VehicleCommandMessage): void {
    const context = this.context;
    try {
      if (!context) throw new Error("The vehicle component is not running.");
      if (message.source !== "keyboard" && !message.source.startsWith("controller:")) throw new Error("Command source is not authorized for vehicle control.");
      if (message.sessionId !== context.sessionId || message.generation !== context.generation) throw new Error("Command belongs to a stale run.");
      if (message.targetStep !== context.step + 1) throw new Error(`Command target step ${message.targetStep} is stale; expected ${context.step + 1}.`);
      validateDriveCommand(message);
      this.queued = message;
    } catch (error) { this.status(message, false, error instanceof Error ? error.message : "Command was rejected.", context?.time ?? { seconds: 0, step: 0 }); }
  }
  private status(command: VehicleCommandMessage, accepted: boolean, message: string, time: SimulationTime): void { this.publishStatus({ type: "command-status", correlationId: command.correlationId, source: command.source, agentId: this.agentId, accepted, message }, time); }
}

export class AgentComponentRegistry {
  create(agent: AgentSnapshot, middleware: Middleware, physics: PhysicsWorld, publishStatus: (status: CommandStatusMessage, time: SimulationTime) => void): readonly AgentComponent[] {
    return agent.asset.category === "vehicles" && agent.vehicle && agent.asset.wheels?.length ? [new VehicleComponent(agent.id, middleware, physics, publishStatus)] : [];
  }
}
