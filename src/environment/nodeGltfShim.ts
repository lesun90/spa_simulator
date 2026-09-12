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

/**
 * GLTFExporter's binary (GLB) assembly path constructs a FileReader unconditionally to read
 * back each buffer view it writes (see GLTFExporter.js's binary-export branch, not just its
 * image-embedding code) — every GLB export needs this, not only ones with real textures. Real
 * Node has no FileReader — only Vitest's jsdom test environment does.
 */
class NodeFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }

  readAsDataURL(blob: Blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        const base64 = Buffer.from(buffer).toString("base64");
        this.result = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

if (!("FileReader" in globalThis)) {
  Object.assign(globalThis, { FileReader: NodeFileReader });
}
