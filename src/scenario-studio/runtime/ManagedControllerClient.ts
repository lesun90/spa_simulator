import type { ControllerAssignment, ControllerScript } from "../domain/controller";
import type { VehicleCommandMessage } from "./messages";

export interface ControllerDiagnostic { readonly controllerId: string; readonly agentId: string | null; readonly level: "info" | "error"; readonly message: string; }
interface ManagedCommand { readonly controllerId: string; readonly agentId: string; readonly correlationId: string; readonly targetStep: number; readonly throttle: number; readonly steering: number; readonly brake: number; }

export interface ControllerTickResult { readonly commands: readonly { readonly agentId: string; readonly message: VehicleCommandMessage }[]; readonly diagnostics: readonly ControllerDiagnostic[]; }
export interface ControllerRuntime {
  validate(source: string): Promise<void>;
  start(sessionId: string, generation: number, controllers: readonly ControllerScript[], assignments: readonly ControllerAssignment[], agentIds: readonly string[]): Promise<readonly ControllerDiagnostic[]>;
  tick(step: number, seconds: number, dt: number): Promise<ControllerTickResult>;
  stop(): Promise<readonly ControllerDiagnostic[]>;
}

/** Browser adapter for backend-owned managed JavaScript lifecycles. */
export class ManagedControllerClient implements ControllerRuntime {
  private runId: string | null = null;
  private sessionId = "";
  private generation = 0;
  private operation = 0;

  async validate(source: string): Promise<void> { await request("/api/scenario-studio/controllers/validate", { source }); }

  async start(sessionId: string, generation: number, controllers: readonly ControllerScript[], assignments: readonly ControllerAssignment[], agentIds: readonly string[]): Promise<readonly ControllerDiagnostic[]> {
    const operation = ++this.operation;
    await this.stopCurrent();
    const payload = await request<{ runId: string; diagnostics: ControllerDiagnostic[] }>("/api/scenario-studio/controller-runs/start", { sessionId, generation, controllers, assignments, agentIds });
    if (operation !== this.operation) {
      await this.stopRun(payload.runId, sessionId, generation);
      return payload.diagnostics;
    }
    this.runId = payload.runId;
    this.sessionId = sessionId;
    this.generation = generation;
    return payload.diagnostics;
  }

  async tick(step: number, seconds: number, dt: number): Promise<ControllerTickResult> {
    if (!this.runId) return { commands: [], diagnostics: [] };
    const payload = await request<{ commands: ManagedCommand[]; diagnostics: ControllerDiagnostic[] }>(`/api/scenario-studio/controller-runs/${encodeURIComponent(this.runId)}/tick`, { sessionId: this.sessionId, generation: this.generation, step, seconds, dt });
    return {
      diagnostics: payload.diagnostics,
      commands: payload.commands.map((command) => ({ agentId: command.agentId, message: { type: "vehicle-command", correlationId: command.correlationId, source: `controller:${command.controllerId}`, sessionId: this.sessionId, generation: this.generation, targetStep: command.targetStep, throttle: command.throttle, steering: command.steering, brake: command.brake } }))
    };
  }

  async stop(): Promise<readonly ControllerDiagnostic[]> {
    ++this.operation;
    return this.stopCurrent();
  }

  private async stopCurrent(): Promise<readonly ControllerDiagnostic[]> {
    const runId = this.runId;
    if (!runId) return [];
    const sessionId = this.sessionId;
    const generation = this.generation;
    this.runId = null;
    return this.stopRun(runId, sessionId, generation);
  }

  private async stopRun(runId: string, sessionId: string, generation: number): Promise<readonly ControllerDiagnostic[]> {
    try {
      const payload = await request<{ diagnostics: ControllerDiagnostic[] }>(`/api/scenario-studio/controller-runs/${encodeURIComponent(runId)}/stop`, { sessionId, generation });
      return payload.diagnostics;
    } catch { return []; }
  }
}

async function request<T = { valid: true }>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    try { throw new Error((await response.json() as { error?: string }).error ?? `Controller request failed (${response.status}).`); }
    catch (error) { if (error instanceof Error) throw error; throw new Error(`Controller request failed (${response.status}).`); }
  }
  return response.json() as Promise<T>;
}
