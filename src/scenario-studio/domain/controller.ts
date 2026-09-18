export const MAX_CONTROLLER_SOURCE_BYTES = 64 * 1024;

export interface ControllerScript {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly contentHash: string;
}

export interface ControllerAssignment {
  readonly controllerId: string;
  readonly agentIds: readonly string[];
}

export const DEFAULT_CONTROLLER_SOURCE = `defineController({
  onStart(context) {
    context.log("Controller started");
  },
  onTick(context) {
    context.command({ throttle: 0.35, steering: 0, brake: 0 });
  },
  onStop(context) {
    context.log("Controller stopped");
  }
});`;

export function validateControllerScript(value: unknown): ControllerScript {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Controller script must be an object.");
  const source = value as Record<string, unknown>;
  const id = identity(source.id, "Controller ID");
  const name = text(source.name, "Controller name", 80);
  const script = text(source.source, "Controller source", MAX_CONTROLLER_SOURCE_BYTES);
  if (new TextEncoder().encode(script).byteLength > MAX_CONTROLLER_SOURCE_BYTES) throw new Error(`Controller ${name} exceeds the ${MAX_CONTROLLER_SOURCE_BYTES}-byte source limit.`);
  const contentHash = typeof source.contentHash === "string" && /^[0-9a-f]{8}$/.test(source.contentHash) ? source.contentHash : hashControllerSource(script);
  if (contentHash !== hashControllerSource(script)) throw new Error(`Controller ${name} content hash does not match its source.`);
  return Object.freeze({ id, name, source: script, contentHash });
}

export function validateControllerAssignment(value: unknown, controllerIds: ReadonlySet<string>, agentIds: ReadonlySet<string>): ControllerAssignment {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Controller assignment must be an object.");
  const source = value as Record<string, unknown>;
  const controllerId = identity(source.controllerId, "Assigned controller ID");
  if (!controllerIds.has(controllerId)) throw new Error(`Controller assignment references missing controller ${controllerId}.`);
  if (!Array.isArray(source.agentIds) || !source.agentIds.length) throw new Error(`Controller ${controllerId} must be assigned to at least one agent.`);
  const assigned = source.agentIds.map((id) => identity(id, "Assigned agent ID"));
  if (new Set(assigned).size !== assigned.length) throw new Error(`Controller ${controllerId} contains a duplicate agent assignment.`);
  for (const id of assigned) if (!agentIds.has(id)) throw new Error(`Controller ${controllerId} references missing agent ${id}.`);
  return Object.freeze({ controllerId, agentIds: Object.freeze(assigned) });
}

export function hashControllerSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error(`${label} contains unsupported characters.`);
  return value;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  if (value.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return value;
}
