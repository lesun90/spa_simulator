import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { unitPlane } from "./Panel";
import { rasterizeText } from "./TextRenderer";
import { configureHudCanvasTexture } from "./textures";
import { hudZ } from "./zIndex";
import { rasterizeIcon } from "./icons";

type LabelMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

export class CheckboxControl {
  readonly root = new THREE.Group();
  private readonly hitArea: THREE.Mesh;
  private renderedMeshes: LabelMesh[] = [];
  private hovered = false;
  private checked = false;
  private readonly unregister: () => void;

  constructor(
    private rect: Rect,
    private readonly interaction: InteractionSystem,
    private readonly label: string,
    private readonly onChange: (checked: boolean) => void
  ) {
    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.hitArea.position.z = hudZ.control;
    this.root.add(this.hitArea);
    this.unregister = this.interaction.register(this.hitArea, {
      onClick: () => this.setChecked(!this.checked),
      onHover: () => {
        this.hovered = true;
        this.render();
      },
      onLeave: () => {
        this.hovered = false;
        this.render();
      }
    });
    this.applyRect();
    this.render();
  }

  isChecked(): boolean {
    return this.checked;
  }

  private setChecked(checked: boolean) {
    if (this.checked === checked) return;
    this.checked = checked;
    this.onChange(checked);
    this.render();
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.applyRect();
    this.render();
  }

  private applyRect() {
    this.hitArea.position.set(this.rect.x + this.rect.width / 2, this.rect.y + this.rect.height / 2, hudZ.control);
    this.hitArea.scale.set(this.rect.width, this.rect.height, 1);
  }

  private render() {
    for (const mesh of this.renderedMeshes) {
      this.root.remove(mesh);
      mesh.material.dispose();
    }
    this.renderedMeshes = [];

    const boxSize = 16;
    const boxRect: Rect = { x: this.rect.x, y: this.rect.y + (this.rect.height - boxSize) / 2, width: boxSize, height: boxSize };
    const stroke = this.checked ? theme.accent.css : this.hovered ? theme.textMutedStrong.css : theme.border.css;
    const box = rasterizeCheckbox(boxSize, stroke, this.checked ? theme.accent.css : theme.white.css);
    const boxMaterial = hudBasicMaterial({ map: box.texture, transparent: true });
    const boxMesh = new THREE.Mesh(unitPlane, boxMaterial);
    boxMesh.scale.set(boxSize, boxSize, 1);
    boxMesh.position.set(boxRect.x + boxSize / 2, boxRect.y + boxSize / 2, hudZ.glyph);
    this.root.add(boxMesh);
    this.renderedMeshes.push(boxMesh);

    if (this.checked) {
      const icon = rasterizeIcon("check", 11, theme.white.css);
      const iconMaterial = hudBasicMaterial({ map: icon.texture, transparent: true });
      const iconMesh = new THREE.Mesh(unitPlane, iconMaterial);
      iconMesh.scale.set(icon.size, icon.size, 1);
      iconMesh.position.set(boxRect.x + boxSize / 2, boxRect.y + boxSize / 2, hudZ.glyph + 0.001);
      this.root.add(iconMesh);
      this.renderedMeshes.push(iconMesh);
    }

    const label = rasterizeText(this.label, { size: 12.5, color: theme.text.css, weight: "600" });
    const labelMaterial = hudBasicMaterial({ map: label.texture, transparent: true });
    const labelMesh = new THREE.Mesh(unitPlane, labelMaterial);
    labelMesh.scale.set(label.width, label.height, 1);
    labelMesh.position.set(boxRect.x + boxSize + 8 + label.width / 2, this.rect.y + this.rect.height / 2, hudZ.glyph);
    this.root.add(labelMesh);
    this.renderedMeshes.push(labelMesh);
  }

  dispose() {
    this.unregister();
    (this.hitArea.material as THREE.Material).dispose();
    for (const mesh of this.renderedMeshes) mesh.material.dispose();
  }
}

function rasterizeCheckbox(size: number, stroke: string, fill: string) {
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(0.75, 0.75, size - 1.5, size - 1.5, 4);
  ctx.fill();
  ctx.stroke();
  return { texture: configureHudCanvasTexture(new THREE.CanvasTexture(canvas)) };
}
