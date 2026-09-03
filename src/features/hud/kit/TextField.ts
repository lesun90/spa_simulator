import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { Panel, unitPlane } from "./Panel";
import { rasterizeText } from "./TextRenderer";
import { hudZ } from "./zIndex";

export interface TextFieldOptions {
  placeholder?: string;
  fontSize?: number;
  paddingX?: number;
  /** Restricts input to digits/./- for numeric text fields. */
  numeric?: boolean;
  onChange?(value: string): void;
  onCommit?(value: string): void;
}

/**
 * Click-to-edit text entry: caret at end-of-text only (no mid-string cursor placement/selection — a
 * deliberate simplification), keyboard capture while focused via InteractionSystem's focus slot.
 */
export class TextField {
  readonly root = new THREE.Group();
  private readonly panel: Panel;
  private readonly hitArea: THREE.Mesh;
  private readonly caret: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private textMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private value: string;
  private focused = false;
  private caretBlinkTimer = 0;
  private rect: Rect;
  private readonly unregister: () => void;
  private readonly focusable = {
    onKeyDown: (event: KeyboardEvent) => this.handleKeyDown(event),
    onBlur: () => this.handleBlur()
  };

  constructor(
    rect: Rect,
    private readonly interaction: InteractionSystem,
    private readonly options: TextFieldOptions = {},
    initialValue = ""
  ) {
    this.rect = rect;
    this.value = initialValue;

    this.panel = new Panel(rect, { fill: theme.white.hex, border: theme.border.hex, borderWidth: 1 });
    this.root.add(this.panel.root);

    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.hitArea.position.z = hudZ.control;
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.panel.root.add(this.hitArea);

    this.caret = new THREE.Mesh(unitPlane, hudBasicMaterial({ color: theme.text.hex }));
    this.caret.position.z = hudZ.glyph;
    this.caret.visible = false;
    this.panel.root.add(this.caret);

    this.unregister = interaction.register(this.hitArea, { onClick: () => this.focus() });

    this.rebuildText();
  }

  focus() {
    if (this.focused) return;
    this.focused = true;
    this.caretBlinkTimer = 0;
    this.caret.visible = true;
    this.interaction.focusField(this.focusable);
    this.panel.setBorder(theme.focusRing.hex);
    this.positionCaret();
  }

  private handleBlur() {
    if (!this.focused) return;
    this.focused = false;
    this.caret.visible = false;
    this.panel.setBorder(theme.border.hex);
    this.options.onCommit?.(this.value);
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      this.interaction.blurField();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      this.value = this.value.slice(0, -1);
      this.afterChange();
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      if (this.options.numeric && !/[0-9.\-]/.test(event.key)) return;
      event.preventDefault();
      this.value += event.key;
      this.afterChange();
    }
  }

  private afterChange() {
    this.options.onChange?.(this.value);
    this.rebuildText();
  }

  setValue(value: string) {
    this.value = value;
    this.rebuildText();
  }

  getValue(): string {
    return this.value;
  }

  private rebuildText() {
    if (this.textMesh) {
      this.panel.root.remove(this.textMesh);
      this.textMesh.material.dispose();
      this.textMesh = null;
    }
    const paddingX = this.options.paddingX ?? 9;
    const showPlaceholder = this.value.length === 0 && Boolean(this.options.placeholder);
    const text = showPlaceholder ? (this.options.placeholder ?? "") : this.value;
    if (!text) {
      this.positionCaret();
      return;
    }
    const rasterized = rasterizeText(text, {
      size: this.options.fontSize ?? 13,
      color: showPlaceholder ? theme.textMutedAlt.css : theme.text.css
    });
    const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
    const mesh = new THREE.Mesh(unitPlane, material);
    mesh.scale.set(rasterized.width, rasterized.height, 1);
    mesh.position.set(-this.rect.width / 2 + paddingX + rasterized.width / 2, 0, hudZ.glyph);
    this.panel.root.add(mesh);
    this.textMesh = mesh;
    this.positionCaret();
  }

  private positionCaret() {
    const paddingX = this.options.paddingX ?? 9;
    const textWidth = this.value.length ? (this.textMesh?.scale.x ?? 0) : 0;
    const height = Math.min(this.rect.height - 10, (this.options.fontSize ?? 13) * 1.2);
    this.caret.scale.set(1.5, height, 1);
    this.caret.position.set(-this.rect.width / 2 + paddingX + textWidth + 1.5, 0, hudZ.glyph + 0.001);
  }

  update(dt: number) {
    if (!this.focused) return;
    this.caretBlinkTimer += dt;
    if (this.caretBlinkTimer > 0.5) {
      this.caretBlinkTimer = 0;
      this.caret.visible = !this.caret.visible;
    }
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.panel.setRect(rect);
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.rebuildText();
  }

  dispose() {
    this.unregister();
    this.interaction.blurField(this.focusable);
    this.panel.dispose();
    this.textMesh?.material.dispose();
    this.caret.material.dispose();
  }
}
