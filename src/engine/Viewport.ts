export interface ViewportSize {
  width: number;
  height: number;
  aspect: number;
  pixelRatio: number;
}

type Listener = (size: ViewportSize) => void;

export class Viewport {
  size: ViewportSize;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly dprCap: number) {
    this.size = this.measure();
    window.addEventListener("resize", this.handleResize);
  }

  private measure(): ViewportSize {
    const width = window.innerWidth;
    const height = window.innerHeight;
    return {
      width,
      height,
      aspect: width / Math.max(height, 1),
      pixelRatio: Math.min(window.devicePixelRatio, this.dprCap)
    };
  }

  private handleResize = () => {
    this.size = this.measure();
    for (const listener of this.listeners) listener(this.size);
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.size);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    window.removeEventListener("resize", this.handleResize);
    this.listeners.clear();
  }
}
