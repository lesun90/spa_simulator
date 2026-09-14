import type { AgentDraft, AgentSnapshot, PlacementHit, PlacementPreview, Ray3 } from "../domain/agent";
import type { SceneGeometryDescription } from "./PhysicsWorld";

export type PhysicsWorkerOperation =
  | { type: "replaceScene"; scene: SceneGeometryDescription }
  | { type: "pickSurface"; ray: Ray3 }
  | { type: "previewAgentPlacement"; draft: AgentDraft; ray: Ray3; ignoreAgentId?: string }
  | { type: "addAgent"; agent: AgentSnapshot; expectedSceneRevision: number }
  | { type: "updateAgent"; agent: AgentSnapshot; expectedSceneRevision: number }
  | { type: "removeAgent"; id: string }
  | { type: "clearAgents" }
  | { type: "dispose" };

export interface PhysicsWorkerRequest { readonly id: number; readonly operation: PhysicsWorkerOperation; }
export interface PhysicsWorkerResponse { readonly id: number; readonly result?: unknown; readonly error?: string; }

export class PhysicsWorkerClient {
  private readonly worker = new Worker(new URL("./physics.worker.ts", import.meta.url), { type: "module", name: "scenario-physics" });
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();
  private nextId = 1;
  private disposed = false;
  private failure: Error | null = null;

  constructor() {
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError);
  }

  replaceScene(scene: SceneGeometryDescription): Promise<number> { return this.request({ type: "replaceScene", scene }); }
  pickSurface(ray: Ray3): Promise<PlacementHit | null> { return this.request({ type: "pickSurface", ray }); }
  previewAgentPlacement(draft: AgentDraft, ray: Ray3, ignoreAgentId?: string): Promise<PlacementPreview> {
    return this.request({ type: "previewAgentPlacement", draft, ray, ignoreAgentId });
  }
  addAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void> { return this.request({ type: "addAgent", agent, expectedSceneRevision }); }
  updateAgent(agent: AgentSnapshot, expectedSceneRevision: number): Promise<void> { return this.request({ type: "updateAgent", agent, expectedSceneRevision }); }
  removeAgent(id: string): Promise<void> { return this.request({ type: "removeAgent", id }); }
  clearAgents(): Promise<void> { return this.request({ type: "clearAgents" }); }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    try { await this.request({ type: "dispose" }); } finally {
      this.disposed = true;
      this.worker.removeEventListener("message", this.handleMessage);
      this.worker.removeEventListener("error", this.handleError);
      this.worker.terminate();
      const error = new Error("Physics worker was disposed.");
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    }
  }

  private request<T>(operation: PhysicsWorkerOperation): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("Physics worker was disposed."));
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      const transfer: Transferable[] = [];
      if (operation.type === "replaceScene") {
        for (const mesh of [...operation.scene.meshes, ...(operation.scene.nonSupportingMeshes ?? [])]) transfer.push(mesh.vertices.buffer, mesh.indices.buffer);
      }
      try {
        this.worker.postMessage({ id, operation } satisfies PhysicsWorkerRequest, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Physics request could not be sent."));
      }
    });
  }

  private handleMessage = (event: MessageEvent<PhysicsWorkerResponse>) => {
    const request = this.pending.get(event.data.id);
    if (!request) return;
    this.pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result);
  };

  private handleError = (event: ErrorEvent) => {
    const error = new Error(event.message || "Physics worker failed.");
    this.failure = error;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.worker.terminate();
  };
}
