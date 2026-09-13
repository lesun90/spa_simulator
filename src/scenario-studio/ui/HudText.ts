import * as THREE from "three";
import { theme } from "../../app/theme";
import { hudBasicMaterial } from "../../features/hud/kit/materials";
import { unitPlane } from "../../features/hud/kit/Panel";
import { rasterizeText } from "../../features/hud/kit/TextRenderer";
import { hudZ } from "../../features/hud/kit/zIndex";

interface TextFrame { x: number; y: number; width: number; maxLines?: number }
interface TextOptions { size?: number; color?: string; weight?: string; lineHeight?: number }

/** Small owned label built from the same text rasterizer and materials as Scene Studio's HUD. */
export class HudText {
  readonly root = new THREE.Group();
  private text = "";
  private meshes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor(private frame: TextFrame, private readonly style: TextOptions = {}) {}

  setText(text: string): void {
    if (this.text === text) return;
    this.text = text;
    this.render();
  }

  setFrame(frame: TextFrame): void {
    this.frame = frame;
    this.render();
  }

  private render(): void {
    for (const mesh of this.meshes) {
      this.root.remove(mesh);
      mesh.material.dispose();
    }
    this.meshes = [];
    if (!this.text) return;
    const size = this.style.size ?? 12;
    const lineHeight = this.style.lineHeight ?? size * 1.45;
    const width = Math.max(this.frame.width, 1);
    const words = this.text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && rasterizeText(candidate, { size, weight: this.style.weight }).width > width) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    const maxLines = this.frame.maxLines ?? 1;
    for (const [index, content] of lines.slice(0, maxLines).entries()) {
      const final = index === maxLines - 1 && lines.length > maxLines ? `${content}…` : content;
      const rasterized = rasterizeText(final, {
        size,
        color: this.style.color ?? theme.text.css,
        weight: this.style.weight ?? "500"
      });
      const mesh = new THREE.Mesh(unitPlane, hudBasicMaterial({ map: rasterized.texture, transparent: true }));
      mesh.scale.set(Math.min(rasterized.width, width), rasterized.height, 1);
      mesh.position.set(this.frame.x + mesh.scale.x / 2, this.frame.y + index * lineHeight + rasterized.height / 2, hudZ.glyph);
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.material.dispose();
    this.meshes = [];
  }
}
