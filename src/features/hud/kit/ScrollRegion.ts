import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { Panel, unitPlane } from "./Panel";
import { hudZ } from "./zIndex";

export interface ScrollRegionOptions {
  axis: "vertical" | "horizontal";
}

const SCROLLBAR_THICKNESS = 6;

/**
 * A clipped, scrollable viewport. Callers add children to `content` positioned at their natural
 * (unscrolled) absolute rect coordinates, call `setContentSize(extent)` once layout is known, and call
 * `applyClipping()` after (re)populating content so every descendant material picks up the region's
 * clip planes. Scroll offset is applied as a single translation on `content`, not per-child.
 */
export class ScrollRegion {
  readonly root = new THREE.Group();
  readonly content = new THREE.Group();

  private readonly clipPlanes: THREE.Plane[];
  private readonly hitArea: THREE.Mesh;
  private readonly scrollbarHitArea: THREE.Mesh;
  private readonly scrollbarTrack: Panel;
  private readonly scrollbarThumb: Panel;
  private rect: Rect;
  private scrollOffset = 0;
  private contentSize = 0;
  private readonly unregister: () => void;
  private readonly unregisterScrollbar: () => void;
  private dragPointerStart = 0;
  private dragOffsetStart = 0;

  constructor(
    rect: Rect,
    private readonly interaction: InteractionSystem,
    private readonly options: ScrollRegionOptions
  ) {
    this.rect = rect;
    this.root.add(this.content);

    this.clipPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
    ];
    this.updateClipPlanes();

    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.hitArea.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, hudZ.control);
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.root.add(this.hitArea);

    this.scrollbarTrack = new Panel(this.trackRect(), { fill: theme.borderSubtle.hex, fillOpacity: 0.6, z: hudZ.active });
    this.scrollbarThumb = new Panel(this.thumbRect(), { fill: theme.textMutedAlt.hex, fillOpacity: 0.7, z: hudZ.active + 0.001 });
    this.scrollbarHitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.root.add(this.scrollbarTrack.root, this.scrollbarThumb.root, this.scrollbarHitArea);
    this.updateScrollbar();

    this.unregister = interaction.register(this.hitArea, {
      onWheel: (event) => this.scrollBy(this.options.axis === "vertical" ? event.deltaY : event.deltaY)
    });
    this.unregisterScrollbar = interaction.register(this.scrollbarHitArea, {
      onPointerDown: (event) => this.startScrollbarDrag(event),
      onPointerMove: (event) => this.dragScrollbar(event),
      onWheel: (event) => this.scrollBy(event.deltaY)
    });
  }

  private updateClipPlanes() {
    const { x, y, width, height } = this.rect;
    this.clipPlanes[0].constant = -x;
    this.clipPlanes[1].constant = x + width;
    this.clipPlanes[2].constant = -y;
    this.clipPlanes[3].constant = y + height;
    // The clip planes above only hide scrolled-out content visually (GPU-side); raycasting doesn't
    // consult them, so without this a row scrolled far out of view (e.g. reaching the bottom of a
    // long list) still geometrically sits wherever it scrolled to and can keep intercepting pointer
    // events meant for whatever's actually there now.
    this.interaction.setClipRect(this.content, this.rect);
  }

  private trackRect(): Rect {
    const { x, y, width, height } = this.rect;
    if (this.options.axis === "vertical") {
      return { x: x + width - SCROLLBAR_THICKNESS, y, width: SCROLLBAR_THICKNESS, height };
    }
    return { x, y: y + height - SCROLLBAR_THICKNESS, width, height: SCROLLBAR_THICKNESS };
  }

  private thumbRect(): Rect {
    const track = this.trackRect();
    const visible = this.options.axis === "vertical" ? this.rect.height : this.rect.width;
    const total = Math.max(this.contentSize, visible);
    const ratio = Math.min(visible / total, 1);
    const maxScroll = this.maxScroll();
    const scrollRatio = maxScroll > 0 ? this.scrollOffset / maxScroll : 0;

    if (this.options.axis === "vertical") {
      const thumbHeight = Math.max(track.height * ratio, 16);
      const thumbY = track.y + (track.height - thumbHeight) * scrollRatio;
      return { x: track.x, y: thumbY, width: track.width, height: thumbHeight };
    }
    const thumbWidth = Math.max(track.width * ratio, 16);
    const thumbX = track.x + (track.width - thumbWidth) * scrollRatio;
    return { x: thumbX, y: track.y, width: thumbWidth, height: track.height };
  }

  private maxScroll(): number {
    const visible = this.options.axis === "vertical" ? this.rect.height : this.rect.width;
    return Math.max(this.contentSize - visible, 0);
  }

  setContentSize(size: number) {
    this.contentSize = size;
    this.scrollOffset = Math.min(this.scrollOffset, this.maxScroll());
    this.applyScrollOffset();
    this.updateScrollbar();
  }

  clearContent() {
    this.content.clear();
    this.contentSize = 0;
    this.scrollOffset = 0;
    this.applyScrollOffset();
    this.updateScrollbar();
  }

  private scrollBy(delta: number) {
    const maxScroll = this.maxScroll();
    this.scrollOffset = Math.min(Math.max(this.scrollOffset + delta, 0), maxScroll);
    this.applyScrollOffset();
    this.updateScrollbar();
  }

  private startScrollbarDrag(event: { x: number; y: number }) {
    if (this.maxScroll() <= 0) return;
    this.jumpScrollbarTowardPointer(event);
    this.dragPointerStart = this.pointerAxis(event);
    this.dragOffsetStart = this.scrollOffset;
  }

  private dragScrollbar(event: { x: number; y: number; buttons: number }) {
    if ((event.buttons & 1) !== 1 || this.maxScroll() <= 0) return;
    const track = this.trackRect();
    const thumb = this.thumbRect();
    const trackLength = this.options.axis === "vertical" ? track.height : track.width;
    const thumbLength = this.options.axis === "vertical" ? thumb.height : thumb.width;
    const travel = Math.max(trackLength - thumbLength, 1);
    const pointerDelta = this.pointerAxis(event) - this.dragPointerStart;
    this.setScrollOffset(this.dragOffsetStart + (pointerDelta / travel) * this.maxScroll());
  }

  private jumpScrollbarTowardPointer(event: { x: number; y: number }) {
    const thumb = this.thumbRect();
    const pointer = this.pointerAxis(event);
    const thumbStart = this.options.axis === "vertical" ? thumb.y : thumb.x;
    const thumbEnd = thumbStart + (this.options.axis === "vertical" ? thumb.height : thumb.width);
    if (pointer >= thumbStart && pointer <= thumbEnd) return;

    const track = this.trackRect();
    const trackStart = this.options.axis === "vertical" ? track.y : track.x;
    const trackLength = this.options.axis === "vertical" ? track.height : track.width;
    const thumbLength = this.options.axis === "vertical" ? thumb.height : thumb.width;
    const travel = Math.max(trackLength - thumbLength, 1);
    const centeredThumbStart = pointer - thumbLength / 2;
    this.setScrollOffset(((centeredThumbStart - trackStart) / travel) * this.maxScroll());
  }

  private setScrollOffset(offset: number) {
    this.scrollOffset = Math.min(Math.max(offset, 0), this.maxScroll());
    this.applyScrollOffset();
    this.updateScrollbar();
  }

  private pointerAxis(event: { x: number; y: number }) {
    return this.options.axis === "vertical" ? event.y : event.x;
  }

  private applyScrollOffset() {
    if (this.options.axis === "vertical") this.content.position.set(0, -this.scrollOffset, 0);
    else this.content.position.set(-this.scrollOffset, 0, 0);
  }

  private updateScrollbar() {
    const visible = this.options.axis === "vertical" ? this.rect.height : this.rect.width;
    const hasOverflow = this.contentSize > visible + 0.5;
    this.scrollbarTrack.root.visible = hasOverflow;
    this.scrollbarThumb.root.visible = hasOverflow;
    this.scrollbarHitArea.visible = hasOverflow;
    if (hasOverflow) this.scrollbarThumb.setRect(this.thumbRect());
    this.updateScrollbarHitArea();
  }

  private updateScrollbarHitArea() {
    const track = this.trackRect();
    this.scrollbarHitArea.position.set(track.x + track.width / 2, track.y + track.height / 2, hudZ.active + 0.002);
    this.scrollbarHitArea.scale.set(track.width, track.height, 1);
  }

  /** Call after (re)populating `content`'s children so their materials pick up the clip planes. */
  applyClipping() {
    this.content.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          material.clippingPlanes = this.clipPlanes;
        }
      }
    });
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.updateClipPlanes();
    this.hitArea.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, hudZ.control);
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.scrollbarTrack.setRect(this.trackRect());
    this.updateScrollbarHitArea();
    this.scrollOffset = Math.min(this.scrollOffset, this.maxScroll());
    this.applyScrollOffset();
    this.updateScrollbar();
  }

  dispose() {
    this.interaction.setClipRect(this.content, null);
    this.unregister();
    this.unregisterScrollbar();
    this.scrollbarTrack.dispose();
    this.scrollbarThumb.dispose();
  }
}
