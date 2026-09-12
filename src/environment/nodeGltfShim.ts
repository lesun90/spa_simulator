import { createCanvas, Image } from "canvas";

/**
 * GLTFLoader/GLTFExporter call document.createElement("canvas") and expect an Image global when
 * decoding/encoding embedded texture images. Real Node has neither (unlike Vitest's jsdom test
 * environment) — this polyfills exactly those two hooks with node-canvas's implementations.
 */
if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  (globalThis as { document?: unknown }).document = {
    createElement(tag: string) {
      if (tag === "canvas") return createCanvas(1, 1);
      throw new Error(`document.createElement("${tag}") is not supported in the Node environment compiler.`);
    }
  };
}
if (typeof (globalThis as { Image?: unknown }).Image === "undefined") {
  (globalThis as { Image?: unknown }).Image = Image;
}
