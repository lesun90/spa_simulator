import { afterEach, describe, expect, test, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
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
    vi.restoreAllMocks();
  });

  test("downloads one scene-named ZIP containing both environment files", async () => {
    let downloadedName = "";
    let downloadedBlob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      downloadedBlob = blob as Blob;
      return "blob:environment-package";
    });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = originalCreateElement(tag as "a");
      if (tag === "a") element.click = () => { downloadedName = (element as HTMLAnchorElement).download; };
      return element;
    });

    const saving = saveEnvironmentPackage("Downtown/West", '{"format":"steerlab-environment"}', new Uint8Array([1, 2, 3]));

    expect(downloadedName).toBe("");
    await saving;
    expect(downloadedName).toBe("Downtown West.zip");
    const archive = unzipSync(new Uint8Array(await downloadedBlob!.arrayBuffer()));
    expect(Object.keys(archive).sort()).toEqual(["environment.glb", "environment.json"]);
    expect(strFromU8(archive["environment.json"])).toBe('{"format":"steerlab-environment"}');
    expect(archive["environment.glb"]).toEqual(new Uint8Array([1, 2, 3]));
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

describe("pickEnvironmentPackageFiles fallback (showOpenFilePicker unavailable)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("reads both files from the hidden file input's change event", async () => {
    const manifestFile = new File(['{"format":"steerlab-environment"}'], "environment.json", { type: "application/json" });
    const modelFile = new File([new Uint8Array([4, 5, 6])], "environment.glb");
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = originalCreateElement(tag as "input");
      if (tag === "input") {
        Object.defineProperty(element, "files", { value: [manifestFile, modelFile], configurable: true });
        element.click = () => element.dispatchEvent(new Event("change"));
      }
      return element;
    });

    const result = await pickEnvironmentPackageFiles();

    expect(result?.manifestJson).toBe('{"format":"steerlab-environment"}');
    expect(result?.glb).toEqual(new Uint8Array([4, 5, 6]));
  });

  test("resolves null when the hidden file input's cancel event fires", async () => {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = originalCreateElement(tag as "input");
      if (tag === "input") element.click = () => element.dispatchEvent(new Event("cancel"));
      return element;
    });

    const result = await pickEnvironmentPackageFiles();

    expect(result).toBeNull();
  });
});
