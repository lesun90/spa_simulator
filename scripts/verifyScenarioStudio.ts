import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { preview } from "vite";
import * as THREE from "three";
import { scenarioStudioPlugin } from "../server/scenarioStudioPlugin";
import { exportGlb } from "../src/environment/glbExporter";
import { disposeObject } from "../src/engine/disposeObject";
import type { SceneChoice } from "../src/scenario-studio/domain/scene";
import type { AgentChoice } from "../src/scenario-studio/domain/agent";

// Built-client walkthrough: real files and middleware, normal canvas clicks/keys.
// Canvas text is observed for assertions; no application modules/state are injected.
const temporary = await mkdtemp(join(tmpdir(), "scenario-studio-review-"));
const assetRoot = join(temporary, "assets");
const scenes = join(assetRoot, "scenes");
const output = resolve(process.env.SCENARIO_REVIEW_ARTIFACT_DIR ?? "/tmp/scenario-studio-review");
const observations: Record<string, unknown> = {};
let server: Awaited<ReturnType<typeof preview>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await mkdir(output, { recursive: true });
  await cp("assets/scenes", scenes, { recursive: true });
  await cp("assets/agents/vehicles/compact", join(assetRoot, "agents", "compact"), { recursive: true });
  await cp("assets/agents/vehicles/coupe", join(assetRoot, "agents", "coupe"), { recursive: true });
  for (const name of ["duplicate-a", "duplicate-b"]) {
    const folder = join(assetRoot, "agents", name);
    await cp("assets/agents/vehicles/compact", folder, { recursive: true });
    await writeFile(join(folder, "asset.json"), JSON.stringify({ id: "review.duplicate", label: name, category: "review" }));
  }
  const malformedAgent = join(assetRoot, "agents", "malformed");
  await mkdir(malformedAgent, { recursive: true });
  await writeFile(join(malformedAgent, "vehicle.json"), "{");
  await writeFile(join(malformedAgent, "malformed.glb"), "not a glb");
  const template = JSON.parse(await readFile(join(scenes, "sample", "environment.json"), "utf8"));
  const fixture = async (name: string, empty = false, metadata?: { name: string; description?: string; sceneSize?: number; cellSize?: number; seed?: number }) => {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    if (!empty) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 8), new THREE.MeshStandardMaterial({ color: 0xb14438 }));
      mesh.position.y = 6;
      root.add(mesh);
    }
    const glb = await exportGlb(root);
    disposeObject(root);
    const manifest = { ...template, ...(metadata ? { metadata } : {}), model: { ...template.model, sha256: createHash("sha256").update(glb).digest("hex") }, chunks: [], assets: [], cells: [], objects: [], navigation: { nodes: [], edges: [] } };
    const folder = join(scenes, name);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "environment.json"), JSON.stringify(manifest));
    await writeFile(join(folder, "environment.glb"), glb);
  };
  await fixture("review-groundless"); // Deliberately retains manifest.ground; GLB has only a raised box.
  await fixture("review-empty", true);
  await fixture("review-metadata", false, { name: "Harbor Loop", description: "Compact harbor circuit.", sceneSize: 24, cellSize: 2, seed: 91 });
  {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const ground = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 20), new THREE.MeshStandardMaterial({ name: "Stone", color: 0x8f8b80 }));
    ground.position.y = -0.5;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ name: "Water", color: 0x3c83b8 }));
    water.name = "Water";
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.4;
    root.add(ground, water);
    const glb = await exportGlb(root);
    disposeObject(root);
    const manifest = { ...template, model: { ...template.model, sha256: createHash("sha256").update(glb).digest("hex") }, chunks: [], assets: [], cells: [], objects: [], navigation: { nodes: [], edges: [] } };
    const folder = join(scenes, "review-water");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "environment.json"), JSON.stringify(manifest));
    await writeFile(join(folder, "environment.glb"), glb);
  }
  {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const ground = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 20), new THREE.MeshStandardMaterial({ name: "Stone", color: 0x8f8b80 }));
    ground.position.y = -0.5;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ name: "Water", color: 0x3c83b8 }));
    water.name = "Water";
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.4;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 16), new THREE.MeshStandardMaterial({ name: "Asphalt", color: 0x4d5158 }));
    bridge.name = "Bridge deck";
    bridge.position.y = 1.25;
    root.add(ground, water, bridge);
    const glb = await exportGlb(root);
    disposeObject(root);
    const manifest = { ...template, model: { ...template.model, sha256: createHash("sha256").update(glb).digest("hex") }, chunks: [], assets: [], cells: [], objects: [], navigation: { nodes: [], edges: [] } };
    const folder = join(scenes, "review-bridge");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "environment.json"), JSON.stringify(manifest));
    await writeFile(join(folder, "environment.glb"), glb);
  }
  {
    const root = new THREE.Group();
    root.name = "SteerlabEnvironment";
    const slope = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 20), new THREE.MeshStandardMaterial({ name: "Stone", color: 0x8f8b80 }));
    slope.rotation.z = 50 * Math.PI / 180;
    root.add(slope);
    const glb = await exportGlb(root);
    disposeObject(root);
    const manifest = { ...template, model: { ...template.model, sha256: createHash("sha256").update(glb).digest("hex") }, chunks: [], assets: [], cells: [], objects: [], navigation: { nodes: [], edges: [] } };
    const folder = join(scenes, "review-steep");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "environment.json"), JSON.stringify(manifest));
    await writeFile(join(folder, "environment.glb"), glb);
  }
  await fixture(""); // Optional root package, key ".".
  await mkdir(join(scenes, "review-invalid"));
  await writeFile(join(scenes, "review-invalid", "environment.json"), "{");
  const longKey = `review-${"long scene name ".repeat(10).trim()}`;
  await fixture(longKey);
  server = await preview({
    configFile: false, root: process.cwd(), plugins: [scenarioStudioPlugin(assetRoot)],
    build: { outDir: "/tmp/steerlab-review-dist" },
    preview: { host: "127.0.0.1", port: 4174, strictPort: true }
  });
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  const text: string[] = [];
  let manifestRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/scene-package/manifest?")) manifestRequests++; });
  await page.exposeFunction("recordReviewText", (value: string) => text.push(value));
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof original>) {
      void (window as unknown as { recordReviewText(value: string): Promise<void> }).recordReviewText(String(args[0]));
      return original.apply(this, args);
    };
  });
  const settle = () => page.waitForTimeout(350);
  const shot = async (name: string) => { await settle(); await page.screenshot({ path: join(output, `${name}.png`) }); console.log(name); };
  const active = () => page.screenshot({ clip: { x: 18, y: 86, width: 235, height: 52 } });
  const saw = async (fragment: string) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (text.some((value) => value.includes(fragment))) return;
      await page.waitForTimeout(100);
    }
    throw new Error(`Canvas did not draw: ${fragment}; recent text: ${text.slice(-30).join(" | ")}`);
  };
  let query = "";
  const search = async (value: string) => {
    await page.mouse.click(150, 736);
    for (const _ of query) await page.keyboard.press("Backspace");
    await page.keyboard.type(value);
    query = value;
    await page.keyboard.press("Enter");
    await settle();
  };
  const select = async (value: string) => { await search(value); await page.mouse.click(80, 810); await settle(); };
  const use = async () => { await page.mouse.click(140, 674); await settle(); };
  const confirm = async (key: string, status = 200) => {
    const response = page.waitForResponse((item) => item.url().includes("/scene-package/manifest?") && new URL(item.url()).searchParams.get("key") === key);
    await page.mouse.click(800, 536);
    assert.equal((await response).status(), status);
    await settle();
  };
  const catalog = async () => (await (await page.request.get("http://127.0.0.1:4174/api/scenario-studio/scenes")).json()).scenes as SceneChoice[];
  const agentCatalog = async () => (await (await page.request.get("http://127.0.0.1:4174/api/scenario-studio/agents")).json()).agents as AgentChoice[];
  await page.goto("http://127.0.0.1:4174/scenario_studio");
  await saw("scene");
  await page.waitForTimeout(1200);
  const choices = await catalog();
  assert(choices.some((item) => item.reference.key === "." && item.available));
  assert(choices.some((item) => item.reference.key === "sample" && item.available));
  assert(choices.some((item) => item.reference.key === "scene2" && item.available));
  const metadataChoice = choices.find((item) => item.reference.key === "review-metadata");
  assert.deepEqual(metadataChoice && {
    label: metadataChoice.label,
    description: metadataChoice.description,
    sceneSize: metadataChoice.sceneSize,
    cellSize: metadataChoice.cellSize,
    seed: metadataChoice.seed
  }, { label: "Harbor Loop", description: "Compact harbor circuit.", sceneSize: 24, cellSize: 2, seed: 91 });
  const waterChoice = choices.find((item) => item.reference.key === "review-water");
  assert(waterChoice?.available, JSON.stringify(waterChoice));
  assert(choices.some((item) => item.reference.key === "review-steep" && item.available));
  assert(choices.some((item) => item.reference.key === "review-bridge" && item.available));
  assert(choices.some((item) => item.reference.key === "review-invalid" && !item.available));
  const source = await page.request.get("http://127.0.0.1:4174/scenario-assets/agents/compact/compact.glb");
  assert.equal(source.status(), 200);
  const agents = await agentCatalog();
  assert(agents.some((item) => item.asset.id === "road-car-pack.compact" && item.available));
  assert(agents.some((item) => item.asset.id === "road-car-pack.coupe" && item.available));
  assert.equal(agents.filter((item) => item.asset.id === "review.duplicate" && !item.available).length, 2);
  assert(agents.some((item) => item.asset.key === "malformed" && !item.available && item.diagnostics.some((diagnostic) => diagnostic.includes("not valid JSON"))));
  assert(agents.every((item) => item.asset.modelUrl.startsWith("/scenario-assets/agents/")));
  observations.packages = choices.map((item) => ({ key: item.reference.key, available: item.available }));
  observations.agents = agents.map((item) => ({ id: item.asset.id, key: item.asset.key, available: item.available }));
  await shot("01-default-ground");
  const initial = await active();
  await page.mouse.click(550, 736); // Agents tab.
  await saw("Search agents");
  await page.mouse.click(80, 810); // Compact asset.
  await saw("NEW AGENT");
  await page.mouse.move(80, 810);
  await page.mouse.down();
  await page.mouse.move(683, 450, { steps: 8 });
  await saw("Click to place");
  await page.mouse.up();
  await saw("Compact placed.");
  await page.mouse.click(140, 677); // Add another Compact.
  await page.mouse.move(683, 450);
  await saw("overlaps another agent");
  await shot("01b-overlap-rejected");
  await page.keyboard.press("Escape");
  await page.mouse.click(150, 736); // Agent search has independent state.
  await page.keyboard.type("coupe");
  await page.keyboard.press("Enter");
  await settle();
  await page.mouse.click(80, 810);
  await saw("Coupe");
  await page.mouse.move(80, 810);
  await page.mouse.down();
  await page.mouse.move(810, 450, { steps: 8 });
  await page.mouse.up();
  await saw("Coupe placed.");
  await shot("01a-agent-placed");
  await page.mouse.click(683, 447); // Select the placed instance.
  await saw("EXISTING AGENT");
  await page.mouse.click(184, 313); // Heading.
  await page.keyboard.press("Backspace");
  await page.keyboard.type("45");
  await page.keyboard.press("Enter");
  await page.mouse.click(140, 677); // Apply Changes.
  await settle();
  await page.mouse.click(76, 639); // Duplicate; the copy becomes selected.
  await settle();
  await page.mouse.click(202, 639); // Delete copy, retaining the original.
  await settle();
  await page.mouse.click(470, 736); // Scenes tab.
  await select("review empty");
  await use();
  await saw("removes 2 agents.");
  await confirm("review-empty");
  await saw("The scene model has no visible geometry.");
  await shot("01c-failed-replacement-preserved");
  const requestsAfterFailedReplacement = manifestRequests;
  await select("SaMpLe");
  await saw("Package: sample");
  assert.deepEqual(await active(), initial, "Selecting a card changed the active environment");
  assert.equal(manifestRequests, requestsAfterFailedReplacement);
  await use();
  await saw("“sample”");
  await saw("removes 2 agents.");
  await shot("02-named-confirmation");
  await page.mouse.click(680, 536); // Cancel.
  assert.deepEqual(await active(), initial);
  await use();
  await page.keyboard.press("Escape");
  assert.deepEqual(await active(), initial);
  await use();
  await page.mouse.click(950, 600); // Backdrop.
  assert.deepEqual(await active(), initial);
  await use();
  await confirm("sample");
  await saw("sample loaded.");
  assert.notDeepEqual(await active(), initial);
  await shot("03-sample-loaded");
  const sample = await active();
  const count = manifestRequests;
  await use(); // Unchanged reference: disabled, no new request.
  await settle();
  assert.equal(manifestRequests, count);
  await search("no such scene xyz");
  await saw("No matching scenes.");
  await shot("04-search-empty");
  assert.deepEqual(await active(), sample);
  await search("ScEnE2");
  const refreshResponse = page.waitForResponse((item) => item.url().endsWith("/api/scenario-studio/scenes"));
  await page.mouse.click(1296, 736);
  await refreshResponse;
  await settle();
  await page.mouse.click(80, 810);
  await saw("Package: scene2");
  assert.deepEqual(await active(), sample);
  await use();
  await shot("04a-zero-agent-warning");
  await page.mouse.click(680, 536);
  assert.deepEqual(await active(), sample);
  // Change a real fixture after selection: both old content hashes must be rejected.
  const changedManifest = join(scenes, "scene2", "environment.json");
  await writeFile(changedManifest, `${await readFile(changedManifest, "utf8")}\n`);
  await use();
  await confirm("scene2", 400);
  await saw("This scene changed.");
  assert.deepEqual(await active(), sample);
  await shot("05-stale-package-preserved");
  const refreshChanged = page.waitForResponse((item) => item.url().endsWith("/api/scenario-studio/scenes"));
  await page.mouse.click(1296, 736);
  await refreshChanged;
  await settle();
  await use();
  await confirm("scene2");
  await saw("scene2 loaded.");
  await shot("06-scene2-loaded");
  const scene2 = await active();
  await select("review invalid");
  await saw("environment.json is not valid JSON.");
  const invalidCount = manifestRequests;
  await use();
  assert.equal(manifestRequests, invalidCount);
  assert.deepEqual(await active(), scene2);
  await select("review empty");
  await use();
  await confirm("review-empty");
  await saw("The scene model has no visible geometry.");
  assert.deepEqual(await active(), scene2);
  await shot("07-empty-geometry-preserved");
  await select("review groundless");
  await use();
  await confirm("review-groundless");
  await saw("review groundless loaded.");
  await shot("08-groundless-no-fallback");
  await select("review water");
  await saw("Package: review-water");
  await use();
  await saw("“review water”");
  await confirm("review-water");
  await saw("review water loaded.");
  await page.mouse.click(550, 736); // Agents tab; its independent search still contains Coupe.
  await page.mouse.click(80, 810);
  await page.mouse.click(140, 677);
  await page.mouse.move(683, 450);
  await saw("Choose a solid surface inside the environment.");
  await shot("08a-water-rejected");
  await page.keyboard.press("Escape");
  await page.mouse.click(470, 736); // Scenes tab.
  await select("review bridge");
  await use();
  await confirm("review-bridge");
  await saw("review bridge loaded.");
  await page.mouse.click(550, 736);
  await page.mouse.click(80, 810);
  await page.mouse.click(140, 677);
  await page.mouse.move(683, 450);
  await saw("Click to place this agent.");
  await page.mouse.click(683, 450);
  await saw("Coupe placed.");
  await shot("08b-bridge-placement");
  await page.mouse.click(470, 736);
  await select("review steep");
  await use();
  await saw("removes 1 agent.");
  await confirm("review-steep");
  await saw("review steep loaded.");
  await page.mouse.click(550, 736);
  await page.mouse.click(80, 810);
  await page.mouse.click(140, 677);
  await page.mouse.move(683, 450);
  await saw("This surface is too steep.");
  await shot("08c-steep-rejected");
  await page.keyboard.press("Escape");
  await page.mouse.click(470, 736);
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.move(700, 430, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -150);
  await settle();
  await page.mouse.click(1039, 27); // Reset view.
  await shot("09-reset-view");
  await select("long scene name");
  await use();
  await shot("10-long-name-confirmation");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("11-narrow-confirmation");
  await page.keyboard.press("Escape");
  await page.mouse.click(150, 720); // Search header at 844 - 150 + 26.
  await page.keyboard.type(" a very long search query that must remain inside the field");
  await shot("12-narrow-search");
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.reload();
  query = "";
  await page.waitForTimeout(1000);
  await select("published environment");
  await use();
  await confirm(".");
  await saw("Published environment loaded.");
  await shot("13-root-package");
  // A real package appears/disappears during review; Refresh discovers both changes.
  await fixture("review-added");
  await search("review added");
  await page.mouse.click(1296, 736);
  await page.waitForTimeout(600);
  assert((await catalog()).some((item) => item.reference.key === "review-added"));
  await page.mouse.click(80, 810);
  await saw("Package: review-added");
  await rm(join(scenes, "review-added"), { recursive: true });
  await page.mouse.click(1296, 736);
  await page.waitForTimeout(600);
  assert(!(await catalog()).some((item) => item.reference.key === "review-added"));
  await shot("14-refresh-removed");
  for (let cycle = 0; cycle < 4; cycle++) {
    await search(cycle % 2 ? "scene2" : "sample");
    await page.mouse.move(80, 810);
    await page.mouse.click(1296, 736);
    await page.setViewportSize({ width: 1200 + cycle * 20, height: 900 });
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  await page.waitForTimeout(600);
  await search("Compact harbor circuit.");
  await saw("Harbor Loop");
  await saw("24m · cell 2m · seed 91");
  assert.deepEqual(errors, [], "Browser errors");
  observations.result = "PASS";
  observations.checks = ["default ground", "agent-only catalog with duplicate/malformed diagnostics", "two agent types at asset scale", "agent drag ghost and placement", "bridge placement above water", "overlap, water, and steep-surface rejection", "instance selection, transform, duplicate and delete", "scene warning count and successful population cleanup", "case-insensitive search and no matches", "selection preserved through filtering/refresh", "named confirmation, cancel/Escape/backdrop", "unchanged reference no-op", "sample and scene2 loading", "stale content rejected without replacement", "invalid package disabled", "empty geometry preserves previous scene", "groundless geometry without fallback", "orbit/zoom/reset and narrow layout", "root package and source routes", "catalog additions/removals", "rapid hover/refresh/resize"];
  observations.browser = await browser.version();
  observations.rendering = "headless Chromium / SwiftShader; functional evidence only, no FPS claim";
  observations.manifestRequests = manifestRequests;
  observations.browserErrors = errors;
  await writeFile(join(output, "observations.json"), JSON.stringify(observations, null, 2) + "\n");
  console.log(JSON.stringify(observations, null, 2));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser?.close();
  server?.httpServer.closeAllConnections();
  if (server) await new Promise<void>((resolve, reject) => server!.httpServer.close((error) => error ? reject(error) : resolve()));
  await rm(temporary, { recursive: true, force: true });
}
