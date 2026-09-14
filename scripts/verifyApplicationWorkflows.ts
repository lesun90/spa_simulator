import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import type { App } from "../src/app/App";
import type { ScenarioStudioApp } from "../src/scenario-studio/ScenarioStudioApp";
import type { ScenarioSession } from "../src/scenario-studio/domain/ScenarioSession";
import type { SceneChoice } from "../src/scenario-studio/domain/scene";
import type * as THREE from "three";

declare global {
  interface Window {
    verificationApp: App;
    verificationScenario: ScenarioStudioApp & { verificationSession: ScenarioSession; verificationHud: {
      choices: SceneChoice[]; busy: boolean; candidate: SceneChoice | null; pending: SceneChoice | null;
      modalRoot: { visible: boolean };
    } };
    verificationViewer: { camera: THREE.PerspectiveCamera; grid: THREE.GridHelper };
    verificationFiles: Record<string, Blob>;
  }
}

// A real application/server run with disposable persistence. No installed host dependencies.
const sceneDirectory = await mkdtemp(join(tmpdir(), "lean-modular-scenes-"));
const outputDirectory = process.env.WORKFLOW_ARTIFACT_DIR ?? "/tmp/lean-modular-workflows";
await mkdir(outputDirectory, { recursive: true });
const previousSceneDirectory = process.env.STEERLAB_USER_DATA_DIR;
process.env.STEERLAB_USER_DATA_DIR = sceneDirectory;
const server = await createServer({ server: { host: "127.0.0.1", port: 5198, strictPort: true, hmr: false, watch: null } });
let browser;
const observations: Record<string, unknown> = {};
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Expose the actual entry-point object only in the verification browser; production files stay untouched.
  await page.route("**/src/scene-studio/main.ts*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.verificationApp = app;` });
  });
  await page.route("**/src/scenario-studio/main.ts*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.verificationScenario = app; app.verificationSession = app.session; app.verificationHud = app.hud;` });
  });
  await page.route("**/src/asset-viewer/main.ts*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const bootstrap = "void new AssetViewer(canvas).start();";
    if (!source.includes(bootstrap)) throw new Error("Update viewer verification instrumentation for its current composition root");
    await route.fulfill({ response, body: source.replace(bootstrap, "window.verificationViewer = new AssetViewer(canvas); void window.verificationViewer.start();") });
  });
  await page.goto("http://127.0.0.1:5198/scene_studio");
  await page.waitForFunction(() => window.verificationApp?.state.scene && window.verificationApp.state.assets.length && !window.verificationApp.state.assetsRefreshing);
  console.log("Scene Studio loaded; checking editing and persistence");
  observations.editing = await page.evaluate(async () => {
    const state = window.verificationApp.state;
    const asset = state.assets.find((entry) => entry.id === "3d-road-tiles.road-tile-163")!;
    if (!asset) throw new Error("Road ground asset missing");
    state.placeAsset(asset.id, { x: 0, y: 0, z: 0 });
    state.updateSelectedObject({ rotationY: Math.PI / 2, scale: 2 });
    await state.saveScene();
    if (!state.notice.startsWith("Saved ")) throw new Error(state.notice);
    return { sceneId: state.scene!.id, objects: state.scene!.objects };
  });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.verificationApp.state.scene?.objects[0]?.scale === 1);
  await page.keyboard.press("Control+Shift+z");
  await page.waitForFunction(() => window.verificationApp.state.scene?.objects[0]?.scale === 2);
  observations.persistence = await page.evaluate(async () => {
    const state = window.verificationApp.state;
    const before = JSON.stringify(state.scene!.objects);
    await state.openScene(state.scene!.id);
    if (before !== JSON.stringify(state.scene!.objects)) throw new Error("Saved scene object round trip drift");
    return "objects and transforms preserved; keyboard undo/redo passed";
  });
  observations.sceneLoadFailure = await page.evaluate(async () => {
    const state = window.verificationApp.state;
    const before = JSON.stringify(state.scene);
    let diagnostic = "";
    try { await state.openScene("missing-verification-scene"); }
    catch (error) { diagnostic = error instanceof Error ? error.message : String(error); }
    if (!diagnostic || JSON.stringify(state.scene) !== before) throw new Error("Failed Scene Studio load changed the active scene or lost its diagnostic");
    return { diagnostic, retainedScene: true };
  });
  observations.generation = await page.evaluate(async () => {
    const state = window.verificationApp.state;
    await state.generateWfcLayout({ width: 10, depth: 10, seed: 13 });
    const generated = state.scene!.objects.filter((object) => object.generated?.pipeline === "wfc");
    if (generated.length !== 100 || state.wfcProgress !== null || state.wfcPreviewObjects.length) throw new Error(`Generation failed: ${state.notice}`);
    const before = JSON.stringify(state.scene!.objects);
    await state.generateWfcLayout({ width: 0, depth: 2, seed: 13 });
    if (before !== JSON.stringify(state.scene!.objects) || !state.notice.includes("infeasible")) throw new Error("Failed generation changed the scene or lost its diagnostic");
    return { generated: generated.length, failedGeneration: state.notice };
  });
  console.log("Generation verified; checking environment export/import");
  // Native picker decisions are supplied by automation; real file-adapter reads/writes and HTTP/GLB operations run.
  observations.environment = await page.evaluate(async () => {
    window.verificationFiles = {};
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => ({
      getFileHandle: async (name: string) => ({ createWritable: async () => ({
        write: async (data: BlobPart) => { window.verificationFiles[name] = new Blob([data]); }, close: async () => {}
      }) })
    }) });
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => Object.entries(window.verificationFiles).map(([name, blob]) => ({ getFile: async () => new File([blob], name) })) });
    const state = window.verificationApp.state;
    await state.exportEnvironment({ chunkSize: 16, removeSeamFaces: false });
    if (!state.notice.startsWith("Exported environment")) throw new Error(state.notice);
    const glbBytes = window.verificationFiles["environment.glb"]?.size;
    if (!glbBytes) throw new Error("No exported GLB");
    await state.importEnvironment();
    if (!state.notice.startsWith("Imported environment") || !state.scene?.environment) throw new Error(state.notice);
    await state.saveScene();
    const hash = state.scene.environment.sha256;
    await state.openScene(state.scene.id);
    if (state.scene!.environment?.sha256 !== hash) throw new Error("Imported environment reference lost on reload");
    return { glbBytes, sha256: hash, notice: state.notice };
  });
  // Historical refactor baselines are optional external artifacts, not repository fixtures.
  if (process.env.WORKFLOW_BASELINE) {
    const baseline = JSON.parse(await readFile(process.env.WORKFLOW_BASELINE, "utf8"));
    const environment = observations.environment as { glbBytes: number; sha256: string };
    if (environment.glbBytes !== baseline.environment.glbBytes || environment.sha256 !== baseline.environment.sha256) throw new Error("Exported environment GLB differs from the supplied browser baseline");
    observations.baselineComparison = "Matched supplied WORKFLOW_BASELINE";
  } else observations.baselineComparison = "Historical byte comparison not requested; set WORKFLOW_BASELINE to supply one.";
  page.once("dialog", (dialog) => dialog.accept());
  observations.environmentFailure = await page.evaluate(async () => {
    const state = window.verificationApp.state;
    const before = JSON.stringify(state.scene);
    const original = window.verificationFiles["environment.glb"];
    window.verificationFiles["environment.glb"] = new Blob([new Uint8Array([0, 1, 2, 3])]);
    try {
      await state.importEnvironment();
      if (state.notice.startsWith("Imported environment") || JSON.stringify(state.scene) !== before) throw new Error("Failed environment import replaced the active scene");
      const diagnostic = state.notice;
      await state.openScene(state.scene!.id);
      if (state.scene!.environment?.sha256 !== JSON.parse(before).environment.sha256) throw new Error("Failed import replaced the persisted environment");
      return { diagnostic, retainedEnvironment: true };
    } finally { window.verificationFiles["environment.glb"] = original; }
  });
  await page.screenshot({ path: join(outputDirectory, "scene-studio.png") });
  observations.sceneDisposal = await page.evaluate(() => {
    const app = window.verificationApp as App & { dispose?: () => void };
    if (!app.dispose) return "baseline limitation: App has no dispose method";
    app.dispose(); app.dispose();
    return "dispose is callable and idempotent";
  });
  console.log("Scene Studio verified; checking Scenario Studio");
  await page.goto("http://127.0.0.1:5198/scenario_studio");
  await page.locator("canvas#app").waitFor();
  await page.waitForFunction(() => window.verificationScenario?.verificationHud.choices.length > 0 && !window.verificationScenario.verificationHud.busy);
  const selectedKey = await page.evaluate(() => {
    const choice = window.verificationScenario.verificationHud.choices[0];
    if (!choice.available) throw new Error("Scenario smoke requires an available first published scene");
    if (window.verificationScenario.verificationSession.document.sceneReference !== null) throw new Error("Scenario did not start on default ground");
    return choice.reference.key;
  });
  // Select the first published tile and activate it through the canvas HUD.
  await page.mouse.click(80, 810);
  await page.waitForFunction((key) => window.verificationScenario.verificationHud.candidate?.reference.key === key, selectedKey);
  await page.evaluate(() => {
    if (window.verificationScenario.verificationSession.document.sceneReference !== null) throw new Error("Tile selection bypassed confirmation");
  });
  await page.mouse.click(140, 674);
  await page.waitForFunction(() => window.verificationScenario.verificationHud.modalRoot.visible);
  await page.evaluate(() => {
    if (window.verificationScenario.verificationSession.document.sceneReference !== null) throw new Error("Use Scene bypassed confirmation");
  });
  await page.mouse.click(800, 536);
  await page.waitForFunction((key) => window.verificationScenario.verificationSession.document.sceneReference?.key === key && !window.verificationScenario.verificationHud.modalRoot.visible, selectedKey);
  observations.scenarioLoad = await page.evaluate(async () => {
    const session = window.verificationScenario.verificationSession;
    const selected = session.document.sceneReference!;
    let diagnostic = "";
    try { await session.replaceScene({ ...selected, key: "missing-verification-scene" }); }
    catch (error) { diagnostic = error instanceof Error ? error.message : String(error); }
    if (!diagnostic || session.document.sceneReference?.key !== selected.key) throw new Error("Failed scene load did not retain prior scene");
    await session.replaceScene(selected);
    return { key: selected.key, failedLoad: diagnostic, retainedScene: true };
  });
  await page.screenshot({ path: join(outputDirectory, "scenario-studio.png") });
  observations.scenario = { title: await page.title(), canvas: await page.locator("canvas#app").count() };
  observations.scenarioDisposal = await page.evaluate(() => {
    window.verificationScenario.dispose();
    window.verificationScenario.dispose();
    if (document.querySelector("canvas#app")) throw new Error("Scenario canvas survived disposal");
    return "idempotent disposal removes the canvas";
  });
  console.log("Scenario Studio verified; checking Asset Viewer");
  await page.goto("http://127.0.0.1:5198/asset-viewer.html?asset=3d-road-tiles.road-tile-163&spin=0");
  await page.waitForFunction(() => document.body.dataset.viewerStatus === "ready");
  const initialCamera = await page.evaluate(() => window.verificationViewer.camera.position.toArray());
  await page.getByRole("combobox", { name: "Camera angle" }).selectOption("top");
  const topCamera = await page.evaluate(() => window.verificationViewer.camera.position.toArray());
  if (JSON.stringify(topCamera) === JSON.stringify(initialCamera) || Math.abs(topCamera[0]) > 0.01 || topCamera[1] <= Math.abs(topCamera[2])) throw new Error("Top camera control did not reframe the asset");
  const initialGrid = await page.evaluate(() => window.verificationViewer.grid.visible);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  if (await page.evaluate(() => window.verificationViewer.grid.visible) === initialGrid) throw new Error("Grid toggle did not change visibility");
  await page.evaluate(() => window.verificationViewer.camera.position.set(999, 999, 999));
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  const resetCamera = await page.evaluate(() => window.verificationViewer.camera.position.toArray());
  if (resetCamera.some((coordinate, index) => Math.abs(coordinate - topCamera[index]) > 0.01)) throw new Error("Reset did not restore the selected viewing angle");
  await page.screenshot({ path: join(outputDirectory, "asset-viewer.png") });
  observations.viewer = await page.evaluate(() => ({ status: document.body.dataset.viewerStatus, assetId: document.body.dataset.assetId }));
  await page.route("**/api/assets", (route) => route.fulfill({ status: 500, json: { error: "Verification catalog failure" } }));
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.viewerStatus === "error");
  observations.viewerFailure = await page.locator(".viewer-status").textContent();
  if (observations.viewerFailure !== "Verification catalog failure") throw new Error("Viewer lost the catalog failure diagnostic");
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  observations.browserErrors = errors;
  console.log(JSON.stringify(observations, null, 2));
  await writeFile(join(outputDirectory, "observations.json"), JSON.stringify(observations, null, 2) + "\n");
} finally {
  await browser?.close();
  await server.close();
  if (previousSceneDirectory === undefined) delete process.env.STEERLAB_USER_DATA_DIR;
  else process.env.STEERLAB_USER_DATA_DIR = previousSceneDirectory;
  await rm(sceneDirectory, { recursive: true, force: true });
}
