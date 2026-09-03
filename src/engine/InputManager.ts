export interface InputHandlers {
  onPointerDown(x: number, y: number, event: PointerEvent): void;
  onPointerMove(x: number, y: number, event: PointerEvent): void;
  onPointerUp(x: number, y: number, event: PointerEvent): void;
  onWheel(x: number, y: number, deltaY: number, event: WheelEvent): void;
  onKeyDown(event: KeyboardEvent): void;
  onFileDrop(files: FileList, x: number, y: number): void;
}

/** Attaches every browser input listener exactly once, on the single canvas. No feature module may call addEventListener itself. */
export class InputManager {
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: InputHandlers
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("dragover", this.onDragOver);
    canvas.addEventListener("drop", this.onDrop);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private toLocal(event: { clientX: number; clientY: number }) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown = (event: PointerEvent) => {
    const { x, y } = this.toLocal(event);
    this.handlers.onPointerDown(x, y, event);
  };

  private onPointerMove = (event: PointerEvent) => {
    const { x, y } = this.toLocal(event);
    this.handlers.onPointerMove(x, y, event);
  };

  private onPointerUp = (event: PointerEvent) => {
    const { x, y } = this.toLocal(event);
    this.handlers.onPointerUp(x, y, event);
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const { x, y } = this.toLocal(event);
    this.handlers.onWheel(x, y, event.deltaY, event);
  };

  private onDragOver = (event: DragEvent) => {
    event.preventDefault();
  };

  private onDrop = (event: DragEvent) => {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const { x, y } = this.toLocal(event);
    this.handlers.onFileDrop(files, x, y);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    this.handlers.onKeyDown(event);
  };

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("dragover", this.onDragOver);
    this.canvas.removeEventListener("drop", this.onDrop);
    window.removeEventListener("keydown", this.onKeyDown);
  }
}
