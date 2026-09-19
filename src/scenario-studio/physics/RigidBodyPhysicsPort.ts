/**
 * Marker port for a physical (non-vehicle) prop's worker resource. Takes no runtime commands
 * today; it exists so a physical prop is still one SceneObject with a real physics port, per the
 * design's "Physical props can use a RigidObject" line, rather than a special case with none.
 */
export interface RigidBodyPhysicsPort {
  readonly resourceId: number;
}

export class RpcRigidBodyPhysicsPort implements RigidBodyPhysicsPort {
  constructor(readonly resourceId: number) {}
}
