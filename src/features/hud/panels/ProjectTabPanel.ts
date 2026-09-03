import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { EditorState } from "../../../state/EditorState";
import type { Rect } from "../kit/layout";
import { hudBasicMaterial } from "../kit/materials";
import { unitPlane } from "../kit/Panel";
import { TextField } from "../kit/TextField";
import { rasterizeText } from "../kit/TextRenderer";
import { hudZ } from "../kit/zIndex";

const PADDING = 16;
const LABEL_HEIGHT = 18;
const LABEL_GAP = 6;
const FIELD_HEIGHT = 32;
const SECTION_GAP = 20;

type LabelMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/** The Project tab: scene name and description, committed on blur (no server round-trip per keystroke). */
export class ProjectTabPanel {
  readonly root = new THREE.Group();

  private readonly nameField: TextField;
  private readonly descriptionField: TextField;
  private nameLabel: LabelMesh | null = null;
  private descriptionLabel: LabelMesh | null = null;
  private rect: Rect;
  private readonly cleanup: () => void;

  constructor(
    rect: Rect,
    interaction: InteractionSystem,
    private readonly state: EditorState
  ) {
    this.rect = rect;

    this.nameField = new TextField(
      this.nameFieldRect(),
      interaction,
      { placeholder: "Scene name", onCommit: (value) => this.commitName(value) },
      state.scene?.name ?? ""
    );
    this.root.add(this.nameField.root);

    this.descriptionField = new TextField(
      this.descriptionFieldRect(),
      interaction,
      { placeholder: "Describe this scene", onCommit: (value) => state.setSceneDescription(value) },
      state.scene?.description ?? ""
    );
    this.root.add(this.descriptionField.root);

    this.layoutLabels();

    this.cleanup = state.on("scene", () => this.refreshFromScene());
  }

  private commitName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      this.nameField.setValue(this.state.scene?.name ?? "");
      return;
    }
    this.state.setSceneName(trimmed);
  }

  private refreshFromScene() {
    this.nameField.setValue(this.state.scene?.name ?? "");
    this.descriptionField.setValue(this.state.scene?.description ?? "");
  }

  private nameLabelRect(): Rect {
    return { x: this.rect.x + PADDING, y: this.rect.y + PADDING, width: this.rect.width - PADDING * 2, height: LABEL_HEIGHT };
  }

  private nameFieldRect(): Rect {
    const label = this.nameLabelRect();
    return { x: label.x, y: label.y + LABEL_HEIGHT + LABEL_GAP, width: label.width, height: FIELD_HEIGHT };
  }

  private descriptionLabelRect(): Rect {
    const field = this.nameFieldRect();
    return { x: field.x, y: field.y + FIELD_HEIGHT + SECTION_GAP, width: field.width, height: LABEL_HEIGHT };
  }

  private descriptionFieldRect(): Rect {
    const label = this.descriptionLabelRect();
    return { x: label.x, y: label.y + LABEL_HEIGHT + LABEL_GAP, width: label.width, height: FIELD_HEIGHT };
  }

  private layoutLabels() {
    if (this.nameLabel) {
      this.root.remove(this.nameLabel);
      this.nameLabel.material.dispose();
    }
    if (this.descriptionLabel) {
      this.root.remove(this.descriptionLabel);
      this.descriptionLabel.material.dispose();
    }
    this.nameLabel = createFieldLabel("Scene name", this.nameLabelRect());
    this.descriptionLabel = createFieldLabel("Description", this.descriptionLabelRect());
    this.root.add(this.nameLabel, this.descriptionLabel);
  }

  update(dt: number) {
    if (!this.root.visible) return;
    this.nameField.update(dt);
    this.descriptionField.update(dt);
  }

  setVisible(visible: boolean) {
    this.root.visible = visible;
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.nameField.setRect(this.nameFieldRect());
    this.descriptionField.setRect(this.descriptionFieldRect());
    this.layoutLabels();
  }

  dispose() {
    this.cleanup();
    this.nameField.dispose();
    this.descriptionField.dispose();
    this.nameLabel?.material.dispose();
    this.descriptionLabel?.material.dispose();
  }
}

function createFieldLabel(text: string, rect: Rect): LabelMesh {
  const rasterized = rasterizeText(text, { size: 11.5, color: theme.textMutedStrong.css, weight: "600" });
  const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
  const mesh = new THREE.Mesh(unitPlane, material);
  mesh.scale.set(rasterized.width, rasterized.height, 1);
  mesh.position.set(rect.x + rasterized.width / 2, rect.y + rect.height / 2, hudZ.glyph);
  return mesh;
}
