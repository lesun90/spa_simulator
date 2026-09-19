import { SceneObject } from "./SceneObject";
import type { SceneObjectAction, VisualObjectPoseFrame } from "./SceneObjectPorts";

export class VisualObject extends SceneObject<VisualObjectPoseFrame> {
  protected async applyAction(action: SceneObjectAction): Promise<void> {
    throw new Error(`VisualObject ${this.id} does not accept actions of kind "${action.kind}".`);
  }
}
