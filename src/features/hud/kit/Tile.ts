import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { Rect } from "./layout";
import { hudBasicMaterial } from "./materials";
import { Panel, unitPlane } from "./Panel";
import { rasterizeText } from "./TextRenderer";
import { hudZ } from "./zIndex";

export interface TileOptions {
  label: string;
  tag: string;
  onClick(): void;
  onHover?(): void;
  onLeave?(): void;
}

/** An asset-browser grid tile: thumbnail + label + tag, click arms placement (see AssetBrowserPanel). */
export class Tile {
  readonly root = new THREE.Group();
  private readonly panel: Panel;
  private readonly hitArea: THREE.Mesh;
  private readonly thumbnail: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private labelMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private tagMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private rect: Rect;
  private isActive = false;
  private isHovered = false;
  private readonly unregister: () => void;

  constructor(
    rect: Rect,
    interaction: InteractionSystem,
    private readonly options: TileOptions
  ) {
    this.rect = rect;
    this.panel = new Panel(rect, { fill: theme.white.hex, border: theme.border.hex, borderWidth: 1, radius: theme.radius.sm });
    this.root.add(this.panel.root);

    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.hitArea.position.z = hudZ.control;
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.panel.root.add(this.hitArea);

    this.thumbnail = new THREE.Mesh(unitPlane, hudBasicMaterial({ color: theme.panelSubtle.hex }));
    this.thumbnail.position.z = hudZ.control - 0.01;
    this.panel.root.add(this.thumbnail);

    this.unregister = interaction.register(this.hitArea, {
      onClick: () => options.onClick(),
      onHover: () => {
        this.setHovered(true);
        options.onHover?.();
      },
      onLeave: () => {
        this.setHovered(false);
        options.onLeave?.();
      }
    });

    this.layoutContent();
  }

  private layoutContent() {
    const padding = 8;
    const thumbHeight = Math.max(this.rect.height * 0.55, 40);
    this.thumbnail.scale.set(Math.max(this.rect.width - padding * 2, 1), thumbHeight, 1);
    this.thumbnail.position.x = 0;
    this.thumbnail.position.y = this.rect.height / 2 - padding - thumbHeight / 2;

    if (this.labelMesh) {
      this.panel.root.remove(this.labelMesh);
      this.labelMesh.material.dispose();
      this.labelMesh = null;
    }
    if (this.tagMesh) {
      this.panel.root.remove(this.tagMesh);
      this.tagMesh.material.dispose();
      this.tagMesh = null;
    }

    const maxWidth = this.rect.width - padding * 2;
    const labelY = this.thumbnail.position.y - thumbHeight / 2 - 14;

    const label = rasterizeText(this.options.label, { size: 12, color: theme.text.css, weight: "600" });
    const labelMaterial = hudBasicMaterial({ map: label.texture, transparent: true });
    const labelMesh = new THREE.Mesh(unitPlane, labelMaterial);
    labelMesh.scale.set(Math.min(label.width, maxWidth), label.height, 1);
    labelMesh.position.set(-this.rect.width / 2 + padding + labelMesh.scale.x / 2, labelY, hudZ.glyph);
    this.panel.root.add(labelMesh);
    this.labelMesh = labelMesh;

    const tag = rasterizeText(this.options.tag, { size: 10.5, color: theme.textMutedAlt.css });
    const tagMaterial = hudBasicMaterial({ map: tag.texture, transparent: true });
    const tagMesh = new THREE.Mesh(unitPlane, tagMaterial);
    tagMesh.scale.set(Math.min(tag.width, maxWidth), tag.height, 1);
    tagMesh.position.set(-this.rect.width / 2 + padding + tagMesh.scale.x / 2, labelY - 16, hudZ.glyph);
    this.panel.root.add(tagMesh);
    this.tagMesh = tagMesh;
  }

  setThumbnailTexture(texture: THREE.Texture | null) {
    this.thumbnail.material.map = texture;
    this.thumbnail.material.color.setHex(texture ? 0xffffff : theme.panelSubtle.hex);
    this.thumbnail.material.needsUpdate = true;
  }

  setActive(active: boolean) {
    if (this.isActive === active) return;
    this.isActive = active;
    this.applyVisualState();
  }

  private setHovered(hovered: boolean) {
    if (this.isHovered === hovered) return;
    this.isHovered = hovered;
    this.applyVisualState();
  }

  private applyVisualState() {
    if (this.isActive) {
      this.panel.setFill(theme.accentSelectedBg.hex);
      this.panel.setBorder(theme.accent.hex);
      this.panel.setShadow("none");
    } else if (this.isHovered) {
      this.panel.setFill(theme.panelSubtle.hex);
      this.panel.setBorder(theme.textMutedAlt.hex);
      this.panel.setShadow("md");
    } else {
      this.panel.setFill(theme.white.hex);
      this.panel.setBorder(theme.border.hex);
      this.panel.setShadow("none");
    }
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.panel.setRect(rect);
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.layoutContent();
  }

  dispose() {
    this.unregister();
    this.panel.dispose();
    this.thumbnail.material.dispose();
    this.labelMesh?.material.dispose();
    this.tagMesh?.material.dispose();
  }
}
