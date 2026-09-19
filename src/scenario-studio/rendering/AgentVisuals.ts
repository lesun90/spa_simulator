import * as THREE from "three";
import type { AssetManager } from "../../engine/AssetManager";
import type { InteractionEvent, InteractionSystem } from "../../engine/InteractionSystem";
import { ObjectTransformControls, type ObjectTransformControlMode } from "../../features/world/ObjectTransformControls";
import {
  hasTransformChanged,
  moveOnGround,
  rotateFromHorizontalDrag,
  scaleFromGroundHandle,
  transformModeForPointerButton
} from "../../features/world/objectTransform";
import { assetEntry, scaledAgentCollision, type AgentDraft, type AgentPresentation, type AgentPresenter, type AgentSnapshot, type PlacementPreview, type Ray3, type Vector3Value } from "../domain/agent";

type AgentTransformMode = ObjectTransformControlMode | "move";

interface AgentVisualCallbacks {
  getGroundPoint(x: number, y: number): Vector3Value | null;
  onSelect(id: string): void;
  onTransformCommit(id: string, draft: AgentDraft, mode: AgentTransformMode, x: number, y: number): Promise<void>;
  onTransformError(message: string): void;
  setCursor(cursor: string): void;
}

interface ActiveAgentTransform {
  readonly id: string;
  readonly mode: AgentTransformMode;
  readonly start: AgentSnapshot;
  readonly startScreenX: number;
  readonly startPointer: Vector3Value;
  readonly center: Vector3Value;
  current: AgentDraft;
  changed: boolean;
}

class PreparedAgentVisual implements AgentPresentation {
  private disposed = false;
  constructor(readonly object: THREE.Object3D) {}
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
  }
}

/** Owns borrowed visual clones; the injected AssetManager owns their shared GPU resources. */
export class AgentVisuals implements AgentPresenter {
  private readonly instances = new Map<string, THREE.Object3D>();
  private readonly agents = new Map<string, AgentSnapshot>();
  private readonly ghost = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x27a86b, transparent: true, opacity: 0.28, depthWrite: false })
  );
  private selectionControls: ObjectTransformControls | null = null;
  private selectedId: string | null = null;
  private activeTransform: ActiveAgentTransform | null = null;
  private committing = false;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetManager,
    private readonly interaction: InteractionSystem,
    private readonly callbacks: AgentVisualCallbacks
  ) {
    this.ghost.visible = false;
    this.ghost.renderOrder = 3;
    this.scene.add(this.ghost);
  }

  async prepare(agent: AgentSnapshot): Promise<AgentPresentation> {
    if (this.disposed) throw new Error("Agent visuals were disposed.");
    const template = await this.assets.getTemplate(assetEntry(agent));
    if (this.disposed) throw new Error("Agent visuals were disposed.");
    const object = template.clone(true);
    object.name = agent.name;
    applyPose(object, agent);
    return new PreparedAgentVisual(object);
  }

  show(agent: AgentSnapshot, presentation: AgentPresentation): void {
    const prepared = presentation as PreparedAgentVisual;
    if (this.disposed) { prepared.dispose(); return; }
    prepared.object.userData.scenarioAgentId = agent.id;
    this.agents.set(agent.id, agent);
    this.instances.set(agent.id, prepared.object);
    this.scene.add(prepared.object);
  }

  update(agent: AgentSnapshot): void {
    const object = this.instances.get(agent.id);
    if (!object) return;
    this.agents.set(agent.id, agent);
    object.name = agent.name;
    applyPose(object, agent);
    object.updateMatrixWorld(true);
    if (this.selectedId === agent.id) this.refreshSelectionControls();
  }

  remove(id: string): void {
    const object = this.instances.get(id);
    if (!object) return;
    object.removeFromParent();
    this.instances.delete(id);
    this.agents.delete(id);
    if (this.selectedId === id) this.select(null);
  }

  clear(): void {
    for (const id of [...this.instances.keys()]) this.remove(id);
    this.select(null);
    this.setGhost(null, null);
  }

  select(id: string | null): void {
    this.clearSelectionControls();
    const object = id ? this.instances.get(id) : null;
    this.selectedId = object && id ? id : null;
    if (!object) return;
    object.updateMatrixWorld(true);
    this.selectionControls = new ObjectTransformControls(new THREE.Box3().setFromObject(object), this.interaction, {
      onPointerDown: (mode, event) => this.beginTransform(id!, mode, event),
      onPointerMove: (event) => this.updateTransform(event),
      onPointerUp: (event) => this.finishTransform(event),
      onResizeHover: (cursor) => { if (!this.activeTransform) this.callbacks.setCursor(cursor); }
    });
    this.scene.add(this.selectionControls.root);
  }

  startDirectTransform(id: string, event: InteractionEvent): void {
    if (this.selectedId !== id) this.callbacks.onSelect(id);
    const mode = transformModeForPointerButton(event.button);
    if (mode) this.beginTransform(id, mode, event);
  }

  handlePointerMove(event: { x: number; y: number }): void { this.updateTransform(event); }
  handlePointerUp(event: { x: number; y: number }): void { this.finishTransform(event); }
  isTransforming(): boolean { return this.activeTransform !== null; }

  private beginTransform(id: string, mode: AgentTransformMode, event: { x: number; y: number }): void {
    if (this.committing) return;
    const start = this.agents.get(id);
    const object = this.instances.get(id);
    const point = this.callbacks.getGroundPoint(event.x, event.y);
    if (!start || !object || !point) return;
    this.activeTransform = {
      id,
      mode,
      start,
      startScreenX: event.x,
      startPointer: point,
      center: { x: object.position.x, y: 0, z: object.position.z },
      current: start,
      changed: false
    };
    this.callbacks.setCursor(mode === "scale" ? "ew-resize" : "grabbing");
  }

  private updateTransform(event: { x: number; y: number }): void {
    const active = this.activeTransform;
    if (!active) return;
    const object = this.instances.get(active.id);
    if (!object) return;
    let current: AgentDraft = active.current;
    if (active.mode === "move") {
      const point = this.callbacks.getGroundPoint(event.x, event.y);
      if (!point) return;
      const position = moveOnGround(active.start.pose.position, active.startPointer, point);
      current = { ...active.start, pose: { ...active.start.pose, position: { ...position, y: active.start.pose.position.y } } };
    } else if (active.mode === "scale") {
      const point = this.callbacks.getGroundPoint(event.x, event.y);
      if (!point) return;
      current = { ...active.start, scale: scaleFromGroundHandle(active.start.scale, active.center, active.startPointer, point) };
    } else {
      current = { ...active.start, pose: { ...active.start.pose, headingRadians: rotateFromHorizontalDrag(active.start.pose.headingRadians, active.startScreenX, event.x) } };
    }
    active.current = current;
    active.changed ||= hasTransformChanged(transformSnapshot(active.start), transformSnapshot(current));
    applyPose(object, current);
    this.refreshSelectionControls();
  }

  private finishTransform(event: { x: number; y: number }): void {
    const active = this.activeTransform;
    if (!active) return;
    this.updateTransform(event);
    this.activeTransform = null;
    this.callbacks.setCursor("default");
    if (!active.changed) return;
    this.committing = true;
    void this.callbacks.onTransformCommit(active.id, active.current, active.mode, event.x, event.y).catch((error) => {
      const object = this.instances.get(active.id);
      if (object) applyPose(object, active.start);
      this.refreshSelectionControls();
      this.callbacks.onTransformError(error instanceof Error ? error.message : "Agent transform failed.");
    }).finally(() => { this.committing = false; });
  }

  private refreshSelectionControls(): void {
    const object = this.selectedId ? this.instances.get(this.selectedId) : null;
    if (!object) return;
    object.updateMatrixWorld(true);
    this.selectionControls?.setBox(new THREE.Box3().setFromObject(object));
  }

  private clearSelectionControls(): void {
    this.selectionControls?.dispose();
    this.selectionControls = null;
  }

  pick(ray: Ray3): string | null {
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z),
      new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z)
    );
    const hits = raycaster.intersectObjects([...this.instances.values()], true);
    for (const hit of hits) {
      let current: THREE.Object3D | null = hit.object;
      while (current) {
        if (typeof current.userData.scenarioAgentId === "string") return current.userData.scenarioAgentId;
        current = current.parent;
      }
    }
    return null;
  }

  setGhost(draft: AgentDraft | null, preview: PlacementPreview | null): void {
    if (!draft || !preview?.pose) { this.ghost.visible = false; return; }
    const collision = scaledAgentCollision(draft);
    const half = collision.halfExtents;
    const center = collision.center;
    const c = Math.cos(preview.pose.headingRadians), s = Math.sin(preview.pose.headingRadians);
    this.ghost.scale.set(half.x * 2, half.y * 2, half.z * 2);
    this.ghost.position.set(
      preview.pose.position.x + center.x * c + center.z * s,
      preview.pose.position.y + center.y,
      preview.pose.position.z - center.x * s + center.z * c
    );
    this.ghost.rotation.set(0, preview.pose.headingRadians, 0);
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(preview.valid ? 0x27a86b : 0xd45151);
    this.ghost.visible = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.clearSelectionControls();
    this.ghost.removeFromParent();
    this.ghost.geometry.dispose();
    this.ghost.material.dispose();
  }
}

function applyPose(object: THREE.Object3D, agent: AgentDraft): void {
  object.position.set(agent.pose.position.x, agent.pose.position.y, agent.pose.position.z);
  object.rotation.set(0, agent.pose.headingRadians, 0);
  object.scale.setScalar(agent.scale / agent.asset.unitsPerMeter);
  object.updateMatrixWorld(true);
}

function transformSnapshot(agent: AgentDraft) {
  return { position: agent.pose.position, rotationY: agent.pose.headingRadians, scale: agent.scale };
}
