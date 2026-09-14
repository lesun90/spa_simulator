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
}

export interface AgentDraft {
  readonly asset: AgentAssetReference;
  readonly name: string;
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

export function createAgentDraft(asset: AgentAssetReference): AgentDraft {
  return freezeDraft({
    asset,
    name: asset.label,
    pose: { position: { x: 0, y: 0, z: 0 }, headingRadians: 0 },
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
    mass: draft.mass,
    inputEligible: draft.inputEligible,
    asset: Object.freeze({ ...draft.asset }),
    pose: Object.freeze({ ...draft.pose, position: Object.freeze({ ...draft.pose.position }) }),
    collision: Object.freeze({
      center: Object.freeze({ ...draft.collision.center }),
      halfExtents: Object.freeze({ ...draft.collision.halfExtents })
    }),
    placement: Object.freeze({ ...draft.placement })
  });
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
