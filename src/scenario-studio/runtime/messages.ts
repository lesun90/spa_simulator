import type { AgentTransform } from "../physics/PhysicsWorld";
import type { DriveCommand, PlaybackState } from "../domain/playback";
import { channel } from "./Middleware";

export interface LifecycleMessage { readonly type: "lifecycle"; readonly state: PlaybackState; readonly sessionId: string; readonly generation: number; }
export interface TickMessage { readonly type: "tick"; readonly generation: number; readonly step: number; readonly timeSeconds: number; readonly dt: number; }
export interface AgentStateMessage { readonly type: "agent-state"; readonly agentId: string; readonly transform: AgentTransform; }
export interface CapabilityMessage { readonly type: "capabilities"; readonly agentId: string; readonly capabilities: readonly string[]; }
export interface KeyboardMessage { readonly type: "keyboard"; readonly code: string; readonly pressed: boolean; }
export interface VehicleCommandMessage extends DriveCommand { readonly type: "vehicle-command"; readonly correlationId: string; readonly source: string; readonly sessionId: string; readonly generation: number; readonly targetStep: number; }
export interface CommandStatusMessage { readonly type: "command-status"; readonly correlationId: string; readonly source: string; readonly agentId: string; readonly accepted: boolean; readonly message: string; }

export const lifecycleChannel = channel<LifecycleMessage>("simulation/lifecycle", "steerlab.runtime.Lifecycle");
export const tickChannel = channel<TickMessage>("simulation/tick", "steerlab.runtime.Tick");
export const keyboardChannel = channel<KeyboardMessage>("input/keyboard", "steerlab.input.Keyboard");
export const commandStatusChannel = channel<CommandStatusMessage>("status/commands", "steerlab.runtime.CommandStatus");
export const agentStateChannel = (id: string) => channel<AgentStateMessage>(`agents/${id}/state`, "steerlab.agent.State");
export const capabilityChannel = (id: string) => channel<CapabilityMessage>(`agents/${id}/capabilities`, "steerlab.agent.Capabilities");
export const vehicleControlChannel = (id: string) => channel<VehicleCommandMessage>(`agents/${id}/vehicle/control`, "steerlab.vehicle.Command");
