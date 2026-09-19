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
    verificationDownload: { name: string; blob: Blob } | null;
    verificationWorkerOperations: string[];
  }
}

// A real application/server run with disposable persistence. No installed host dependencies.
const sceneDirectory = await mkdtemp(join(tmpdir(), "lean-modular-scenes-"));
const outputDirectory = process.env.WORKFLOW_ARTIFACT_DIR ?? "/tmp/lean-modular-workflows";
await mkdir(outputDirectory, { recursive: true });
const previousSceneDirectory = process.env.STEERLAB_USER_DATA_DIR;
const previousScenarioDirectory = process.env.STEERLAB_SCENARIOS_DIR;
process.env.STEERLAB_USER_DATA_DIR = sceneDirectory;
process.env.STEERLAB_SCENARIOS_DIR = join(sceneDirectory, "scenarios");
const server = await createServer({ cacheDir: join(sceneDirectory, ".vite-cache"), server: { host: "127.0.0.1", port: 5198, strictPort: true, hmr: false, watch: null } });
let browser;
const observations: Record<string, unknown> = {};
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.verificationWorkerOperations = [];
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
      const operation = (message as { operation?: { type?: unknown } })?.operation?.type;
      if (typeof operation === "string") window.verificationWorkerOperations.push(operation);
      return Reflect.apply(postMessage, this, [message, ...rest]);
    };
  });
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
    window.verificationDownload = null;
    let pendingDownload: Blob | null = null;
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => {
      if (blob.type === "application/zip") pendingDownload = blob;
      return nativeCreateObjectURL(blob);
    } });
    HTMLAnchorElement.prototype.click = function () {
      if (pendingDownload) window.verificationDownload = { name: this.download, blob: pendingDownload };
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
      if (/\/environment\/export$/.test(url)) {
        const payload = await response.clone().json() as { manifestJson: string };
        window.verificationFiles["environment.json"] = new Blob([payload.manifestJson], { type: "application/json" });
      } else if (/\/environment\/export\/[^/]+\/model$/.test(url)) {
        window.verificationFiles["environment.glb"] = await response.clone().blob();
      }
      return response;
    };
    const state = window.verificationApp.state;
    state.setSceneDescription("Workflow export scene");
    await state.exportEnvironment({ chunkSize: 16, removeSeamFaces: false });
    if (!state.notice.startsWith("Exported environment")) throw new Error(state.notice);
    if (window.verificationDownload?.name !== `${state.scene!.name}.zip` || window.verificationDownload.blob.type !== "application/zip") throw new Error("Environment export did not download one scene-named ZIP");
    const glbBytes = window.verificationFiles["environment.glb"]?.size;
    if (!glbBytes) throw new Error("No exported GLB");
    const exportedManifest = JSON.parse(await window.verificationFiles["environment.json"].text());
    const metadata = exportedManifest.metadata;
    if (metadata?.name !== state.scene!.name || metadata.description !== "Workflow export scene" || metadata.sceneSize !== state.scene!.grid.width || metadata.cellSize !== state.scene!.grid.cellSize || metadata.seed !== 13) {
      throw new Error(`Environment metadata mismatch: ${JSON.stringify(metadata)}`);
    }
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => Object.entries(window.verificationFiles).map(([name, blob]) => ({ getFile: async () => new File([blob], name) })) });
    await state.importEnvironment();
    if (!state.notice.startsWith("Imported environment") || !state.scene?.environment) throw new Error(state.notice);
    await state.saveScene();
    const hash = state.scene.environment.sha256;
    await state.openScene(state.scene.id);
    if (state.scene!.environment?.sha256 !== hash) throw new Error("Imported environment reference lost on reload");
    return { archiveBytes: window.verificationDownload.blob.size, glbBytes, sha256: hash, notice: state.notice };
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
  observations.scenarioInspector = await page.evaluate(() => {
    const hud = window.verificationScenario.verificationHud as unknown as {
      candidate: SceneChoice | null;
      labels: Record<string, { text: string }>;
    };
    const metadata = hud.labels.detailMetadata.text;
    if (hud.candidate?.sceneSize !== undefined && !metadata.includes(`Scene size: ${hud.candidate.sceneSize} m`)) throw new Error("Scene Inspector omitted scene size metadata");
    if (hud.candidate?.cellSize !== undefined && !metadata.includes(`Cell size: ${hud.candidate.cellSize} m`)) throw new Error("Scene Inspector omitted cell size metadata");
    if (hud.candidate?.seed !== undefined && !metadata.includes(`Seed: ${hud.candidate.seed}`)) throw new Error("Scene Inspector omitted seed metadata");
    return { description: hud.labels.detailDescription.text, metadata };
  });
  await page.mouse.click(550, 736); // Agents tab.
  await page.mouse.click(80, 810); // First available agent asset.
  await page.waitForFunction(() => (window.verificationScenario.verificationHud as unknown as { agentInspector: { context: unknown } }).agentInspector.context !== null);
  const nameHelpPoint = await page.evaluate(() => {
    const inspector = (window.verificationScenario.verificationHud as unknown as {
      agentInspector: { helpButtons: Array<{ root: THREE.Object3D }> };
    }).agentInspector;
    let node: THREE.Object3D | null = inspector.helpButtons[0].root.children[0] ?? null;
    let x = 0;
    let y = 0;
    while (node) { x += node.position.x; y += node.position.y; node = node.parent; }
    return { x, y };
  });
  await page.mouse.click(nameHelpPoint.x, nameHelpPoint.y); // Name field help.
  await page.waitForFunction(() => (window.verificationScenario.verificationHud as unknown as { agentInspector: { status: { text: string } } }).agentInspector.status.text.includes("name used to identify"));
  observations.agentPlacement = await page.evaluate(async () => {
    const app = window.verificationScenario as unknown as {
      session: ScenarioSession;
      hud: { agentInspector: { currentPlacementDraft(): import("../src/scenario-studio/domain/agent").AgentDraft | null }; setPopulation(agents: readonly import("../src/scenario-studio/domain/agent").SceneObjectSnapshot[]): void };
    };
    const draft = app.hud.agentInspector.currentPlacementDraft();
    if (!draft) throw new Error("Agent Inspector did not expose its configured placement draft");
    let ray: import("../src/scenario-studio/domain/agent").Ray3 | null = null;
    const coordinates = [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15, 18, -18];
    for (const z of coordinates) for (const x of coordinates) {
      if (ray) break;
      const candidate = { origin: { x, y: 100, z }, direction: { x: 0, y: -1, z: 0 } };
      const previews = await Promise.all([
        app.session.previewAgentPlacement(draft, candidate),
        app.session.previewAgentPlacement({ ...draft, scale: 0.75 }, candidate),
        app.session.previewAgentPlacement({ ...draft, pose: { ...draft.pose, headingRadians: 0.25 } }, candidate)
      ]);
      if (previews.every((preview) => preview.valid)) ray = candidate;
    }
    if (!ray) throw new Error("No valid authored placement was found on the active scene surface");
    await app.session.placeAgent(draft, ray);
    app.hud.setPopulation(app.session.agents);
    const base = app.session.agents[0];
    const stackedDraft = { ...draft, name: `${draft.name} stacked`, scale: 0.5 };
    const stackRay = { origin: { x: base.pose.position.x, y: base.pose.position.y + 50, z: base.pose.position.z }, direction: { x: 0, y: -1, z: 0 } };
    const stackPreview = await app.session.previewAgentPlacement(stackedDraft, stackRay);
    if (!stackPreview.valid || stackPreview.pose?.support?.kind !== "agent" || stackPreview.pose.support.id !== base.id) {
      throw new Error(`Authored object was not available as a supporting surface: ${JSON.stringify(stackPreview)}`);
    }
    await app.session.placeAgent(stackedDraft, stackRay);
    const stacked = app.session.agents.find((agent) => agent.id !== base.id)!;
    let transformRejected = "";
    try {
      await app.session.updateAgent(base.id, { ...base, scale: base.scale * 0.9 });
    } catch (error) {
      transformRejected = error instanceof Error ? error.message : String(error);
    }
    if (!transformRejected.includes("resting on this agent")) throw new Error("A supporting agent transform was not rejected");
    let deletionRejected = "";
    try {
      await app.session.deleteAgent(base.id);
    } catch (error) {
      deletionRejected = error instanceof Error ? error.message : String(error);
    }
    if (!deletionRejected.includes("resting on this agent")) throw new Error("A supporting agent deletion was not rejected");
    await app.session.deleteAgent(stacked.id);
    app.hud.setPopulation(app.session.agents);
    return { id: base.id, support: base.pose.support, stackedSupport: stackPreview.pose.support, transformRejected, deletionRejected };
  });
  const transformedAgentId = (observations.agentPlacement as { id: string }).id;
  await page.evaluate((id) => (window.verificationScenario as unknown as { selectAgent(id: string): void }).selectAgent(id), transformedAgentId);
  const transformPoint = async (kind: "move" | "resize" | "rotate") => page.evaluate(({ id, kind }) => {
    const app = window.verificationScenario as unknown as {
      viewport: { size: { width: number; height: number } };
      world: { camera: THREE.PerspectiveCamera };
      agentVisuals: {
        instances: Map<string, THREE.Object3D>;
        selectionControls: {
          outline: { box: THREE.Box3 };
          resizeEdges: Array<{ mesh: THREE.Object3D }>;
          rotateHandle: { ring: THREE.Object3D };
        };
      };
    };
    const object = app.agentVisuals.instances.get(id)!;
    object.updateMatrixWorld(true);
    const center = object.position.clone().project(app.world.camera);
    let point = object.position.clone();
    if (kind === "move") point = app.agentVisuals.selectionControls.outline.box.getCenter(point);
    else if (kind === "resize") point = app.agentVisuals.selectionControls.resizeEdges[1].mesh.getWorldPosition(point);
    else if (kind === "rotate") {
      point.set(1, 0, 0);
      app.agentVisuals.selectionControls.rotateHandle.ring.localToWorld(point);
    }
    point.project(app.world.camera);
    const screen = (value: THREE.Vector3) => ({
      x: (value.x + 1) * app.viewport.size.width / 2,
      y: (1 - value.y) * app.viewport.size.height / 2
    });
    return { point: screen(point), center: screen(center) };
  }, { id: transformedAgentId, kind });
  const beforeTransform = await page.evaluate((id) => {
    const agent = window.verificationScenario.verificationSession.agents.find((candidate) => candidate.id === id)!;
    return { scale: agent.scale, heading: agent.pose.headingRadians, position: agent.pose.position };
  }, transformedAgentId);
  const resize = await transformPoint("resize");
  await page.mouse.move(resize.point.x, resize.point.y);
  await page.mouse.down();
  await page.mouse.move(resize.point.x + (resize.center.x - resize.point.x) * 0.22, resize.point.y + (resize.center.y - resize.point.y) * 0.22, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(({ id, scale }) => window.verificationScenario.verificationSession.agents.find((candidate) => candidate.id === id)?.scale !== scale,
    { id: transformedAgentId, scale: beforeTransform.scale });
  const rotate = await transformPoint("rotate");
  await page.mouse.move(rotate.point.x, rotate.point.y);
  await page.mouse.down();
  await page.mouse.move(rotate.point.x + 24, rotate.point.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(({ id, heading }) => window.verificationScenario.verificationSession.agents.find((candidate) => candidate.id === id)?.pose.headingRadians !== heading,
    { id: transformedAgentId, heading: beforeTransform.heading });
  const move = await transformPoint("move");
  await page.mouse.move(move.point.x, move.point.y);
  await page.mouse.down();
  await page.mouse.move(move.point.x + 12, move.point.y + 4, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(({ id, position }) => {
    const next = window.verificationScenario.verificationSession.agents.find((candidate) => candidate.id === id)?.pose.position;
    return next && (Math.abs(next.x - position.x) > 0.001 || Math.abs(next.z - position.z) > 0.001);
  }, { id: transformedAgentId, position: beforeTransform.position });
  observations.agentTransforms = await page.evaluate((id) => {
    const app = window.verificationScenario as unknown as {
      agentVisuals: { selectedId: string | null };
      hud: { agentInspector: { context: unknown } };
    };
    const agent = window.verificationScenario.verificationSession.agents.find((candidate) => candidate.id === id)!;
    return { scale: agent.scale, heading: agent.pose.headingRadians, position: agent.pose.position, selected: app.agentVisuals.selectedId };
  }, transformedAgentId);
  await page.screenshot({ path: join(outputDirectory, "scenario-studio-agent-inspector.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(outputDirectory, "scenario-studio-agent-inspector-narrow.png") });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => {
    const app = window.verificationScenario as unknown as { agentVisuals: { selectionControls: { root: THREE.Object3D } | null } };
    (window as unknown as { verificationSelectionRoot: THREE.Object3D | null }).verificationSelectionRoot = app.agentVisuals.selectionControls?.root ?? null;
  });
  await page.mouse.click(420, 110); // Empty viewport clears the selected agent.
  await page.waitForFunction(() => {
    const app = window.verificationScenario as unknown as { agentVisuals: { selectedId: string | null; selectionControls: unknown }; hud: { agentInspector: { context: unknown } } };
    const root = (window as unknown as { verificationSelectionRoot: THREE.Object3D | null }).verificationSelectionRoot;
    return app.agentVisuals.selectedId === null && app.agentVisuals.selectionControls === null && app.hud.agentInspector.context === null && root?.parent === null;
  });
  observations.scenarioPhysicsOperations = await page.evaluate(() => {
    const operations = [...window.verificationWorkerOperations];
    const authoredBodyOperations = operations.filter((operation) => ["addAgent", "updateAgent", "removeAgent"].includes(operation));
    if (authoredBodyOperations.length) throw new Error(`Scenario authoring created agent physics bodies: ${authoredBodyOperations.join(", ")}`);
    return operations;
  });
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
  if (previousScenarioDirectory === undefined) delete process.env.STEERLAB_SCENARIOS_DIR;
  else process.env.STEERLAB_SCENARIOS_DIR = previousScenarioDirectory;
  await rm(sceneDirectory, { recursive: true, force: true });
}
