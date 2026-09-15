export interface Vector3Value {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Ray3 {
  readonly origin: Vector3Value;
  readonly direction: Vector3Value;
}

export interface PlacementHit {
  readonly point: Vector3Value;
  readonly normal: Vector3Value;
  readonly support: AgentSupportReference;
  readonly sceneRevision: number;
}

export interface AgentAssetReference {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly modelUrl: string;
  readonly thumbnailUrl: string | null;
  readonly modelSha256: string;
  readonly metadataSha256: string;
  readonly unitsPerMeter: number;
  readonly bounds: { readonly min: Vector3Value; readonly max: Vector3Value };
  readonly collision: {
    readonly center: Vector3Value;
    readonly halfExtents: Vector3Value;
  };
}

export interface AgentChoice {
  readonly asset: AgentAssetReference;
  readonly available: boolean;
  readonly diagnostics: readonly string[];
}

export interface AgentPose {
  readonly position: Vector3Value;
  readonly headingRadians: number;
  readonly support?: AgentSupportReference | null;
}

export type AgentSupportReference =
  | { readonly kind: "scene"; readonly id: string }
  | { readonly kind: "agent"; readonly id: string };

export interface AgentDraft {
  readonly asset: AgentAssetReference;
  readonly name: string;
  readonly scale: number;
  readonly pose: AgentPose;
  readonly mass: number;
  readonly collision: {
    readonly center: Vector3Value;
    readonly halfExtents: Vector3Value;
  };
  readonly placement: {
    readonly maxSlopeDegrees: number;
    readonly clearance: number;
  };
  readonly inputEligible: boolean;
}

export interface AgentSnapshot extends AgentDraft {
  readonly id: string;
}

export interface PlacementPreview {
  readonly valid: boolean;
  readonly pose: AgentPose | null;
  readonly reason: string | null;
  readonly sceneRevision: number;
}

export interface AgentPresentation { dispose(): void; }
export interface AgentPresenter {
  prepare(agent: AgentSnapshot): Promise<AgentPresentation>;
  show(agent: AgentSnapshot, presentation: AgentPresentation): void;
  update(agent: AgentSnapshot): void;
  remove(id: string): void;
  clear(): void;
}

/** Defaults a new agent to its native size, unless the target scene has a known road width — then a vehicle is scaled to fit within half of it. */
export function createAgentDraft(asset: AgentAssetReference, roadWidthMeters = 0): AgentDraft {
  const nativeWidth = asset.collision.halfExtents.x * 2;
  const scale = roadWidthMeters > 0 && nativeWidth > 0 ? (roadWidthMeters / 2) / nativeWidth : 1;
  return freezeDraft({
    asset,
    name: asset.label,
    scale,
    pose: { position: { x: 0, y: 0, z: 0 }, headingRadians: 0, support: null },
    mass: 1200,
    collision: asset.collision,
    placement: { maxSlopeDegrees: 35, clearance: 0.03 },
    inputEligible: true
  });
}

export function validateAgentDraft(draft: AgentDraft): AgentDraft {
  if (!draft.asset.id.trim() || !draft.asset.key.trim()) throw new Error("Agent asset identity is missing.");
  if (!draft.name.trim()) throw new Error("Agent name is required.");
  if (draft.name.trim().length > 80) throw new Error("Agent name must be 80 characters or fewer.");
  positive(draft.scale, "Agent scale");
  finiteVector(draft.pose.position, "Agent position");
  finite(draft.pose.headingRadians, "Agent heading");
  positive(draft.mass, "Agent mass");
  finiteVector(draft.collision.center, "Collision center");
  positiveVector(draft.collision.halfExtents, "Collision half-extents");
  positive(draft.placement.clearance, "Placement clearance", true);
  if (!Number.isFinite(draft.placement.maxSlopeDegrees) || draft.placement.maxSlopeDegrees < 0 || draft.placement.maxSlopeDegrees >= 90) {
    throw new Error("Maximum placement slope must be between 0 and 90 degrees.");
  }
  return freezeDraft({ ...draft, name: draft.name.trim() });
}

export function freezeDraft(draft: AgentDraft): AgentDraft {
  return Object.freeze({
    name: draft.name,
    scale: draft.scale,
    mass: draft.mass,
    inputEligible: draft.inputEligible,
    asset: Object.freeze({ ...draft.asset }),
    pose: Object.freeze({
      ...draft.pose,
      position: Object.freeze({ ...draft.pose.position }),
      support: draft.pose.support ? Object.freeze({ ...draft.pose.support }) : null
    }),
    collision: Object.freeze({
      center: Object.freeze({ ...draft.collision.center }),
      halfExtents: Object.freeze({ ...draft.collision.halfExtents })
    }),
    placement: Object.freeze({ ...draft.placement })
  });
}

export function scaledAgentCollision(draft: AgentDraft): AgentDraft["collision"] {
  const scale = draft.scale;
  return {
    center: {
      x: draft.collision.center.x * scale,
      y: draft.collision.center.y * scale,
      z: draft.collision.center.z * scale
    },
    halfExtents: {
      x: draft.collision.halfExtents.x * scale,
      y: draft.collision.halfExtents.y * scale,
      z: draft.collision.halfExtents.z * scale
    }
  };
}

export function agentBoundsOverlap(a: AgentDraft, b: AgentDraft): boolean {
  const first = collisionFrame(a);
  const second = collisionFrame(b);
  const epsilon = 0.0001;
  if (first.minY >= second.maxY - epsilon || first.maxY <= second.minY + epsilon) return false;
  const delta = { x: second.center.x - first.center.x, z: second.center.z - first.center.z };
  for (const axis of [first.axisX, first.axisZ, second.axisX, second.axisZ]) {
    const distance = Math.abs(dot(delta, axis));
    const firstRadius = first.halfX * Math.abs(dot(first.axisX, axis)) + first.halfZ * Math.abs(dot(first.axisZ, axis));
    const secondRadius = second.halfX * Math.abs(dot(second.axisX, axis)) + second.halfZ * Math.abs(dot(second.axisZ, axis));
    if (distance >= firstRadius + secondRadius - epsilon) return false;
  }
  return true;
}

export function authoredBounds(draft: AgentDraft): { min: Vector3Value; max: Vector3Value } {
  const frame = collisionFrame(draft);
  const halfX = Math.abs(frame.axisX.x) * frame.halfX + Math.abs(frame.axisZ.x) * frame.halfZ;
  const halfZ = Math.abs(frame.axisX.z) * frame.halfX + Math.abs(frame.axisZ.z) * frame.halfZ;
  return {
    min: { x: frame.center.x - halfX, y: frame.minY, z: frame.center.z - halfZ },
    max: { x: frame.center.x + halfX, y: frame.maxY, z: frame.center.z + halfZ }
  };
}

export function agentFootprintContainsPoint(agent: AgentDraft, point: Pick<Vector3Value, "x" | "z">): boolean {
  const frame = collisionFrame(agent);
  const delta = { x: point.x - frame.center.x, z: point.z - frame.center.z };
  return Math.abs(dot(delta, frame.axisX)) <= frame.halfX + 0.0001 && Math.abs(dot(delta, frame.axisZ)) <= frame.halfZ + 0.0001;
}

export function agentSupportsFootprint(support: AgentDraft, candidate: AgentDraft): boolean {
  const base = collisionFrame(support);
  const placed = collisionFrame(candidate);
  for (const xSign of [-1, 1]) for (const zSign of [-1, 1]) {
    const point = {
      x: placed.center.x + placed.axisX.x * placed.halfX * xSign + placed.axisZ.x * placed.halfZ * zSign,
      z: placed.center.z + placed.axisX.z * placed.halfX * xSign + placed.axisZ.z * placed.halfZ * zSign
    };
    const delta = { x: point.x - base.center.x, z: point.z - base.center.z };
    if (Math.abs(dot(delta, base.axisX)) > base.halfX + 0.0001 || Math.abs(dot(delta, base.axisZ)) > base.halfZ + 0.0001) return false;
  }
  return true;
}

export function placementOriginY(draft: AgentDraft, surfaceY: number): number {
  const collision = scaledAgentCollision(draft);
  return surfaceY + draft.placement.clearance - (collision.center.y - collision.halfExtents.y);
}

interface CollisionFrame {
  readonly center: { x: number; z: number };
  readonly axisX: { x: number; z: number };
  readonly axisZ: { x: number; z: number };
  readonly halfX: number;
  readonly halfZ: number;
  readonly minY: number;
  readonly maxY: number;
}

function collisionFrame(draft: AgentDraft): CollisionFrame {
  const collision = scaledAgentCollision(draft);
  const cosine = Math.cos(draft.pose.headingRadians);
  const sine = Math.sin(draft.pose.headingRadians);
  const axisX = { x: cosine, z: -sine };
  const axisZ = { x: sine, z: cosine };
  const center = {
    x: draft.pose.position.x + axisX.x * collision.center.x + axisZ.x * collision.center.z,
    z: draft.pose.position.z + axisX.z * collision.center.x + axisZ.z * collision.center.z
  };
  const centerY = draft.pose.position.y + collision.center.y;
  return {
    center,
    axisX,
    axisZ,
    halfX: collision.halfExtents.x,
    halfZ: collision.halfExtents.z,
    minY: centerY - collision.halfExtents.y,
    maxY: centerY + collision.halfExtents.y
  };
}

function dot(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return a.x * b.x + a.z * b.z;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
}

function positive(value: number, label: string, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${label} must be ${allowZero ? "nonnegative" : "positive"}.`);
  }
}

function finiteVector(value: Vector3Value, label: string): void {
  finite(value.x, label); finite(value.y, label); finite(value.z, label);
}

function positiveVector(value: Vector3Value, label: string): void {
  positive(value.x, label); positive(value.y, label); positive(value.z, label);
}
