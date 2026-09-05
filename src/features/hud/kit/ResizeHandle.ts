import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { Panel, unitPlane } from "./Panel";
import { hudZ } from "./zIndex";

type ResizeAxis = "horizontal" | "vertical";
const HIT_THICKNESS = 14;

interface ResizeHandleOptions {
  axis: ResizeAxis;
  onDragStart?(): void;
  onDrag(delta: number): void;
  onDragEnd?(): void;
  setCursor?(cursor: string): void;
}

export class ResizeHandle {
  readonly root = new THREE.Group();

  private readonly visual: Panel;
  private readonly hitArea: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly unregister: () => void;
  private rect: Rect;
  private dragging = false;
  private dragStart = 0;

  constructor(rect: Rect, private readonly interaction: InteractionSystem, private readonly options: ResizeHandleOptions) {
    this.rect = rect;
    this.visual = new Panel(rect, {
      fill: theme.borderStrong.hex,
      fillOpacity: 0.72,
      radius: 0,
      z: hudZ.active + 0.003
    });
    this.root.add(this.visual.root);

    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.root.add(this.hitArea);
    this.placeHitArea();

    this.unregister = interaction.register(this.hitArea, {
      onPointerDown: (event) => this.startDrag(event),
      onPointerMove: (event) => this.drag(event),
      onPointerUp: () => this.endDrag(),
      onHover: () => this.setResizeCursor(),
      onLeave: () => this.clearCursor()
    });
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.visual.setRect(rect);
    this.placeHitArea();
  }

  setVisible(visible: boolean) {
    this.root.visible = visible;
    this.hitArea.visible = visible;
  }

  dispose() {
    this.unregister();
    this.visual.dispose();
    this.clearCursor();
  }

  private startDrag(event: { x: number; y: number }) {
    this.dragging = true;
    this.dragStart = this.pointerAxis(event);
    this.setResizeCursor();
    this.options.onDragStart?.();
  }

  private drag(event: { x: number; y: number; buttons: number }) {
    if (!this.dragging || (event.buttons & 1) !== 1) return;
    this.options.onDrag(this.pointerAxis(event) - this.dragStart);
  }

  private endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.options.onDragEnd?.();
    this.clearCursor();
  }

  private pointerAxis(event: { x: number; y: number }) {
    return this.options.axis === "vertical" ? event.y : event.x;
  }

  private setResizeCursor() {
    this.options.setCursor?.(this.options.axis === "vertical" ? "ns-resize" : "ew-resize");
  }

  private clearCursor() {
    if (!this.dragging) this.options.setCursor?.("");
  }

  private placeHitArea() {
    const hitWidth = this.options.axis === "horizontal" ? HIT_THICKNESS : this.rect.width;
    const hitHeight = this.options.axis === "vertical" ? HIT_THICKNESS : this.rect.height;
    this.hitArea.position.set(this.rect.x + this.rect.width / 2, this.rect.y + this.rect.height / 2, hudZ.active + 0.004);
    this.hitArea.scale.set(hitWidth, hitHeight, 1);
  }
}
