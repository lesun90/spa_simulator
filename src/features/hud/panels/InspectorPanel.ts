import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { AssetCatalogEntry } from "../../../editor-core/assets";
import { GRID_SIZE_MULTIPLIERS, snapToGridMultiplier } from "../../../editor-core/grid";
import type { SceneObject } from "../../../editor-core/scene";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { EditorState } from "../../../state/EditorState";
import { BasePanel } from "../kit/BasePanel";
import { Button } from "../kit/Button";
import type { Rect } from "../kit/layout";
import { hudBasicMaterial } from "../kit/materials";
import { Panel, unitPlane } from "../kit/Panel";
import { segmentButtonRect } from "../kit/segmentedControl";
import { Slider } from "../kit/Slider";
import { rasterizeText } from "../kit/TextRenderer";
import { TextField } from "../kit/TextField";
import { hudZ } from "../kit/zIndex";
import type { ThumbnailRenderer } from "../thumbnails/ThumbnailRenderer";

type LabelMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

const PADDING = 16;
const TITLE_HEIGHT = 34;
const PREVIEW_SIZE = 116;
const ROW_GAP = 10;
const LABEL_SIZE = 10.5;
const BODY_SIZE = 12;
const FIELD_HEIGHT = 32;
const SLIDER_HEIGHT = 28;
const MIN_SCALE = 0.05;
const MAX_SCALE = 3;
const SNAP_MIN_SCALE = GRID_SIZE_MULTIPLIERS[0];
const SNAP_MAX_SCALE = GRID_SIZE_MULTIPLIERS[GRID_SIZE_MULTIPLIERS.length - 1];

export class InspectorPanel extends BasePanel {
  private readonly titleMeshes: LabelMesh[] = [];
  private readonly dynamicMeshes: LabelMesh[] = [];
  private readonly previewFrame: Panel;
  private readonly previewMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly nameField: TextField;
  private readonly scaleSlider: Slider;
  private readonly inspectionCellButton: Button;
  private readonly inspectionFreeButton: Button;
  private readonly stateCleanups: Array<() => void> = [];
  private previewAssetId: string | null = null;
  private previewRequestId = 0;

  constructor(
    rect: Rect,
    interaction: InteractionSystem,
    private readonly state: EditorState,
    private readonly thumbnails: ThumbnailRenderer,
    private readonly actions: {
      setCursor(cursor: string): void;
      setWorldControlsEnabled(enabled: boolean): void;
    }
  ) {
    super(
      rect,
      {
        fill: theme.panel.hex,
        border: theme.borderStrong.hex,
        borderWidth: 1,
        radius: { topLeft: theme.radius.lg, topRight: 0, bottomLeft: theme.radius.lg, bottomRight: 0 },
        shadow: "lg",
        z: -0.2
      },
      interaction
    );

    this.previewFrame = new Panel(this.previewRect(), {
      fill: theme.panelSubtle.hex,
      border: theme.borderSubtle.hex,
      borderWidth: 1,
      radius: theme.radius.md,
      z: hudZ.panel + 0.01
    });
    this.previewMesh = new THREE.Mesh(unitPlane, hudBasicMaterial({ transparent: true }));
    this.previewMesh.position.z = hudZ.glyph;
    this.previewMesh.visible = false;

    this.nameField = new TextField(
      this.nameFieldRect(),
      interaction,
      { placeholder: "Object name", onCommit: (value) => this.state.renameSelectedObject(value) },
      ""
    );
    this.scaleSlider = new Slider(
      this.scaleSliderRect(),
      interaction,
      {
        min: MIN_SCALE,
        max: MAX_SCALE,
        onChange: (scale) => this.state.updateSelectedObject({ scale: this.resolveScaleValue(scale) }),
        onDragStart: () => this.actions.setWorldControlsEnabled(false),
        onDragEnd: () => this.actions.setWorldControlsEnabled(true),
        setCursor: (cursor) => this.actions.setCursor(cursor)
      },
      1
    );
    this.inspectionCellButton = new Button(this.inspectionCellButtonRect(), interaction, {
      label: "Cell",
      fontSize: 11.5,
      onClick: () => this.state.setInspectionResolution("snap")
    });
    this.inspectionFreeButton = new Button(this.inspectionFreeButtonRect(), interaction, {
      label: "Free",
      fontSize: 11.5,
      onClick: () => this.state.setInspectionResolution("free")
    });

    this.root.add(
      this.previewFrame.root,
      this.previewMesh,
      this.nameField.root,
      this.scaleSlider.root,
      this.inspectionCellButton.root,
      this.inspectionFreeButton.root
    );
    this.stateCleanups.push(
      state.on("scene", () => this.refresh()),
      state.on("selection", () => this.refresh()),
      state.on("inspection", () => this.refresh()),
      state.on("assets", () => this.refresh())
    );
    this.renderStatic();
    this.refresh();
  }

  update(dt: number) {
    if (!this.root.visible) return;
    this.nameField.update(dt);
  }

  protected layout() {
    this.previewFrame?.setRect(this.previewRect());
    this.placePreviewMesh();
    this.inspectionCellButton?.setRect(this.inspectionCellButtonRect());
    this.inspectionFreeButton?.setRect(this.inspectionFreeButtonRect());
    this.nameField?.setRect(this.nameFieldRect());
    this.scaleSlider?.setRect(this.scaleSliderRect());
    this.renderStatic();
    this.refresh();
  }

  private refresh() {
    const object = this.state.selected;
    const asset = object ? this.findAsset(object.assetId) : null;
    const snap = this.state.inspectionResolution === "snap";
    this.scaleSlider.setRange(snap ? SNAP_MIN_SCALE : MIN_SCALE, snap ? SNAP_MAX_SCALE : MAX_SCALE);
    this.nameField.setValue(object?.name ?? "");
    this.scaleSlider.setValue(object ? this.resolveScaleValue(object.scale) : 1);
    this.nameField.root.visible = Boolean(object);
    this.scaleSlider.root.visible = Boolean(object);
    this.inspectionCellButton.root.visible = Boolean(object);
    this.inspectionFreeButton.root.visible = Boolean(object);
    this.refreshInspectionControls();
    this.previewFrame.root.visible = Boolean(object);
    this.previewMesh.visible = Boolean(object && this.previewMesh.material.map);
    this.renderDynamic(object, asset);
    this.refreshPreview(asset);
  }

  private renderStatic() {
    this.disposeMeshes(this.titleMeshes);
    this.titleMeshes.push(this.addText("Inspector", this.rect.x + PADDING + 38, this.rect.y + 22, 15, theme.text.css, "750"));
  }

  private renderDynamic(object: SceneObject | null, asset: AssetCatalogEntry | null) {
    this.disposeMeshes(this.dynamicMeshes);
    if (!object) {
      this.dynamicMeshes.push(
        this.addText("No object selected", this.rect.x + PADDING, this.rect.y + TITLE_HEIGHT + 34, BODY_SIZE, theme.textMutedStrong.css, "650")
      );
      this.dynamicMeshes.push(
        this.addText("Select an object to inspect it.", this.rect.x + PADDING, this.rect.y + TITLE_HEIGHT + 56, BODY_SIZE, theme.textMutedAlt.css, "500")
      );
      return;
    }

    const metaX = this.rect.x + PADDING;
    const metaY = this.previewRect().y + PREVIEW_SIZE + 26;
    this.dynamicMeshes.push(this.addText(asset?.label ?? object.assetId, metaX, metaY, 13, theme.text.css, "700"));
    this.dynamicMeshes.push(this.addText(`Asset ${object.assetId}`, metaX, metaY + 22, BODY_SIZE, theme.textMuted.css, "500"));
    this.dynamicMeshes.push(this.addText(`Id ${object.id}`, metaX, metaY + 42, BODY_SIZE, theme.textMuted.css, "500"));
    this.dynamicMeshes.push(this.addText(`Position ${formatNumber(object.position.x)}, ${formatNumber(object.position.z)}`, metaX, metaY + 70, BODY_SIZE, theme.textMuted.css, "500"));
    this.dynamicMeshes.push(this.addText(`Rotation ${formatDegrees(object.rotationY)}`, metaX, metaY + 90, BODY_SIZE, theme.textMuted.css, "500"));
    this.dynamicMeshes.push(this.addText("Mode", this.rect.x + PADDING, this.inspectionControlRect().y - 10, LABEL_SIZE, theme.textMutedStrong.css, "700"));
    this.dynamicMeshes.push(this.addText("Name", this.rect.x + PADDING, this.nameFieldRect().y - 10, LABEL_SIZE, theme.textMutedStrong.css, "700"));
    this.dynamicMeshes.push(this.addText("Scale", this.rect.x + PADDING, this.scaleSliderRect().y - 10, LABEL_SIZE, theme.textMutedStrong.css, "700"));
    this.dynamicMeshes.push(
      this.addText(
        scaleLabel(this.resolveScaleValue(object.scale), this.state.inspectionResolution === "snap"),
        this.rect.x + this.rect.width - PADDING - 56,
        this.scaleSliderRect().y - 10,
        LABEL_SIZE,
        theme.textMutedStrong.css,
        "700"
      )
    );
  }

  private refreshPreview(asset: AssetCatalogEntry | null) {
    if (!asset) {
      this.previewAssetId = null;
      this.previewMesh.material.map = null;
      this.previewMesh.visible = false;
      return;
    }
    if (this.previewAssetId === asset.id && this.previewMesh.material.map) return;

    this.previewAssetId = asset.id;
    const requestId = ++this.previewRequestId;
    this.thumbnails.getStaticThumbnail(asset).then((texture) => {
      if (requestId !== this.previewRequestId || this.previewAssetId !== asset.id) return;
      this.previewMesh.material.map = texture;
      this.previewMesh.material.needsUpdate = true;
      this.previewMesh.visible = Boolean(this.state.selected);
      this.placePreviewMesh();
    });
  }

  private findAsset(assetId: string): AssetCatalogEntry | null {
    return this.state.assets.find((asset) => asset.id === assetId) ?? null;
  }

  private previewRect(): Rect {
    return { x: this.rect.x + PADDING, y: this.rect.y + TITLE_HEIGHT + 8, width: PREVIEW_SIZE, height: PREVIEW_SIZE };
  }

  private nameFieldRect(): Rect {
    const control = this.inspectionControlRect();
    return { x: this.rect.x + PADDING, y: control.y + FIELD_HEIGHT + 36, width: this.contentWidth(), height: FIELD_HEIGHT };
  }

  private scaleSliderRect(): Rect {
    return { x: this.rect.x + PADDING, y: this.nameFieldRect().y + FIELD_HEIGHT + 46, width: this.contentWidth(), height: SLIDER_HEIGHT };
  }

  private inspectionControlRect(): Rect {
    const metaY = this.previewRect().y + PREVIEW_SIZE + 26;
    return { x: this.rect.x + PADDING, y: metaY + 122, width: this.contentWidth(), height: FIELD_HEIGHT };
  }

  private inspectionCellButtonRect(): Rect {
    return segmentButtonRect(this.inspectionControlRect(), 0);
  }

  private inspectionFreeButtonRect(): Rect {
    return segmentButtonRect(this.inspectionControlRect(), 1);
  }

  private contentWidth(): number {
    return Math.max(this.rect.width - PADDING * 2, 1);
  }

  private placePreviewMesh() {
    const rect = this.previewRect();
    this.previewMesh.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, hudZ.glyph);
    this.previewMesh.scale.set(rect.width - ROW_GAP, rect.height - ROW_GAP, 1);
  }

  private addText(text: string, x: number, y: number, size: number, color: string, weight: string): LabelMesh {
    const rasterized = rasterizeText(text, { size, color, weight });
    const mesh = new THREE.Mesh(unitPlane, hudBasicMaterial({ map: rasterized.texture, transparent: true }));
    mesh.scale.set(rasterized.width, rasterized.height, 1);
    mesh.position.set(x + rasterized.width / 2, y, hudZ.glyph);
    this.root.add(mesh);
    return mesh;
  }

  private disposeMeshes(meshes: LabelMesh[]) {
    for (const mesh of meshes.splice(0)) {
      this.root.remove(mesh);
      mesh.material.dispose();
    }
  }

  private refreshInspectionControls() {
    this.inspectionCellButton.setActive(this.state.inspectionResolution === "snap");
    this.inspectionFreeButton.setActive(this.state.inspectionResolution === "free");
  }

  private resolveScaleValue(scale: number): number {
    return this.state.inspectionResolution === "snap" ? snapToGridMultiplier(scale) : scale;
  }

  dispose() {
    for (const cleanup of this.stateCleanups) cleanup();
    this.disposeMeshes(this.titleMeshes);
    this.disposeMeshes(this.dynamicMeshes);
    this.previewFrame.dispose();
    this.previewMesh.material.dispose();
    this.nameField.dispose();
    this.scaleSlider.dispose();
    this.inspectionCellButton.dispose();
    this.inspectionFreeButton.dispose();
    super.dispose();
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDegrees(radians: number): string {
  return `${Math.round(THREE.MathUtils.radToDeg(radians))} deg`;
}

function scaleLabel(scale: number, snapped: boolean): string {
  return snapped ? `${formatNumber(scale)}x grid` : `${formatNumber(scale)}x`;
}
