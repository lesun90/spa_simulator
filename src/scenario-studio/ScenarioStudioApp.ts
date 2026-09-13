import { InputManager } from "../engine/InputManager";
import { InteractionSystem } from "../engine/InteractionSystem";
import { PerformanceMonitor } from "../engine/PerformanceMonitor";
import { Renderer } from "../engine/Renderer";
import { RenderLoop } from "../engine/RenderLoop";
import { Viewport } from "../engine/Viewport";
import { HttpSceneCatalog } from "./catalog/HttpSceneCatalog";
import { ScenarioDocument } from "./domain/ScenarioDocument";
import { ScenarioSession } from "./domain/ScenarioSession";
import { ScenarioViewport } from "./rendering/ScenarioViewport";
import { ScenarioHudCache } from "./rendering/ScenarioHudCache";
import { ScenarioSceneThumbnails } from "./rendering/ScenarioSceneThumbnails";
import { ScenarioHudFeature } from "./ui/ScenarioHudFeature";

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
  private readonly unsubscribe: () => void;
  private disposed = false;

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
    this.session = new ScenarioSession(new ScenarioDocument(), catalog, this.world);
    this.hud = new ScenarioHudFeature(
      this.viewport.size,
      this.interaction,
      () => catalog.list(),
      async (reference) => {
        await this.session.replaceScene(reference);
        if (!this.disposed) this.hud.setActive(this.session.document.sceneReference);
      },
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
        this.world.setCameraControlsEnabled(!this.interaction.isPointerOverInteractiveLayer(x, y));
        this.interaction.handlePointerDown(x, y, event);
        this.hud.invalidate();
      },
      onPointerMove: (x, y, event) => {
        this.interaction.handlePointerMove(x, y, event);
        if (!this.interaction.isCaptured()) this.world.setCameraControlsEnabled(!this.interaction.isPointerOverInteractiveLayer(x, y));
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
      onFileDrop: () => {}
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
    this.session.dispose();
    this.hud.dispose();
    this.hudCache.dispose();
    this.sceneThumbnails.dispose();
    this.input.dispose();
    this.world.dispose();
    this.unsubscribe();
    this.renderer.dispose();
    this.viewport.dispose();
    this.canvas.remove();
  }
}
