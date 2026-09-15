import { InputManager } from "../engine/InputManager";
import { InteractionSystem } from "../engine/InteractionSystem";
import { PerformanceMonitor } from "../engine/PerformanceMonitor";
import { Renderer } from "../engine/Renderer";
import { RenderLoop } from "../engine/RenderLoop";
import { Viewport } from "../engine/Viewport";
import { HttpSceneCatalog } from "./catalog/HttpSceneCatalog";
import { HttpAgentCatalog } from "./catalog/HttpAgentCatalog";
import { newScenarioRecord, ScenarioDocument } from "./domain/ScenarioDocument";
import { ScenarioSession } from "./domain/ScenarioSession";
import { ScenarioViewport } from "./rendering/ScenarioViewport";
import { AgentVisuals } from "./rendering/AgentVisuals";
import { ScenarioHudCache } from "./rendering/ScenarioHudCache";
import { ScenarioSceneThumbnails } from "./rendering/ScenarioSceneThumbnails";
import { ScenarioHudFeature } from "./ui/ScenarioHudFeature";
import { PhysicsEngineRegistry } from "./physics/PhysicsEngineRegistry";
import { RapierPhysicsEngineFactory } from "./physics/RapierPhysicsWorld";
import type { PlacementPreview } from "./domain/agent";
import type { DriveCommand } from "./domain/playback";
import { HttpScenarioRepository } from "./persistence/HttpScenarioRepository";

const DRIVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
const NEUTRAL_DRIVE_COMMAND: DriveCommand = { throttle: 0, steering: 0, brake: 0 };

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
  private readonly driveKeys = new Set<string>();
  private currentDriveCommand: DriveCommand = NEUTRAL_DRIVE_COMMAND;
  private playbackAccumulator = 0;
  private playbackStepBusy = false;
  private readonly beforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.session.document.isDirty) return;
    event.preventDefault();
    event.returnValue = "";
  };
  private readonly onWindowBlur = () => this.clearDriveKeys();

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
    const scenarios = new HttpScenarioRepository();
    this.agentVisuals = new AgentVisuals(this.world.scene, this.interaction, {
      getGroundPoint: (x, y) => this.world.groundPointFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height),
      onSelect: (id) => this.selectAgent(id),
      onTransformCommit: async (id, draft, mode, x, y) => {
        const ray = mode === "move" ? this.world.rayFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height) : undefined;
        await this.session.updateAgent(id, draft, ray);
        if (!this.disposed) {
          this.hud.setPopulation(this.session.agents);
          this.syncScenarioState();
        }
      },
      onTransformError: (message) => this.hud.setAgentStatus(message, true),
      setCursor: (cursor) => { this.canvas.style.cursor = cursor; }
    });
    const physicsEngines = new PhysicsEngineRegistry();
    physicsEngines.register(new RapierPhysicsEngineFactory());
    this.session = new ScenarioSession(new ScenarioDocument(), catalog, agentCatalog, this.world, physicsEngines.create("rapier"), "rapier", this.agentVisuals,
      (agents) => {
        if (!this.disposed) {
          this.hud?.setPopulation(agents);
          this.syncScenarioState();
        }
      },
      (state, message) => {
        if (this.disposed) return;
        this.hud?.setPlaybackState(state, message);
        if (state !== "running") this.clearDriveKeys();
        if (state !== "ready") {
          this.agentVisuals.select(null);
          this.hud?.clearAgentSelection();
          this.clearPlacement();
        }
      });
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
          this.syncScenarioState();
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
      this.sceneThumbnails,
      {
        rename: (name) => {
          this.session.document.rename(name);
          this.syncScenarioState();
          return this.session.document.name;
        },
        create: async () => {
          if (!this.confirmDiscard("create a new scenario")) {
            this.hud.setScenarioStatus("New scenario canceled.");
            return;
          }
          await this.session.open(newScenarioRecord());
          this.afterScenarioOpen("New scenario ready.");
        },
        open: async () => {
          const summaries = await scenarios.list();
          if (!summaries.length) {
            this.hud.setScenarioStatus("No saved scenarios yet. Save this scenario first.");
            return;
          }
          const lines = summaries.slice(0, 20).map((item) => `${item.name} — ${item.id}`);
          const answer = window.prompt(`Open a scenario by name or ID:\n\n${lines.join("\n")}`, summaries[0].id);
          if (answer === null) { this.hud.setScenarioStatus("Open canceled."); return; }
          const query = answer.trim().toLowerCase();
          const matches = summaries.filter((item) => item.id.toLowerCase() === query || item.name.toLowerCase() === query);
          if (matches.length !== 1) throw new Error(matches.length ? "More than one scenario has that name. Enter its ID." : "No saved scenario matches that name or ID.");
          if (!this.confirmDiscard("open another scenario")) {
            this.hud.setScenarioStatus("Open canceled; current work kept.");
            return;
          }
          const record = await scenarios.open(matches[0].id);
          await this.session.open(record);
          this.afterScenarioOpen(`${record.name} opened.`);
        },
        save: async () => {
          const saved = await scenarios.save(this.session.document.toRecord());
          const currentWasSaved = this.session.document.markSaved(saved);
          this.syncScenarioState();
          this.hud.setScenarioStatus(currentWasSaved ? `${saved.name} saved.` : "Saved the previous revision; newer changes remain unsaved.");
        },
        play: async () => { await this.session.play(); },
        pause: () => this.session.pause(),
        reset: () => this.session.reset(),
        materialFriction: () => this.session.document.materialFriction,
        setMaterialFriction: (material, value) => { this.session.document.setMaterialFriction(material, value); }
      }
    );
    this.syncScenarioState();
    window.addEventListener("beforeunload", this.beforeUnload);
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
        let directAgent = false;
        this.interaction.handlePointerDown(x, y, event);
        if (draft && !overHud) {
          this.world.setCameraControlsEnabled(false);
          if (this.session.playback !== "ready") this.hud.setPlacementPreview({ valid: false, pose: null, reason: "Pause playback and Reset before placing agents.", sceneRevision: -1 });
          else if (!this.placementBusy && this.placementPreview?.valid) void this.commitPlacement(draft, this.world.rayFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height));
        } else if (!overHud && !this.interaction.isCaptured()) {
          const id = this.agentVisuals.pick(this.world.rayFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height));
          if (id) {
            directAgent = true;
            this.selectAgent(id);
            if (this.session.playback === "ready") this.agentVisuals.startDirectTransform(id, { x, y, target: null, button: event.button, buttons: event.buttons, shiftKey: event.shiftKey, originalEvent: event });
          }
          this.world.setCameraControlsEnabled(!id);
        } else this.world.setCameraControlsEnabled(false);
        if (!draft && !overHud && !this.interaction.isCaptured() && !directAgent) this.clearAgentSelection();
        this.hud.invalidate();
      },
      onPointerMove: (x, y, event) => {
        this.interaction.handlePointerMove(x, y, event);
        if (!this.interaction.isCaptured()) this.agentVisuals.handlePointerMove({ x, y });
        if (!this.interaction.isCaptured()) this.world.setCameraControlsEnabled(!this.agentVisuals.isTransforming() && !this.interaction.isPointerOverInteractiveLayer(x, y));
        if (this.hud.getPlacementDraft() && !this.interaction.isPointerOverInteractiveLayer(x, y)) this.previewPlacement(x, y);
        this.hud.invalidate();
      },
      onPointerUp: (x, y, event) => {
        if (!this.interaction.isCaptured()) this.agentVisuals.handlePointerUp({ x, y });
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
        this.handleDriveKey(event, true);
      },
      onKeyUp: (event) => this.handleDriveKey(event, false),
      onFileDrop: (_files, x, y) => {
        const draft = this.hud.getPlacementDraft();
        if (draft && !this.interaction.isPointerOverInteractiveLayer(x, y)) void this.commitPlacement(draft, this.world.rayFromCanvasPoint(x, y, this.viewport.size.width, this.viewport.size.height));
      }
    });
    window.addEventListener("blur", this.onWindowBlur);
    this.unsubscribe = this.viewport.subscribe((size) => {
      this.world.resize(size);
      this.hud.resize(size);
    });
    void this.hud.refresh();
    this.loop.start((dt) => {
      this.performanceMonitor.begin();
      this.world.update();
      this.hud.updatePreviews(dt);
      this.tickPlayback(dt);
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
    window.removeEventListener("beforeunload", this.beforeUnload);
    window.removeEventListener("blur", this.onWindowBlur);
  }

  private confirmDiscard(action: string): boolean {
    return !this.session.document.isDirty || window.confirm(`Discard unsaved changes and ${action}?`);
  }

  private tickPlayback(dt: number): void {
    if (this.session.playback !== "running") { this.playbackAccumulator = 0; return; }
    this.playbackAccumulator += dt;
    if (this.playbackStepBusy) return;
    const stepDt = this.playbackAccumulator;
    this.playbackAccumulator = 0;
    this.playbackStepBusy = true;
    void this.session.stepPlayback(stepDt).then((transforms) => {
      if (transforms && !this.disposed) this.agentVisuals.applyLiveTransforms(transforms);
    }).finally(() => { this.playbackStepBusy = false; });
  }

  private handleDriveKey(event: KeyboardEvent, pressed: boolean): void {
    if (!DRIVE_KEYS.has(event.code)) return;
    if (this.interaction.hasFocus() || this.session.playback !== "running") {
      if (this.driveKeys.size) this.clearDriveKeys();
      return;
    }
    event.preventDefault();
    if (pressed) this.driveKeys.add(event.code); else this.driveKeys.delete(event.code);
    this.updateDriveCommand();
  }

  private updateDriveCommand(): void {
    const throttle = (this.driveKeys.has("KeyW") || this.driveKeys.has("ArrowUp") ? 1 : 0) - (this.driveKeys.has("KeyS") || this.driveKeys.has("ArrowDown") ? 1 : 0);
    const steering = (this.driveKeys.has("KeyD") || this.driveKeys.has("ArrowRight") ? 1 : 0) - (this.driveKeys.has("KeyA") || this.driveKeys.has("ArrowLeft") ? 1 : 0);
    const brake = this.driveKeys.has("Space") ? 1 : 0;
    const next: DriveCommand = { throttle, steering, brake };
    if (next.throttle === this.currentDriveCommand.throttle && next.steering === this.currentDriveCommand.steering && next.brake === this.currentDriveCommand.brake) return;
    this.currentDriveCommand = next;
    this.session.drive(next);
  }

  private clearDriveKeys(): void {
    if (!this.driveKeys.size && this.currentDriveCommand === NEUTRAL_DRIVE_COMMAND) return;
    this.driveKeys.clear();
    this.currentDriveCommand = NEUTRAL_DRIVE_COMMAND;
    this.session.drive(NEUTRAL_DRIVE_COMMAND);
  }

  private syncScenarioState(): void {
    this.hud?.setScenarioState(this.session.document.name, this.session.document.isDirty);
  }

  private afterScenarioOpen(status: string): void {
    if (this.disposed) return;
    this.agentVisuals.select(null);
    this.clearPlacement();
    this.hud.setActive(this.session.document.sceneReference);
    this.hud.setPopulation(this.session.agents);
    this.hud.sceneReplaced();
    this.syncScenarioState();
    this.hud.setScenarioStatus(status);
  }

  private previewPlacement(x: number, y: number): void {
    const draft = this.hud.getPlacementDraft();
    if (!draft) return;
    if (this.session.playback !== "ready") {
      this.hud.setPlacementPreview({ valid: false, pose: null, reason: "Pause playback and Reset before placing agents.", sceneRevision: -1 });
      return;
    }
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

  private clearAgentSelection(): void {
    this.agentVisuals.select(null);
    this.hud.clearAgentSelection();
  }

  private clearPlacement(): void {
    ++this.placementGeneration;
    this.placementPreview = null;
    this.agentVisuals.setGhost(null, null);
  }
}
