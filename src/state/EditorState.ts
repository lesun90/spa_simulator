import type { AssetCatalogEntry } from "../editor-core/assets";
import {
  addObjectCommand,
  createHistory,
  deleteObjectCommand,
  duplicateObjectCommand,
  executeCommand,
  redo as redoHistory,
  undo as undoHistory,
  updateObjectCommand,
  type HistoryState
} from "../editor-core/commands";
import type { PlacementResolution } from "../editor-core/grid";
import { createId, type Scene, type SceneObject, type Vector3Data } from "../editor-core/scene";
import { validateSceneForSave } from "../editor-core/validation";
import {
  createSceneRequest,
  deleteSceneRequest,
  duplicateSceneRequest,
  importSharedAssetRequest,
  listAssets,
  listScenes,
  openSceneRequest,
  renameSceneRequest,
  saveSceneRequest,
  type SceneSummary
} from "../api/client";
import { createTemporaryAsset, selectedObject } from "./editorHelpers";
import type { EditorTool } from "./types";

export type EditorTopic =
  | "scene"
  | "scenesList"
  | "assets"
  | "assetRefresh"
  | "selection"
  | "tool"
  | "placement"
  | "objectsVisible"
  | "search"
  | "category"
  | "notice";

type Listener = () => void;

/**
 * All application/business state for the editor, ported near-verbatim from the previous DOM
 * EditorApp component. Holds no Three.js objects (see threejs-design-rule §10) — HUD/world features
 * read from here and subscribe to topics to know when to redraw.
 */
export class EditorState {
  assets: AssetCatalogEntry[] = [];
  scenes: SceneSummary[] = [];
  history: HistoryState | null = null;
  selectedObjectId: string | null = null;
  activeTool: EditorTool = "select";
  placementAssetId: string | null = null;
  placementResolution: PlacementResolution = "snap";
  objectsVisible = true;
  assetSearch = "";
  category = "all";
  assetsRefreshing = false;
  notice = "Ready";

  private readonly listeners = new Map<EditorTopic, Set<Listener>>();

  on(topic: EditorTopic, listener: Listener): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  private emit(...topics: EditorTopic[]) {
    for (const topic of topics) {
      for (const listener of this.listeners.get(topic) ?? []) listener();
    }
  }

  get scene(): Scene | null {
    return this.history?.scene ?? null;
  }

  get selected(): SceneObject | null {
    return selectedObject(this.scene, this.selectedObjectId);
  }

  get activeAsset(): AssetCatalogEntry | null {
    return this.assets.find((asset) => asset.id === this.placementAssetId) ?? null;
  }

  get categories(): string[] {
    return ["all", ...Array.from(new Set(this.assets.map((asset) => asset.category))).sort()];
  }

  get filteredAssets(): AssetCatalogEntry[] {
    const query = this.assetSearch.trim().toLowerCase();
    return this.assets.filter((asset) => {
      const matchesQuery = !query || `${asset.label} ${asset.id} ${asset.tags?.join(" ") ?? ""}`.toLowerCase().includes(query);
      const matchesCategory = this.category === "all" || asset.category === this.category;
      return matchesQuery && matchesCategory;
    });
  }

  private setNotice(notice: string) {
    this.notice = notice;
    this.emit("notice");
  }

  async refreshAssets() {
    if (this.assetsRefreshing) return;
    this.assetsRefreshing = true;
    this.emit("assetRefresh");
    try {
      this.assets = await listAssets();
      const resetCategory = this.category !== "all" && !this.categories.includes(this.category);
      if (resetCategory) this.category = "all";
      this.emit(...(resetCategory ? (["assets", "category"] as const) : (["assets"] as const)));
      this.setNotice("Assets refreshed");
    } catch (error) {
      this.setNotice(error instanceof Error ? error.message : "Asset refresh failed");
    } finally {
      this.assetsRefreshing = false;
      this.emit("assetRefresh");
    }
  }

  async refreshScenes() {
    this.scenes = await listScenes();
    this.emit("scenesList");
    if (!this.history && this.scenes.length === 0) {
      const defaultScene = await createSceneRequest("Downtown");
      this.history = createHistory(defaultScene);
      this.selectedObjectId = null;
      this.scenes = await listScenes();
      this.emit("scene", "selection", "scenesList");
      this.setNotice(`Created ${defaultScene.name}`);
      return;
    }
    if (!this.history && this.scenes[0]) {
      await this.openScene(this.scenes[0].id);
    }
  }

  async createScene() {
    const name = window.prompt("Scene name", "Downtown");
    if (!name) return;
    const nextScene = await createSceneRequest(name);
    this.history = createHistory(nextScene);
    this.selectedObjectId = null;
    this.emit("scene", "selection");
    await this.refreshScenes();
    this.setNotice(`Created ${nextScene.name}`);
  }

  async openScene(id: string) {
    const nextScene = await openSceneRequest(id);
    this.history = createHistory(nextScene);
    this.selectedObjectId = null;
    this.emit("scene", "selection");
    this.setNotice(`Opened ${nextScene.name}`);
  }

  async saveScene() {
    if (!this.scene) return;
    const result = validateSceneForSave(this.scene, this.assets);
    if (!result.valid) {
      this.setNotice(result.diagnostics[0]);
      return;
    }
    await saveSceneRequest(this.scene);
    await this.refreshScenes();
    this.setNotice(`Saved ${this.scene.name}`);
  }

  async renameScene() {
    if (!this.scene) return;
    const name = window.prompt("Scene name", this.scene.name);
    if (!name) return;
    const renamed = await renameSceneRequest(this.scene.id, name);
    this.history = createHistory(renamed);
    this.emit("scene");
    await this.refreshScenes();
    this.setNotice(`Renamed to ${renamed.name}`);
  }

  async duplicateScene() {
    if (!this.scene) return;
    const copy = await duplicateSceneRequest(this.scene.id);
    this.history = createHistory(copy);
    this.selectedObjectId = null;
    this.emit("scene", "selection");
    await this.refreshScenes();
    this.setNotice(`Duplicated ${copy.name}`);
  }

  async deleteScene() {
    if (!this.scene) return;
    if (!window.confirm(`Delete ${this.scene.name}? This cannot be undone.`)) return;
    await deleteSceneRequest(this.scene.id);
    this.history = null;
    this.selectedObjectId = null;
    this.emit("scene", "selection");
    await this.refreshScenes();
    this.setNotice("Deleted scene");
  }

  placeAsset(assetId: string, position: Vector3Data) {
    if (!this.history) return;
    const object: SceneObject = {
      id: createId("obj"),
      assetId,
      position: { x: position.x, y: 0, z: position.z },
      rotationY: 0,
      scale: 1
    };
    this.history = executeCommand(this.history, addObjectCommand(object));
    this.selectedObjectId = object.id;
    this.placementAssetId = null;
    this.activeTool = "select";
    this.emit("scene", "selection", "placement", "tool");
    this.setNotice(`Placed ${assetId}`);
  }

  selectObject(objectId: string | null) {
    if (this.activeTool === "erase" && objectId && this.history) {
      this.history = executeCommand(this.history, deleteObjectCommand(objectId));
      this.selectedObjectId = null;
      this.emit("scene", "selection");
      this.setNotice("Object erased");
      return;
    }
    this.selectedObjectId = objectId;
    this.emit("selection");
  }

  updateSelectedObject(patch: Partial<Pick<SceneObject, "position" | "rotationY" | "scale">>) {
    if (!this.history || !this.selectedObjectId) return;
    this.history = executeCommand(this.history, updateObjectCommand(this.selectedObjectId, patch));
    this.emit("scene");
  }

  duplicateSelectedObject() {
    if (!this.history || !this.selectedObjectId) return;
    const duplicateId = createId("obj");
    this.history = executeCommand(this.history, duplicateObjectCommand(this.selectedObjectId, duplicateId));
    this.selectedObjectId = duplicateId;
    this.emit("scene", "selection");
    this.setNotice("Object duplicated");
  }

  deleteSelectedObject() {
    if (!this.history || !this.selectedObjectId) return;
    this.history = executeCommand(this.history, deleteObjectCommand(this.selectedObjectId));
    this.selectedObjectId = null;
    this.emit("scene", "selection");
    this.setNotice("Object deleted");
  }

  choosePlacement(assetId: string) {
    const asset = this.assets.find((entry) => entry.id === assetId);
    this.placementAssetId = assetId;
    this.activeTool = "place";
    this.emit("placement", "tool");
    this.setNotice(`Placing ${asset?.label ?? assetId}`);
  }

  cancelPlacement() {
    if (!this.placementAssetId) return;
    this.placementAssetId = null;
    this.activeTool = "select";
    this.emit("placement", "tool");
    this.setNotice("Placement cancelled");
  }

  setActiveTool(tool: EditorTool) {
    this.activeTool = tool;
    this.emit("tool");
  }

  setPlacementResolution(resolution: PlacementResolution) {
    this.placementResolution = resolution;
    this.emit("placement");
  }

  setObjectsVisible(visible: boolean) {
    this.objectsVisible = visible;
    this.emit("objectsVisible");
  }

  setSearch(query: string) {
    if (this.assetSearch === query) return;
    this.assetSearch = query;
    this.emit("search");
  }

  setCategory(category: string) {
    if (!this.categories.includes(category)) return;
    if (this.category === category) return;
    this.category = category;
    this.emit("category");
  }

  undo() {
    if (!this.history) return;
    this.history = undoHistory(this.history);
    this.emit("scene");
  }

  redo() {
    if (!this.history) return;
    this.history = redoHistory(this.history);
    this.emit("scene");
  }

  canUndo(): boolean {
    return Boolean(this.history?.undoStack.length);
  }

  canRedo(): boolean {
    return Boolean(this.history?.redoStack.length);
  }

  handleGlobalKeyDown(event: KeyboardEvent) {
    const modifier = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      this.cancelPlacement();
    }
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      this.deleteSelectedObject();
    }
  }

  async importDroppedFile(file: File) {
    if (window.confirm("Add this import to the shared asset library? Cancel reviews it temporarily for this session.")) {
      await this.addDroppedFileToSharedLibrary(file);
      return;
    }
    const temporary = createTemporaryAsset(file);
    this.assets = [...this.assets.filter((asset) => asset.id !== temporary.id), temporary];
    this.emit("assets");
    this.choosePlacement(temporary.id);
    this.setNotice(`Reviewing temporary import ${file.name}`);
  }

  private async addDroppedFileToSharedLibrary(file: File) {
    const defaultFolder = file.name.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
    const categoryName = window.prompt("Asset category", "imports");
    if (!categoryName) return;
    const folderName = window.prompt("Asset folder", defaultFolder);
    if (!folderName) return;
    const label = window.prompt("Asset label", file.name.replace(/\.[^.]+$/, ""));
    if (!label) return;
    const id = window.prompt("Stable asset ID", `${categoryName}.${folderName}`.toLowerCase().replace(/[^a-z0-9.]+/g, "-"));
    if (!id) return;
    const contentBase64 = await fileToBase64(file);

    try {
      const asset = await importSharedAssetRequest({
        id,
        label,
        category: categoryName,
        folderName,
        files: [{ name: file.name, contentBase64 }],
        overwrite: false
      });
      await this.refreshAssets();
      this.choosePlacement(asset.id);
      this.setNotice(`Added ${asset.label} to shared assets`);
    } catch (error) {
      if (window.confirm("An asset file already exists. Overwrite it?")) {
        const asset = await importSharedAssetRequest({
          id,
          label,
          category: categoryName,
          folderName,
          files: [{ name: file.name, contentBase64 }],
          overwrite: true
        });
        await this.refreshAssets();
        this.choosePlacement(asset.id);
        this.setNotice(`Updated ${asset.label}`);
        return;
      }
      this.setNotice(error instanceof Error ? error.message : "Import failed");
    }
  }
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
