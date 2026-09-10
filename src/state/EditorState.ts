import type { AssetCatalogEntry } from "../editor-core/assets";
import {
  addObjectCommand,
  createHistory,
  deleteObjectCommand,
  duplicateObjectCommand,
  executeCommand,
  replaceGeneratedLayoutCommand,
  redo as redoHistory,
  undo as undoHistory,
  updateObjectCommand,
  type HistoryState
} from "../editor-core/commands";
import type { PlacementResolution } from "../editor-core/grid";
import { createId, objectDisplayNames, type Scene, type SceneObject, type SurfaceAppearanceType, type Vector3Data } from "../editor-core/scene";
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
import { policiesFromWorldPlan, validateWorldPlanResult } from "../wfc/worldPlanPolicies";
import { createWorldPlan } from "../wfc/worldPlanner";
import {
  paletteFromAssets,
  sceneObjectsFromWfcResult,
  solvePlanarWfcInWorker,
  isGeneratedWfcObject,
  type GenerateWfcLayoutRequest,
  type WfcGenerationProgress
} from "../wfc/sceneLayout";

export type EditorTopic =
  | "scene"
  | "sceneMeta"
  | "sceneBackground"
  | "sceneGround"
  | "sceneGrid"
  | "scenesList"
  | "assets"
  | "assetRefresh"
  | "selection"
  | "tool"
  | "placement"
  | "inspection"
  | "objectsVisible"
  | "objectVisibility"
  | "search"
  | "category"
  | "notice"
  | "wfcProgress";

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
  inspectionResolution: PlacementResolution = "snap";
  objectsVisible = true;
  assetSearch = "";
  category = "all";
  assetsRefreshing = false;
  notice = "Ready";
  wfcProgress: WfcGenerationProgress | null = null;
  wfcPreviewObjects: readonly SceneObject[] = [];

  private readonly listeners = new Map<EditorTopic, Set<Listener>>();
  /** Session-only, per-scene: objects hidden from the viewport for editing convenience, not persisted. */
  private readonly hiddenObjectIdSet = new Set<string>();

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

  get hiddenObjectIds(): ReadonlySet<string> {
    return this.hiddenObjectIdSet;
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
    this.hiddenObjectIdSet.clear();
    this.emit("scene", "selection");
    await this.refreshScenes();
    this.setNotice(`Created ${nextScene.name}`);
  }

  async openScene(id: string) {
    const nextScene = await openSceneRequest(id);
    this.history = createHistory(nextScene);
    this.selectedObjectId = null;
    this.hiddenObjectIdSet.clear();
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
    this.hiddenObjectIdSet.clear();
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
    this.hiddenObjectIdSet.clear();
    this.emit("scene", "selection");
    await this.refreshScenes();
    this.setNotice("Deleted scene");
  }

  placeAsset(assetId: string, position: Vector3Data, options: { scale?: number } = {}) {
    const scene = this.scene;
    if (!this.history || !scene) return;
    const object: SceneObject = {
      id: createId("obj"),
      assetId,
      name: nextObjectName(scene.objects, assetId),
      position: { x: position.x, y: Number.isFinite(position.y) ? position.y : 0, z: position.z },
      rotationY: 0,
      scale: Number.isFinite(options.scale) && options.scale! > 0 ? options.scale! : 1
    };
    this.history = executeCommand(this.history, addObjectCommand(object));
    this.selectedObjectId = object.id;
    this.placementAssetId = null;
    this.activeTool = "select";
    this.emit("scene", "selection", "placement", "tool");
    this.setNotice(`Placed ${assetId}`);
  }

  async generateWfcLayout(request: GenerateWfcLayoutRequest) {
    if (!this.history || !this.scene || this.wfcProgress) {
      if (!this.history || !this.scene) this.setNotice("Open a scene before generating a layout");
      return;
    }

    this.setWfcProgress({ status: "building-palette" });
    const roadScene = this.assets.some((asset) => asset.category === "3d-road-tiles");
    try {
      const worldPlan = roadScene
        ? createWorldPlan({ width: request.width, depth: request.depth, seed: request.seed, roadCoverage: 0.5 })
        : undefined;
      const palette = paletteFromAssets("shared-assets", this.assets, {
        tileWidth: request.tileWidth,
        tileDepth: request.tileDepth,
        purpose: roadScene ? "road-scene" : undefined
      });
      const policies = [...(request.policies ?? []), ...(worldPlan ? policiesFromWorldPlan(worldPlan) : [])];
      const solved = await solvePlanarWfcInWorker(
        palette,
        { ...request, policies },
        { onProgress: (progress) => this.setWfcProgress(progress) }
      );
      const validationDiagnostics = worldPlan ? validateWorldPlanResult(worldPlan, palette, solved) : [];
      const result = sceneObjectsFromWfcResult(solved, request, palette);
      const objects = result.status === "solved" && !validationDiagnostics.length ? result.objects : [];
      if (!objects.length) {
        throw new Error(validationDiagnostics[0] ?? (result.status === "failed"
          ? result.diagnostics[0] ?? "WFC generation failed"
          : "WFC generation failed"));
      }

      this.setWfcProgress({ status: "placing", cells: objects.length });
      this.history = executeCommand(this.history, replaceGeneratedLayoutCommand(objects, isGeneratedWfcObject));
      this.selectedObjectId = objects[0]?.id ?? null;
      this.emit("scene", "selection");
      this.setNotice(`Generated ${objects.length} tiles (seed ${request.seed})`);
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : "WFC generation failed";
      this.setNotice(roadScene ? `Road scene infeasible (seed ${request.seed}): ${diagnostic}` : diagnostic);
    } finally {
      this.setWfcProgress(null);
    }
  }

  private setWfcProgress(progress: WfcGenerationProgress | null) {
    this.wfcProgress = progress;
    this.wfcPreviewObjects = progress?.status === "solving" ? progress.objects : [];
    this.emit("wfcProgress");
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

  updateSelectedObject(patch: Partial<Pick<SceneObject, "name" | "position" | "rotationY" | "scale">>) {
    if (!this.history || !this.selectedObjectId) return;
    this.history = executeCommand(this.history, updateObjectCommand(this.selectedObjectId, patch));
    this.emit("scene");
  }

  renameSelectedObject(name: string) {
    const trimmed = name.trim();
    if (!trimmed || this.selected?.name === trimmed) return;
    this.updateSelectedObject({ name: trimmed });
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
    if (!this.selectedObjectId) return;
    this.deleteObject(this.selectedObjectId);
  }

  deleteObject(objectId: string) {
    if (!this.history) return;
    this.history = executeCommand(this.history, deleteObjectCommand(objectId));
    this.hiddenObjectIdSet.delete(objectId);
    if (this.selectedObjectId === objectId) this.selectedObjectId = null;
    this.emit("scene", "selection");
    this.setNotice("Object deleted");
  }

  isObjectHidden(objectId: string): boolean {
    return this.hiddenObjectIdSet.has(objectId);
  }

  toggleObjectVisibility(objectId: string) {
    if (this.hiddenObjectIdSet.has(objectId)) this.hiddenObjectIdSet.delete(objectId);
    else this.hiddenObjectIdSet.add(objectId);
    this.emit("objectVisibility");
  }

  setSceneName(name: string) {
    if (!this.history || this.history.scene.name === name) return;
    this.history = { ...this.history, scene: { ...this.history.scene, name } };
    this.emit("sceneMeta");
  }

  setSceneDescription(description: string) {
    if (!this.history || this.history.scene.description === description) return;
    this.history = { ...this.history, scene: { ...this.history.scene, description } };
    this.emit("sceneMeta");
  }

  setGridCellSize(cellSize: number) {
    if (!this.history || !Number.isFinite(cellSize) || cellSize <= 0) return;
    if (this.history.scene.grid.cellSize === cellSize) return;
    this.history = {
      ...this.history,
      scene: { ...this.history.scene, grid: { ...this.history.scene.grid, cellSize } }
    };
    this.emit("sceneGrid");
  }

  /** The ground plane's overall extent (kept square: width and depth move together). */
  setSceneSize(size: number) {
    if (!this.history || !Number.isFinite(size) || size <= 0) return;
    const grid = this.history.scene.grid;
    if (grid.width === size && grid.depth === size) return;
    this.history = {
      ...this.history,
      scene: { ...this.history.scene, grid: { ...grid, width: size, depth: size } }
    };
    this.emit("sceneGrid");
  }

  setBackgroundType(type: SurfaceAppearanceType) {
    if (!this.history || this.history.scene.background.type === type) return;
    this.history = {
      ...this.history,
      scene: { ...this.history.scene, background: { ...this.history.scene.background, type } }
    };
    this.emit("sceneBackground");
  }

  setBackgroundColor(color: string) {
    if (!this.history || this.history.scene.background.color === color) return;
    this.history = {
      ...this.history,
      scene: { ...this.history.scene, background: { ...this.history.scene.background, color } }
    };
    this.emit("sceneBackground");
  }

  setBackgroundTexture(textureUrl: string) {
    if (!this.history) return;
    this.history = {
      ...this.history,
      scene: { ...this.history.scene, background: { ...this.history.scene.background, textureUrl } }
    };
    this.emit("sceneBackground");
  }

  setGroundType(type: SurfaceAppearanceType) {
    if (!this.history || this.history.scene.ground.type === type) return;
    this.history = {
      ...this.history,
      scene: { ...this.history.scene, ground: { ...this.history.scene.ground, type } }
    };
    this.emit("sceneGround");
  }

  setGroundColor(color: string) {
    if (!this.history || this.history.scene.ground.color === color) return;
    this.history = {
      ...this.history,
      scene: { ...this.history.scene, ground: { ...this.history.scene.ground, color } }
    };
    this.emit("sceneGround");
  }

  setGroundTexture(textureUrl: string) {
    if (!this.history) return;
    this.history = {
      ...this.history,
      scene: { ...this.history.scene, ground: { ...this.history.scene.ground, textureUrl } }
    };
    this.emit("sceneGround");
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
    if (this.placementResolution === resolution) return;
    this.placementResolution = resolution;
    this.emit("placement");
  }

  setInspectionResolution(resolution: PlacementResolution) {
    if (this.inspectionResolution === resolution) return;
    this.inspectionResolution = resolution;
    this.emit("inspection");
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

function nextObjectName(objects: SceneObject[], assetId: string): string {
  const id = "__next__";
  return objectDisplayNames([...objects, { id, assetId, name: "", position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 }]).get(id) ?? assetId;
}
