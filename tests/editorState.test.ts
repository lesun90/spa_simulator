import { beforeEach, expect, test, vi } from "vitest";
import { createScene } from "../src/editor-core/scene";
import { EditorState } from "../src/state/EditorState";
import {
  createSceneRequest,
  listAssets,
  listScenes,
  openSceneRequest,
  type SceneSummary
} from "../src/api/client";
import type { AssetCatalogEntry } from "../src/editor-core/assets";
import type { WfcMetadata } from "../src/wfc/metadata/socketTypes";

vi.mock("../src/api/client", () => ({
  createSceneRequest: vi.fn(),
  deleteSceneRequest: vi.fn(),
  duplicateSceneRequest: vi.fn(),
  importSharedAssetRequest: vi.fn(),
  listAssets: vi.fn(),
  listScenes: vi.fn(),
  openSceneRequest: vi.fn(),
  renameSceneRequest: vi.fn(),
  saveSceneRequest: vi.fn()
}));

const mockedListScenes = vi.mocked(listScenes);
const mockedListAssets = vi.mocked(listAssets);
const mockedCreateSceneRequest = vi.mocked(createSceneRequest);
const mockedOpenSceneRequest = vi.mocked(openSceneRequest);

beforeEach(() => {
  vi.clearAllMocks();
});

test("refreshScenes creates and opens a default scene on first run", async () => {
  const scene = createScene("Downtown");
  const summary: SceneSummary = {
    id: scene.id,
    name: scene.name,
    objectCount: 0,
    updatedAt: "2026-09-02T00:00:00.000Z"
  };
  mockedListScenes.mockResolvedValueOnce([]).mockResolvedValueOnce([summary]);
  mockedCreateSceneRequest.mockResolvedValue(scene);
  mockedOpenSceneRequest.mockResolvedValue(scene);

  const state = new EditorState();
  await state.refreshScenes();

  expect(mockedCreateSceneRequest).toHaveBeenCalledWith("Downtown");
  expect(state.scene).toEqual(scene);
  expect(state.scenes).toEqual([summary]);
});

test("asset search matches label, id, and tags inside the selected category", () => {
  const state = new EditorState();
  state.assets = [
    asset({ id: "props.cone", label: "Traffic Cone", category: "props", tags: ["road", "safety"] }),
    asset({ id: "vegetation.oak", label: "Oak Tree", category: "vegetation", tags: ["tree", "shade"] }),
    asset({ id: "props.barrier", label: "Road Barrier", category: "props", tags: ["traffic"] })
  ];

  state.setCategory("props");
  state.setSearch("road");

  expect(state.filteredAssets.map((entry) => entry.id)).toEqual(["props.cone", "props.barrier"]);

  state.setSearch("oak");

  expect(state.filteredAssets).toEqual([]);
});

test("asset category changes emit a category-specific event and reject unknown categories", () => {
  const state = new EditorState();
  state.assets = [
    asset({ id: "props.cone", category: "props" }),
    asset({ id: "vegetation.oak", category: "vegetation" })
  ];
  const onCategory = vi.fn();
  const onSearch = vi.fn();
  state.on("category", onCategory);
  state.on("search", onSearch);

  state.setCategory("vegetation");
  state.setCategory("missing");

  expect(state.category).toBe("vegetation");
  expect(onCategory).toHaveBeenCalledTimes(1);
  expect(onSearch).not.toHaveBeenCalled();
});

test("refreshAssets exposes loading state and keeps prior assets when loading fails", async () => {
  const state = new EditorState();
  const existing = [asset({ id: "props.cone", category: "props" })];
  const next = [asset({ id: "vegetation.oak", category: "vegetation" })];
  state.assets = existing;
  mockedListAssets.mockRejectedValueOnce(new Error("catalog unavailable")).mockResolvedValueOnce(next);
  const onRefresh = vi.fn();
  const onAssets = vi.fn();
  const onNotice = vi.fn();
  state.on("assetRefresh", onRefresh);
  state.on("assets", onAssets);
  state.on("notice", onNotice);

  await state.refreshAssets();

  expect(state.assets).toEqual(existing);
  expect(state.assetsRefreshing).toBe(false);
  expect(state.notice).toBe("catalog unavailable");
  expect(onRefresh).toHaveBeenCalledTimes(2);
  expect(onAssets).not.toHaveBeenCalled();
  expect(onNotice).toHaveBeenCalledTimes(1);

  await state.refreshAssets();

  expect(state.assets).toEqual(next);
  expect(state.notice).toBe("Assets refreshed");
  expect(onAssets).toHaveBeenCalledTimes(1);
});

test("refreshAssets resets a stale selected category when the catalog no longer contains it", async () => {
  const state = new EditorState();
  state.assets = [asset({ id: "props.cone", category: "props" })];
  state.setCategory("props");
  mockedListAssets.mockResolvedValueOnce([asset({ id: "vegetation.oak", category: "vegetation" })]);
  const onCategory = vi.fn();
  state.on("category", onCategory);

  await state.refreshAssets();

  expect(state.category).toBe("all");
  expect(onCategory).toHaveBeenCalledTimes(1);
});

test("placement can store a snapped object scale", () => {
  const state = new EditorState();
  state.history = { scene: createScene("Downtown"), undoStack: [], redoStack: [] };

  state.placeAsset("props.cone", { x: 1.5, y: 0, z: 2.5 }, { scale: 2.5 });

  expect(state.scene?.objects[0]).toMatchObject({
    assetId: "props.cone",
    position: { x: 1.5, y: 0, z: 2.5 },
    scale: 2.5
  });
});

test("placement preserves a stacked object height", () => {
  const state = new EditorState();
  state.history = { scene: createScene("Downtown"), undoStack: [], redoStack: [] };

  state.placeAsset("props.cone", { x: 1.5, y: 3.25, z: 2.5 });

  expect(state.scene?.objects[0]?.position).toEqual({ x: 1.5, y: 3.25, z: 2.5 });
});

test("generates a connected WFC layout as one undoable scene operation", async () => {
  const state = new EditorState();
  state.history = { scene: createScene("Downtown"), undoStack: [], redoStack: [] };
  state.assets = [
    asset({ id: "tiles.a", category: "tiles", wfc: wfc("tiles.a") }),
    asset({ id: "tiles.b", category: "tiles", wfc: wfc("tiles.b") })
  ];

  await state.generateWfcLayout({ width: 3, depth: 2, seed: 12, tileWidth: 6, tileDepth: 6 });

  expect(state.scene?.objects).toHaveLength(6);
  expect(state.scene?.objects.every((object) => object.scale === 2)).toBe(true);
  expect(state.canUndo()).toBe(true);
  expect(state.notice).toContain("Generated 6 tiles");
  state.undo();
  expect(state.scene?.objects).toHaveLength(0);
  state.redo();
  expect(state.scene?.objects).toHaveLength(6);
});

test("preserves the scene when road route constraints contradict the catalog", async () => {
  const state = new EditorState();
  state.history = { scene: createScene("Downtown"), undoStack: [], redoStack: [] };
  state.assets = [
    asset({ id: "roads.only", category: "3d-road-tiles", wfc: wfc("roads.only"), semantics: { roles: ["terrain.ground"], sockets: {} } })
  ];
  state.placeAsset("roads.only", { x: 1, y: 0, z: 1 });
  const previousHistory = state.history;
  const previousSelection = state.selectedObjectId;

  await state.generateWfcLayout({ width: 4, depth: 4, seed: 12, tileWidth: 3, tileDepth: 3 });

  expect(state.history).toBe(previousHistory);
  expect(state.selectedObjectId).toBe(previousSelection);
  expect(state.notice).toContain("Road scene infeasible");
  expect(state.wfcProgress).toBeNull();
  expect(state.wfcPreviewObjects).toEqual([]);
});

test("inspection resolution is independent from placement resolution", () => {
  const state = new EditorState();
  const onPlacement = vi.fn();
  const onInspection = vi.fn();
  state.on("placement", onPlacement);
  state.on("inspection", onInspection);

  state.setPlacementResolution("free");
  state.setInspectionResolution("free");

  expect(state.placementResolution).toBe("free");
  expect(state.inspectionResolution).toBe("free");
  expect(onPlacement).toHaveBeenCalledTimes(1);
  expect(onInspection).toHaveBeenCalledTimes(1);
});

function asset(patch: Partial<AssetCatalogEntry>): AssetCatalogEntry {
  return {
    id: patch.id ?? "props.cone",
    label: patch.label ?? "Asset",
    category: patch.category ?? "props",
    tags: patch.tags,
    source: patch.source ?? "shared",
    implementation: patch.implementation ?? "placeholder",
    wfc: patch.wfc
  };
}

function wfc(assetId: string): WfcMetadata {
  return {
    height: 1,
    diagnostics: [],
    variants: [
      {
        variantId: `${assetId}@r0`,
        rotationDegrees: 0,
        sockets: { north: "road", east: "road", south: "road", west: "road", top: "top", bottom: "bottom" }
      }
    ]
  };
}
