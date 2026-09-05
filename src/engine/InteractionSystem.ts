import * as THREE from "three";
import type { Viewport } from "./Viewport";

export interface InteractionEvent {
  x: number;
  y: number;
  point?: THREE.Vector3;
  target: THREE.Object3D | null;
  button: number;
  buttons: number;
  shiftKey: boolean;
  originalEvent: Event;
}

export interface InteractiveHandlers {
  onPointerDown?(event: InteractionEvent): void;
  onPointerMove?(event: InteractionEvent): void;
  onPointerUp?(event: InteractionEvent): void;
  onClick?(event: InteractionEvent): void;
  onWheel?(event: InteractionEvent & { deltaY: number }): void;
  onHover?(): void;
  onLeave?(): void;
}

export interface RaycastLayer {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

/** A screen-space rect (same coordinate space as raycast hit points against an orthographic HUD camera). */
export interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocusableField {
  onKeyDown?(event: KeyboardEvent): void;
  onBlur?(): void;
}

interface Hit {
  root: THREE.Object3D | null;
  handlers: InteractiveHandlers;
  point?: THREE.Vector3;
}

type HandlerPredicate = (handlers: InteractiveHandlers) => boolean;

/**
 * Centralized pointer/keyboard interaction: one Raycaster shared across every hit-test (no per-call
 * allocation), a registry mapping interactive root Object3Ds to handlers (business ids stay in closures,
 * not userData), and a single "focused field" slot so text entry can claim exclusive keyboard routing.
 */
export class InteractionSystem {
  private layers: RaycastLayer[] = [];
  private readonly registry = new Map<THREE.Object3D, InteractiveHandlers>();
  private readonly clipRects = new Map<THREE.Object3D, ClipRect>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private hovered: THREE.Object3D | null = null;
  private captured: THREE.Object3D | null = null;
  private focusedField: FocusableField | null = null;

  constructor(private readonly viewport: Viewport) {}

  /** Ordered highest-priority-first (the first layer that reports a hit wins). */
  setLayers(layers: RaycastLayer[]) {
    this.layers = layers;
  }

  register(root: THREE.Object3D, handlers: InteractiveHandlers): () => void {
    this.registry.set(root, handlers);
    return () => {
      this.registry.delete(root);
      if (this.hovered === root) this.hovered = null;
      if (this.captured === root) this.captured = null;
    };
  }

  /**
   * Marks every descendant of `root` as hit-testable only within `rect` — for content a scrollable
   * region clips visually (via shader clip planes), since raycasting has no idea those clip planes
   * exist and would otherwise keep hitting geometry the viewer can no longer see. Pass null to clear.
   */
  setClipRect(root: THREE.Object3D, rect: ClipRect | null) {
    if (rect) this.clipRects.set(root, rect);
    else this.clipRects.delete(root);
  }

  /** Raycasts a specific target (e.g. the ground plane) outside of the registry-dispatch flow. */
  raycastAgainst(x: number, y: number, target: THREE.Object3D, camera: THREE.Camera): THREE.Vector3 | null {
    this.resolveNdc(x, y);
    this.raycaster.setFromCamera(this.ndc, camera);
    return this.raycaster.intersectObject(target, true)[0]?.point ?? null;
  }

  private resolveNdc(x: number, y: number) {
    const { width, height } = this.viewport.size;
    this.ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
  }

  private isClippedOut(object: THREE.Object3D, point: THREE.Vector3): boolean {
    let node: THREE.Object3D | null = object;
    while (node) {
      const rect = this.clipRects.get(node);
      if (rect && (point.x < rect.x || point.x > rect.x + rect.width || point.y < rect.y || point.y > rect.y + rect.height)) {
        return true;
      }
      node = node.parent;
    }
    return false;
  }

  private hitTest(x: number, y: number, accepts?: HandlerPredicate): Hit | null {
    this.resolveNdc(x, y);
    for (const layer of this.layers) {
      this.raycaster.setFromCamera(this.ndc, layer.camera);
      const hits = this.raycaster
        .intersectObjects(layer.scene.children, true)
        .filter((hit) => isVisibleInHierarchy(hit.object) && !this.isClippedOut(hit.object, hit.point));
      for (const hit of hits) {
        let node: THREE.Object3D | null = hit.object;
        while (node) {
          const handlers = this.registry.get(node);
          if (handlers && (!accepts || accepts(handlers))) return { root: node, handlers, point: hit.point };
          node = node.parent;
        }
      }
      if (hits.length > 0 && !accepts) return { root: null, handlers: {}, point: hits[0]?.point };
    }
    return null;
  }

  private toEvent(x: number, y: number, hit: Hit | null, event: Event): InteractionEvent {
    return {
      x,
      y,
      point: hit?.point,
      target: hit?.root ?? null,
      button: "button" in event ? (event as MouseEvent).button : 0,
      buttons: "buttons" in event ? (event as MouseEvent).buttons : 0,
      shiftKey: "shiftKey" in event ? Boolean((event as MouseEvent).shiftKey) : false,
      originalEvent: event
    };
  }

  handlePointerDown(x: number, y: number, event: PointerEvent): Hit | null {
    const hit = this.hitTest(x, y, acceptsPointerInteraction);
    this.captured = hit?.root ?? null;
    hit?.handlers.onPointerDown?.(this.toEvent(x, y, hit, event));
    return hit;
  }

  handlePointerMove(x: number, y: number, event: PointerEvent): Hit | null {
    // Pointerup/pointercancel only fire on the canvas, so a drag released past its edge (e.g.
    // dragging a resize handle or scrollbar thumb toward the window edge) never reaches handlePointerUp.
    // Left uncaught, `captured` would stay set forever, routing every future move to the dead drag
    // target instead of whatever is actually under the pointer (e.g. the ground, breaking the
    // placement ghost). The button state on this move is enough to detect and self-heal that.
    if (this.captured && (event.buttons & 1) !== 1) {
      const stale = this.captured;
      this.captured = null;
      this.registry.get(stale)?.onPointerUp?.(this.toEvent(x, y, null, event));
    }

    const hit = this.hitTest(x, y, acceptsPointerMove);
    const hitRoot = hit?.root ?? null;
    if (this.hovered !== hitRoot) {
      if (this.hovered) this.registry.get(this.hovered)?.onLeave?.();
      this.hovered = hitRoot;
      if (this.hovered) this.registry.get(this.hovered)?.onHover?.();
    }
    if (this.captured) {
      this.registry.get(this.captured)?.onPointerMove?.(this.toEvent(x, y, hit, event));
    } else {
      hit?.handlers.onPointerMove?.(this.toEvent(x, y, hit, event));
    }
    return hit;
  }

  handlePointerUp(x: number, y: number, event: PointerEvent): Hit | null {
    const hit = this.hitTest(x, y, acceptsPointerInteraction);
    const capturedRoot = this.captured;
    const capturedHandlers = capturedRoot ? this.registry.get(capturedRoot) : null;
    capturedHandlers?.onPointerUp?.(this.toEvent(x, y, hit, event));
    if (capturedRoot && capturedRoot === hit?.root) {
      capturedHandlers?.onClick?.(this.toEvent(x, y, hit, event));
    }
    this.captured = null;
    return hit;
  }

  handleWheel(x: number, y: number, deltaY: number, event: WheelEvent): Hit | null {
    const hit = this.hitTest(x, y, (handlers) => Boolean(handlers.onWheel));
    hit?.handlers.onWheel?.({ ...this.toEvent(x, y, hit, event), deltaY });
    return hit;
  }

  isPointerOverLayer(x: number, y: number, layerIndex = 0): boolean {
    const layer = this.layers[layerIndex];
    if (!layer) return false;
    this.resolveNdc(x, y);
    this.raycaster.setFromCamera(this.ndc, layer.camera);
    return this.raycaster
      .intersectObjects(layer.scene.children, true)
      .some((hit) => isVisibleInHierarchy(hit.object) && !this.isClippedOut(hit.object, hit.point));
  }

  isPointerOverInteractiveLayer(x: number, y: number): boolean {
    return this.isPointerOverLayer(x, y, 0);
  }

  isCaptured(): boolean {
    return this.captured !== null;
  }

  focusField(field: FocusableField) {
    if (this.focusedField === field) return;
    this.focusedField?.onBlur?.();
    this.focusedField = field;
  }

  blurField(field?: FocusableField) {
    if (field && this.focusedField !== field) return;
    this.focusedField?.onBlur?.();
    this.focusedField = null;
  }

  hasFocus(): boolean {
    return this.focusedField !== null;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (this.focusedField) {
      this.focusedField.onKeyDown?.(event);
      return true;
    }
    return false;
  }
}

function acceptsPointerInteraction(handlers: InteractiveHandlers): boolean {
  return Boolean(handlers.onPointerDown || handlers.onPointerMove || handlers.onPointerUp || handlers.onClick);
}

function acceptsPointerMove(handlers: InteractiveHandlers): boolean {
  return Boolean(
    handlers.onPointerMove ||
      handlers.onPointerDown ||
      handlers.onPointerUp ||
      handlers.onClick ||
      handlers.onHover ||
      handlers.onLeave
  );
}

function isVisibleInHierarchy(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}
