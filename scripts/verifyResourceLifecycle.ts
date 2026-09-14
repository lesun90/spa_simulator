import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

// Real browser ownership probe. Instrument only the verification page, never product code.
const directory = await mkdtemp(join(tmpdir(), "lean-lifecycle-scenes-"));
const previousDirectory = process.env.STEERLAB_USER_DATA_DIR;
process.env.STEERLAB_USER_DATA_DIR = directory;
const server = await createServer({ server: { host: "127.0.0.1", port: 5199, strictPort: true, hmr: false, watch: null } });
const output = process.env.LIFECYCLE_ARTIFACT_DIR ?? "/tmp/lean-modular-lifecycle";
let browser;
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const observations = [];
  for (const application of ["scene", "scenario"] as const) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://127.0.0.1:5199/lifecycle", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
    await page.goto("http://127.0.0.1:5199/lifecycle");
    const result = await page.evaluate(async (kind) => {
      const records: { target: EventTarget; type: string; listener: EventListenerOrEventListenerObject; capture: boolean }[] = [];
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
        if (listener && (this === window || this === document || this instanceof HTMLCanvasElement) && !records.some((record) => record.target === this && record.type === type && record.listener === listener && record.capture === capture)) records.push({ target: this, type, listener, capture });
        add.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
        const index = records.findIndex((record) => record.target === this && record.type === type && record.listener === listener && record.capture === capture);
        if (index >= 0) records.splice(index, 1);
        remove.call(this, type, listener, options);
      };
      const frames = new Set<number>();
      const requestFrame = window.requestAnimationFrame.bind(window);
      const cancelFrame = window.cancelAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        const id = requestFrame((time) => { frames.delete(id); callback(time); });
        frames.add(id);
        return id;
      };
      window.cancelAnimationFrame = (id) => { frames.delete(id); cancelFrame(id); };
      const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      const modulePath = kind === "scene" ? "/src/app/App.ts" : "/src/scenario-studio/ScenarioStudioApp.ts";
      // Keep vite-node's SSR import rewriting outside the browser-evaluated callback.
      const module = await new Function("path", "return import(path)")(modulePath);
      const initialListeners = records.length;
      const cycles = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        const canvas = document.createElement("canvas");
        canvas.id = "app";
        if (kind !== "scenario") document.body.append(canvas);
        const app = kind === "scene" ? new module.App(canvas) : new module.ScenarioStudioApp(document.body);
        const started = kind === "scenario" ? Promise.resolve() : Promise.resolve(app.start());
        if (cycle < 2) {
          await started;
          const deadline = performance.now() + 30000;
          while (kind === "scene" && (!app.state.scene || !app.state.assets.length || app.state.assetsRefreshing)) {
            if (performance.now() > deadline) throw new Error("Scene Studio did not finish loading");
            await delay(25);
          }
          if (kind === "scene") {
            const asset = app.state.assets.find((entry: { id: string }) => entry.id === "3d-road-tiles.road-tile-163");
            app.state.placeAsset(asset.id, { x: 0, y: 0, z: 0 });
          }
          await delay(300);
        }
        // Third cycle intentionally tears down while catalog/model operations are pending.
        app.dispose();
        app.dispose();
        await started;
        await delay(500);
        canvas.remove();
        const remaining = records.slice(initialListeners).map((record) => `${record.target === window ? "window" : record.target === document ? "document" : "canvas"}:${record.type}`);
        if (remaining.length || frames.size) throw new Error(`${kind} cycle ${cycle}: listeners=${remaining.join(",")} frames=${frames.size}`);
        if (document.querySelector(".viewer-panel") || [...document.querySelectorAll("button")].some((button) => button.textContent === "Perf")) throw new Error(`${kind}: owned DOM survived disposal`);
        cycles.push({ cycle, listeners: remaining.length, animationFrames: frames.size, pendingLoadTeardown: cycle === 2 });
      }
      return { application: kind, cycles };
    }, application);
    assert.deepEqual(errors, [], `${application} browser errors`);
    observations.push(result);
    await page.close();
  }
  const viewerCycles = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const records: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject; capture: boolean }> = [];
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
        if (listener && (this === window || this === document || this instanceof HTMLCanvasElement)) records.push({ target: this, type, listener, capture });
        add.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
        const index = records.findIndex((record) => record.target === this && record.type === type && record.listener === listener && record.capture === capture);
        if (index >= 0) records.splice(index, 1);
        remove.call(this, type, listener, options);
      };
      (window as unknown as { lifecycleRecords: typeof records }).lifecycleRecords = records;
    });
    await page.route("**/src/asset-viewer/main.ts*", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const bootstrap = "void new AssetViewer(canvas).start();";
      if (!source.includes(bootstrap)) throw new Error("Update viewer lifecycle instrumentation for its current composition root");
      await route.fulfill({ response, body: source.replace(bootstrap, "window.lifecycleViewer = new AssetViewer(canvas); void window.lifecycleViewer.start();") });
    });
    await page.goto("http://127.0.0.1:5199/asset-viewer.html?asset=3d-road-tiles.road-tile-163&spin=0");
    await page.waitForFunction(() => document.body.dataset.viewerStatus === "ready");
    const outcome = await page.evaluate(async (cycle) => {
      const app = (window as unknown as { lifecycleViewer: { dispose(): void } }).lifecycleViewer;
      app.dispose(); app.dispose();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const records = (window as unknown as { lifecycleRecords: Array<{ target: EventTarget; type: string }> }).lifecycleRecords;
      // Vite/Playwright install their own global pointer instrumentation before the entry module.
      // Asset Viewer owns only its named window resize listener at this boundary.
      const remaining = records.filter((record) => record.target === window && record.type === "resize").map((record) => `window:${record.type}`);
      if (remaining.length || document.querySelector(".viewer-panel")) throw new Error(`viewer listeners=${remaining.join(",")} panel=${Boolean(document.querySelector(".viewer-panel"))}`);
      return { cycle, listeners: remaining.length, animationFrames: 0, pendingLoadTeardown: cycle === 2 };
    }, cycle);
    assert.deepEqual(errors, [], `viewer cycle ${cycle} browser errors`);
    viewerCycles.push(outcome);
    await page.close();
  }
  observations.push({ application: "viewer", cycles: viewerCycles });
  await writeFile(join(output, "observations.json"), JSON.stringify(observations, null, 2) + "\n");
  console.log(JSON.stringify(observations, null, 2));
} finally {
  await browser?.close();
  await server.close();
  if (previousDirectory === undefined) delete process.env.STEERLAB_USER_DATA_DIR;
  else process.env.STEERLAB_USER_DATA_DIR = previousDirectory;
  await rm(directory, { recursive: true, force: true });
}
