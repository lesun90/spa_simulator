import * as THREE from "three";
import { theme } from "../../../app/theme";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { EditorState } from "../../../state/EditorState";
import { BasePanel } from "../kit/BasePanel";
import type { Rect } from "../kit/layout";
import { hudBasicMaterial } from "../kit/materials";
import { Panel, unitPlane } from "../kit/Panel";
import { rasterizeText } from "../kit/TextRenderer";
import { hudZ } from "../kit/zIndex";
import { ProjectTabPanel } from "./ProjectTabPanel";
import { SceneTabPanel } from "./SceneTabPanel";

type LeftPanelTab = "project" | "scene";

/** Exported so HudFeature can vertically-center its floating collapse button against this row. */
export const LEFT_PANEL_TAB_BAR_HEIGHT = 40;
const TAB_INSET_X = 16;
const TAB_GAP = 4;
const TAB_PADDING_X = 14;
const TAB_LABEL_SIZE = 11.5;
const UNDERLINE_HEIGHT = 2;
const DIVIDER_HEIGHT = 1;

/** The hideable left sidebar: a Project/Scene tab bar over the matching tab content panel. */
export class LeftPanel extends BasePanel {
  private readonly projectTabButton: TabButton;
  private readonly sceneTabButton: TabButton;
  private readonly divider: Panel;
  private readonly projectTab: ProjectTabPanel;
  private readonly sceneTab: SceneTabPanel;
  private activeTab: LeftPanelTab = "scene";

  constructor(rect: Rect, interaction: InteractionSystem, state: EditorState) {
    super(rect, {
      fill: theme.panel.hex,
      border: theme.borderStrong.hex,
      borderWidth: 1,
      radius: { topLeft: 0, topRight: theme.radius.lg, bottomLeft: 0, bottomRight: theme.radius.lg },
      shadow: "lg",
      z: -0.2
    });

    const projectWidth = tabWidth("Project");
    const sceneWidth = tabWidth("Scene");

    this.projectTabButton = new TabButton(
      { x: this.rect.x + TAB_INSET_X, y: this.rect.y, width: projectWidth, height: LEFT_PANEL_TAB_BAR_HEIGHT },
      interaction,
      "Project",
      () => this.setActiveTab("project")
    );
    this.sceneTabButton = new TabButton(
      { x: this.rect.x + TAB_INSET_X + projectWidth + TAB_GAP, y: this.rect.y, width: sceneWidth, height: LEFT_PANEL_TAB_BAR_HEIGHT },
      interaction,
      "Scene",
      () => this.setActiveTab("scene")
    );
    this.root.add(this.projectTabButton.root, this.sceneTabButton.root);

    this.divider = new Panel(this.dividerRect(), { fill: theme.borderSubtle.hex, radius: 0 });
    this.root.add(this.divider.root);

    this.projectTab = new ProjectTabPanel(this.contentRect(), interaction, state);
    this.sceneTab = new SceneTabPanel(this.contentRect(), interaction, state);
    this.root.add(this.projectTab.root, this.sceneTab.root);

    this.applyActiveTab();
  }

  private dividerRect(): Rect {
    return { x: this.rect.x, y: this.rect.y + LEFT_PANEL_TAB_BAR_HEIGHT, width: this.rect.width, height: DIVIDER_HEIGHT };
  }

  private contentRect(): Rect {
    const top = this.rect.y + LEFT_PANEL_TAB_BAR_HEIGHT + DIVIDER_HEIGHT;
    return { x: this.rect.x, y: top, width: this.rect.width, height: Math.max(this.rect.height - LEFT_PANEL_TAB_BAR_HEIGHT - DIVIDER_HEIGHT, 0) };
  }

  private setActiveTab(tab: LeftPanelTab) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.applyActiveTab();
  }

  private applyActiveTab() {
    this.projectTabButton.setActive(this.activeTab === "project");
    this.sceneTabButton.setActive(this.activeTab === "scene");
    this.projectTab.setVisible(this.activeTab === "project");
    this.sceneTab.setVisible(this.activeTab === "scene");
  }

  update(dt: number) {
    if (!this.root.visible) return;
    this.projectTab.update(dt);
    this.sceneTab.update(dt);
  }

  protected layout() {
    const projectWidth = tabWidth("Project");
    const sceneWidth = tabWidth("Scene");
    this.projectTabButton?.setRect({ x: this.rect.x + TAB_INSET_X, y: this.rect.y, width: projectWidth, height: LEFT_PANEL_TAB_BAR_HEIGHT });
    this.sceneTabButton?.setRect({
      x: this.rect.x + TAB_INSET_X + projectWidth + TAB_GAP,
      y: this.rect.y,
      width: sceneWidth,
      height: LEFT_PANEL_TAB_BAR_HEIGHT
    });
    this.divider?.setRect(this.dividerRect());
    this.projectTab?.setRect(this.contentRect());
    this.sceneTab?.setRect(this.contentRect());
  }

  dispose() {
    this.projectTabButton.dispose();
    this.sceneTabButton.dispose();
    this.divider.dispose();
    this.projectTab.dispose();
    this.sceneTab.dispose();
    super.dispose();
  }
}

function tabWidth(label: string): number {
  return rasterizeText(label.toUpperCase(), { size: TAB_LABEL_SIZE, weight: "700" }).width + TAB_PADDING_X * 2;
}

type LabelMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/**
 * A minimal text tab: muted when inactive, dark + underlined when active, a faint hover chip
 * between — the lighter "earned familiarity" tab idiom instead of a full-bleed pill button.
 */
class TabButton {
  readonly root = new THREE.Group();
  private readonly hoverBg: Panel;
  private readonly underline: Panel;
  private readonly hitArea: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private labelMesh: LabelMesh | null = null;
  private readonly unregister: () => void;
  private active = false;
  private hovered = false;

  constructor(
    private rect: Rect,
    interaction: InteractionSystem,
    private readonly label: string,
    private readonly onClick: () => void
  ) {
    this.hoverBg = new Panel(rect, {
      fill: theme.panelSubtle.hex,
      radius: { topLeft: theme.radius.sm, topRight: theme.radius.sm, bottomLeft: 0, bottomRight: 0 },
      z: hudZ.panel + 0.01
    });
    this.hoverBg.root.visible = false;
    this.root.add(this.hoverBg.root);

    this.underline = new Panel(this.underlineRect(), { fill: theme.accent.hex, radius: 0, z: hudZ.control });
    this.underline.root.visible = false;
    this.root.add(this.underline.root);

    this.hitArea = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
    this.hitArea.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, hudZ.control + 0.01);
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.root.add(this.hitArea);

    this.unregister = interaction.register(this.hitArea, {
      onClick: () => this.onClick(),
      onHover: () => this.setHovered(true),
      onLeave: () => this.setHovered(false)
    });

    this.renderLabel();
  }

  private underlineRect(): Rect {
    return { x: this.rect.x + 2, y: this.rect.y + this.rect.height - UNDERLINE_HEIGHT, width: this.rect.width - 4, height: UNDERLINE_HEIGHT };
  }

  private setHovered(hovered: boolean) {
    if (this.hovered === hovered) return;
    this.hovered = hovered;
    this.hoverBg.root.visible = hovered && !this.active;
    this.renderLabel();
  }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.underline.root.visible = active;
    this.hoverBg.root.visible = this.hovered && !active;
    this.renderLabel();
  }

  private renderLabel() {
    if (this.labelMesh) {
      this.root.remove(this.labelMesh);
      this.labelMesh.material.dispose();
      this.labelMesh = null;
    }
    const color = this.active ? theme.text.css : this.hovered ? theme.textMutedStrong.css : theme.textMutedAlt.css;
    const rasterized = rasterizeText(this.label.toUpperCase(), { size: TAB_LABEL_SIZE, color, weight: this.active ? "700" : "600" });
    const mesh = new THREE.Mesh(unitPlane, hudBasicMaterial({ map: rasterized.texture, transparent: true }));
    mesh.scale.set(rasterized.width, rasterized.height, 1);
    mesh.position.set(this.rect.x + this.rect.width / 2, this.rect.y + this.rect.height / 2, hudZ.glyph);
    this.root.add(mesh);
    this.labelMesh = mesh;
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.hoverBg.setRect(rect);
    this.underline.setRect(this.underlineRect());
    this.hitArea.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, hudZ.control + 0.01);
    this.hitArea.scale.set(rect.width, rect.height, 1);
    this.renderLabel();
  }

  dispose() {
    this.unregister();
    this.hoverBg.dispose();
    this.underline.dispose();
    this.labelMesh?.material.dispose();
  }
}
