import * as THREE from "three";
import type { AssetManager } from "../../engine/AssetManager";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import type { ViewportSize } from "../../engine/Viewport";
import type { EditorState } from "../../state/EditorState";
import { computeShellLayout, type Rect, type ShellRects } from "./kit/layout";
import { Button } from "./kit/Button";
import { ResizeHandle } from "./kit/ResizeHandle";
import { AssetBrowserPanel } from "./panels/AssetBrowserPanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { LeftPanel, LEFT_PANEL_TAB_BAR_HEIGHT } from "./panels/LeftPanel";
import { ThumbnailRenderer } from "./thumbnails/ThumbnailRenderer";

interface HudActions {
  onResetView(): void;
  setCursor(cursor: string): void;
  setWorldControlsEnabled(enabled: boolean): void;
}

const ASSET_BROWSER_MIN_HEIGHT = 130;
const ASSET_BROWSER_MAX_VIEWPORT_RATIO = 0.55;
const ASSET_RESIZE_HANDLE_HEIGHT = 4;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_VIEWPORT_RATIO = 0.45;
const LEFT_PANEL_RESIZE_HANDLE_WIDTH = 4;
const INSPECTOR_PANEL_MIN_WIDTH = 240;
const INSPECTOR_PANEL_MAX_VIEWPORT_RATIO = 0.4;
const INSPECTOR_PANEL_RESIZE_HANDLE_WIDTH = 4;

/**
 * The orthographic HUD overlay: a top-level composite owning its own Scene+Camera (like WorldFeature),
 * composing the bottom asset browser from `kit` primitives.
 */
export class HudFeature {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;

  private readonly thumbnails: ThumbnailRenderer;
  private readonly assetBrowser: AssetBrowserPanel;
  private readonly assetBrowserToggleButton: Button;
  private readonly assetBrowserResizeHandle: ResizeHandle;
  private assetBrowserHidden = false;
  private assetBrowserHeight: number;
  private assetResizeStartHeight = 0;
  private readonly leftPanel: LeftPanel;
  private readonly leftPanelToggleButton: Button;
  private readonly leftPanelResizeHandle: ResizeHandle;
  private leftPanelWidth: number;
  private leftResizeStartWidth = 0;
  private readonly inspectorPanel: InspectorPanel;
  private readonly inspectorPanelToggleButton: Button;
  private readonly inspectorPanelResizeHandle: ResizeHandle;
  private inspectorPanelWidth: number;
  private inspectorResizeStartWidth = 0;
  private readonly resetViewButton: Button;
  private leftPanelHidden = false;
  private inspectorPanelHidden = false;
  private currentSize: ViewportSize;

  constructor(
    renderer: THREE.WebGLRenderer,
    size: ViewportSize,
    private readonly interaction: InteractionSystem,
    assetManager: AssetManager,
    private readonly state: EditorState,
    private readonly actions: HudActions
  ) {
    this.currentSize = size;
    this.camera = new THREE.OrthographicCamera(0, size.width, 0, size.height, 0.1, 100);
    this.camera.position.z = 10;

    this.thumbnails = new ThumbnailRenderer(renderer, assetManager);
    this.assetBrowserHeight = defaultAssetBrowserHeight(size);
    this.leftPanelWidth = defaultLeftPanelWidth(size);
    this.inspectorPanelWidth = defaultInspectorPanelWidth(size);

    const layout = this.computeLayout(size);
    this.assetBrowser = new AssetBrowserPanel(layout.assetBrowser, interaction, state, this.thumbnails);
    this.assetBrowserToggleButton = new Button(assetToggleRect(layout, this.assetBrowserHidden), interaction, {
      icon: "chevronDown",
      label: "Hide Assets",
      justify: "start",
      onClick: () => this.setAssetBrowserHidden(!this.assetBrowserHidden)
    });
    this.assetBrowserResizeHandle = new ResizeHandle(assetResizeHandleRect(layout), interaction, {
      axis: "vertical",
      setCursor: (cursor) => this.actions.setCursor(cursor),
      onDragStart: () => this.startAssetBrowserResize(),
      onDrag: (delta) => this.dragAssetBrowserResize(delta),
      onDragEnd: () => this.endPanelResize()
    });

    this.leftPanel = new LeftPanel(layout.leftPanel, interaction, state);
    this.leftPanelToggleButton = new Button(leftPanelToggleRect(layout, this.leftPanelHidden), interaction, {
      icon: "chevronLeft",
      justify: "center",
      onClick: () => this.setLeftPanelHidden(!this.leftPanelHidden)
    });
    this.leftPanelResizeHandle = new ResizeHandle(leftPanelResizeHandleRect(layout), interaction, {
      axis: "horizontal",
      setCursor: (cursor) => this.actions.setCursor(cursor),
      onDragStart: () => this.startLeftPanelResize(),
      onDrag: (delta) => this.dragLeftPanelResize(delta),
      onDragEnd: () => this.endPanelResize()
    });
    this.inspectorPanel = new InspectorPanel(layout.inspectorPanel, interaction, state, assetManager, this.thumbnails, {
      setCursor: (cursor) => this.actions.setCursor(cursor),
      setWorldControlsEnabled: (enabled) => this.actions.setWorldControlsEnabled(enabled)
    });
    this.inspectorPanelToggleButton = new Button(inspectorPanelToggleRect(layout, this.inspectorPanelHidden), interaction, {
      icon: "chevronRight",
      justify: "center",
      onClick: () => this.setInspectorPanelHidden(!this.inspectorPanelHidden)
    });
    this.inspectorPanelResizeHandle = new ResizeHandle(inspectorPanelResizeHandleRect(layout), interaction, {
      axis: "horizontal",
      setCursor: (cursor) => this.actions.setCursor(cursor),
      onDragStart: () => this.startInspectorPanelResize(),
      onDrag: (delta) => this.dragInspectorPanelResize(delta),
      onDragEnd: () => this.endPanelResize()
    });
    this.resetViewButton = new Button(resetViewRect(layout), interaction, {
      icon: "refresh",
      justify: "center",
      onClick: () => this.actions.onResetView()
    });

    this.scene.add(
      this.assetBrowser.root,
      this.assetBrowserToggleButton.root,
      this.assetBrowserResizeHandle.root,
      this.leftPanel.root,
      this.leftPanelToggleButton.root,
      this.leftPanelResizeHandle.root,
      this.inspectorPanel.root,
      this.inspectorPanelToggleButton.root,
      this.inspectorPanelResizeHandle.root,
      this.resetViewButton.root
    );
    this.applyAssetBrowserVisibility(layout);
    this.applyLeftPanelVisibility(layout);
    this.applyInspectorPanelVisibility(layout);
  }

  update(dt: number) {
    this.thumbnails.update(dt);
    this.assetBrowser.update(dt);
    this.leftPanel.update(dt);
    this.inspectorPanel.update(dt);
  }

  resize(size: ViewportSize) {
    this.currentSize = size;
    this.assetBrowserHeight = clampAssetBrowserHeight(this.assetBrowserHeight, size.height);
    this.leftPanelWidth = clampLeftPanelWidth(this.leftPanelWidth, size.width);
    this.inspectorPanelWidth = clampInspectorPanelWidth(this.inspectorPanelWidth, size.width);
    this.camera.left = 0;
    this.camera.right = size.width;
    this.camera.top = 0;
    this.camera.bottom = size.height;
    this.camera.updateProjectionMatrix();

    const layout = this.computeLayout(size);
    this.applyLayout(layout);
  }

  private computeLayout(size: ViewportSize) {
    return computeShellLayout(size.width, size.height, {
      assetBrowserHidden: this.assetBrowserHidden,
      leftPanelHidden: this.leftPanelHidden,
      inspectorPanelHidden: this.inspectorPanelHidden,
      assetBrowserHeight: this.assetBrowserHeight,
      leftPanelWidth: this.leftPanelWidth,
      inspectorPanelWidth: this.inspectorPanelWidth
    });
  }

  private applyLayout(layout: ShellRects) {
    this.assetBrowser.setRect(layout.assetBrowser);
    this.assetBrowserToggleButton.setRect(assetToggleRect(layout, this.assetBrowserHidden));
    this.assetBrowserResizeHandle.setRect(assetResizeHandleRect(layout));
    this.applyAssetBrowserVisibility(layout);
    this.leftPanel.setRect(layout.leftPanel);
    this.leftPanelResizeHandle.setRect(leftPanelResizeHandleRect(layout));
    this.applyLeftPanelVisibility(layout);
    this.inspectorPanel.setRect(layout.inspectorPanel);
    this.inspectorPanelResizeHandle.setRect(inspectorPanelResizeHandleRect(layout));
    this.applyInspectorPanelVisibility(layout);
    this.resetViewButton.setRect(resetViewRect(layout));
  }

  private setAssetBrowserHidden(hidden: boolean) {
    if (this.assetBrowserHidden === hidden) return;
    this.assetBrowserHidden = hidden;
    this.applyLayout(this.computeLayout(this.currentSize));
  }

  private applyAssetBrowserVisibility(layout: ShellRects) {
    const visible = !this.assetBrowserHidden;
    this.assetBrowser.setVisible(visible);
    this.assetBrowserResizeHandle.setVisible(visible);
    this.assetBrowserToggleButton.setContent({
      icon: visible ? "chevronDown" : "chevronUp",
      label: visible ? "Hide Assets" : "Assets"
    });
    this.assetBrowserToggleButton.setRect(assetToggleRect(layout, this.assetBrowserHidden));
  }

  private setLeftPanelHidden(hidden: boolean) {
    if (this.leftPanelHidden === hidden) return;
    this.leftPanelHidden = hidden;
    this.applyLayout(this.computeLayout(this.currentSize));
  }

  private startAssetBrowserResize() {
    if (this.assetBrowserHidden) return;
    this.assetResizeStartHeight = this.assetBrowserHeight;
    this.actions.setWorldControlsEnabled(false);
  }

  private dragAssetBrowserResize(deltaY: number) {
    if (this.assetBrowserHidden) return;
    this.assetBrowserHeight = clampAssetBrowserHeight(this.assetResizeStartHeight - deltaY, this.currentSize.height);
    this.applyLayout(this.computeLayout(this.currentSize));
  }

  private startLeftPanelResize() {
    if (this.leftPanelHidden) return;
    this.leftResizeStartWidth = this.leftPanelWidth;
    this.actions.setWorldControlsEnabled(false);
  }

  private dragLeftPanelResize(deltaX: number) {
    if (this.leftPanelHidden) return;
    this.leftPanelWidth = clampLeftPanelWidth(this.leftResizeStartWidth + deltaX, this.currentSize.width);
    this.applyLayout(this.computeLayout(this.currentSize));
  }

  private endPanelResize() {
    this.actions.setWorldControlsEnabled(true);
  }

  private setInspectorPanelHidden(hidden: boolean) {
    if (this.inspectorPanelHidden === hidden) return;
    this.inspectorPanelHidden = hidden;
    this.applyLayout(this.computeLayout(this.currentSize));
  }

  private startInspectorPanelResize() {
    if (this.inspectorPanelHidden) return;
    this.inspectorResizeStartWidth = this.inspectorPanelWidth;
    this.actions.setWorldControlsEnabled(false);
  }

  private dragInspectorPanelResize(deltaX: number) {
    if (this.inspectorPanelHidden) return;
    this.inspectorPanelWidth = clampInspectorPanelWidth(this.inspectorResizeStartWidth - deltaX, this.currentSize.width);
    this.applyLayout(this.computeLayout(this.currentSize));
  }

  private applyLeftPanelVisibility(layout: ShellRects) {
    const visible = !this.leftPanelHidden;
    this.leftPanel.setVisible(visible);
    this.leftPanelResizeHandle.setVisible(visible);
    this.leftPanelToggleButton.setContent({
      icon: visible ? "chevronLeft" : "chevronRight",
      label: visible ? undefined : "Panel"
    });
    this.leftPanelToggleButton.setRect(leftPanelToggleRect(layout, this.leftPanelHidden));
  }

  private applyInspectorPanelVisibility(layout: ShellRects) {
    const visible = !this.inspectorPanelHidden && layout.inspectorPanel.width > 0;
    this.inspectorPanel.setVisible(visible);
    this.inspectorPanelResizeHandle.setVisible(visible);
    this.inspectorPanelToggleButton.root.visible = !layout.narrow;
    this.inspectorPanelToggleButton.setContent({
      icon: visible ? "chevronRight" : "chevronLeft",
      label: visible ? undefined : "Inspector"
    });
    this.inspectorPanelToggleButton.setRect(inspectorPanelToggleRect(layout, this.inspectorPanelHidden || layout.inspectorPanel.width <= 0));
  }

  dispose() {
    this.assetBrowser.dispose();
    this.assetBrowserToggleButton.dispose();
    this.assetBrowserResizeHandle.dispose();
    this.leftPanel.dispose();
    this.leftPanelToggleButton.dispose();
    this.leftPanelResizeHandle.dispose();
    this.inspectorPanel.dispose();
    this.inspectorPanelToggleButton.dispose();
    this.inspectorPanelResizeHandle.dispose();
    this.resetViewButton.dispose();
    this.thumbnails.dispose();
  }
}

function assetToggleRect(layout: ShellRects, hidden: boolean): Rect {
  const width = hidden ? 94 : 122;
  const height = 34;
  const margin = 10;
  if (hidden) {
    return {
      x: layout.viewport.x + margin,
      y: layout.viewport.y + layout.viewport.height - height - margin,
      width,
      height
    };
  }
  return {
    x: layout.assetBrowser.x + layout.assetBrowser.width - width - margin,
    y: layout.assetBrowser.y + 5,
    width,
    height
  };
}

function assetResizeHandleRect(layout: ShellRects): Rect {
  return {
    x: layout.assetBrowser.x,
    y: layout.assetBrowser.y,
    width: layout.assetBrowser.width,
    height: ASSET_RESIZE_HANDLE_HEIGHT
  };
}

function defaultAssetBrowserHeight(size: ViewportSize): number {
  const fallback = size.width < 980 ? 150 : 190;
  return clampAssetBrowserHeight(fallback, size.height);
}

function clampAssetBrowserHeight(height: number, viewportHeight: number): number {
  const max = Math.max(ASSET_BROWSER_MIN_HEIGHT, viewportHeight * ASSET_BROWSER_MAX_VIEWPORT_RATIO);
  return THREE.MathUtils.clamp(height, ASSET_BROWSER_MIN_HEIGHT, max);
}

function leftPanelResizeHandleRect(layout: ShellRects): Rect {
  return {
    x: layout.leftPanel.x + layout.leftPanel.width - LEFT_PANEL_RESIZE_HANDLE_WIDTH,
    y: layout.leftPanel.y,
    width: LEFT_PANEL_RESIZE_HANDLE_WIDTH,
    height: layout.leftPanel.height
  };
}

function defaultLeftPanelWidth(size: ViewportSize): number {
  return clampLeftPanelWidth(280, size.width);
}

function clampLeftPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(LEFT_PANEL_MIN_WIDTH, viewportWidth * LEFT_PANEL_MAX_VIEWPORT_RATIO);
  return THREE.MathUtils.clamp(width, LEFT_PANEL_MIN_WIDTH, max);
}

function defaultInspectorPanelWidth(size: ViewportSize): number {
  return clampInspectorPanelWidth(300, size.width);
}

function clampInspectorPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(INSPECTOR_PANEL_MIN_WIDTH, viewportWidth * INSPECTOR_PANEL_MAX_VIEWPORT_RATIO);
  return THREE.MathUtils.clamp(width, INSPECTOR_PANEL_MIN_WIDTH, max);
}

function leftPanelToggleRect(layout: ShellRects, hidden: boolean): Rect {
  const margin = 10;
  if (hidden) {
    const width = 84;
    const height = 34;
    return { x: margin, y: margin, width, height };
  }
  // Icon-only square, vertically centered in LeftPanel's tab row so it sits beside the tabs, not over them.
  const size = 30;
  return {
    x: layout.leftPanel.x + layout.leftPanel.width - size - margin,
    y: layout.leftPanel.y + (LEFT_PANEL_TAB_BAR_HEIGHT - size) / 2,
    width: size,
    height: size
  };
}

function resetViewRect(layout: ShellRects): Rect {
  const size = 34;
  const margin = 10;
  return {
    x: layout.viewport.x + layout.viewport.width - size - margin,
    y: layout.viewport.y + margin,
    width: size,
    height: size
  };
}

function inspectorPanelResizeHandleRect(layout: ShellRects): Rect {
  return {
    x: layout.inspectorPanel.x,
    y: layout.inspectorPanel.y,
    width: INSPECTOR_PANEL_RESIZE_HANDLE_WIDTH,
    height: layout.inspectorPanel.height
  };
}

function inspectorPanelToggleRect(layout: ShellRects, hidden: boolean): Rect {
  const margin = 10;
  if (hidden) {
    const width = 112;
    const height = 34;
    return {
      x: layout.viewport.x + layout.viewport.width - width - margin,
      y: layout.viewport.y + margin,
      width,
      height
    };
  }
  const size = 30;
  return {
    x: layout.inspectorPanel.x + margin,
    y: layout.inspectorPanel.y + margin,
    width: size,
    height: size
  };
}
