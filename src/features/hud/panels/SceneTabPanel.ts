import * as THREE from "three";
import { theme } from "../../../app/theme";
import { objectDisplayNames, type SurfaceAppearance, type SurfaceAppearanceType } from "../../../editor-core/scene";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { EditorState } from "../../../state/EditorState";
import { Button } from "../kit/Button";
import { Dropdown } from "../kit/Dropdown";
import { rasterizeIcon } from "../kit/icons";
import type { Rect } from "../kit/layout";
import { hudBasicMaterial } from "../kit/materials";
import { pickColor, pickImageFile } from "../kit/nativeInputs";
import { Panel, unitPlane } from "../kit/Panel";
import { ScrollRegion } from "../kit/ScrollRegion";
import { segmentButtonRect } from "../kit/segmentedControl";
import { TextField } from "../kit/TextField";
import { rasterizeText } from "../kit/TextRenderer";
import { hudZ } from "../kit/zIndex";

const PADDING = 16;
const HEADER_HEIGHT = 18;
const HEADER_GAP = 8;
const SECTION_GAP = 20;
const ROW_HEIGHT = 32;
const ROW_GAP = 2;
const ROW_PADDING_X = 8;
const ICON_BUTTON_SIZE = 24;
const ICON_GAP = 4;
const CONTROL_HEIGHT = 32;
const STACK_GAP = 8;
const DIVIDER_HEIGHT = 1;
const SWATCH_SIZE = 32;
const ROW_LABEL_WIDTH = 76;

// One "header + dropdown + value row" surface-appearance block (used for Background and Ground).
const APPEARANCE_BLOCK_HEIGHT = HEADER_HEIGHT + HEADER_GAP + CONTROL_HEIGHT + STACK_GAP + CONTROL_HEIGHT;
// The grid block: header + three labeled rows (cell size, scene size, placement).
const GRID_BLOCK_HEIGHT = HEADER_HEIGHT + HEADER_GAP + CONTROL_HEIGHT + STACK_GAP + CONTROL_HEIGHT + STACK_GAP + CONTROL_HEIGHT;

const WFC_BLOCK_HEIGHT = HEADER_HEIGHT + HEADER_GAP + CONTROL_HEIGHT + STACK_GAP + CONTROL_HEIGHT;

const FOOTER_HEIGHT =
  SECTION_GAP + // above divider
  DIVIDER_HEIGHT +
  SECTION_GAP +
  APPEARANCE_BLOCK_HEIGHT + // background
  SECTION_GAP +
  APPEARANCE_BLOCK_HEIGHT + // ground
  SECTION_GAP +
  GRID_BLOCK_HEIGHT +
  SECTION_GAP +
  WFC_BLOCK_HEIGHT +
  PADDING;

const SURFACE_TYPE_LABELS: Record<SurfaceAppearanceType, string> = { color: "Color", texture: "Texture" };
const SURFACE_TYPE_BY_LABEL: Record<string, SurfaceAppearanceType> = { Color: "color", Texture: "texture" };

type LabelMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/** The Scene tab: the placed-object list (visibility + delete), background, ground surface, and grid. */
export class SceneTabPanel {
  readonly root = new THREE.Group();

  private readonly scroll: ScrollRegion;
  private rows: SceneObjectRow[] = [];
  private emptyStateMesh: LabelMesh | null = null;
  private objectsHeader: SectionHeader;

  private readonly divider: Panel;
  private backgroundHeader: SectionHeader;
  private readonly backgroundEditor: SurfaceAppearanceEditor;
  private groundHeader: SectionHeader;
  private readonly groundEditor: SurfaceAppearanceEditor;
  private gridHeader: SectionHeader;
  private cellSizeLabel: LabelMesh | null = null;
  private readonly gridField: TextField;
  private sceneSizeLabel: LabelMesh | null = null;
  private readonly sceneSizeField: TextField;
  private placementLabel: LabelMesh | null = null;
  private readonly placementCellButton: Button;
  private readonly placementFreeButton: Button;
  private wfcHeader: SectionHeader;
  private readonly wfcSeedField: TextField;
  private readonly generateWfcButton: Button;

  private rect: Rect;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    rect: Rect,
    private readonly interaction: InteractionSystem,
    private readonly state: EditorState
  ) {
    this.rect = rect;

    this.objectsHeader = new SectionHeader(this.objectsHeaderRect());
    this.root.add(this.objectsHeader.root);

    this.scroll = new ScrollRegion(this.listRect(), interaction, { axis: "vertical" });
    this.root.add(this.scroll.root);

    this.divider = new Panel(this.dividerRect(), { fill: theme.borderSubtle.hex, radius: 0 });
    this.root.add(this.divider.root);

    this.backgroundHeader = new SectionHeader(this.backgroundHeaderRect());
    this.root.add(this.backgroundHeader.root);
    this.backgroundEditor = new SurfaceAppearanceEditor(this.backgroundDropdownRect(), this.backgroundValueRect(), interaction, {
      getAppearance: () => state.scene?.background,
      onTypeChange: (type) => state.setBackgroundType(type),
      onColorChange: (color) => state.setBackgroundColor(color),
      onTextureChange: (dataUrl) => state.setBackgroundTexture(dataUrl)
    });
    this.root.add(this.backgroundEditor.root);

    this.groundHeader = new SectionHeader(this.groundHeaderRect());
    this.root.add(this.groundHeader.root);
    this.groundEditor = new SurfaceAppearanceEditor(this.groundDropdownRect(), this.groundValueRect(), interaction, {
      getAppearance: () => state.scene?.ground,
      onTypeChange: (type) => state.setGroundType(type),
      onColorChange: (color) => state.setGroundColor(color),
      onTextureChange: (dataUrl) => state.setGroundTexture(dataUrl)
    });
    this.root.add(this.groundEditor.root);

    this.gridHeader = new SectionHeader(this.gridHeaderRect());
    this.root.add(this.gridHeader.root);

    this.gridField = new TextField(
      this.gridFieldRect(),
      interaction,
      { numeric: true, placeholder: "1", onCommit: (value) => this.commitGridSize(value) },
      formatGridSize(state.scene?.grid.cellSize ?? 1)
    );
    this.root.add(this.gridField.root);

    this.sceneSizeField = new TextField(
      this.sceneSizeFieldRect(),
      interaction,
      { numeric: true, placeholder: "10", onCommit: (value) => this.commitSceneSize(value) },
      formatGridSize(state.scene?.grid.width ?? 10)
    );
    this.root.add(this.sceneSizeField.root);

    this.placementCellButton = new Button(this.placementCellButtonRect(), interaction, {
      label: "Cell",
      fontSize: 11.5,
      onClick: () => this.state.setPlacementResolution("snap")
    });
    this.placementFreeButton = new Button(this.placementFreeButtonRect(), interaction, {
      label: "Free",
      fontSize: 11.5,
      onClick: () => this.state.setPlacementResolution("free")
    });
    this.root.add(this.placementCellButton.root, this.placementFreeButton.root);

    this.wfcHeader = new SectionHeader(this.wfcHeaderRect());
    this.root.add(this.wfcHeader.root);
    this.wfcSeedField = new TextField(
      this.wfcSeedFieldRect(),
      interaction,
      { numeric: true, placeholder: "Seed", onCommit: () => this.normalizeWfcSeed() },
      "1"
    );
    this.generateWfcButton = new Button(this.generateWfcButtonRect(), interaction, {
      label: "Generate layout",
      fontSize: 11.5,
      onClick: () => this.generateWfcLayout()
    });
    this.root.add(this.wfcSeedField.root, this.generateWfcButton.root);

    this.applyStaticHeaders();

    this.cleanups.push(
      state.on("scene", () => this.onSceneChanged()),
      state.on("wfcProgress", () => this.refreshWfcGeneration()),
      state.on("selection", () => this.refreshSelection()),
      state.on("objectVisibility", () => this.refreshVisibility()),
      state.on("placement", () => this.refreshPlacementControls()),
      state.on("sceneBackground", () => this.backgroundEditor.refresh()),
      state.on("sceneGround", () => this.groundEditor.refresh())
    );

    this.rebuildRows();
  }

  private onSceneChanged() {
    this.rebuildRows();
    this.backgroundEditor.refresh();
    this.groundEditor.refresh();
    this.gridField.setValue(formatGridSize(this.state.scene?.grid.cellSize ?? 1));
    this.sceneSizeField.setValue(formatGridSize(this.state.scene?.grid.width ?? 10));
  }

  private refreshSelection() {
    for (const row of this.rows) row.setSelected(row.objectId === this.state.selectedObjectId);
  }

  private refreshVisibility() {
    for (const row of this.rows) row.setHidden(this.state.isObjectHidden(row.objectId));
  }

  // --- layout -----------------------------------------------------------

  private objectsHeaderRect(): Rect {
    return { x: this.rect.x + PADDING, y: this.rect.y + PADDING, width: this.rect.width - PADDING * 2, height: HEADER_HEIGHT };
  }

  private footerTop(): number {
    return this.rect.y + this.rect.height - FOOTER_HEIGHT;
  }

  private listRect(): Rect {
    const top = this.rect.y + PADDING + HEADER_HEIGHT + HEADER_GAP;
    return { x: this.rect.x + PADDING, y: top, width: this.rect.width - PADDING * 2, height: Math.max(this.footerTop() - top, 0) };
  }

  private dividerRect(): Rect {
    return { x: this.rect.x + PADDING, y: this.footerTop(), width: this.rect.width - PADDING * 2, height: DIVIDER_HEIGHT };
  }

  private backgroundHeaderRect(): Rect {
    const y = this.footerTop() + DIVIDER_HEIGHT + SECTION_GAP;
    return { x: this.rect.x + PADDING, y, width: this.rect.width - PADDING * 2, height: HEADER_HEIGHT };
  }

  private backgroundDropdownRect(): Rect {
    const header = this.backgroundHeaderRect();
    return { x: header.x, y: header.y + HEADER_HEIGHT + HEADER_GAP, width: header.width, height: CONTROL_HEIGHT };
  }

  private backgroundValueRect(): Rect {
    const dropdown = this.backgroundDropdownRect();
    return { x: dropdown.x, y: dropdown.y + CONTROL_HEIGHT + STACK_GAP, width: dropdown.width, height: CONTROL_HEIGHT };
  }

  private groundHeaderRect(): Rect {
    const value = this.backgroundValueRect();
    const y = value.y + CONTROL_HEIGHT + SECTION_GAP;
    return { x: this.rect.x + PADDING, y, width: this.rect.width - PADDING * 2, height: HEADER_HEIGHT };
  }

  private groundDropdownRect(): Rect {
    const header = this.groundHeaderRect();
    return { x: header.x, y: header.y + HEADER_HEIGHT + HEADER_GAP, width: header.width, height: CONTROL_HEIGHT };
  }

  private groundValueRect(): Rect {
    const dropdown = this.groundDropdownRect();
    return { x: dropdown.x, y: dropdown.y + CONTROL_HEIGHT + STACK_GAP, width: dropdown.width, height: CONTROL_HEIGHT };
  }

  private gridHeaderRect(): Rect {
    const value = this.groundValueRect();
    const y = value.y + CONTROL_HEIGHT + SECTION_GAP;
    return { x: this.rect.x + PADDING, y, width: this.rect.width - PADDING * 2, height: HEADER_HEIGHT };
  }

  private gridFieldRect(): Rect {
    const header = this.gridHeaderRect();
    const y = header.y + HEADER_HEIGHT + HEADER_GAP;
    return { x: header.x + ROW_LABEL_WIDTH, y, width: header.width - ROW_LABEL_WIDTH, height: CONTROL_HEIGHT };
  }

  private cellSizeLabelRect(): Rect {
    const field = this.gridFieldRect();
    return { x: field.x - ROW_LABEL_WIDTH, y: field.y, width: ROW_LABEL_WIDTH, height: CONTROL_HEIGHT };
  }

  private sceneSizeFieldRect(): Rect {
    const field = this.gridFieldRect();
    return { x: field.x, y: field.y + CONTROL_HEIGHT + STACK_GAP, width: field.width, height: CONTROL_HEIGHT };
  }

  private sceneSizeLabelRect(): Rect {
    const field = this.sceneSizeFieldRect();
    return { x: field.x - ROW_LABEL_WIDTH, y: field.y, width: ROW_LABEL_WIDTH, height: CONTROL_HEIGHT };
  }

  private placementControlRect(): Rect {
    const field = this.sceneSizeFieldRect();
    return { x: field.x, y: field.y + CONTROL_HEIGHT + STACK_GAP, width: field.width, height: CONTROL_HEIGHT };
  }

  private placementLabelRect(): Rect {
    const control = this.placementControlRect();
    return { x: control.x - ROW_LABEL_WIDTH, y: control.y, width: ROW_LABEL_WIDTH, height: CONTROL_HEIGHT };
  }

  private placementCellButtonRect(): Rect {
    return segmentButtonRect(this.placementControlRect(), 0);
  }

  private placementFreeButtonRect(): Rect {
    return segmentButtonRect(this.placementControlRect(), 1);
  }

  private wfcHeaderRect(): Rect {
    const placement = this.placementControlRect();
    const y = placement.y + CONTROL_HEIGHT + SECTION_GAP;
    return { x: this.rect.x + PADDING, y, width: this.rect.width - PADDING * 2, height: HEADER_HEIGHT };
  }

  private wfcSeedFieldRect(): Rect {
    const header = this.wfcHeaderRect();
    return { x: header.x, y: header.y + HEADER_HEIGHT + HEADER_GAP, width: header.width, height: CONTROL_HEIGHT };
  }

  private generateWfcButtonRect(): Rect {
    const seed = this.wfcSeedFieldRect();
    return { x: seed.x, y: seed.y + CONTROL_HEIGHT + STACK_GAP, width: seed.width, height: CONTROL_HEIGHT };
  }

  private applyStaticHeaders() {
    this.objectsHeader.setRect(this.objectsHeaderRect());
    this.backgroundHeader.setRect(this.backgroundHeaderRect());
    this.groundHeader.setRect(this.groundHeaderRect());
    this.gridHeader.setRect(this.gridHeaderRect());
    this.objectsHeader.setLabel("Objects", this.state.scene ? countSuffix(this.state.scene.objects.length) : "");
    this.backgroundHeader.setLabel("Background", "");
    this.groundHeader.setLabel("Ground", "");
    this.gridHeader.setLabel("Grid", "");
    this.wfcHeader.setLabel("Generate layout", wfcGenerationLabel(this.state));
    this.refreshWfcGeneration();
    this.renderRowLabel("cellSizeLabel", "Cell size", this.cellSizeLabelRect());
    this.renderRowLabel("sceneSizeLabel", "Scene size", this.sceneSizeLabelRect());
    this.renderRowLabel("placementLabel", "Placement", this.placementLabelRect());
    this.refreshPlacementControls();
  }

  private renderRowLabel(field: "cellSizeLabel" | "sceneSizeLabel" | "placementLabel", text: string, rect: Rect) {
    const existing = this[field];
    if (existing) {
      this.root.remove(existing);
      existing.material.dispose();
    }
    const rasterized = rasterizeText(text, { size: 11.5, color: theme.textMutedStrong.css, weight: "600" });
    const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
    const mesh = new THREE.Mesh(unitPlane, material);
    mesh.scale.set(rasterized.width, rasterized.height, 1);
    mesh.position.set(rect.x, rect.y + rect.height / 2, hudZ.glyph);
    mesh.position.x += rasterized.width / 2;
    this.root.add(mesh);
    this[field] = mesh;
  }

  private refreshPlacementControls() {
    this.placementCellButton.setActive(this.state.placementResolution === "snap");
    this.placementFreeButton.setActive(this.state.placementResolution === "free");
  }

  private refreshWfcGeneration() {
    const generating = this.state.wfcProgress !== null;
    this.wfcSeedField.root.visible = !generating;
    this.generateWfcButton.setDisabled(generating);
    this.generateWfcButton.setLabel(generating ? "Generating layout…" : "Generate layout");
    this.wfcHeader.setLabel("Generate layout", wfcGenerationLabel(this.state));
  }

  // --- object list --------------------------------------------------------

  private rebuildRows() {
    for (const row of this.rows) row.dispose();
    this.rows = [];
    this.scroll.clearContent();
    this.clearEmptyState();
    this.applyStaticHeaders();

    const scene = this.state.scene;
    if (!scene) return;

    const names = objectDisplayNames(scene.objects);
    const list = this.listRect();
    let y = list.y;

    for (const object of scene.objects) {
      const rowRect: Rect = { x: list.x, y, width: list.width, height: ROW_HEIGHT };
      const row = new SceneObjectRow(rowRect, this.interaction, object.id, names.get(object.id) ?? object.id, {
        selected: object.id === this.state.selectedObjectId,
        hidden: this.state.isObjectHidden(object.id),
        onSelect: () => this.state.selectObject(object.id),
        onToggleVisible: () => this.state.toggleObjectVisibility(object.id),
        onDelete: () => this.state.deleteObject(object.id)
      });
      this.scroll.content.add(row.root);
      this.rows.push(row);
      y += ROW_HEIGHT + ROW_GAP;
    }

    this.scroll.setContentSize(Math.max(y - ROW_GAP - list.y, 0));
    this.scroll.applyClipping();

    if (scene.objects.length === 0) this.showEmptyState(list);
  }

  private showEmptyState(list: Rect) {
    const rasterized = rasterizeText("No objects in scene yet", { size: 12.5, color: theme.textMutedAlt.css });
    const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
    const mesh = new THREE.Mesh(unitPlane, material);
    mesh.scale.set(rasterized.width, rasterized.height, 1);
    mesh.position.set(list.x + list.width / 2, list.y + 22, hudZ.glyph);
    this.root.add(mesh);
    this.emptyStateMesh = mesh;
  }

  private clearEmptyState() {
    if (!this.emptyStateMesh) return;
    this.root.remove(this.emptyStateMesh);
    this.emptyStateMesh.material.dispose();
    this.emptyStateMesh = null;
  }

  // --- grid -----------------------------------------------------------------

  private commitGridSize(value: string) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      this.state.setGridCellSize(parsed);
      return;
    }
    this.gridField.setValue(formatGridSize(this.state.scene?.grid.cellSize ?? 1));
  }

  private commitSceneSize(value: string) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      this.state.setSceneSize(parsed);
      return;
    }
    this.sceneSizeField.setValue(formatGridSize(this.state.scene?.grid.width ?? 10));
  }

  private normalizeWfcSeed() {
    this.wfcSeedField.setValue(String(integer(this.wfcSeedField.getValue(), 1)));
  }

  private generateWfcLayout() {
    this.normalizeWfcSeed();
    const grid = this.state.scene?.grid;
    if (!grid) return;
    const width = Math.floor(grid.width / grid.cellSize);
    const depth = Math.floor(grid.depth / grid.cellSize);
    const seed = integer(this.wfcSeedField.getValue(), 1);
    this.state.generateWfcLayout({ width, depth, seed, tileWidth: grid.cellSize, tileDepth: grid.cellSize });
  }

  // --- lifecycle --------------------------------------------------------

  update(dt: number) {
    if (!this.root.visible) return;
    this.gridField.update(dt);
    this.sceneSizeField.update(dt);
  }

  setVisible(visible: boolean) {
    this.root.visible = visible;
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.scroll.setRect(this.listRect());
    this.divider.setRect(this.dividerRect());
    this.backgroundEditor.setRects(this.backgroundDropdownRect(), this.backgroundValueRect());
    this.groundEditor.setRects(this.groundDropdownRect(), this.groundValueRect());
    this.gridField.setRect(this.gridFieldRect());
    this.sceneSizeField.setRect(this.sceneSizeFieldRect());
    this.placementCellButton.setRect(this.placementCellButtonRect());
    this.placementFreeButton.setRect(this.placementFreeButtonRect());
    this.wfcSeedField.setRect(this.wfcSeedFieldRect());
    this.generateWfcButton.setRect(this.generateWfcButtonRect());
    this.applyStaticHeaders();
    this.rebuildRows();
  }

  dispose() {
    for (const cleanup of this.cleanups) cleanup();
    this.clearEmptyState();
    for (const row of this.rows) row.dispose();
    this.objectsHeader.dispose();
    this.scroll.dispose();
    this.divider.dispose();
    this.backgroundHeader.dispose();
    this.backgroundEditor.dispose();
    this.groundHeader.dispose();
    this.groundEditor.dispose();
    this.gridHeader.dispose();
    this.wfcHeader.dispose();
    this.cellSizeLabel?.material.dispose();
    this.gridField.dispose();
    this.sceneSizeLabel?.material.dispose();
    this.sceneSizeField.dispose();
    this.placementLabel?.material.dispose();
    this.placementCellButton.dispose();
    this.placementFreeButton.dispose();
    this.wfcSeedField.dispose();
    this.generateWfcButton.dispose();
  }
}

/** A small muted uppercase section label with an optional right-aligned suffix (e.g. an object count). */
class SectionHeader {
  readonly root = new THREE.Group();
  private labelMesh: LabelMesh | null = null;
  private suffixMesh: LabelMesh | null = null;
  private label = "";
  private suffix = "";

  constructor(private rect: Rect) {}

  setLabel(label: string, suffix: string) {
    this.label = label;
    this.suffix = suffix;
    this.render();
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.render();
  }

  private render() {
    if (this.labelMesh) {
      this.root.remove(this.labelMesh);
      this.labelMesh.material.dispose();
      this.labelMesh = null;
    }
    if (this.suffixMesh) {
      this.root.remove(this.suffixMesh);
      this.suffixMesh.material.dispose();
      this.suffixMesh = null;
    }
    if (this.label) {
      const rasterized = rasterizeText(this.label.toUpperCase(), { size: 10.5, color: theme.textMutedStrong.css, weight: "700" });
      const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
      const mesh = new THREE.Mesh(unitPlane, material);
      mesh.scale.set(rasterized.width, rasterized.height, 1);
      mesh.position.set(this.rect.x + rasterized.width / 2, this.rect.y + this.rect.height / 2, hudZ.glyph);
      this.root.add(mesh);
      this.labelMesh = mesh;
    }
    if (this.suffix) {
      const rasterized = rasterizeText(this.suffix, { size: 10.5, color: theme.textMutedAlt.css, weight: "600" });
      const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
      const mesh = new THREE.Mesh(unitPlane, material);
      mesh.scale.set(rasterized.width, rasterized.height, 1);
      mesh.position.set(this.rect.x + this.rect.width - rasterized.width / 2, this.rect.y + this.rect.height / 2, hudZ.glyph);
      this.root.add(mesh);
      this.suffixMesh = mesh;
    }
  }

  dispose() {
    this.labelMesh?.material.dispose();
    this.suffixMesh?.material.dispose();
  }
}

interface SurfaceAppearanceEditorOptions {
  getAppearance(): SurfaceAppearance | undefined;
  onTypeChange(type: SurfaceAppearanceType): void;
  onColorChange(color: string): void;
  onTextureChange(dataUrl: string): void;
}

/**
 * A Color/Texture dropdown plus its matching value row — a swatch and hex code for a color, or an
 * image preview and picker for a texture. Shared by the Background and Ground sections of the Scene
 * tab, the two places a surface's appearance is edited.
 */
class SurfaceAppearanceEditor {
  readonly root = new THREE.Group();
  private readonly dropdown: Dropdown;
  private readonly valueRoot = new THREE.Group();
  private disposeValueControl: () => void = () => {};
  private previewTexture: THREE.Texture | null = null;
  private previewTextureUrl: string | null = null;
  private previewToken = 0;
  private valueRect: Rect;
  private currentType: SurfaceAppearanceType | null = null;
  private colorSwatch: Panel | null = null;
  private colorHexMesh: LabelMesh | null = null;
  private colorHexLeftX = 0;

  constructor(
    dropdownRect: Rect,
    valueRect: Rect,
    private readonly interaction: InteractionSystem,
    private readonly options: SurfaceAppearanceEditorOptions
  ) {
    this.valueRect = valueRect;

    this.dropdown = new Dropdown(
      dropdownRect,
      interaction,
      ["Color", "Texture"],
      SURFACE_TYPE_LABELS[options.getAppearance()?.type ?? "color"],
      (label) => options.onTypeChange(SURFACE_TYPE_BY_LABEL[label] ?? "color")
    );
    this.root.add(this.dropdown.root, this.valueRoot);

    this.rebuildValueControl();
  }

  /** Call when the appearance data changed externally (type, color, or texture). */
  refresh() {
    const appearance = this.options.getAppearance();
    const type = appearance?.type ?? "color";
    this.dropdown.setOptions(["Color", "Texture"], SURFACE_TYPE_LABELS[type]);

    // Repainting the swatch is far cheaper than a full teardown/rebuild, and matters here: a color
    // drag fires this on every tick, so staying in color mode takes the light path.
    if (type === "color" && this.currentType === "color") {
      this.updateColorSwatch(appearance?.color ?? "#696969");
      return;
    }
    this.rebuildValueControl();
  }

  private updateColorSwatch(color: string) {
    this.colorSwatch?.setFill(hexToNumber(color));
    if (!this.colorHexMesh) return;
    const rasterized = rasterizeText(color.toUpperCase(), { size: 12.5, color: theme.text.css, weight: "600" });
    this.colorHexMesh.material.map = rasterized.texture;
    this.colorHexMesh.material.needsUpdate = true;
    this.colorHexMesh.scale.set(rasterized.width, rasterized.height, 1);
    this.colorHexMesh.position.x = this.colorHexLeftX + rasterized.width / 2;
  }

  setRects(dropdownRect: Rect, valueRect: Rect) {
    this.valueRect = valueRect;
    this.dropdown.setRect(dropdownRect);
    this.rebuildValueControl();
  }

  private rebuildValueControl() {
    this.disposeValueControl();
    this.valueRoot.clear();

    const appearance = this.options.getAppearance();
    const rect = this.valueRect;

    if (!appearance || appearance.type === "color") {
      this.releasePreviewTexture();
      this.currentType = "color";
      const color = appearance?.color ?? "#696969";

      const hoverBg = new Panel(rect, { fill: theme.panelSubtle.hex, radius: 8, z: hudZ.panel + 0.01 });
      hoverBg.root.visible = false;
      this.valueRoot.add(hoverBg.root);

      const swatchRect: Rect = { x: rect.x + 6, y: rect.y + (rect.height - SWATCH_SIZE) / 2, width: SWATCH_SIZE, height: SWATCH_SIZE };
      const swatch = new Panel(swatchRect, { fill: hexToNumber(color), border: theme.border.hex, borderWidth: 1, radius: 7, z: hudZ.control });
      this.valueRoot.add(swatch.root);
      this.colorSwatch = swatch;

      const hexLeftX = swatchRect.x + SWATCH_SIZE + 10;
      const hexRasterized = rasterizeText(color.toUpperCase(), { size: 12.5, color: theme.text.css, weight: "600" });
      const hexMaterial = hudBasicMaterial({ map: hexRasterized.texture, transparent: true });
      const hexMesh = new THREE.Mesh(unitPlane, hexMaterial);
      hexMesh.scale.set(hexRasterized.width, hexRasterized.height, 1);
      hexMesh.position.set(hexLeftX + hexRasterized.width / 2, rect.y + rect.height / 2, hudZ.glyph);
      this.valueRoot.add(hexMesh);
      this.colorHexMesh = hexMesh;
      this.colorHexLeftX = hexLeftX;

      const hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
      hitArea.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, hudZ.control + 0.01);
      hitArea.scale.set(rect.width, rect.height, 1);
      this.valueRoot.add(hitArea);
      const unregister = this.interaction.register(hitArea, {
        onClick: () => {
          void pickColor(color, swatchRect, (live) => this.options.onColorChange(live)).then((picked) => {
            if (picked) this.options.onColorChange(picked);
          });
        },
        onHover: () => (hoverBg.root.visible = true),
        onLeave: () => (hoverBg.root.visible = false)
      });

      this.disposeValueControl = () => {
        unregister();
        hoverBg.dispose();
        swatch.dispose();
        hexMaterial.dispose();
        hitArea.material.dispose();
        this.colorSwatch = null;
        this.colorHexMesh = null;
      };
      return;
    }

    this.currentType = "texture";
    const textureUrl = appearance.textureUrl;
    if (!textureUrl) {
      this.releasePreviewTexture();
      const button = new Button(rect, this.interaction, {
        icon: "refresh",
        label: "Choose Image",
        justify: "start",
        onClick: () => this.pickTexture()
      });
      this.valueRoot.add(button.root);
      this.disposeValueControl = () => button.dispose();
      return;
    }

    const previewRect: Rect = { x: rect.x, y: rect.y, width: SWATCH_SIZE, height: SWATCH_SIZE };
    const previewFrame = new Panel(previewRect, { fill: theme.panelSubtle.hex, border: theme.border.hex, borderWidth: 1, radius: 7 });
    this.valueRoot.add(previewFrame.root);

    // A separate mesh for the loaded image — Panel's own mesh carries its baked rounded-rect chrome
    // texture, so the photo goes on its own layer rather than overwriting that mask.
    const inset = 2;
    const previewImage = new THREE.Mesh(unitPlane, hudBasicMaterial({ transparent: true, visible: false }));
    previewImage.scale.set(SWATCH_SIZE - inset * 2, SWATCH_SIZE - inset * 2, 1);
    previewImage.position.set(previewRect.x + SWATCH_SIZE / 2, previewRect.y + SWATCH_SIZE / 2, hudZ.control);
    this.valueRoot.add(previewImage);
    this.applyPreviewTexture(previewImage, textureUrl);

    const buttonRect: Rect = {
      x: rect.x + SWATCH_SIZE + 10,
      y: rect.y,
      width: rect.width - SWATCH_SIZE - 10,
      height: rect.height
    };
    const button = new Button(buttonRect, this.interaction, {
      icon: "refresh",
      label: "Replace",
      justify: "start",
      onClick: () => this.pickTexture()
    });
    this.valueRoot.add(button.root);
    this.disposeValueControl = () => {
      previewFrame.dispose();
      previewImage.material.dispose();
      button.dispose();
    };
  }

  private pickTexture() {
    void pickImageFile().then((picked) => {
      if (picked) this.options.onTextureChange(picked.dataUrl);
    });
  }

  private applyPreviewTexture(mesh: LabelMesh, url: string) {
    if (this.previewTextureUrl === url && this.previewTexture) {
      this.setPreviewTextureOn(mesh);
      return;
    }
    this.releasePreviewTexture();
    this.previewTextureUrl = url;
    const token = this.previewToken;
    new THREE.TextureLoader().load(url, (texture) => {
      if (token !== this.previewToken) {
        texture.dispose();
        return;
      }
      this.previewTexture = texture;
      this.setPreviewTextureOn(mesh);
    });
  }

  private setPreviewTextureOn(mesh: LabelMesh) {
    if (!this.previewTexture) return;
    mesh.material.map = this.previewTexture;
    mesh.material.visible = true;
    mesh.material.needsUpdate = true;
  }

  private releasePreviewTexture() {
    this.previewToken++;
    this.previewTexture?.dispose();
    this.previewTexture = null;
    this.previewTextureUrl = null;
  }

  dispose() {
    this.dropdown.dispose();
    this.disposeValueControl();
    this.releasePreviewTexture();
  }
}

interface SceneObjectRowCallbacks {
  selected: boolean;
  hidden: boolean;
  onSelect(): void;
  onToggleVisible(): void;
  onDelete(): void;
}

/** One row in the object outliner: hover/selected background, name, and ghost eye/trash icon buttons. */
class SceneObjectRow {
  readonly root = new THREE.Group();
  readonly objectId: string;

  private readonly background: Panel;
  private readonly hitArea: THREE.Mesh;
  private labelMesh: LabelMesh | null = null;
  private readonly eyeButton: GhostIconButtonHandle;
  private readonly trashButton: GhostIconButtonHandle;
  private readonly unregister: () => void;
  private hovered = false;
  private selected: boolean;
  private hidden: boolean;

  constructor(
    private rect: Rect,
    interaction: InteractionSystem,
    objectId: string,
    private name: string,
    private readonly callbacks: SceneObjectRowCallbacks
  ) {
    this.objectId = objectId;
    this.selected = callbacks.selected;
    this.hidden = callbacks.hidden;

    this.background = new Panel(rect, { fill: theme.panelSubtle.hex, radius: 7, z: hudZ.panel + 0.01 });
    this.background.root.visible = false;
    this.root.add(this.background.root);

    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.hitArea.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, hudZ.control - 0.05);
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.root.add(this.hitArea);
    this.unregister = interaction.register(this.hitArea, {
      onClick: () => callbacks.onSelect(),
      onHover: () => this.setHovered(true),
      onLeave: () => this.setHovered(false)
    });

    this.eyeButton = createGhostIconButton(this.eyeRect(), interaction, { icon: "eye", onClick: () => callbacks.onToggleVisible() });
    this.root.add(this.eyeButton.root);

    this.trashButton = createGhostIconButton(this.trashRect(), interaction, {
      icon: "trash",
      danger: true,
      onClick: () => callbacks.onDelete()
    });
    this.root.add(this.trashButton.root);

    this.applyState();
  }

  private trashRect(): Rect {
    return {
      x: this.rect.x + this.rect.width - ROW_PADDING_X - ICON_BUTTON_SIZE,
      y: this.rect.y + (this.rect.height - ICON_BUTTON_SIZE) / 2,
      width: ICON_BUTTON_SIZE,
      height: ICON_BUTTON_SIZE
    };
  }

  private eyeRect(): Rect {
    const trash = this.trashRect();
    return { x: trash.x - ICON_GAP - ICON_BUTTON_SIZE, y: trash.y, width: ICON_BUTTON_SIZE, height: ICON_BUTTON_SIZE };
  }

  private labelRect(): Rect {
    const eye = this.eyeRect();
    const x = this.rect.x + ROW_PADDING_X;
    return { x, y: this.rect.y, width: Math.max(eye.x - ICON_GAP - x, 0), height: this.rect.height };
  }

  private setHovered(hovered: boolean) {
    if (this.hovered === hovered) return;
    this.hovered = hovered;
    this.applyState();
  }

  setSelected(selected: boolean) {
    if (this.selected === selected) return;
    this.selected = selected;
    this.applyState();
  }

  setHidden(hidden: boolean) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    this.applyState();
  }

  private applyState() {
    const showBg = this.hovered || this.selected;
    this.background.root.visible = showBg;
    if (showBg) this.background.setFill(this.selected ? theme.accentSelectedBg.hex : theme.panelSubtle.hex);

    this.renderLabel();
    this.eyeButton.setIcon(this.hidden ? "eyeOff" : "eye", this.hidden ? theme.textMutedStrong.css : theme.textMutedAlt.css);
  }

  private renderLabel() {
    if (this.labelMesh) {
      this.root.remove(this.labelMesh);
      this.labelMesh.material.dispose();
      this.labelMesh = null;
    }
    const color = this.hidden ? theme.textMutedAlt.css : this.selected ? theme.accent.css : theme.text.css;
    const rasterized = rasterizeText(this.name, { size: 12.5, color, weight: this.selected ? "600" : "500" });
    const label = this.labelRect();
    const width = Math.min(rasterized.width, label.width);
    const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
    const mesh = new THREE.Mesh(unitPlane, material);
    mesh.scale.set(width, rasterized.height, 1);
    mesh.position.set(label.x + width / 2, label.y + label.height / 2, hudZ.glyph);
    this.root.add(mesh);
    this.labelMesh = mesh;
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.background.setRect(rect);
    this.hitArea.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, hudZ.control - 0.05);
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.eyeButton.setRect(this.eyeRect());
    this.trashButton.setRect(this.trashRect());
    this.renderLabel();
  }

  dispose() {
    this.unregister();
    this.background.dispose();
    this.labelMesh?.material.dispose();
    this.eyeButton.dispose();
    this.trashButton.dispose();
  }
}

interface GhostIconButtonOptions {
  icon: string;
  danger?: boolean;
  onClick(): void;
}

interface GhostIconButtonHandle {
  root: THREE.Group;
  setIcon(icon: string, restColor: string): void;
  setRect(rect: Rect): void;
  dispose(): void;
}

/** A borderless icon button, invisible at rest — a background chip and (for `danger`) a color flip appear only on hover. */
function createGhostIconButton(rect: Rect, interaction: InteractionSystem, options: GhostIconButtonOptions): GhostIconButtonHandle {
  const root = new THREE.Group();
  let currentRect = rect;

  const background = new Panel(rect, { fill: theme.panelSubtle.hex, radius: 6, z: hudZ.control });
  background.root.visible = false;
  root.add(background.root);

  const hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
  hitArea.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, hudZ.control + 0.01);
  hitArea.scale.set(rect.width, rect.height, 1);
  root.add(hitArea);

  let icon = options.icon;
  let restColor = theme.textMutedAlt.css;
  let hovered = false;
  let iconMesh: LabelMesh | null = null;

  function render() {
    if (iconMesh) {
      root.remove(iconMesh);
      iconMesh.material.dispose();
      iconMesh = null;
    }
    background.root.visible = hovered;
    if (hovered) background.setFill(options.danger ? theme.diagnostic.hex : theme.panelSubtle.hex);

    const color = hovered ? (options.danger ? theme.white.css : theme.textMutedStrong.css) : restColor;
    const size = 15;
    const rasterized = rasterizeIcon(icon, size, color);
    const material = hudBasicMaterial({ map: rasterized.texture, transparent: true });
    const mesh = new THREE.Mesh(unitPlane, material);
    mesh.scale.set(size, size, 1);
    mesh.position.set(currentRect.x + currentRect.width / 2, currentRect.y + currentRect.height / 2, hudZ.glyph);
    root.add(mesh);
    iconMesh = mesh;
  }

  const unregister = interaction.register(hitArea, {
    onClick: () => options.onClick(),
    onHover: () => {
      hovered = true;
      render();
    },
    onLeave: () => {
      hovered = false;
      render();
    }
  });

  render();

  return {
    root,
    setIcon(nextIcon, nextColor) {
      icon = nextIcon;
      restColor = nextColor;
      render();
    },
    setRect(nextRect) {
      currentRect = nextRect;
      background.setRect(nextRect);
      hitArea.position.set(nextRect.x + nextRect.width / 2, nextRect.y + nextRect.height / 2, hudZ.control + 0.01);
      hitArea.scale.set(nextRect.width, nextRect.height, 1);
      render();
    },
    dispose() {
      unregister();
      background.dispose();
      hitArea.material.dispose();
      iconMesh?.material.dispose();
    }
  };
}

function hexToNumber(css: string): number {
  return Number.parseInt(css.replace("#", ""), 16);
}

function formatGridSize(cellSize: number): string {
  return String(cellSize);
}

function integer(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function wfcGenerationLabel(state: EditorState) {
  const progress = state.wfcProgress;
  if (!progress) return "Scene size / cell size";
  if (progress.status === "building-palette") return "Preparing tile palette";
  if (progress.status === "solving") return `Solving ${progress.collapsedCells}/${progress.cells} cells · ${progress.backtracks} backtracks`;
  return `Placing ${progress.cells} tiles`;
}

function countSuffix(count: number): string {
  return count > 0 ? String(count) : "";
}
