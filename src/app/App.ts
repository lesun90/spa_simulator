import { AssetManager } from "../engine/AssetManager";
import { InputManager } from "../engine/InputManager";
import { InteractionSystem } from "../engine/InteractionSystem";
import { Renderer } from "../engine/Renderer";
import { RenderLoop } from "../engine/RenderLoop";
import { Viewport } from "../engine/Viewport";
import { HudFeature } from "../features/hud/HudFeature";
import { WorldFeature } from "../features/world/WorldFeature";
import { EditorState } from "../state/EditorState";
import { dprCap } from "./config";

/** Composition root: owns engine services, wires the world/HUD features, starts the single render loop. */
export class App {
  private readonly viewport: Viewport;
  private readonly renderer: Renderer;
  private readonly renderLoop: RenderLoop;
  private readonly interaction: InteractionSystem;
  private readonly assetManager: AssetManager;
  readonly state: EditorState;
  readonly world: WorldFeature;
  readonly hud: HudFeature;

  constructor(canvas: HTMLCanvasElement) {
    this.viewport = new Viewport(dprCap);
    this.renderer = new Renderer(canvas, this.viewport);
    this.renderLoop = new RenderLoop(this.renderer);
    this.interaction = new InteractionSystem(this.viewport);
    this.assetManager = new AssetManager();
    this.state = new EditorState();

    this.world = new WorldFeature(canvas, this.assetManager, this.interaction, this.state);
    this.hud = new HudFeature(this.renderer.renderer, this.viewport.size, this.interaction, this.assetManager, this.state);

    this.interaction.setLayers([
      { scene: this.hud.scene, camera: this.hud.camera },
      { scene: this.world.scene, camera: this.world.camera }
    ]);

    new InputManager(canvas, {
      onPointerDown: (x, y, event) => this.interaction.handlePointerDown(x, y, event),
      onPointerMove: (x, y, event) => this.interaction.handlePointerMove(x, y, event),
      onPointerUp: (x, y, event) => this.interaction.handlePointerUp(x, y, event),
      onWheel: (x, y, deltaY, event) => this.interaction.handleWheel(x, y, deltaY, event),
      onKeyDown: (event) => {
        if (this.interaction.handleKeyDown(event)) return;
        this.state.handleGlobalKeyDown(event);
      },
      onFileDrop: (files) => {
        const file = files[0];
        if (file) void this.state.importDroppedFile(file);
      }
    });

    this.viewport.subscribe((size) => {
      this.world.resize(size);
      this.hud.resize(size);
    });

    void this.state.refreshAssets();
    void this.state.refreshScenes();
  }

  start() {
    this.renderLoop.start((dt, elapsed) => {
      this.world.update(dt, elapsed);
      this.hud.update(dt);
      this.renderer.renderLayers([
        { scene: this.world.scene, camera: this.world.camera },
        { scene: this.hud.scene, camera: this.hud.camera }
      ]);
    });
  }
}
