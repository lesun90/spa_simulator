# Scene Environment Export — Editor UI and Locked Environment Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Export Environment"/"Import Environment" controls to the Project panel, wire them to `EditorState` methods that call the server API and the browser's file system, and load an imported package as a read-only "locked environment" layer in the 3D world that can never be selected, moved, or deleted.

**Architecture:** This is the fifth of several plans implementing `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`. It depends on the server routes and client wrappers from `docs/superpowers/plans/2026-09-10-scene-environment-export-server.md` (verify `src/api/client.ts` has `exportEnvironmentRequest`, `fetchExportedEnvironmentModel`, `uploadEnvironmentManifestRequest`, `uploadEnvironmentModelRequest`, `commitEnvironmentImportRequest`, `fetchCommittedEnvironmentManifest`, `fetchCommittedEnvironmentModel` before starting) and on `Scene.environment` (same plan, Task 1). This codebase has no modal/dialog kit component and no prior File System Access API usage — both are net-new here, built to match the one existing DOM-bridging precedent (`src/features/hud/kit/nativeInputs.ts`'s hidden-`<input>`-plus-Promise pattern) rather than introducing a new UI paradigm. The export/import options live as an inline "Environment" section in the Project tab, following `SceneTabPanel.ts`'s existing inline-section-with-numeric-field-and-checkbox convention for its WFC generation controls, not a floating dialog.

**Tech Stack:** TypeScript, Three.js (`GLTFLoader` in the browser), Vitest with `jsdom` (this project's test environment already provides `document`/`Blob`/etc.), the File System Access API with a download/upload fallback for browsers without it.

**Spec:** `docs/superpowers/specs/2026-09-10-scene-environment-export-design.md`

## Global Constraints

- Exported filenames are always exactly `environment.glb` and `environment.json`.
- The export dialog's two options are chunk size (integer, default 10; zero means one spatial chunk) and "Remove internal seam faces" (unchecked by default) — no other options.
- Import accepts a folder/pair of files containing both fixed filenames; if the scene already owns an environment, the editor asks for replacement confirmation before uploading.
- The imported environment is never selectable, movable, or deletable — it must never be passed to `InteractionSystem.register()` or inserted into `SceneObjectsFeature`'s tracked maps (the existing `gridHelper` is the precedent: an object with no registered interaction handlers is already excluded from click/drag/select in this codebase's raycasting model).
- Import adopts the manifest grid for placement and snapping; when the package contains ground geometry, the editor hides the project's visible ground surface (via `material.visible = false`, which stops rendering but — unlike `object.visible = false` — does not stop `InteractionSystem`'s raycasts against it) while keeping the same mesh as an invisible placement plane.
- All user-facing confirmation in this codebase is `window.confirm` (no custom dialog component) — match that, don't introduce one.

---

## File Structure

- **Modify** `src/features/hud/panels/SceneTabPanel.ts` — remove the private `CheckboxControl` class (moved out).
- **Create** `src/features/hud/kit/Checkbox.ts` — the extracted, exported `CheckboxControl`.
- **Create** `src/features/hud/kit/fileSystemAccess.ts` — `saveEnvironmentPackage`, `pickEnvironmentPackageFiles`.
- **Modify** `src/state/EditorState.ts` — add `"sceneEnvironment"` topic, `exportEnvironment`, `importEnvironment`.
- **Modify** `src/features/hud/panels/ProjectTabPanel.ts` — add the Environment section.
- **Create** `src/features/world/LockedEnvironmentFeature.ts` — the read-only world sub-feature.
- **Modify** `src/features/world/WorldFeature.ts` — instantiate and sync `LockedEnvironmentFeature`, suppress ground when the package has one.
- **Test** `tests/checkbox.test.ts`, `tests/fileSystemAccess.test.ts`, `tests/editorStateEnvironment.test.ts`, `tests/lockedEnvironmentFeature.test.ts` — all new.

---

### Task 1: Extract `CheckboxControl` into the HUD kit

**Files:**
- Create: `src/features/hud/kit/Checkbox.ts`
- Modify: `src/features/hud/panels/SceneTabPanel.ts`
- Test: `tests/checkbox.test.ts`

**Interfaces:**
- Consumes: `InteractionSystem`, `Rect` — unchanged from the existing private class.
- Produces: `CheckboxControl` (exported), gaining one new method, `isChecked(): boolean`, needed by Task 4's export button to read the current state at click time (the existing private class only ever pushed state out via the `onChange` callback). Task 4 imports this from `../kit/Checkbox` instead of defining its own.

- [ ] **Step 1: Move the class, unchanged, and add `isChecked`**

Create `src/features/hud/kit/Checkbox.ts` with the exact body of the private `CheckboxControl` class currently at the bottom of `src/features/hud/panels/SceneTabPanel.ts` (imports of `THREE`, `theme`, `InteractionSystem`, `Rect`, `hudBasicMaterial`, `Panel`/`unitPlane`, `rasterizeText`, `hudZ`, and the `rasterizeCheckbox`/`rasterizeIcon` helpers it uses — adjust relative import paths from `../../../app/theme` etc. to this new file's location, `src/features/hud/kit/Checkbox.ts`, one directory shallower than `panels/`), renaming the export and adding one method:

```typescript
export class CheckboxControl {
  // ...unchanged fields and constructor from SceneTabPanel.ts...

  isChecked(): boolean {
    return this.checked;
  }

  // ...unchanged setRect/applyRect/render/dispose...
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/checkbox.test.ts`:

```typescript
import { describe, expect, test, vi } from "vitest";
import { InteractionSystem } from "../src/engine/InteractionSystem";
import { CheckboxControl } from "../src/features/hud/kit/Checkbox";

describe("CheckboxControl", () => {
  test("starts unchecked, and reports its state via isChecked", () => {
    const interaction = new InteractionSystem();
    const checkbox = new CheckboxControl({ x: 0, y: 0, width: 100, height: 24 }, interaction, "Test", () => {});

    expect(checkbox.isChecked()).toBe(false);
  });

  test("clicking the hit area toggles checked and calls onChange", () => {
    const interaction = new InteractionSystem();
    const onChange = vi.fn();
    const checkbox = new CheckboxControl({ x: 0, y: 0, width: 100, height: 24 }, interaction, "Test", onChange);

    interaction.handleClick(0, 0);

    expect(onChange).toHaveBeenCalledWith(true);
    expect(checkbox.isChecked()).toBe(true);
  });
});
```

Note: if `InteractionSystem` has no `handleClick(x, y)` convenience method for simulating a click by screen position, use whatever the existing HUD kit tests already use to simulate a click on a registered hit area (check `tests/` for an existing `Button`/`TextField` interaction test and copy its exact simulation approach instead of inventing a new one — this codebase already has a click-simulation pattern for other kit controls).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/checkbox.test.ts`
Expected: FAIL — "Cannot find module '../src/features/hud/kit/Checkbox'"

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/checkbox.test.ts`
Expected: PASS (Step 1 already implemented the class; this step is the verification, not new code)

- [ ] **Step 5: Update `SceneTabPanel.ts` to import the extracted class**

In `src/features/hud/panels/SceneTabPanel.ts`, delete the private `CheckboxControl` class body and add `import { CheckboxControl } from "../kit/Checkbox";` alongside its other kit imports. Leave every existing usage (`this.wfcRandomSeedCheckbox = new CheckboxControl(...)`) unchanged — only the import site moves.

- [ ] **Step 6: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS — in particular, `tests/sceneTabPanel.test.ts` (or equivalent) must still pass unchanged, confirming the extraction didn't alter behavior.

- [ ] **Step 7: Commit**

```bash
git add src/features/hud/kit/Checkbox.ts src/features/hud/panels/SceneTabPanel.ts tests/checkbox.test.ts
git commit -m "refactor: extract CheckboxControl into the HUD kit for reuse"
```

---

### Task 2: File System Access helpers with a fallback

**Files:**
- Create: `src/features/hud/kit/fileSystemAccess.ts`
- Test: `tests/fileSystemAccess.test.ts`

**Interfaces:**
- Consumes: nothing new (browser globals only: `window.showDirectoryPicker`, `window.showOpenFilePicker`, `document.createElement("a")`, `URL.createObjectURL`).
- Produces: `saveEnvironmentPackage(manifestJson: string, glb: Uint8Array): Promise<void>`; `pickEnvironmentPackageFiles(): Promise<{ manifestJson: string; glb: Uint8Array } | null>` (`null` on user cancellation). Task 3 (`EditorState.exportEnvironment`/`importEnvironment`) calls these directly.

- [ ] **Step 1: Write the failing test**

Create `tests/fileSystemAccess.test.ts`:

```typescript
import { afterEach, describe, expect, test, vi } from "vitest";
import { pickEnvironmentPackageFiles, saveEnvironmentPackage } from "../src/features/hud/kit/fileSystemAccess";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fileSystemAccess.test.ts`
Expected: FAIL — "Cannot find module '../src/features/hud/kit/fileSystemAccess'"

- [ ] **Step 3: Write minimal implementation**

Create `src/features/hud/kit/fileSystemAccess.ts`:

```typescript
interface WritableFileStream {
  write(data: BlobPart): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<WritableFileStream>;
  getFile(): Promise<File>;
}
interface FileSystemDirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
}

/** Writes both fixed-name package files into a user-picked directory, or triggers two plain downloads when the File System Access API isn't available. */
export async function saveEnvironmentPackage(manifestJson: string, glb: Uint8Array): Promise<void> {
  const picker = (window as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike> }).showDirectoryPicker;
  if (picker) {
    const directory = await picker();
    await writeFileInDirectory(directory, "environment.json", manifestJson);
    await writeFileInDirectory(directory, "environment.glb", glb);
    return;
  }
  downloadFile("environment.json", new Blob([manifestJson], { type: "application/json" }));
  downloadFile("environment.glb", new Blob([glb], { type: "model/gltf-binary" }));
}

async function writeFileInDirectory(directory: FileSystemDirectoryHandleLike, name: string, data: BlobPart): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

function downloadFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Opens a native picker for the two fixed package files; resolves null if the user cancels. */
export async function pickEnvironmentPackageFiles(): Promise<{ manifestJson: string; glb: Uint8Array } | null> {
  const picker = (window as {
    showOpenFilePicker?: (options: { multiple: boolean; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandleLike[]>;
  }).showOpenFilePicker;
  if (!picker) return pickFilesViaInput();

  try {
    const handles = await picker({
      multiple: true,
      types: [{ description: "Environment package", accept: { "application/json": [".json"], "model/gltf-binary": [".glb"] } }]
    });
    const files = await Promise.all(handles.map((handle) => handle.getFile()));
    return await readPackageFromFiles(files);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

function pickFilesViaInput(): Promise<{ manifestJson: string; glb: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".json,.glb";
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);

    const cleanup = () => document.body.removeChild(input);
    input.addEventListener(
      "change",
      async () => {
        const files = input.files ? [...input.files] : [];
        cleanup();
        resolve(files.length ? await readPackageFromFiles(files) : null);
      },
      { once: true }
    );
    input.addEventListener("cancel", () => {
      cleanup();
      resolve(null);
    }, { once: true });
    input.click();
  });
}

async function readPackageFromFiles(files: File[]): Promise<{ manifestJson: string; glb: Uint8Array } | null> {
  const manifestFile = files.find((file) => file.name.endsWith(".json"));
  const modelFile = files.find((file) => file.name.endsWith(".glb"));
  if (!manifestFile || !modelFile) return null;
  const manifestJson = await manifestFile.text();
  const glb = new Uint8Array(await modelFile.arrayBuffer());
  return { manifestJson, glb };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fileSystemAccess.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/hud/kit/fileSystemAccess.ts tests/fileSystemAccess.test.ts
git commit -m "feat: add File System Access helpers for environment export/import"
```

---

### Task 3: `EditorState.exportEnvironment` and `importEnvironment`

**Files:**
- Modify: `src/state/EditorState.ts`
- Test: `tests/editorStateEnvironment.test.ts`

**Interfaces:**
- Consumes: `exportEnvironmentRequest`, `fetchExportedEnvironmentModel`, `uploadEnvironmentManifestRequest`, `uploadEnvironmentModelRequest`, `commitEnvironmentImportRequest` from `../api/client` (server plan); `saveEnvironmentPackage`, `pickEnvironmentPackageFiles` from `../features/hud/kit/fileSystemAccess` (Task 2).
- Produces: `"sceneEnvironment"` added to `EditorTopic`; `EditorState.exportEnvironment(options: { chunkSize: number; removeSeamFaces: boolean }): Promise<void>`; `EditorState.importEnvironment(): Promise<void>`. Task 4 (Project panel) calls both.

- [ ] **Step 1: Write the failing test**

Create `tests/editorStateEnvironment.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/editorStateEnvironment.test.ts`
Expected: FAIL — `exportEnvironment`/`importEnvironment` are not defined

- [ ] **Step 3: Write minimal implementation**

In `src/state/EditorState.ts`, add `"sceneEnvironment"` to the `EditorTopic` union, add the new imports, and add both methods:

```typescript
import { saveEnvironmentPackage, pickEnvironmentPackageFiles } from "../features/hud/kit/fileSystemAccess";
import type { EnvironmentManifest } from "../environment/types";
import {
  commitEnvironmentImportRequest,
  exportEnvironmentRequest,
  fetchExportedEnvironmentModel,
  uploadEnvironmentManifestRequest,
  uploadEnvironmentModelRequest
} from "../api/client";
```

```typescript
async exportEnvironment(options: { chunkSize: number; removeSeamFaces: boolean }) {
  if (!this.scene) {
    this.setNotice("Open a scene before exporting an environment");
    return;
  }
  try {
    const { exportId, manifest, manifestJson } = await exportEnvironmentRequest(this.scene, options);
    const glb = await fetchExportedEnvironmentModel(this.scene.id, exportId);
    await saveEnvironmentPackage(manifestJson, glb);
    this.setNotice(`Exported environment (${manifest.cells.length} cells)`);
  } catch (error) {
    this.setNotice(error instanceof Error ? error.message : "Environment export failed");
  }
}

async importEnvironment() {
  if (!this.history || !this.scene) {
    this.setNotice("Open a scene before importing an environment");
    return;
  }
  if (this.scene.environment && !window.confirm("Replace the current environment package?")) return;

  const picked = await pickEnvironmentPackageFiles();
  if (!picked) return;

  try {
    await uploadEnvironmentManifestRequest(this.scene.id, picked.manifestJson);
    await uploadEnvironmentModelRequest(this.scene.id, picked.glb);
    const updated = await commitEnvironmentImportRequest(this.scene.id);
    const manifest = JSON.parse(picked.manifestJson) as EnvironmentManifest;

    this.history = {
      ...this.history,
      scene: {
        ...this.history.scene,
        environment: updated.environment,
        grid: { cellSize: manifest.grid.cellSize, width: manifest.grid.width * manifest.grid.cellSize, depth: manifest.grid.depth * manifest.grid.cellSize }
      }
    };
    this.emit("scene", "sceneGrid", "sceneEnvironment");
    this.setNotice(`Imported environment (${manifest.cells.length} cells)`);
  } catch (error) {
    this.setNotice(error instanceof Error ? error.message : "Environment import failed");
  }
}
```

Note: `importEnvironment` deliberately patches `this.history.scene` directly (the same pattern `setSceneName`/`setGridCellSize` already use) instead of calling `createHistory(updated)` — that would discard the undo/redo stack for a change that only touches the environment reference and grid, not the editable objects.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/editorStateEnvironment.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/state/EditorState.ts tests/editorStateEnvironment.test.ts
git commit -m "feat: add EditorState.exportEnvironment and importEnvironment"
```

---

### Task 4: Project panel Environment section

**Files:**
- Modify: `src/features/hud/panels/ProjectTabPanel.ts`

**Interfaces:**
- Consumes: `Button` from `../kit/Button`; `CheckboxControl` from `../kit/Checkbox` (Task 1); `EditorState.exportEnvironment`/`importEnvironment` (Task 3).
- Produces: no new exports — this task only adds UI. No new test is added (this codebase's existing panel classes, e.g. `ProjectTabPanel`, `SceneTabPanel`, have no dedicated unit tests today; their behavior is exercised through `EditorState` tests, already covered by Task 3).

- [ ] **Step 1: Add the fields and layout rects**

In `src/features/hud/panels/ProjectTabPanel.ts`, add imports for `Button` and `CheckboxControl`, then add fields and construct them in the constructor after the description field:

```typescript
import { Button } from "../kit/Button";
import { CheckboxControl } from "../kit/Checkbox";
```

```typescript
private readonly environmentChunkSizeField: TextField;
private readonly environmentSeamCheckbox: CheckboxControl;
private readonly exportEnvironmentButton: Button;
private readonly importEnvironmentButton: Button;
private environmentStatusLabel: LabelMesh | null = null;
```

```typescript
this.environmentChunkSizeField = new TextField(this.environmentChunkSizeFieldRect(), interaction, { numeric: true, placeholder: "10" }, "10");
this.root.add(this.environmentChunkSizeField.root);

this.environmentSeamCheckbox = new CheckboxControl(this.environmentSeamCheckboxRect(), interaction, "Remove internal seam faces", () => {});
this.root.add(this.environmentSeamCheckbox.root);

this.exportEnvironmentButton = new Button(this.exportEnvironmentButtonRect(), interaction, {
  label: "Export Environment",
  fontSize: 11.5,
  onClick: () => this.exportEnvironment()
});
this.root.add(this.exportEnvironmentButton.root);

this.importEnvironmentButton = new Button(this.importEnvironmentButtonRect(), interaction, {
  label: "Import Environment",
  fontSize: 11.5,
  onClick: () => void this.state.importEnvironment()
});
this.root.add(this.importEnvironmentButton.root);
```

Add the rect-cascade methods, following the file's existing pattern (each rect computed from the previous element's rect):

```typescript
private environmentLabelRect(): Rect {
  const field = this.descriptionFieldRect();
  return { x: field.x, y: field.y + FIELD_HEIGHT + SECTION_GAP, width: field.width, height: LABEL_HEIGHT };
}

private environmentChunkSizeFieldRect(): Rect {
  const label = this.environmentLabelRect();
  return { x: label.x, y: label.y + LABEL_HEIGHT + LABEL_GAP, width: label.width, height: FIELD_HEIGHT };
}

private environmentSeamCheckboxRect(): Rect {
  const field = this.environmentChunkSizeFieldRect();
  return { x: field.x, y: field.y + FIELD_HEIGHT + LABEL_GAP, width: field.width, height: 24 };
}

private exportEnvironmentButtonRect(): Rect {
  const checkbox = this.environmentSeamCheckboxRect();
  return { x: checkbox.x, y: checkbox.y + checkbox.height + LABEL_GAP, width: checkbox.width, height: FIELD_HEIGHT };
}

private importEnvironmentButtonRect(): Rect {
  const exportButton = this.exportEnvironmentButtonRect();
  return { x: exportButton.x, y: exportButton.y + FIELD_HEIGHT + LABEL_GAP, width: exportButton.width, height: FIELD_HEIGHT };
}
```

- [ ] **Step 2: Wire the export button to read the field/checkbox and call `EditorState`**

```typescript
private exportEnvironment() {
  const chunkSize = Math.max(0, Math.trunc(Number.parseFloat(this.environmentChunkSizeField.getValue()) || 10));
  void this.state.exportEnvironment({ chunkSize, removeSeamFaces: this.environmentSeamCheckbox.isChecked() });
}
```

- [ ] **Step 3: Add the environment status label and refresh it on the `"sceneEnvironment"`/`"scene"` topics**

In `layoutLabels()`, add the "Environment" section label the same way `nameLabel`/`descriptionLabel` are built, and add an `environmentStatusLabel` rebuilt whenever the scene changes:

```typescript
private refreshEnvironmentStatus() {
  if (this.environmentStatusLabel) {
    this.root.remove(this.environmentStatusLabel);
    this.environmentStatusLabel.material.dispose();
  }
  const text = this.state.scene?.environment ? "Environment: attached" : "Environment: none";
  this.environmentStatusLabel = createFieldLabel(text, this.environmentLabelRect());
  this.root.add(this.environmentStatusLabel);
}
```

Call `this.refreshEnvironmentStatus()` at the end of the constructor and inside `refreshFromScene()`, and subscribe to the new topic alongside the existing `"scene"` subscription:

```typescript
this.cleanup = combineCleanup(state.on("scene", () => this.refreshFromScene()), state.on("sceneEnvironment", () => this.refreshEnvironmentStatus()));
```

Since `ProjectTabPanel.cleanup` is currently a single unsubscribe function (`private readonly cleanup: () => void`), change its type to accept multiple, e.g.:

```typescript
private readonly cleanupFns: Array<() => void>;
// ...
this.cleanupFns = [state.on("scene", () => this.refreshFromScene()), state.on("sceneEnvironment", () => this.refreshEnvironmentStatus())];
```

and in `dispose()`, replace `this.cleanup();` with `for (const cleanup of this.cleanupFns) cleanup();`.

- [ ] **Step 4: Update `setRect` and `dispose` to include the new controls**

Extend `setRect` to reposition every new control (mirroring the existing `nameField`/`descriptionField` calls) and `dispose` to dispose every new control and the status label, matching the file's existing exhaustive-disposal convention.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, open the app, select the Project tab, confirm the chunk-size field, checkbox, and both buttons render below the description field without overlapping, and that clicking "Export Environment" on a scene with at least one object triggers a browser save/download without throwing (check the console for errors — a full round-trip through the real server routes is the natural verification here, not a mocked unit test).

- [ ] **Step 6: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/hud/panels/ProjectTabPanel.ts
git commit -m "feat: add Export/Import Environment controls to the Project panel"
```

---

### Task 5: Locked environment world feature

**Files:**
- Create: `src/features/world/LockedEnvironmentFeature.ts`
- Test: `tests/lockedEnvironmentFeature.test.ts`

**Interfaces:**
- Consumes: `EnvironmentManifest`, `EnvironmentManifestCell`, `EnvironmentManifestObject`, `WorldBounds` from `../../environment/types` (foundation plan); `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`.
- Produces: `class LockedEnvironmentFeature` with `readonly root: THREE.Group`; `load(manifestJson: string, glb: ArrayBuffer): Promise<void>`; `clear(): void`; `get hasGround(): boolean`; `cellAt(x: number, z: number): EnvironmentManifestCell | null`; `objectsInBounds(bounds: WorldBounds): EnvironmentManifestObject[]`; `dispose(): void`. Task 6 (`WorldFeature`) owns one instance.

- [ ] **Step 1: Write the failing test**

Create `tests/lockedEnvironmentFeature.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { LockedEnvironmentFeature } from "../src/features/world/LockedEnvironmentFeature";
import type { EnvironmentManifest } from "../src/environment/types";

describe("LockedEnvironmentFeature", () => {
  test("load adds the GLB's scene under root and never registers interaction (no selectable state to check — verified by the absence of any register() call in this class)", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    const glb = await exportTestGlb(root);
    const manifest = manifestFixture();
    const feature = new LockedEnvironmentFeature();

    await feature.load(JSON.stringify(manifest), glb.buffer);

    expect(feature.root.children.length).toBeGreaterThan(0);
    expect(feature.hasGround).toBe(true);
  });

  test("cellAt maps a world position to the containing cell by grid coordinate", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const glb = await exportTestGlb(root);
    const manifest = manifestFixture();
    const feature = new LockedEnvironmentFeature();
    await feature.load(JSON.stringify(manifest), glb.buffer);

    expect(feature.cellAt(0.5, 0.5)?.id).toBe("c-0-0");
    expect(feature.cellAt(100, 100)).toBeNull();
  });

  test("objectsInBounds returns objects whose bounds intersect the query bounds", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const glb = await exportTestGlb(root);
    const manifest = manifestFixture();
    manifest.objects = [
      {
        id: "obj-1",
        name: "Wall",
        transform: { position: { x: 5, y: 0, z: 5 }, rotationY: 0, scale: 1 },
        bounds: { min: { x: 4.5, y: 0, z: 4.5 }, max: { x: 5.5, y: 1, z: 5.5 } },
        sourceAssetId: "props.wall",
        semanticRoles: ["obstacle.wall"],
        chunkId: "chunk_0_0",
        sourceLayer: "scene"
      }
    ];
    const feature = new LockedEnvironmentFeature();
    await feature.load(JSON.stringify(manifest), glb.buffer);

    expect(feature.objectsInBounds({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 2, z: 10 } })).toHaveLength(1);
    expect(feature.objectsInBounds({ min: { x: 20, y: 0, z: 20 }, max: { x: 30, y: 2, z: 30 } })).toHaveLength(0);
  });

  test("clear removes the loaded model and resets query state", async () => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const glb = await exportTestGlb(root);
    const feature = new LockedEnvironmentFeature();
    await feature.load(JSON.stringify(manifestFixture()), glb.buffer);

    feature.clear();

    expect(feature.root.children).toHaveLength(0);
    expect(feature.hasGround).toBe(false);
    expect(feature.cellAt(0.5, 0.5)).toBeNull();
  });
});

function exportTestGlb(root: THREE.Object3D): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(root, (result) => resolve(new Uint8Array(result as ArrayBuffer)), reject, { binary: true });
  });
}

function manifestFixture(): EnvironmentManifest {
  return {
    format: "steerlab-environment",
    formatVersion: 1,
    model: { file: "environment.glb", sha256: "hash", rootNode: "SteerlabEnvironment", upAxis: "Y", unitsPerMeter: 1 },
    grid: { width: 1, depth: 1, cellSize: 1, origin: { x: 0, y: 0, z: 0 }, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } },
    provenance: { source: "cli", generatorVersion: "0.1.0", generationRuns: [] },
    build: { chunkSize: 10, removeInternalSeamFaces: false },
    chunks: [{ id: "chunk_0_0", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } }],
    assets: [],
    cells: [
      {
        id: "c-0-0",
        column: 0,
        row: 0,
        transform: { position: { x: 0.5, y: 0, z: 0.5 }, rotationY: 0, scale: 1 },
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
        sourceAssetId: "tiles.a",
        semanticRoles: [],
        chunkId: "chunk_0_0",
        sourceLayer: "scene"
      }
    ],
    objects: [],
    ground: { bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0, z: 1 } }, material: { color: "#050608", textureUrl: null }, chunkIds: ["chunk_0_0"] },
    navigation: { nodes: [], edges: [] },
    diagnostics: []
  };
}
```

Note: this test's own browser-context GLTFExporter/GLTFLoader round trip runs under Vitest's `jsdom` environment (already the project default per `vite.config.ts`), which is why no Node canvas shim (unlike the compiler plan's Node-side `nodeGltfShim.ts`) is needed here — `document`/`Image` already exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lockedEnvironmentFeature.test.ts`
Expected: FAIL — "Cannot find module '../src/features/world/LockedEnvironmentFeature'"

- [ ] **Step 3: Write minimal implementation**

Create `src/features/world/LockedEnvironmentFeature.ts`:

```typescript
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { EnvironmentManifest, EnvironmentManifestCell, EnvironmentManifestObject, WorldBounds } from "../../environment/types";

const loader = new GLTFLoader();

/**
 * Loads an imported environment package under its own root, with no interaction registration —
 * matching how gridHelper is already excluded from selection today, this class simply never calls
 * InteractionSystem.register() on anything it owns. Exposes read-only spatial/semantic queries over
 * the manifest for placement snapping and future consumers, per the design's locked-environment contract.
 */
export class LockedEnvironmentFeature {
  readonly root = new THREE.Group();
  private manifest: EnvironmentManifest | null = null;
  private loadToken = 0;
  private loadedModel: THREE.Object3D | null = null;

  async load(manifestJson: string, glb: ArrayBuffer): Promise<void> {
    const token = ++this.loadToken;
    const manifest = JSON.parse(manifestJson) as EnvironmentManifest;
    const gltf = await loader.parseAsync(glb, "");
    if (token !== this.loadToken) return;

    this.clear();
    this.manifest = manifest;
    this.loadedModel = gltf.scene;
    this.root.add(this.loadedModel);
  }

  clear(): void {
    this.loadToken += 1;
    this.manifest = null;
    if (this.loadedModel) {
      this.root.remove(this.loadedModel);
      this.loadedModel = null;
    }
  }

  get hasGround(): boolean {
    return this.manifest?.ground != null;
  }

  cellAt(x: number, z: number): EnvironmentManifestCell | null {
    if (!this.manifest) return null;
    const column = Math.floor((x - this.manifest.grid.origin.x) / this.manifest.grid.cellSize);
    const row = Math.floor((z - this.manifest.grid.origin.z) / this.manifest.grid.cellSize);
    return this.manifest.cells.find((cell) => cell.column === column && cell.row === row) ?? null;
  }

  objectsInBounds(bounds: WorldBounds): EnvironmentManifestObject[] {
    if (!this.manifest) return [];
    return this.manifest.objects.filter((object) => boundsIntersect(object.bounds, bounds));
  }

  dispose(): void {
    this.clear();
  }
}

function boundsIntersect(a: WorldBounds, b: WorldBounds): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lockedEnvironmentFeature.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/world/LockedEnvironmentFeature.ts tests/lockedEnvironmentFeature.test.ts
git commit -m "feat: add read-only locked environment world feature"
```

---

### Task 6: Wire the locked environment into `WorldFeature`, with ground suppression

**Files:**
- Modify: `src/features/world/WorldFeature.ts`

**Interfaces:**
- Consumes: `LockedEnvironmentFeature` (Task 5); `fetchCommittedEnvironmentManifest`, `fetchCommittedEnvironmentModel` from `../../api/client` (server plan).
- Produces: no new exports — `WorldFeature` gains a private `lockedEnvironment` field and a sync routine. No new test (this file has no dedicated unit test today either — `WorldFeature` is exercised through integration-style tests elsewhere in the suite, and this task's manual verification step is the practical check for a Three.js scene-graph wiring change).

- [ ] **Step 1: Add the field and constructor wiring**

In `src/features/world/WorldFeature.ts`, add the import and field:

```typescript
import { fetchCommittedEnvironmentManifest, fetchCommittedEnvironmentModel } from "../../api/client";
import { LockedEnvironmentFeature } from "./LockedEnvironmentFeature";
```

```typescript
private readonly lockedEnvironment = new LockedEnvironmentFeature();
private environmentSyncToken = 0;
```

In the constructor, after `this.scene.add(this.objects.root);`:

```typescript
this.scene.add(this.lockedEnvironment.root);
```

Add `"sceneEnvironment"` to the existing `state.on(...)` subscription list in the constructor:

```typescript
state.on("sceneEnvironment", () => this.syncEnvironment()),
```

(add this alongside the existing `state.on("scene", () => this.resync())` line inside the `this.unsubscribers.push(...)` call).

- [ ] **Step 2: Add the sync routine and call it from `resync`**

```typescript
private resync() {
  if (!this.state.scene) return;
  this.syncSceneObjects();
  this.applyBackground();
  this.applyGround();
  this.syncGrid();
  void this.syncEnvironment();
}

private async syncEnvironment() {
  const token = ++this.environmentSyncToken;
  const sceneId = this.state.scene?.id;
  const hasEnvironment = Boolean(this.state.scene?.environment);

  if (!sceneId || !hasEnvironment) {
    this.lockedEnvironment.clear();
    this.applyGroundVisibility(true);
    return;
  }

  const [manifest, glb] = await Promise.all([fetchCommittedEnvironmentManifest(sceneId), fetchCommittedEnvironmentModel(sceneId)]);
  if (token !== this.environmentSyncToken || !manifest) return;

  await this.lockedEnvironment.load(JSON.stringify(manifest), glb.buffer);
  if (token !== this.environmentSyncToken) return;
  this.applyGroundVisibility(!this.lockedEnvironment.hasGround);
}

/** Hides the visible ground surface without disabling its raycast — material.visible (unlike object.visible) does not gate InteractionSystem's hit-testing, so placement/snap clicks against the invisible plane keep working. */
private applyGroundVisibility(visible: boolean) {
  this.ground.material.visible = visible;
}
```

- [ ] **Step 3: Reset ground visibility and clear the locked environment in `rebuildGround`**

In `rebuildGround(grid: GridDefinition)`, after the new `ground` mesh is created and before `this.applyGround()` is called, re-apply the current environment's ground visibility (a fresh `GroundMesh` starts fully visible, which would momentarily show a duplicate ground plane if an environment is attached):

```typescript
private rebuildGround(grid: GridDefinition) {
  this.unregisterGround?.();
  this.scene.remove(this.gridHelper, this.ground);
  disposeGround(this.gridHelper, this.ground);

  const { grid: gridHelper, ground } = createGround(grid.width, grid.depth, grid.cellSize);
  this.gridHelper = gridHelper;
  this.ground = ground;
  this.lastGrid = { ...grid };
  this.scene.add(gridHelper, ground);
  this.registerGroundInteraction();
  this.applyGround();
  this.applyGroundVisibility(!this.lockedEnvironment.hasGround);
}
```

- [ ] **Step 4: Dispose the locked environment feature**

In `dispose()`, add `this.lockedEnvironment.dispose();` alongside the other sub-feature disposals.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`. Export a small scene's environment (Task 4), reload the page, re-open the same scene, import that same package back onto it, and confirm: the imported geometry appears in the viewport, the ground surface underneath it is not doubled, and clicking on the imported geometry does not select it or show a transform gizmo (clicking should behave exactly as clicking empty ground does, since the locked environment has no registered interaction handlers).

- [ ] **Step 6: Run the full suite and build check**

Run: `npx vitest run && npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/world/WorldFeature.ts
git commit -m "feat: load the locked environment into the world and suppress duplicate ground"
```

---

## What this plan does not cover

- Package composition (re-exporting a scene whose environment is already attached, merging it into the fresh export) — deferred by the compiler plan; exporting from a scene that has an attached environment today produces a package containing only the current editable objects, not the locked environment's geometry. This is a known, explicitly deferred gap (see the compiler plan's scope boundary), not an oversight in this plan.
- Product-level verification against the spec's full test matrix (100x100 export/import, renderer-statistics comparisons, seam-removal visual review) — per explicit instruction, this round of plans covers implementation only; the spec's "Verification" section is intentionally not turned into a plan task here.
