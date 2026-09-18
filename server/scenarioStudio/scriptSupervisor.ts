import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { validateDriveCommand, type DriveCommand } from "../../src/scenario-studio/domain/playback";
import { validateControllerAssignment, validateControllerScript, type ControllerAssignment, type ControllerScript } from "../../src/scenario-studio/domain/controller";

const EXECUTION_TIMEOUT_MS = 10;
const MAX_COMMANDS_PER_TICK = 32;
const MAX_ACTIVE_INSTANCES = 256;
const MAX_ACTIVE_RUNS = 8;

export interface ControllerDiagnostic { readonly controllerId: string; readonly agentId: string | null; readonly level: "info" | "error"; readonly message: string; }
export interface ManagedCommand extends DriveCommand { readonly controllerId: string; readonly agentId: string; readonly correlationId: string; readonly targetStep: number; }
interface HookContext { command(command: DriveCommand): void; log(message: unknown): void; readonly agent: { readonly id: string }; readonly time: { readonly seconds: number; readonly step: number; readonly dt: number }; }
interface ControllerHooks { onStart?(context: HookContext): void; onTick?(context: HookContext): void; onStop?(context: HookContext): void; }

interface RuntimeInstance {
  readonly controller: ControllerScript;
  readonly agentId: string;
  readonly context: vm.Context;
  disabled: boolean;
}

interface ActiveRun { readonly id: string; readonly sessionId: string; readonly generation: number; readonly instances: RuntimeInstance[]; }

/** Owns validated, resource-bounded JavaScript controller contexts on the local backend. */
export class ScriptSupervisor {
  private readonly runs = new Map<string, ActiveRun>();

  validate(source: string): void { this.compile({ id: "validation", name: "Controller", source, contentHash: sourceHash(source) }); }

  start(sessionId: string, generation: number, scripts: readonly ControllerScript[], assignments: readonly ControllerAssignment[], agentIds: readonly string[]): { runId: string; diagnostics: ControllerDiagnostic[] } {
    if (!sessionId || !Number.isSafeInteger(generation) || generation <= 0) throw new Error("Controller run identity is invalid.");
    const validScripts = scripts.map(validateControllerScript);
    const ids = new Set(agentIds);
    const scriptIds = new Set(validScripts.map((script) => script.id));
    const validAssignments = assignments.map((assignment) => validateControllerAssignment(assignment, scriptIds, ids));
    const instanceCount = validAssignments.reduce((count, assignment) => count + assignment.agentIds.length, 0);
    if (instanceCount > MAX_ACTIVE_INSTANCES) throw new Error(`Controller run exceeds the ${MAX_ACTIVE_INSTANCES}-instance limit.`);
    for (const [activeId, run] of this.runs) if (run.sessionId === sessionId) this.stop(activeId);
    const activeInstances = [...this.runs.values()].reduce((count, run) => count + run.instances.length, 0);
    if (this.runs.size >= MAX_ACTIVE_RUNS || activeInstances + instanceCount > MAX_ACTIVE_INSTANCES) throw new Error("The managed controller capacity is exhausted; stop an active run before starting another.");
    const runId = randomUUID();
    const diagnostics: ControllerDiagnostic[] = [];
    const instances: RuntimeInstance[] = [];
    try {
      for (const assignment of validAssignments) {
        const controller = validScripts.find((script) => script.id === assignment.controllerId)!;
        for (const agentId of assignment.agentIds) {
          const context = this.compile(controller);
          const instance = { controller, agentId, context, disabled: false };
          instances.push(instance);
          diagnostics.push(...this.invoke(instance, "onStart", { seconds: 0, step: 0, dt: 0 }).diagnostics);
        }
      }
      this.runs.set(runId, { id: runId, sessionId, generation, instances });
      return { runId, diagnostics };
    } catch (error) {
      for (const instance of instances) this.invoke(instance, "onStop", { seconds: 0, step: 0, dt: 0 });
      throw error;
    }
  }

  tick(runId: string, sessionId: string, generation: number, step: number, seconds: number, dt: number): { commands: ManagedCommand[]; diagnostics: ControllerDiagnostic[] } {
    const run = this.requireRun(runId, sessionId, generation);
    if (!Number.isSafeInteger(step) || step < 0 || !Number.isFinite(seconds) || !Number.isFinite(dt) || dt < 0) throw new Error("Controller tick is invalid.");
    const commands: ManagedCommand[] = [];
    const diagnostics: ControllerDiagnostic[] = [];
    for (const instance of run.instances) {
      const result = this.invoke(instance, "onTick", { seconds, step, dt });
      diagnostics.push(...result.diagnostics);
      for (const command of result.commands) commands.push({ ...command, controllerId: instance.controller.id, agentId: instance.agentId, correlationId: `${instance.controller.id}:${instance.agentId}:${step}`, targetStep: step + 1 });
    }
    return { commands, diagnostics };
  }

  stop(runId: string, sessionId?: string, generation?: number): ControllerDiagnostic[] {
    const run = this.runs.get(runId);
    if (!run) return [];
    if (sessionId !== undefined && (run.sessionId !== sessionId || run.generation !== generation)) throw new Error("Controller stop belongs to a stale run.");
    this.runs.delete(runId);
    return run.instances.flatMap((instance) => this.invoke(instance, "onStop", { seconds: 0, step: 0, dt: 0 }).diagnostics);
  }

  dispose(): void { for (const runId of [...this.runs.keys()]) this.stop(runId); }

  private compile(controller: ControllerScript): vm.Context {
    const valid = validateControllerScript(controller);
    if (/\b(?:import\s*(?:\(|[{'*])|export\s|require\s*\()/.test(valid.source)) throw new Error(`Controller ${valid.name} cannot import modules.`);
    if (/\basync\b/.test(valid.source)) throw new Error(`Controller ${valid.name} must use synchronous hooks.`);
    const sandbox = Object.assign(Object.create(null), {
      Promise: undefined,
      queueMicrotask: undefined,
      setTimeout: undefined,
      setInterval: undefined
    }) as { __controller?: ControllerHooks };
    const context = vm.createContext(sandbox, {
      name: `scenario-controller:${valid.id}`,
      codeGeneration: { strings: false, wasm: false }
    });
    const registration = `
      "use strict";
      let __registeredController = null;
      const defineController = (value) => {
        if (__registeredController) throw new Error("defineController may be called only once.");
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("defineController requires a hooks object.");
        for (const name of ["onStart", "onTick", "onStop"]) {
          const hook = value[name];
          if (hook !== undefined && typeof hook !== "function") throw new Error(name + " must be a function.");
          if (hook !== undefined && Object.prototype.toString.call(hook) !== "[object Function]") throw new Error(name + " must be synchronous.");
        }
        __registeredController = Object.freeze(value);
      };
      ${valid.source}
      if (!__registeredController) throw new Error("Controller must call defineController().");
      globalThis.__controller = __registeredController;
    `;
    try { new vm.Script(registration, { filename: `${valid.id}.controller.js` }).runInContext(context, { timeout: EXECUTION_TIMEOUT_MS }); }
    catch (error) { throw new Error(`Controller ${valid.name}: ${message(error)}`); }
    return context;
  }

  private invoke(instance: RuntimeInstance, hook: keyof ControllerHooks, time: { seconds: number; step: number; dt: number }): { commands: DriveCommand[]; diagnostics: ControllerDiagnostic[] } {
    if (instance.disabled && hook !== "onStop") return { commands: [], diagnostics: [] };
    const commands: DriveCommand[] = [];
    const diagnostics: ControllerDiagnostic[] = [];
    const globals = instance.context as {
      __agentId?: string; __time?: typeof time;
      __commandJson?: (value: unknown) => void; __logText?: (value: unknown) => void;
    };
    globals.__agentId = instance.agentId;
    globals.__time = Object.freeze({ ...time });
    globals.__commandJson = (value: unknown) => {
        if (typeof value !== "string") throw new Error("Controller command serialization failed.");
        if (commands.length >= MAX_COMMANDS_PER_TICK) throw new Error(`Controller command queue exceeds ${MAX_COMMANDS_PER_TICK} messages per tick.`);
        commands.push(validateDriveCommand(JSON.parse(value) as DriveCommand));
    };
    globals.__logText = (value: unknown) => {
      if (typeof value !== "string") throw new Error("Controller log serialization failed.");
      diagnostics.push({ controllerId: instance.controller.id, agentId: instance.agentId, level: "info", message: value.slice(0, 500) });
    };
    try {
      new vm.Script(`
        if (__controller.${hook}) {
          const __context = Object.freeze({
            agent: Object.freeze({ id: __agentId }),
            time: Object.freeze({ seconds: __time.seconds, step: __time.step, dt: __time.dt }),
            command(value) { __commandJson(JSON.stringify(value)); },
            log(value) { __logText(String(value)); }
          });
          const __result = __controller.${hook}(__context);
          if (__result !== null && (typeof __result === "object" || typeof __result === "function") && typeof __result.then === "function") {
            throw new Error("${hook} must be synchronous.");
          }
        }
      `).runInContext(instance.context, { timeout: EXECUTION_TIMEOUT_MS });
    } catch (error) {
      instance.disabled = hook !== "onStop";
      diagnostics.push({ controllerId: instance.controller.id, agentId: instance.agentId, level: "error", message: `${hook}: ${message(error)}` });
    } finally {
      delete globals.__agentId; delete globals.__time; delete globals.__commandJson; delete globals.__logText;
    }
    return { commands, diagnostics };
  }

  private requireRun(runId: string, sessionId: string, generation: number): ActiveRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Controller run is not active.");
    if (run.sessionId !== sessionId || run.generation !== generation) {
      const affected = run.instances.map((instance) => `${instance.controller.id}/${instance.agentId}`).join(", ") || "no assigned instances";
      throw new Error(`Controller request belongs to a stale run (affected: ${affected}).`);
    }
    return run;
  }
}

const message = (error: unknown) => error instanceof Error
  ? error.message
  : error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : "Controller execution failed.";
const sourceHash = (source: string) => { let hash = 0x811c9dc5; for (let index = 0; index < source.length; index++) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(16).padStart(8, "0"); };
