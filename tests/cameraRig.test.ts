import * as THREE from "three";
import { describe, expect, test } from "vitest";
import { worldConfig } from "../src/app/config";
import { CameraRig } from "../src/engine/CameraRig";

describe("CameraRig", () => {
  test("resets the camera to its initial centered view", () => {
    const canvas = document.createElement("canvas");
    const camera = new THREE.PerspectiveCamera(worldConfig.cameraFov, 1, worldConfig.cameraNear, worldConfig.cameraFar);
    camera.position.set(worldConfig.cameraPosition.x, worldConfig.cameraPosition.y, worldConfig.cameraPosition.z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const rig = new CameraRig(camera, canvas, worldConfig.maxPolarAngle);

    camera.position.set(-12, 8, 5);
    camera.lookAt(10, 0, -4);
    camera.updateMatrixWorld(true);

    rig.resetView();

    expectVectorCloseTo(camera.position, new THREE.Vector3(worldConfig.cameraPosition.x, worldConfig.cameraPosition.y, worldConfig.cameraPosition.z));
    expectVectorCloseTo(
      camera.getWorldDirection(new THREE.Vector3()),
      new THREE.Vector3()
        .subVectors(new THREE.Vector3(0, 0, 0), new THREE.Vector3(worldConfig.cameraPosition.x, worldConfig.cameraPosition.y, worldConfig.cameraPosition.z))
        .normalize()
    );
  });
});

function expectVectorCloseTo(actual: THREE.Vector3, expected: THREE.Vector3) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
  expect(actual.z).toBeCloseTo(expected.z, 8);
}
