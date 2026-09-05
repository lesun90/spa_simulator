import * as THREE from "three";
import { PanelOptions } from "../src/features/hud/kit/Panel";
import { BasePanel } from "../src/features/hud/kit/BasePanel";
import type { Rect } from "../src/features/hud/kit/layout";
import { InteractionSystem } from "../src/engine/InteractionSystem";
import { Viewport } from "../src/engine/Viewport";

vi.stubGlobal("innerWidth", 400);
vi.stubGlobal("innerHeight", 300);

function makeOrthoCamera(width: number, height: number) {
  const camera = new THREE.OrthographicCamera(0, width, 0, height, 0.1, 100);
  camera.position.z = 10;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function makeWorldTarget() {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  mesh.scale.set(400, 300, 1);
  mesh.position.set(200, 150, -1);
  return mesh;
}

class TestPanel extends BasePanel {
  layoutCalls = 0;

  constructor(rect: Rect, options?: PanelOptions, interaction?: InteractionSystem) {
    super(rect, options, interaction);
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

test("an opaque panel's blank background blocks pointer-move from reaching the layer beneath it", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const hudScene = new THREE.Scene();
  const worldScene = new THREE.Scene();
  const camera = makeOrthoCamera(400, 300);
  interaction.setLayers([
    { scene: hudScene, camera },
    { scene: worldScene, camera }
  ]);

  const panel = new TestPanel({ x: 0, y: 0, width: 400, height: 300 }, {}, interaction);
  hudScene.add(panel.root);

  const worldTarget = makeWorldTarget();
  worldScene.add(worldTarget);
  hudScene.updateMatrixWorld(true);
  worldScene.updateMatrixWorld(true);

  const onWorldMove = vi.fn();
  interaction.register(worldTarget, { onPointerMove: onWorldMove });

  // No widget lives at this point — just the panel's own opaque background — so this must not
  // reach the ground/world layer underneath, the way clicking through a modal backdrop shouldn't.
  interaction.handlePointerMove(200, 150, {} as PointerEvent);

  expect(onWorldMove).not.toHaveBeenCalled();
});
