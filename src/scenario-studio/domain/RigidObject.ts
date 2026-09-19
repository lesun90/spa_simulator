import { SceneObject } from "./SceneObject";
import type { PresentationPort, SceneObjectAction, VisualObjectPoseFrame } from "./SceneObjectPorts";
import type { RigidBodyPhysicsPort } from "../physics/RigidBodyPhysicsPort";

/** A physical (non-vehicle) prop: one SceneObject with a real physics port but no runtime commands today. */
export class RigidObject extends SceneObject<VisualObjectPoseFrame> {
  constructor(
    id: string,
    presentation: PresentationPort<VisualObjectPoseFrame>,
    generation: number,
    initialPose: VisualObjectPoseFrame,
    private readonly physics: RigidBodyPhysicsPort
  ) {
    super(id, presentation, generation, initialPose);
  }

  protected async applyAction(action: SceneObjectAction): Promise<void> {
    throw new Error(`RigidObject ${this.id} does not accept actions of kind "${action.kind}".`);
  }
}
