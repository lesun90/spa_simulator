import * as THREE from "three";
import { InteractionSystem } from "../src/engine/InteractionSystem";
import { Viewport } from "../src/engine/Viewport";
import { unitPlane } from "../src/features/hud/kit/Panel";
import { hudBasicMaterial } from "../src/features/hud/kit/materials";

vi.stubGlobal("innerWidth", 400);
vi.stubGlobal("innerHeight", 300);

function makeOrthoHudCamera(width: number, height: number) {
  const camera = new THREE.OrthographicCamera(0, width, 0, height, 0.1, 100);
  camera.position.z = 10;
  camera.updateProjectionMatrix();
  // Cameras aren't part of the scene graph, so scene.updateMatrixWorld() never touches them — in
  // production WebGLRenderer.render() refreshes this every frame; here nothing ever renders.
  camera.updateMatrixWorld(true);
  return camera;
}

function makeQuad(x: number, y: number, width: number, height: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  mesh.scale.set(width, height, 1);
  mesh.position.set(x + width / 2, y + height / 2, z);
  return mesh;
}

function makeHudQuad(x: number, y: number, width: number, height: number, z: number) {
  const mesh = new THREE.Mesh(unitPlane, hudBasicMaterial({ visible: false }));
  mesh.scale.set(width, height, 1);
  mesh.position.set(x + width / 2, y + height / 2, z);
  return mesh;
}

/**
 * In the real app, WebGLRenderer.render() recomputes matrixWorld every frame before any pointer
 * event's hit-test can run. These tests never render, so they must do that step themselves —
 * otherwise every mesh raycasts as if it were still sitting at its stale default (identity) transform.
 */
function settle(scene: THREE.Scene) {
  scene.updateMatrixWorld(true);
}

test("hit-tests the frontmost (largest z) registered ancestor at a screen point", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const back = makeQuad(0, 0, 400, 300, 0);
  const front = makeQuad(50, 50, 100, 60, 1);
  scene.add(back, front);
  settle(scene);

  const backClicks = vi.fn();
  const frontClicks = vi.fn();
  interaction.register(back, { onClick: backClicks });
  interaction.register(front, { onClick: frontClicks });

  // Inside the overlapping region: the closer-to-camera (larger z) quad should win.
  interaction.handlePointerDown(80, 70, {} as PointerEvent);
  interaction.handlePointerUp(80, 70, {} as PointerEvent);
  expect(frontClicks).toHaveBeenCalledTimes(1);
  expect(backClicks).not.toHaveBeenCalled();

  // Outside the front quad but still over the back one.
  interaction.handlePointerDown(300, 200, {} as PointerEvent);
  interaction.handlePointerUp(300, 200, {} as PointerEvent);
  expect(backClicks).toHaveBeenCalledTimes(1);
});

test("a leaf mesh's click resolves to its registered ancestor group, not the leaf itself", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const group = new THREE.Group();
  const leaf = makeQuad(0, 0, 100, 100, 0);
  group.add(leaf);
  scene.add(group);
  settle(scene);

  const onClick = vi.fn();
  interaction.register(group, { onClick });

  interaction.handlePointerDown(20, 20, {} as PointerEvent);
  const hit = interaction.handlePointerUp(20, 20, {} as PointerEvent);

  expect(hit?.root).toBe(group);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("pointerup only fires onClick when the down and up hit the same registered node", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const a = makeQuad(0, 0, 100, 100, 0);
  const b = makeQuad(150, 0, 100, 100, 0);
  scene.add(a, b);
  settle(scene);

  const onClickA = vi.fn();
  const onClickB = vi.fn();
  interaction.register(a, { onClick: onClickA });
  interaction.register(b, { onClick: onClickB });

  // Sanity check first: each quad is independently clickable (proves the "not called" cases
  // below aren't vacuously true because raycasting found nothing at all).
  interaction.handlePointerDown(20, 20, {} as PointerEvent);
  interaction.handlePointerUp(20, 20, {} as PointerEvent);
  expect(onClickA).toHaveBeenCalledTimes(1);
  onClickA.mockClear();

  interaction.handlePointerDown(20, 20, {} as PointerEvent);
  interaction.handlePointerUp(180, 20, {} as PointerEvent);

  expect(onClickA).not.toHaveBeenCalled();
  expect(onClickB).not.toHaveBeenCalled();
});

test("detects visible layer geometry even when it has no matching wheel handler", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const hudScene = new THREE.Scene();
  const worldScene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([
    { scene: hudScene, camera },
    { scene: worldScene, camera }
  ]);

  const panel = makeHudQuad(0, 200, 400, 100, 1);
  hudScene.add(panel);
  settle(hudScene);
  settle(worldScene);

  expect(interaction.isPointerOverInteractiveLayer(20, 220)).toBe(true);
  expect(interaction.isPointerOverInteractiveLayer(20, 120)).toBe(false);
});

test("unregister removes a node from future hit-tests", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const quad = makeQuad(0, 0, 100, 100, 0);
  scene.add(quad);
  settle(scene);

  const onClick = vi.fn();
  const unregister = interaction.register(quad, { onClick });

  // Sanity check: clickable before unregistering.
  interaction.handlePointerDown(20, 20, {} as PointerEvent);
  interaction.handlePointerUp(20, 20, {} as PointerEvent);
  expect(onClick).toHaveBeenCalledTimes(1);
  onClick.mockClear();

  unregister();
  interaction.handlePointerDown(20, 20, {} as PointerEvent);
  interaction.handlePointerUp(20, 20, {} as PointerEvent);
  expect(onClick).not.toHaveBeenCalled();
});

test("hit-tests invisible HUD control quads built from the shared unit plane", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const control = makeHudQuad(0, 220, 180, 60, 1);
  scene.add(control);
  settle(scene);

  const onClick = vi.fn();
  interaction.register(control, { onClick });

  interaction.handlePointerDown(30, 240, {} as PointerEvent);
  interaction.handlePointerUp(30, 240, {} as PointerEvent);

  expect(onClick).toHaveBeenCalledTimes(1);
});

test("clicks HUD controls nested in panel groups", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const group = new THREE.Group();
  const panelBackground = makeHudQuad(20, 230, 120, 34, 0);
  const hitArea = makeHudQuad(20, 230, 120, 34, 0.1);
  group.add(panelBackground, hitArea);
  scene.add(group);
  settle(scene);

  const onClick = vi.fn();
  interaction.register(hitArea, { onClick });

  interaction.handlePointerDown(40, 245, {} as PointerEvent);
  interaction.handlePointerUp(40, 245, {} as PointerEvent);

  expect(onClick).toHaveBeenCalledTimes(1);
});

test("non-interactive HUD geometry lets pointer events reach lower layers", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const hudScene = new THREE.Scene();
  const worldScene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  const worldCamera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([
    { scene: hudScene, camera },
    { scene: worldScene, camera: worldCamera }
  ]);

  const panelBackground = makeHudQuad(0, 220, 400, 80, 0);
  const worldTarget = makeQuad(0, 0, 400, 300, -1);
  hudScene.add(panelBackground);
  worldScene.add(worldTarget);
  settle(hudScene);
  settle(worldScene);

  const onWorldClick = vi.fn();
  interaction.register(worldTarget, { onClick: onWorldClick });

  interaction.handlePointerDown(40, 245, {} as PointerEvent);
  interaction.handlePointerUp(40, 245, {} as PointerEvent);

  expect(onWorldClick).toHaveBeenCalledTimes(1);
});

test("handleWheel returns null when visible HUD geometry has no wheel handler", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const hudScene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene: hudScene, camera }]);

  const panelBackground = makeHudQuad(0, 220, 400, 80, 0);
  hudScene.add(panelBackground);
  settle(hudScene);

  const hit = interaction.handleWheel(40, 245, 100, {} as WheelEvent);

  expect(hit).toBeNull();
});

test("wheel-only HUD hit areas do not steal clicks from controls behind them", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const scrollWheelArea = makeHudQuad(0, 220, 400, 80, 0.2);
  const tileControl = makeHudQuad(20, 230, 120, 50, 0.1);
  scene.add(scrollWheelArea, tileControl);
  settle(scene);

  const onWheel = vi.fn();
  const onClick = vi.fn();
  interaction.register(scrollWheelArea, { onWheel });
  interaction.register(tileControl, { onClick });

  interaction.handlePointerDown(40, 245, {} as PointerEvent);
  interaction.handlePointerUp(40, 245, {} as PointerEvent);

  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onWheel).not.toHaveBeenCalled();
});

test("hit-tests ignore controls whose ancestor group is hidden", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const hiddenPopup = new THREE.Group();
  hiddenPopup.visible = false;
  const hiddenScrim = makeHudQuad(-50000, -50000, 100000, 100000, 5);
  hiddenPopup.add(hiddenScrim);
  const control = makeHudQuad(20, 230, 120, 50, 0.1);
  scene.add(hiddenPopup, control);
  settle(scene);

  const onScrimClick = vi.fn();
  const onControlClick = vi.fn();
  interaction.register(hiddenScrim, { onClick: onScrimClick });
  interaction.register(control, { onClick: onControlClick });

  interaction.handlePointerDown(40, 245, {} as PointerEvent);
  interaction.handlePointerUp(40, 245, {} as PointerEvent);

  expect(onScrimClick).not.toHaveBeenCalled();
  expect(onControlClick).toHaveBeenCalledTimes(1);
});

test("a released drag whose pointerup fires outside the canvas doesn't strand the ground layer", () => {
  // Mirrors dragging a resize handle (or scrollbar thumb) past the canvas/window edge and releasing
  // there: no pointerup ever reaches the canvas, so only handlePointerMove sees the drag end — via
  // event.buttons no longer reporting the primary button held.
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const hudScene = new THREE.Scene();
  const worldScene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([
    { scene: hudScene, camera },
    { scene: worldScene, camera }
  ]);

  const resizeHandle = makeHudQuad(0, 0, 400, 14, 0);
  const groundTarget = makeQuad(0, 0, 400, 300, -1);
  hudScene.add(resizeHandle);
  worldScene.add(groundTarget);
  settle(hudScene);
  settle(worldScene);

  const onHandleDrag = vi.fn();
  const onGroundMove = vi.fn();
  interaction.register(resizeHandle, { onPointerDown: () => {}, onPointerMove: onHandleDrag });
  interaction.register(groundTarget, { onPointerMove: onGroundMove });

  interaction.handlePointerDown(200, 7, { buttons: 1 } as PointerEvent);
  // Drag continues normally while the button is held...
  interaction.handlePointerMove(200, 5, { buttons: 1 } as PointerEvent);
  expect(onHandleDrag).toHaveBeenCalledTimes(1);

  // ...then the button is released off-canvas (no pointerup/pointercancel ever fires), and the
  // pointer comes back over the ground with buttons now reporting 0.
  interaction.handlePointerMove(200, 200, { buttons: 0 } as PointerEvent);

  expect(onGroundMove).toHaveBeenCalledTimes(1);
});

test("right-button captured drags continue while the secondary button is held", () => {
  const viewport = new Viewport(2);
  const interaction = new InteractionSystem(viewport);
  const scene = new THREE.Scene();
  const camera = makeOrthoHudCamera(400, 300);
  interaction.setLayers([{ scene, camera }]);

  const target = makeQuad(0, 0, 400, 300, 0);
  scene.add(target);
  settle(scene);

  const onDrag = vi.fn();
  const onRelease = vi.fn();
  interaction.register(target, { onPointerDown: () => {}, onPointerMove: onDrag, onPointerUp: onRelease });

  interaction.handlePointerDown(200, 150, { button: 2, buttons: 2 } as PointerEvent);
  interaction.handlePointerMove(210, 150, { button: 2, buttons: 2 } as PointerEvent);

  expect(onDrag).toHaveBeenCalledTimes(1);
  expect(onRelease).not.toHaveBeenCalled();
});
