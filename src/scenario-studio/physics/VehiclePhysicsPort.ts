import type { DriveCommand } from "../domain/playback";
import type { PhysicsWorkerClient } from "./PhysicsWorkerClient";

export interface VehiclePhysicsPort {
  readonly resourceId: number;
  applyDriveCommand(command: DriveCommand, generation: number): Promise<void>;
}

export class RpcVehiclePhysicsPort implements VehiclePhysicsPort {
  constructor(readonly resourceId: number, private readonly client: PhysicsWorkerClient) {}

  applyDriveCommand(command: DriveCommand, generation: number): Promise<void> {
    return this.client.vehiclePortDriveCommand(this.resourceId, command, generation);
  }
}
