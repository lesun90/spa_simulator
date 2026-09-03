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
