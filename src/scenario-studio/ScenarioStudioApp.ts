import { InputManager } from "../engine/InputManager";
import { InteractionSystem } from "../engine/InteractionSystem";
import { PerformanceMonitor } from "../engine/PerformanceMonitor";
import { Renderer } from "../engine/Renderer";
import { RenderLoop } from "../engine/RenderLoop";
import { Viewport } from "../engine/Viewport";
import { HttpSceneCatalog } from "./catalog/HttpSceneCatalog";
import { HttpAgentCatalog } from "./catalog/HttpAgentCatalog";
import { ScenarioDocument } from "./domain/ScenarioDocument";
import { ScenarioSession } from "./domain/ScenarioSession";
import { ScenarioViewport } from "./rendering/ScenarioViewport";
import { AgentVisuals } from "./rendering/AgentVisuals";
import { ScenarioHudCache } from "./rendering/ScenarioHudCache";
import { ScenarioSceneThumbnails } from "./rendering/ScenarioSceneThumbnails";
import { ScenarioHudFeature } from "./ui/ScenarioHudFeature";
import { PhysicsEngineRegistry } from "./physics/PhysicsEngineRegistry";
import { RapierPhysicsEngineFactory } from "./physics/RapierPhysicsWorld";
import type { PlacementPreview } from "./domain/agent";

/** Owns the same renderer, viewport, input, and HUD composition used by Scene Studio. */
export class ScenarioStudioApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly viewport: Viewport;
  private readonly renderer: Renderer;
  private readonly loop: RenderLoop;
  private readonly performanceMonitor: PerformanceMonitor;
  private readonly interaction: InteractionSystem;
  private readonly input: InputManager;
  private readonly world: ScenarioViewport;
  private readonly hud: ScenarioHudFeature;
  private readonly hudCache: ScenarioHudCache;
  private readonly sceneThumbnails: ScenarioSceneThumbnails;
  private readonly session: ScenarioSession;
  private readonly agentVisuals: AgentVisuals;
  private readonly unsubscribe: () => void;
  private disposed = false;
  private placementPreview: PlacementPreview | null = null;
  private placementGeneration = 0;
  private placementBusy = false;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "app";
    this.canvas.setAttribute("aria-label", "Scenario Studio. Drag the viewport to orbit and scroll to zoom.");
    host.append(this.canvas);
    this.viewport = new Viewport(2);
    this.renderer = new Renderer(this.canvas, this.viewport);
    this.loop = new RenderLoop(this.renderer);
    this.performanceMonitor = new PerformanceMonitor();
    this.sceneThumbnails = new ScenarioSceneThumbnails(this.renderer.renderer);
    this.interaction = new InteractionSystem(this.viewport);
    this.world = new ScenarioViewport(this.canvas);
    const catalog = new HttpSceneCatalog();
    const agentCatalog = new HttpAgentCatalog();
    this.agentVisuals = new AgentVisuals(this.world.scene);
    const physicsEngines = new PhysicsEngineRegistry();
    physicsEngines.register(new RapierPhysicsEngineFactory());
    this.session = new ScenarioSession(new ScenarioDocument(), catalog, this.world, physicsEngines.create("rapier"), this.agentVisuals,
      (agents) => { if (!this.disposed) this.hud?.setPopulation(agents); });
    this.hud = new ScenarioHudFeature(
      this.viewport.size,
      this.interaction,
      () => catalog.list(),
      () => agentCatalog.list(),
      async (reference) => {
        await this.session.replaceScene(reference);
        if (!this.disposed) {
          this.hud.setActive(this.session.document.sceneReference);
          this.hud.setPopulation(this.session.agents);
          this.hud.sceneReplaced();
          this.agentVisuals.select(null);
          this.clearPlacement();
        }
      },
      (draft) => { if (!draft) this.clearPlacement(); },
      (draft, x, y) => { if (!this.placementBusy) void this.commitPlacement(draft, this.world.rayFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height)); },
      async (id, draft) => { await this.session.updateAgent(id, draft); this.hud.setPopulation(this.session.agents); this.agentVisuals.select(id); },
      async (id) => { const copy = await this.session.duplicateAgent(id); this.hud.setPopulation(this.session.agents); this.selectAgent(copy); },
      async (id) => { await this.session.deleteAgent(id); this.hud.setPopulation(this.session.agents); this.agentVisuals.select(null); },
      () => this.world.resetView(),
      this.sceneThumbnails
    );
    this.hudCache = new ScenarioHudCache();
    this.interaction.setLayers([
      { scene: this.hud.scene, camera: this.hud.camera },
      { scene: this.world.scene, camera: this.world.camera }
    ]);
    this.input = new InputManager(this.canvas, {
      onPointerDown: (x, y, event) => {
        this.interaction.blurField();
        const overHud = this.interaction.isPointerOverInteractiveLayer(x, y);
        const draft = this.hud.getPlacementDraft();
        if (draft && !overHud) {
          this.world.setCameraControlsEnabled(false);
          if (!this.placementBusy && this.placementPreview?.valid) void this.commitPlacement(draft, this.world.rayFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height));
        } else if (!overHud) {
          const id = this.agentVisuals.pick(this.world.rayFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height));
          if (id) this.selectAgent(id);
          this.world.setCameraControlsEnabled(!id);
        } else this.world.setCameraControlsEnabled(false);
        this.interaction.handlePointerDown(x, y, event);
        this.hud.invalidate();
      },
      onPointerMove: (x, y, event) => {
        this.interaction.handlePointerMove(x, y, event);
        if (!this.interaction.isCaptured()) this.world.setCameraControlsEnabled(!this.interaction.isPointerOverInteractiveLayer(x, y));
        if (this.hud.getPlacementDraft() && !this.interaction.isPointerOverInteractiveLayer(x, y)) this.previewPlacement(x, y);
        this.hud.invalidate();
      },
      onPointerUp: (x, y, event) => {
        this.interaction.handlePointerUp(x, y, event);
        this.world.setCameraControlsEnabled(!this.interaction.isPointerOverInteractiveLayer(x, y));
        this.hud.invalidate();
      },
      onWheel: (x, y, deltaY, event) => {
        if (this.interaction.isPointerOverInteractiveLayer(x, y)) this.interaction.handleWheel(x, y, deltaY, event);
        else this.world.zoom(deltaY);
        this.hud.invalidate();
      },
      onKeyDown: (event) => {
        this.hud.handleKeyDown(event);
        this.hud.invalidate();
      },
      onFileDrop: (_files, x, y) => {
        const draft = this.hud.getPlacementDraft();
        if (draft && !this.interaction.isPointerOverInteractiveLayer(x, y)) void this.commitPlacement(draft, this.world.rayFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height));
      }
    });
    this.unsubscribe = this.viewport.subscribe((size) => {
      this.world.resize(size);
      this.hud.resize(size);
    });
    void this.hud.refresh();
    this.loop.start((dt) => {
      this.performanceMonitor.begin();
      this.world.update();
      this.hud.updatePreviews(dt);
      if (this.hud.consumeRenderNeeded()) this.hudCache.refresh(this.renderer.renderer, this.hud.scene, this.hud.camera, this.viewport.size);
      this.renderer.renderLayers([
        { scene: this.world.scene, camera: this.world.camera },
        { scene: this.hudCache.scene, camera: this.hudCache.camera }
      ]);
      this.performanceMonitor.end();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.performanceMonitor.dispose();
    void this.session.dispose();
    this.hud.dispose();
    this.hudCache.dispose();
    this.sceneThumbnails.dispose();
    this.agentVisuals.dispose();
    this.input.dispose();
    this.world.dispose();
    this.unsubscribe();
    this.renderer.dispose();
    this.viewport.dispose();
    this.canvas.remove();
  }

  private previewPlacement(x: number, y: number): void {
    const draft = this.hud.getPlacementDraft();
    if (!draft) return;
    const generation = ++this.placementGeneration;
    const ray = this.world.rayFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height);
    void this.session.previewAgentPlacement(draft, ray).then((preview) => {
      if (this.disposed || generation !== this.placementGeneration || this.hud.getPlacementDraft() !== draft) return;
      this.placementPreview = preview;
      this.agentVisuals.setGhost(draft, preview);
      this.hud.setPlacementPreview(preview);
    }).catch((error) => {
      if (generation === this.placementGeneration) this.hud.setPlacementPreview({ valid: false, pose: null, reason: error instanceof Error ? error.message : "Placement failed.", sceneRevision: -1 });
    });
  }

  private async commitPlacement(draft: import("./domain/agent").AgentDraft, ray: import("./domain/agent").Ray3): Promise<void> {
    if (this.placementBusy) return;
    this.placementBusy = true;
    try {
      await this.session.placeAgent(draft, ray);
      if (!this.disposed) {
        this.hud.setPopulation(this.session.agents);
        this.hud.placementCompleted(`${draft.name} placed.`);
        this.clearPlacement();
      }
    } catch (error) {
      if (!this.disposed) this.hud.setPlacementPreview({ valid: false, pose: this.placementPreview?.pose ?? null, reason: error instanceof Error ? error.message : "Placement failed.", sceneRevision: -1 });
    } finally { this.placementBusy = false; }
  }

  private selectAgent(id: string): void {
    const agent = this.session.agents.find((candidate) => candidate.id === id) ?? null;
    if (!agent) return;
    this.agentVisuals.select(id);
    this.hud.selectExistingAgent(agent);
  }

  private clearPlacement(): void {
    ++this.placementGeneration;
    this.placementPreview = null;
    this.agentVisuals.setGhost(null, null);
  }
}
