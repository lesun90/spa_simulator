import * as THREE from "three";
import { unitPlane } from "../src/features/hud/kit/Panel";
import { configureHudCanvasTexture, configureHudRenderTargetTexture } from "../src/features/hud/kit/textures";

test("HUD unit plane is front-facing under the flipped screen-space projection", () => {
  const camera = new THREE.OrthographicCamera(0, 100, 0, 100, 0.1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  const mesh = new THREE.Mesh(unitPlane, new THREE.MeshBasicMaterial());
  mesh.position.set(50, 50, 0);
  mesh.scale.set(20, 20, 1);
  mesh.updateMatrixWorld();

  const position = unitPlane.attributes.position;
  const index = unitPlane.index;
  expect(index).not.toBeNull();

  const points = [0, 1, 2].map((offset) => {
    const vertexIndex = index!.getX(offset);
    return new THREE.Vector3()
      .fromBufferAttribute(position, vertexIndex)
      .applyMatrix4(mesh.matrixWorld)
      .project(camera);
  });

  expect(signedArea(points[0], points[1], points[2])).toBeGreaterThan(0);
});

test("HUD canvas textures preserve top-to-bottom orientation", () => {
  const texture = new THREE.Texture();
  configureHudCanvasTexture(texture);
  expect(texture.flipY).toBe(false);
  expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(texture.version).toBe(1);
});

test("HUD render-target textures are vertically remapped for screen-space quads", () => {
  const texture = new THREE.Texture();
  configureHudRenderTargetTexture(texture);
  expect(texture.wrapT).toBe(THREE.RepeatWrapping);
  expect(texture.repeat.y).toBe(-1);
  expect(texture.offset.y).toBe(1);
});

function signedArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
