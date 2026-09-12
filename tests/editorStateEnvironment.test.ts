import { describe, expect, test, vi } from "vitest";
import { EditorState } from "../src/state/EditorState";
import { createHistory } from "../src/editor-core/commands";
import { createScene } from "../src/editor-core/scene";
import * as client from "../src/api/client";
import * as fileSystemAccess from "../src/features/hud/kit/fileSystemAccess";

describe("EditorState.exportEnvironment", () => {
  test("compiles, fetches the model, and saves the package, then posts a notice", async () => {
    const state = new EditorState();
    state["history"] = createHistory(createScene("Test"));
    const manifest = { cells: [{ id: "c-1" }] } as never;
    vi.spyOn(client, "exportEnvironmentRequest").mockResolvedValue({ exportId: "export-1", manifest, manifestJson: JSON.stringify(manifest), metrics: {} as never });
    vi.spyOn(client, "fetchExportedEnvironmentModel").mockResolvedValue(new Uint8Array([1]));
    const save = vi.spyOn(fileSystemAccess, "saveEnvironmentPackage").mockResolvedValue();

    await state.exportEnvironment({ chunkSize: 10, removeSeamFaces: false });

    expect(save).toHaveBeenCalledWith(expect.stringContaining("cells"), new Uint8Array([1]));
    expect(state.notice).toContain("Exported environment");
  });

  test("posts a failure notice instead of throwing when export fails", async () => {
    const state = new EditorState();
    state["history"] = createHistory(createScene("Test"));
    vi.spyOn(client, "exportEnvironmentRequest").mockRejectedValue(new Error("compile failed"));

    await state.exportEnvironment({ chunkSize: 10, removeSeamFaces: false });

    expect(state.notice).toBe("compile failed");
  });
});

describe("EditorState.importEnvironment", () => {
  test("uploads both files, commits, and adopts the manifest grid without resetting undo history", async () => {
    const state = new EditorState();
    const scene = createScene("Test");
    state["history"] = createHistory(scene);
    const manifest = { grid: { width: 4, depth: 4, cellSize: 2 }, cells: [{ id: "c-1" }, { id: "c-2" }] };
    vi.spyOn(fileSystemAccess, "pickEnvironmentPackageFiles").mockResolvedValue({ manifestJson: JSON.stringify(manifest), glb: new Uint8Array([1]) });
    const uploadManifest = vi.spyOn(client, "uploadEnvironmentManifestRequest").mockResolvedValue();
    const uploadModel = vi.spyOn(client, "uploadEnvironmentModelRequest").mockResolvedValue();
    vi.spyOn(client, "commitEnvironmentImportRequest").mockResolvedValue({
      ...scene,
      environment: { sha256: "a".repeat(64), manifestVersion: 1 }
    });

    await state.importEnvironment();

    expect(uploadManifest).toHaveBeenCalledWith(scene.id, JSON.stringify(manifest));
    expect(uploadModel).toHaveBeenCalledWith(scene.id, new Uint8Array([1]));
    expect(state.scene?.environment).toEqual({ sha256: "a".repeat(64), manifestVersion: 1 });
    expect(state.scene?.grid).toEqual({ cellSize: 2, width: 8, depth: 8 });
    expect(state.canUndo()).toBe(false);
  });

  test("does nothing when the user cancels the file picker", async () => {
    const state = new EditorState();
    const scene = createScene("Test");
    state["history"] = createHistory(scene);
    vi.spyOn(fileSystemAccess, "pickEnvironmentPackageFiles").mockResolvedValue(null);
    const uploadManifest = vi.spyOn(client, "uploadEnvironmentManifestRequest");

    await state.importEnvironment();

    expect(uploadManifest).not.toHaveBeenCalled();
  });
});
