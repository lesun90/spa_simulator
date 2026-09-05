import * as THREE from "three";
import { InteractionSystem } from "../src/engine/InteractionSystem";
import { Viewport } from "../src/engine/Viewport";
import { ScrollRegion } from "../src/features/hud/kit/ScrollRegion";

vi.stubGlobal("innerWidth", 400);
vi.stubGlobal("innerHeight", 300);

test("clearContent removes stale children from the scrollable scene graph", () => {
  const interaction = new InteractionSystem(new Viewport(2));
  const scroll = new ScrollRegion({ x: 0, y: 0, width: 100, height: 50 }, interaction, { axis: "horizontal" });
  const stale = new THREE.Group();
  const next = new THREE.Group();
  scroll.content.add(stale);

  scroll.clearContent();
  scroll.content.add(next);

  expect(scroll.content.children).toEqual([next]);
  scroll.dispose();
});

test("dragging the scrollbar thumb scrolls horizontal content", () => {
  const interaction = new InteractionSystem(new Viewport(2));
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const scroll = new ScrollRegion({ x: 0, y: 0, width: 100, height: 50 }, interaction, { axis: "horizontal" });
  scroll.setContentSize(300);
  scene.add(scroll.root);
  settle(scene);

  interaction.handlePointerDown(10, 47, { button: 0 } as PointerEvent);
  interaction.handlePointerMove(50, 47, { buttons: 1 } as PointerEvent);
  interaction.handlePointerUp(50, 47, { button: 0 } as PointerEvent);

  expect(scroll.content.position.x).toBeLessThan(0);
  scroll.dispose();
});

test("a row scrolled out of the list's visible bounds no longer intercepts pointer events", () => {
  // Reproduces picking an item near the bottom of a long list: reaching it scrolls earlier rows far
  // out of view. Visual clipping (shader clip planes) hides them, but raycasting ignores clip planes —
  // so without an explicit bounds check, a scrolled-out row still geometrically sits wherever it was
  // translated to, which can land on top of whatever's in a layer behind the panel (e.g. the world
  // viewport rendered above a bottom-docked list), silently swallowing pointer events meant for it.
  const interaction = new InteractionSystem(new Viewport(2));
  const hudScene = new THREE.Scene();
  const worldScene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([
    { scene: hudScene, camera },
    { scene: worldScene, camera }
  ]);

  // The list panel occupies the bottom half of the screen (y: 150-300); the world viewport sits above it.
  const scroll = new ScrollRegion({ x: 0, y: 150, width: 400, height: 150 }, interaction, { axis: "vertical" });
  hudScene.add(scroll.root);

  const row = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  row.scale.set(400, 30, 1);
  row.position.set(200, 165, 0.1); // top row, at the list's local y=0 (absolute y=150..180)
  scroll.content.add(row);
  scroll.setContentSize(600);

  const worldTarget = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  worldTarget.scale.set(400, 150, 1);
  worldTarget.position.set(200, 75, -1); // the world viewport, above the list panel
  worldScene.add(worldTarget);

  settle(hudScene);
  settle(worldScene);

  const onRowMove = vi.fn();
  const onWorldMove = vi.fn();
  interaction.register(row, { onPointerMove: onRowMove });
  interaction.register(worldTarget, { onPointerMove: onWorldMove });

  // Scroll far enough that the top row (originally at absolute y=150..180) is pushed up past the
  // panel's top edge, into the world viewport's screen region above it (now at y=50..80).
  interaction.handleWheel(200, 200, 100, {} as WheelEvent);
  settle(hudScene);

  // Now move the pointer over where the row physically ended up (still within the world viewport's
  // screen area) — it must reach the world layer, not the row that's no longer visibly there.
  interaction.handlePointerMove(200, 65, { buttons: 0 } as PointerEvent);

  expect(onRowMove).not.toHaveBeenCalled();
  expect(onWorldMove).toHaveBeenCalledTimes(1);

  scroll.dispose();
});

function makeOrthoHudCamera(width: number, height: number) {
  const camera = new THREE.OrthographicCamera(0, width, 0, height, 0.1, 100);
  camera.position.z = 10;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function settle(scene: THREE.Scene) {
  scene.updateMatrixWorld(true);
}
