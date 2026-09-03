import { PanelOptions } from "../src/features/hud/kit/Panel";
import { BasePanel } from "../src/features/hud/kit/BasePanel";
import type { Rect } from "../src/features/hud/kit/layout";

class TestPanel extends BasePanel {
  layoutCalls = 0;

  constructor(rect: Rect, options?: PanelOptions) {
    super(rect, options);
  }

  get currentRect() {
    return this.rect;
  }

  addDisposable(disposable: { dispose(): void }) {
    this.registerDisposable(disposable);
  }

  addCleanup(cleanup: () => void) {
    this.registerCleanup(cleanup);
  }

  protected layout() {
    this.layoutCalls++;
  }
}

test("base panel owns a root, background, and resize lifecycle", () => {
  const panel = new TestPanel({ x: 10, y: 20, width: 120, height: 40 });

  expect(panel.root.children.length).toBe(1);
  expect(panel.currentRect).toEqual({ x: 10, y: 20, width: 120, height: 40 });

  panel.setRect({ x: 2, y: 4, width: 80, height: 30 });

  expect(panel.currentRect).toEqual({ x: 2, y: 4, width: 80, height: 30 });
  expect(panel.layoutCalls).toBe(1);
});

test("base panel handles visibility and disposal hooks", () => {
  const panel = new TestPanel({ x: 0, y: 0, width: 10, height: 10 });
  const disposed = vi.fn();
  const cleaned = vi.fn();
  panel.addDisposable({ dispose: disposed });
  panel.addCleanup(cleaned);

  panel.setVisible(false);
  expect(panel.root.visible).toBe(false);
  panel.setVisible(true);
  expect(panel.root.visible).toBe(true);

  panel.dispose();
  expect(cleaned).toHaveBeenCalledTimes(1);
  expect(disposed).toHaveBeenCalledTimes(1);
});
