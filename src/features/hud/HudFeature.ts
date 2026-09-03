import * as THREE from "three";
import type { AssetManager } from "../../engine/AssetManager";
import type { InteractionSystem } from "../../engine/InteractionSystem";
import type { ViewportSize } from "../../engine/Viewport";
import type { EditorState } from "../../state/EditorState";
import { computeShellLayout, type Rect, type ShellRects } from "./kit/layout";
import { Button } from "./kit/Button";
import { AssetBrowserPanel } from "./panels/AssetBrowserPanel";
import { ThumbnailRenderer } from "./thumbnails/ThumbnailRenderer";

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
  private assetBrowserHidden = false;
  private currentSize: ViewportSize;

  constructor(
    renderer: THREE.WebGLRenderer,
    size: ViewportSize,
    private readonly interaction: InteractionSystem,
    assetManager: AssetManager,
    private readonly state: EditorState
  ) {
    this.currentSize = size;
    this.camera = new THREE.OrthographicCamera(0, size.width, 0, size.height, 0.1, 100);
    this.camera.position.z = 10;

    this.thumbnails = new ThumbnailRenderer(renderer, assetManager);

    const layout = this.computeLayout(size);
    this.assetBrowser = new AssetBrowserPanel(layout.assetBrowser, interaction, state, this.thumbnails);
    this.assetBrowserToggleButton = new Button(assetToggleRect(layout, this.assetBrowserHidden), interaction, {
      icon: "chevronDown",
      label: "Hide Assets",
      justify: "start",
      onClick: () => this.setAssetBrowserHidden(!this.assetBrowserHidden)
    });

    this.scene.add(
      this.assetBrowser.root,
      this.assetBrowserToggleButton.root
    );
    this.applyAssetBrowserVisibility(layout);
  }

  update(dt: number) {
    this.thumbnails.update(dt);
    this.assetBrowser.update(dt);
  }

  resize(size: ViewportSize) {
    this.currentSize = size;
    this.camera.left = 0;
    this.camera.right = size.width;
    this.camera.top = 0;
    this.camera.bottom = size.height;
    this.camera.updateProjectionMatrix();

    const layout = this.computeLayout(size);
    this.applyLayout(layout);
  }

  private computeLayout(size: ViewportSize) {
    return computeShellLayout(size.width, size.height, { assetBrowserHidden: this.assetBrowserHidden });
  }

  private applyLayout(layout: ShellRects) {
    this.assetBrowser.setRect(layout.assetBrowser);
    this.assetBrowserToggleButton.setRect(assetToggleRect(layout, this.assetBrowserHidden));
    this.applyAssetBrowserVisibility(layout);
  }

  private setAssetBrowserHidden(hidden: boolean) {
    if (this.assetBrowserHidden === hidden) return;
    this.assetBrowserHidden = hidden;
    this.applyLayout(this.computeLayout(this.currentSize));
  }

  private applyAssetBrowserVisibility(layout: ShellRects) {
    const visible = !this.assetBrowserHidden;
    this.assetBrowser.setVisible(visible);
    this.assetBrowserToggleButton.setContent({
      icon: visible ? "chevronDown" : "chevronUp",
      label: visible ? "Hide Assets" : "Assets"
    });
    this.assetBrowserToggleButton.setRect(assetToggleRect(layout, this.assetBrowserHidden));
  }

  dispose() {
    this.assetBrowser.dispose();
    this.assetBrowserToggleButton.dispose();
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
