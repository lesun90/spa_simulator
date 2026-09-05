import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { Panel, unitPlane } from "./Panel";
import { hudZ } from "./zIndex";

export interface SliderOptions {
  min: number;
  max: number;
  onChange(value: number): void;
  onDragStart?(): void;
  onDragEnd?(): void;
  setCursor?(cursor: string): void;
}

const TRACK_HEIGHT = 6;
const THUMB_SIZE = 16;

export function sliderFillRatio(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
}

export function sliderValueFromPointer(rect: Rect, pointerX: number, min: number, max: number): number {
  const ratio = rect.width <= 0 ? 0 : THREE.MathUtils.clamp((pointerX - rect.x) / rect.width, 0, 1);
  return min + (max - min) * ratio;
}

export class Slider {
  readonly root = new THREE.Group();

  private readonly track: Panel;
  private readonly fill: Panel;
  private readonly thumb: Panel;
  private readonly hitArea: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly unregister: () => void;
  private dragging = false;
  private rect: Rect;
  private value: number;

  constructor(rect: Rect, private readonly interaction: InteractionSystem, private options: SliderOptions, initialValue: number) {
    this.rect = rect;
    this.value = this.clampValue(initialValue);

    this.track = new Panel(this.trackRect(), { fill: theme.borderSubtle.hex, radius: TRACK_HEIGHT / 2, z: hudZ.control });
    this.fill = new Panel(this.fillRect(), { fill: theme.accent.hex, radius: TRACK_HEIGHT / 2, z: hudZ.control + 0.001 });
    this.thumb = new Panel(this.thumbRect(), {
      fill: theme.white.hex,
      border: theme.accent.hex,
      borderWidth: 2,
      radius: THUMB_SIZE / 2,
      shadow: "md",
      z: hudZ.control + 0.002
    });

    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.root.add(this.track.root, this.fill.root, this.thumb.root, this.hitArea);
    this.placeHitArea();

    this.unregister = interaction.register(this.hitArea, {
      onPointerDown: (event) => this.startDrag(event),
      onPointerMove: (event) => this.drag(event),
      onPointerUp: () => this.endDrag(),
      onHover: () => this.options.setCursor?.("pointer"),
      onLeave: () => {
        if (!this.dragging) this.options.setCursor?.("");
      }
    });
  }

  private startDrag(event: { x: number }) {
    this.dragging = true;
    this.options.onDragStart?.();
    this.options.setCursor?.("ew-resize");
    this.setValue(sliderValueFromPointer(this.rect, event.x, this.options.min, this.options.max), true);
  }

  private drag(event: { x: number; buttons: number }) {
    if (!this.dragging || (event.buttons & 1) !== 1) return;
    this.setValue(sliderValueFromPointer(this.rect, event.x, this.options.min, this.options.max), true);
  }

  private endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.options.onDragEnd?.();
    this.options.setCursor?.("");
  }

  setValue(value: number, notify = false) {
    const next = this.clampValue(value);
    if (Math.abs(next - this.value) < 0.001) return;
    this.value = next;
    this.layout();
    if (notify) this.options.onChange(roundSliderValue(next));
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.placeHitArea();
    this.layout();
  }

  setRange(min: number, max: number) {
    if (this.options.min === min && this.options.max === max) return;
    this.options = { ...this.options, min, max };
    this.value = this.clampValue(this.value);
    this.layout();
  }

  private layout() {
    this.track.setRect(this.trackRect());
    this.fill.setRect(this.fillRect());
    this.thumb.setRect(this.thumbRect());
  }

  private trackRect(): Rect {
    return {
      x: this.rect.x,
      y: this.rect.y + (this.rect.height - TRACK_HEIGHT) / 2,
      width: this.rect.width,
      height: TRACK_HEIGHT
    };
  }

  private fillRect(): Rect {
    const ratio = sliderFillRatio(this.value, this.options.min, this.options.max);
    return {
      x: this.rect.x,
      y: this.rect.y + (this.rect.height - TRACK_HEIGHT) / 2,
      width: Math.max(this.rect.width * ratio, TRACK_HEIGHT),
      height: TRACK_HEIGHT
    };
  }

  private thumbRect(): Rect {
    const ratio = sliderFillRatio(this.value, this.options.min, this.options.max);
    return {
      x: this.rect.x + this.rect.width * ratio - THUMB_SIZE / 2,
      y: this.rect.y + (this.rect.height - THUMB_SIZE) / 2,
      width: THUMB_SIZE,
      height: THUMB_SIZE
    };
  }

  private placeHitArea() {
    this.hitArea.position.set(this.rect.x + this.rect.width / 2, this.rect.y + this.rect.height / 2, hudZ.control + 0.01);
    this.hitArea.scale.set(this.rect.width, this.rect.height, 1);
  }

  private clampValue(value: number): number {
    return THREE.MathUtils.clamp(Number.isFinite(value) ? value : this.options.min, this.options.min, this.options.max);
  }

  dispose() {
    this.unregister();
    this.track.dispose();
    this.fill.dispose();
    this.thumb.dispose();
  }
}

function roundSliderValue(value: number): number {
  return Math.round(value * 100) / 100;
}
