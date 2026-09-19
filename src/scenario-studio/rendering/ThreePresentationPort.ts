import * as THREE from "three";
import type { AgentWheelPose, BodyPose, PresentationPort, VehiclePoseFrame, VisualObjectPoseFrame } from "../domain/SceneObjectPorts";
import type { WheelDescriptor } from "../domain/agent";

interface WheelBinding {
  readonly steering: THREE.Object3D;
  readonly wheel: THREE.Object3D;
  readonly suspension: THREE.Object3D;
  readonly suspensionBind: THREE.Matrix4;
  readonly steeringBind: THREE.Matrix4;
  readonly tireBind: THREE.Matrix4;
}

const IDENTITY_BIND = new THREE.Matrix4();
const scratchWorld = new THREE.Matrix4();
const scratchLocal = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternionA = new THREE.Quaternion();
const scratchQuaternionB = new THREE.Quaternion();
const scratchQuaternion = new THREE.Quaternion();
const unitScale = new THREE.Vector3(1, 1, 1);

/** visualWorld = chassisWorldInverse × interpolatedPhysicsBodyWorld × bindMatrix, converted back to the node's local space. */
function applyInterpolatedPart(node: THREE.Object3D, bind: THREE.Matrix4, chassis: THREE.Object3D, from: BodyPose, to: BodyPose, alpha: number): void {
  scratchPosition.set(
    from.worldPositionMeters.x + (to.worldPositionMeters.x - from.worldPositionMeters.x) * alpha,
    from.worldPositionMeters.y + (to.worldPositionMeters.y - from.worldPositionMeters.y) * alpha,
    from.worldPositionMeters.z + (to.worldPositionMeters.z - from.worldPositionMeters.z) * alpha
  );
  scratchQuaternionA.set(from.worldOrientation.x, from.worldOrientation.y, from.worldOrientation.z, from.worldOrientation.w);
  scratchQuaternionB.set(to.worldOrientation.x, to.worldOrientation.y, to.worldOrientation.z, to.worldOrientation.w);
  scratchQuaternion.copy(scratchQuaternionA).slerp(scratchQuaternionB, alpha);
  scratchWorld.compose(scratchPosition, scratchQuaternion, unitScale);
  scratchLocal.copy(chassis.matrixWorld).invert().multiply(scratchWorld).multiply(bind);
  scratchLocal.decompose(node.position, node.quaternion, node.scale);
}

function resolveWheelBindings(object: THREE.Object3D, wheels: readonly WheelDescriptor[]): (WheelBinding | null)[] {
  return wheels.map((wheel) => {
    const steering = object.getObjectByName(wheel.steeringNode);
    const wheelNode = object.getObjectByName(wheel.wheelNode);
    const suspension = object.getObjectByName(wheel.suspensionNode);
    if (!steering || !wheelNode || !suspension) return null;
    // Each node's local-to-object matrix at rest IS its bind matrix: the authored placement is the
    // physics rest pose, so binding against the node's current local transform reproduces the
    // authored pivot without any physics-side lookup.
    return { steering, wheel: wheelNode, suspension, suspensionBind: suspension.matrix.clone(), steeringBind: steering.matrix.clone(), tireBind: wheelNode.matrix.clone() };
  });
}

function isVehiclePose(pose: VehiclePoseFrame | VisualObjectPoseFrame): pose is VehiclePoseFrame {
  return "chassis" in pose;
}

type Pose = VehiclePoseFrame | VisualObjectPoseFrame;

/** Three.js `PresentationPort` implementation: binds rendered parts once at prepare time, then applies exact interpolated physics poses every frame — no wheel reconstruction, no independent simulation. */
export class ThreePresentationPort<TPose extends Pose> implements PresentationPort<TPose> {
  private wheelBindings: (WheelBinding | null)[] | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly object: THREE.Object3D,
    private readonly wheels: readonly WheelDescriptor[]
  ) {}

  async prepare(): Promise<void> {
    this.wheelBindings = this.wheels.length ? resolveWheelBindings(this.object, this.wheels) : null;
  }

  activate(): void { this.scene.add(this.object); }

  applyPose(from: TPose, to: TPose, alpha: number): void {
    if (isVehiclePose(to) && isVehiclePose(from)) this.applyVehiclePose(from, to, alpha);
    else if (!isVehiclePose(to) && !isVehiclePose(from)) {
      applyInterpolatedPart(this.object, IDENTITY_BIND, this.object, (from as VisualObjectPoseFrame).body, (to as VisualObjectPoseFrame).body, alpha);
    }
    this.object.updateMatrixWorld(true);
  }

  private applyVehiclePose(from: VehiclePoseFrame, to: VehiclePoseFrame, alpha: number): void {
    applyInterpolatedPart(this.object, IDENTITY_BIND, this.object, from.chassis, to.chassis, alpha);
    this.object.updateMatrixWorld(true);
    to.wheels.forEach((toWheel: AgentWheelPose, index: number) => {
      const binding = this.wheelBindings?.[index];
      if (!binding) return;
      const fromWheel = from.wheels[index] ?? toWheel;
      applyInterpolatedPart(binding.suspension, binding.suspensionBind, this.object, fromWheel.suspensionBody, toWheel.suspensionBody, alpha);
      applyInterpolatedPart(binding.steering, binding.steeringBind, this.object, fromWheel.steeringBody, toWheel.steeringBody, alpha);
      applyInterpolatedPart(binding.wheel, binding.tireBind, this.object, fromWheel.tireBody, toWheel.tireBody, alpha);
    });
  }

  reset(): void {}

  release(): void { this.object.removeFromParent(); }
}
