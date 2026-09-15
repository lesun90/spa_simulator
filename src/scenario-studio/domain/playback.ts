/** Legal playback states and the transitions `ScenarioSession` enforces between them. */
export type PlaybackState = "ready" | "preparing" | "running" | "paused" | "error";

/** Engine-neutral control input for the single controlled agent. */
export interface DriveCommand {
  readonly throttle: number;
  readonly steering: number;
  readonly brake: number;
}

export const NEUTRAL_DRIVE_COMMAND: DriveCommand = Object.freeze({ throttle: 0, steering: 0, brake: 0 });

export function validateDriveCommand(command: DriveCommand): DriveCommand {
  ranged(command.throttle, -1, 1, "Drive throttle");
  ranged(command.steering, -1, 1, "Drive steering");
  ranged(command.brake, 0, 1, "Drive brake");
  return Object.freeze({ throttle: command.throttle, steering: command.steering, brake: command.brake });
}

function ranged(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
}
