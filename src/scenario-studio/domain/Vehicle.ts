import { SceneObject } from "./SceneObject";
import type { PresentationPort, SceneObjectAction, VehiclePoseFrame } from "./SceneObjectPorts";
import type { VehiclePhysicsPort } from "../physics/VehiclePhysicsPort";
import { NEUTRAL_DRIVE_COMMAND, type DriveCommand } from "./playback";

/**
 * The main-thread authority for one live vehicle. Owns command interpretation and its exclusive
 * physics port; exposes no public command method of its own — `dispatch` (inherited) is the only
 * entry point, so the registry never needs to know it is holding a Vehicle rather than any other
 * SceneObject subtype.
 */
export class Vehicle extends SceneObject<VehiclePoseFrame> {
  private command: DriveCommand = NEUTRAL_DRIVE_COMMAND;

  constructor(
    id: string,
    presentation: PresentationPort<VehiclePoseFrame>,
    generation: number,
    initialPose: VehiclePoseFrame,
    private readonly physics: VehiclePhysicsPort
  ) {
    super(id, presentation, generation, initialPose);
  }

  protected async applyAction(action: SceneObjectAction): Promise<void> {
    if (action.kind !== "drive") throw new Error(`Vehicle ${this.id} does not accept action kind "${action.kind}".`);
    this.command = action.command;
    await this.physics.applyDriveCommand(action.command, this.currentGeneration());
  }

  protected async resetPhysics(): Promise<void> {
    this.command = NEUTRAL_DRIVE_COMMAND;
    await this.physics.applyDriveCommand(NEUTRAL_DRIVE_COMMAND, this.currentGeneration());
  }
}
