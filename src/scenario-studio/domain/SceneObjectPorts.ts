import type { DriveCommand } from "./playback";

export type SceneObjectId = string;
export type WheelId = string;

export interface Vector3Value { readonly x: number; readonly y: number; readonly z: number; }

export interface BodyPose {
  readonly worldPositionMeters: Vector3Value;
  readonly worldOrientation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
}

export interface AgentWheelPose {
  readonly wheelId: WheelId;
  readonly suspensionBody: BodyPose;
  readonly steeringBody: BodyPose;
  readonly tireBody: BodyPose;
}

/** Base pose frame every SceneObject subtype's TPose extends. */
export interface SceneObjectPoseFrame {
  readonly resourceId: number;
  readonly generation: number;
  readonly physicsStep: number;
  readonly topologyVersion: number;
}

export interface VisualObjectPoseFrame extends SceneObjectPoseFrame {
  readonly body: BodyPose;
}

export interface VehiclePoseFrame extends SceneObjectPoseFrame {
  readonly chassis: BodyPose;
  readonly wheels: readonly AgentWheelPose[];
}

export interface PresentationPort<TPose extends SceneObjectPoseFrame> {
  prepare(): Promise<void>;
  activate(): void;
  applyPose(from: TPose, to: TPose, alpha: number): void;
  reset(): void;
  release(): void;
}

export interface ActionContext {
  readonly sessionId: string;
  readonly generation: number;
  readonly step: number;
}

export type SceneObjectAction =
  | { readonly kind: "drive"; readonly command: DriveCommand };

export interface SceneObjectActionEnvelope {
  readonly objectId: SceneObjectId;
  readonly resourceId: number | null;
  readonly generation: number;
  readonly targetStep: number;
  readonly sequence: number;
  readonly action: SceneObjectAction;
}
