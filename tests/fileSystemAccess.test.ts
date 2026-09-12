import { afterEach, describe, expect, test, vi } from "vitest";
import { pickEnvironmentPackageFiles, saveEnvironmentPackage } from "../src/features/hud/kit/fileSystemAccess";

// This project's jsdom test environment implements Blob only partially (no
// `text()`/`arrayBuffer()`) and doesn't implement `URL.createObjectURL`/
// `revokeObjectURL` at all. Shim them minimally via jsdom's own FileReader
// (which does work) so these tests can exercise real File/Blob objects,
// without changing any assertion below.
if (typeof Blob.prototype.text !== "function") {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock-url";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}

describe("saveEnvironmentPackage", () => {
  afterEach(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  test("writes both fixed filenames through a picked directory handle when the API is available", async () => {
    const writeCalls: Array<{ name: string; data: unknown }> = [];
    const fakeDirectory = {
      getFileHandle: vi.fn(async (name: string) => ({
        createWritable: async () => ({
          write: async (data: unknown) => writeCalls.push({ name, data }),
          close: async () => {}
        })
      }))
    };
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = vi.fn(async () => fakeDirectory);

    await saveEnvironmentPackage('{"format":"steerlab-environment"}', new Uint8Array([1, 2, 3]));

    expect(writeCalls.map((call) => call.name).sort()).toEqual(["environment.glb", "environment.json"]);
  });

  test("falls back to triggering two downloads when the API is unavailable", async () => {
    const clicked: string[] = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = originalCreateElement(tag as "a");
      if (tag === "a") element.click = () => clicked.push((element as HTMLAnchorElement).download);
      return element;
    });

    await saveEnvironmentPackage('{"format":"steerlab-environment"}', new Uint8Array([1, 2, 3]));

    expect(clicked.sort()).toEqual(["environment.glb", "environment.json"]);
    vi.restoreAllMocks();
  });
});

describe("pickEnvironmentPackageFiles", () => {
  afterEach(() => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });

  test("reads both files via a picked file-handle pair when the API is available", async () => {
    const manifestFile = new File(['{"format":"steerlab-environment"}'], "environment.json", { type: "application/json" });
    const modelFile = new File([new Uint8Array([1, 2, 3])], "environment.glb");
    (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = vi.fn(async () => [
      { getFile: async () => manifestFile },
      { getFile: async () => modelFile }
    ]);

    const result = await pickEnvironmentPackageFiles();

    expect(result?.manifestJson).toBe('{"format":"steerlab-environment"}');
    expect(result?.glb).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("resolves null when the user cancels", async () => {
    (window as { showOpenFilePicker?: unknown }).showOpenFilePicker = vi.fn(async () => {
      const error = new DOMException("The user aborted a request.", "AbortError");
      throw error;
    });

    const result = await pickEnvironmentPackageFiles();

    expect(result).toBeNull();
  });
});
