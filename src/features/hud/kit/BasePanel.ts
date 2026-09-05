import * as THREE from "three";
import type { InteractionSystem } from "../../../engine/InteractionSystem";
import type { Rect } from "./layout";
import { Panel, type PanelOptions } from "./Panel";

interface Disposable {
  dispose(): void;
}

export class BasePanel {
  readonly root = new THREE.Group();
  protected readonly background: Panel;
  protected rect: Rect;
  private readonly disposables: Disposable[] = [];
  private readonly cleanups: Array<() => void> = [];

  constructor(rect: Rect, options: PanelOptions = {}, interaction?: InteractionSystem) {
    this.rect = rect;
    this.background = new Panel(rect, options);
    this.root.add(this.background.root);

    // Every child widget registers its own hit area, but the plain background fill between/around
    // them was never registered — so pointer moves over blank panel space (e.g. gaps exposed by
    // scrolling, or padding between rows) fell through to whatever sat in the world layer beneath,
    // moving/hiding things like the placement ghost even though the cursor is over opaque HUD chrome.
    if (interaction) {
      this.registerCleanup(
        interaction.register(this.background.root, {
          onPointerDown: () => {},
          onPointerMove: () => {},
          onPointerUp: () => {}
        })
      );
    }
  }

  setRect(rect: Rect) {
    this.rect = rect;
    this.background.setRect(rect);
    this.layout();
  }

  setVisible(visible: boolean) {
    this.root.visible = visible;
  }

  dispose() {
    for (const cleanup of this.cleanups) cleanup();
    for (const disposable of this.disposables) disposable.dispose();
    this.background.dispose();
  }

  protected layout() {}

  protected registerDisposable<T extends Disposable>(disposable: T): T {
    this.disposables.push(disposable);
    return disposable;
  }

  protected registerCleanup(cleanup: () => void) {
    this.cleanups.push(cleanup);
  }
}
