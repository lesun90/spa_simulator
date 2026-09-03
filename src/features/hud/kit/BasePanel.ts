import * as THREE from "three";
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

  constructor(rect: Rect, options: PanelOptions = {}) {
    this.rect = rect;
    this.background = new Panel(rect, options);
    this.root.add(this.background.root);
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
