import * as THREE from "three";
import { AssetManager } from "../../engine/AssetManager";
import type { AssetCatalogEntry } from "../../editor-core/assets";
import type { AgentDraft, AgentPresentation, AgentPresenter, AgentSnapshot, PlacementPreview, Ray3 } from "../domain/agent";

class PreparedAgentVisual implements AgentPresentation {
  private disposed = false;
  constructor(readonly object: THREE.Object3D) {}
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
  }
}

/** Owns borrowed visual clones while AssetManager owns their shared GPU resources. */
export class AgentVisuals implements AgentPresenter {
  private readonly assets = new AssetManager();
  private readonly instances = new Map<string, THREE.Object3D>();
  private readonly selection = new THREE.Box3Helper(new THREE.Box3(), 0x2e7cf6);
  private readonly ghost = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x27a86b, transparent: true, opacity: 0.28, depthWrite: false })
  );
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.selection.visible = false;
    this.selection.renderOrder = 4;
    this.ghost.visible = false;
    this.ghost.renderOrder = 3;
    this.scene.add(this.selection, this.ghost);
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
    this.instances.set(agent.id, prepared.object);
    this.scene.add(prepared.object);
  }

  update(agent: AgentSnapshot): void {
    const object = this.instances.get(agent.id);
    if (!object) return;
    object.name = agent.name;
    applyPose(object, agent);
    if (this.selection.visible && this.selection.userData.agentId === agent.id) this.select(agent.id);
  }

  remove(id: string): void {
    const object = this.instances.get(id);
    if (!object) return;
    object.removeFromParent();
    this.instances.delete(id);
    if (this.selection.userData.agentId === id) this.select(null);
  }

  clear(): void {
    for (const id of [...this.instances.keys()]) this.remove(id);
    this.select(null);
    this.setGhost(null, null);
  }

  select(id: string | null): void {
    const object = id ? this.instances.get(id) : null;
    this.selection.visible = Boolean(object);
    this.selection.userData.agentId = object ? id : null;
    if (object) {
      this.selection.box.setFromObject(object);
      this.selection.updateMatrixWorld(true);
    }
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
    const half = draft.collision.halfExtents;
    const center = draft.collision.center;
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
    this.selection.removeFromParent();
    this.selection.geometry.dispose();
    const selectionMaterials = Array.isArray(this.selection.material) ? this.selection.material : [this.selection.material];
    for (const material of selectionMaterials) material.dispose();
    this.ghost.removeFromParent();
    this.ghost.geometry.dispose();
    this.ghost.material.dispose();
    this.assets.dispose();
  }
}

function applyPose(object: THREE.Object3D, agent: AgentSnapshot): void {
  object.position.set(agent.pose.position.x, agent.pose.position.y, agent.pose.position.z);
  object.rotation.set(0, agent.pose.headingRadians, 0);
  object.scale.setScalar(1 / agent.asset.unitsPerMeter);
  object.updateMatrixWorld(true);
}

function assetEntry(agent: AgentSnapshot): AssetCatalogEntry {
  return {
    id: `${agent.asset.id}:${agent.asset.modelSha256}:${agent.asset.metadataSha256}`,
    label: agent.asset.label,
    category: agent.asset.category,
    source: "shared",
    implementation: "glb",
    modelUrl: agent.asset.modelUrl,
    thumbnailUrl: agent.asset.thumbnailUrl ?? undefined
  };
}
