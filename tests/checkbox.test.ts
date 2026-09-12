import { describe, expect, test, vi } from "vitest";
import * as THREE from "three";
import { InteractionSystem } from "../src/engine/InteractionSystem";
import { Viewport } from "../src/engine/Viewport";
import { CheckboxControl } from "../src/features/hud/kit/Checkbox";

vi.stubGlobal("innerWidth", 400);
vi.stubGlobal("innerHeight", 300);

function makeOrthoHudCamera(width: number, height: number) {
  const camera = new THREE.OrthographicCamera(0, width, 0, height, 0.1, 100);
  camera.position.z = 10;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

describe("CheckboxControl", () => {
  test("starts unchecked, and reports its state via isChecked", () => {
    const interaction = new InteractionSystem(new Viewport(2));
    const checkbox = new CheckboxControl({ x: 0, y: 0, width: 100, height: 24 }, interaction, "Test", () => {});

    expect(checkbox.isChecked()).toBe(false);
  });

  test("clicking the hit area toggles checked and calls onChange", () => {
    const interaction = new InteractionSystem(new Viewport(2));
    const scene = new THREE.Scene();
    const camera = makeOrthoHudCamera(400, 300);
    const onChange = vi.fn();
    const checkbox = new CheckboxControl({ x: 0, y: 0, width: 100, height: 24 }, interaction, "Test", onChange);
    scene.add(checkbox.root);
    interaction.setLayers([{ scene, camera }]);
    scene.updateMatrixWorld(true);

    interaction.handlePointerDown(20, 10, {} as PointerEvent);
    interaction.handlePointerUp(20, 10, {} as PointerEvent);

    expect(onChange).toHaveBeenCalledWith(true);
    expect(checkbox.isChecked()).toBe(true);
  });
});
