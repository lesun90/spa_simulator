import * as THREE from "three";

export function configureHudCanvasTexture<T extends THREE.Texture>(texture: T): T {
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function configureHudRenderTargetTexture<T extends THREE.Texture>(texture: T): T {
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.y = -1;
  texture.offset.y = 1;
  return texture;
}
