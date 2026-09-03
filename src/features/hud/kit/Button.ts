import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import { rasterizeIcon } from "./icons";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { Panel, unitPlane } from "./Panel";
import { rasterizeText } from "./TextRenderer";
import { hudZ } from "./zIndex";

export interface ButtonOptions {
  icon?: string;
  label?: string;
  iconSize?: number;
  fontSize?: number;
  justify?: "center" | "start";
  paddingX?: number;
  gap?: number;
  onClick(): void;
}

/** A clickable Panel with an optional icon + label, hover/active visual states, driven by InteractionSystem. */
export class Button {
  readonly root = new THREE.Group();
  private readonly panel: Panel;
  private readonly hitArea: THREE.Mesh;
  private iconMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private labelMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private rect: Rect;
  private isActive = false;
  private isHovered = false;
  private isDisabled = false;
  private readonly unregister: () => void;

  constructor(
    rect: Rect,
    private readonly interaction: InteractionSystem,
    private options: ButtonOptions
  ) {
    this.rect = rect;
    this.panel = new Panel(rect, { fill: theme.white.hex, border: theme.border.hex, borderWidth: 1 });
    this.root.add(this.panel.root);

    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.hitArea.position.z = hudZ.control;
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.panel.root.add(this.hitArea);

    this.unregister = this.interaction.register(this.hitArea, {
      onClick: () => {
        if (!this.isDisabled) this.options.onClick();
      },
      onHover: () => this.setHovered(true),
      onLeave: () => this.setHovered(false)
    });

    this.rebuildContent();
    this.applyVisualState();
  }

  private rebuildContent() {
    if (this.iconMesh) {
      this.panel.root.remove(this.iconMesh);
      this.iconMesh.material.dispose();
      this.iconMesh = null;
    }
    if (this.labelMesh) {
      this.panel.root.remove(this.labelMesh);
      this.labelMesh.material.dispose();
      this.labelMesh = null;
    }

    const { icon, label, iconSize = 16, fontSize = 12.5, justify = "center", paddingX = 10, gap = 6 } = this.options;
    const color = this.isActive ? theme.white.css : theme.text.css;

    const rasterizedLabel = label ? rasterizeText(label, { size: fontSize, color, weight: "600" }) : null;
    const iconWidth = icon ? iconSize : 0;
    const labelWidth = rasterizedLabel?.width ?? 0;
    const contentWidth = iconWidth + (icon && label ? gap : 0) + labelWidth;
    const startX = justify === "center" ? -contentWidth / 2 : -this.rect.width / 2 + paddingX;

    let cursor = startX;
    if (icon) {
      const rasterized = rasterizeIcon(icon, iconSize, color);
      const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
      const mesh = new THREE.Mesh(unitPlane, material);
      mesh.scale.set(iconSize, iconSize, 1);
      mesh.position.set(cursor + iconSize / 2, 0, hudZ.glyph);
      this.panel.root.add(mesh);
      this.iconMesh = mesh;
      cursor += iconSize + gap;
    }
    if (label && rasterizedLabel) {
      const material = hudBasicMaterial({ map: rasterizedLabel.texture, transparent: true });
      const mesh = new THREE.Mesh(unitPlane, material);
      mesh.scale.set(rasterizedLabel.width, rasterizedLabel.height, 1);
      mesh.position.set(cursor + rasterizedLabel.width / 2, 0, hudZ.glyph);
      this.panel.root.add(mesh);
      this.labelMesh = mesh;
    }
  }

  private setHovered(hovered: boolean) {
    if (this.isHovered === hovered) return;
    this.isHovered = hovered;
    this.applyVisualState();
  }

  setLabel(label: string) {
    this.options = { ...this.options, label };
    this.rebuildContent();
  }

  setContent(options: Pick<ButtonOptions, "icon" | "label">) {
    this.options = { ...this.options, ...options };
    this.rebuildContent();
  }

  setActive(active: boolean) {
    if (this.isActive === active) return;
    this.isActive = active;
    this.rebuildContent();
    this.applyVisualState();
  }

  setDisabled(disabled: boolean) {
    this.isDisabled = disabled;
    this.root.visible = true;
    this.root.traverse((child) => {
      if (child instanceof THREE.Mesh && "opacity" in child.material) {
        const material = child.material as THREE.MeshBasicMaterial;
        material.transparent = true;
        material.opacity = disabled ? 0.45 : 1;
      }
    });
  }

  private applyVisualState() {
    if (this.isActive) {
      this.panel.setFill(theme.accent.hex);
      this.panel.setBorder(theme.accent.hex);
    } else if (this.isHovered) {
      this.panel.setFill(theme.accentSelectedBg.hex);
      this.panel.setBorder(theme.border.hex);
    } else {
      this.panel.setFill(theme.white.hex);
      this.panel.setBorder(theme.border.hex);
    }
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.panel.setRect(rect);
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.rebuildContent();
  }

  dispose() {
    this.unregister();
    this.panel.dispose();
    this.iconMesh?.material.dispose();
    this.labelMesh?.material.dispose();
  }
}
