import type { Renderer } from "./Renderer";

export type FrameCallback = (dt: number, elapsed: number) => void;

/** The single owner of the application's animation loop. No other module may call requestAnimationFrame. */
export class RenderLoop {
  private lastTime = 0;
  private elapsed = 0;

  constructor(private readonly renderer: Renderer) {}

  start(callback: FrameCallback) {
    this.lastTime = performance.now();
    this.renderer.renderer.setAnimationLoop((time) => {
      const dt = Math.min((time - this.lastTime) / 1000, 0.1);
      this.lastTime = time;
      this.elapsed += dt;
      callback(dt, this.elapsed);
    });
  }

  stop() {
    this.renderer.renderer.setAnimationLoop(null);
  }
}
