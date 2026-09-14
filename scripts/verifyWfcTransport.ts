/** Bounded integration verification of the execution boundary; no frozen fixtures are rewritten. */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { BrowserWorkerSolver, type WfcWorker } from "../src/wfc/browserWorkerSolver";
import { InProcessSolver } from "../src/wfc/inProcessSolver";
import { createPlanarPalette, solvePlanarWfc } from "../src/wfc/planarWfc";
import { WorkerCodec, validateSolveMessage, validateWorkerMessage } from "../src/wfc/workerCodec";
import { createWorldPlan } from "../src/wfc/worldPlanner";

const palette = createPlanarPalette("transport", 3, 3, ["b", "a"].map((id, index) => ({ id, assetId: id, rotationDegrees: 0, weight: index + 0.123456789123,
  sockets: { north: "x", east: "x", south: "x", west: "x", top: "", bottom: "" } })));
const unsorted = { ...palette, variants: [...palette.variants].reverse() };
const request = { width: 1, depth: 1, seed: 3, policies: [{ type: "cell-variants" as const, id: "pin", column: 0, row: 0, variantIds: ["a", "unknown"] }] };
const codec = new WorkerCodec(unsorted);
const encoded = codec.encode(request, {});
assert.deepEqual(encoded.request.policies, [{ ...request.policies[0], variantIds: ["00000000"] }]);
assert.equal(codec.cells([{ column: 0, row: 0, variantIndex: 0 }])[0].variant.id, "a");
assert.equal(encoded.compact.weights[0], palette.variants[0].weight);
for (const malformed of [null, {}, { ...encoded, compact: { ...encoded.compact, weights: new Float32Array(2) } },
  { ...encoded, request: { ...request, policies: [{ type: "bad", id: "bad" }] } },
  { ...encoded, worldPlan: {} }, { ...encoded, scenicRecipe: {} }]) assert.throws(() => validateSolveMessage(malformed));
for (const malformed of [null, {}, { type: "result", result: { status: "failed", seed: 1, reason: "bad", diagnostics: [] } },
  { type: "progress", checkpoint: "initial", decisions: 0, backtracks: 0, collapsedCells: 0, cells: [{ column: 0, row: 0, variantIndex: 2 }] },
  { type: "plan", plan: {} }]) assert.throws(() => validateWorkerMessage(malformed, 2, request));

class ControlledWorker implements WfcWorker {
  onmessage: WfcWorker["onmessage"] = null;
  onerror: WfcWorker["onerror"] = null;
  terminated = 0;
  posts = 0;
  constructor(private readonly failPost = false) {}
  postMessage() { this.posts++; if (this.failPost) throw new Error("post failed"); }
  terminate() { this.terminated++; }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
const cancellation = () => {
  let listener: (() => void) | undefined;
  let removed = 0;
  return { port: { subscribe(callback: () => void) { listener = callback; return () => { removed++; listener = undefined; }; } },
    abort() { listener?.(); }, get removed() { return removed; } };
};
for (const outcome of ["success", "domain-failure", "post-failure", "runtime-failure", "cancel", "malformed"] as const) {
  const worker = new ControlledWorker(outcome === "post-failure");
  const signal = cancellation();
  let creations = 0;
  const promise = new BrowserWorkerSolver(() => { creations++; return worker; }).solve(unsorted, request, { cancellation: signal.port });
  const rejection = ["post-failure", "runtime-failure", "cancel", "malformed"].includes(outcome) ? assert.rejects(promise, outcome === "cancel" ? { name: "AbortError", message: "WFC generation cancelled" } : undefined) : undefined;
  if (outcome === "success") worker.emit({ type: "result", result: { status: "solved", seed: 3, decisions: 0, backtracks: 0, cells: [{ column: 0, row: 0, variantIndex: 0 }] } });
  if (outcome === "domain-failure") worker.emit({ type: "result", result: { status: "failed", seed: 3, reason: "contradiction", diagnostics: ["expected"] } });
  if (outcome === "runtime-failure") worker.onerror?.({ message: "runtime failed" } as ErrorEvent);
  if (outcome === "cancel") signal.abort();
  if (outcome === "malformed") worker.emit({ type: "oops" });
  if (rejection) await rejection; else { const result = await promise; assert.equal(result.status, outcome === "success" ? "solved" : "failed"); }
  assert.equal(worker.terminated, 1, outcome); assert.equal(signal.removed, 1, outcome); assert.equal(creations, 1);
  assert.equal(worker.onmessage, null); assert.equal(worker.onerror, null); signal.abort(); assert.equal(worker.terminated, 1);
}
assert.throws(() => new BrowserWorkerSolver(() => { throw new Error("factory failed"); }).solve(palette, request), /factory failed/);
let progress = 0, subscriptions = 0;
assert.deepEqual(await new InProcessSolver().solve(palette, request, { onProgress() { progress++; }, cancellation: { subscribe() { subscriptions++; return () => {}; } } }), solvePlanarWfc(palette, request));
assert.equal(progress, 0); assert.equal(subscriptions, 0);
const worldPlan = createWorldPlan({ width: 10, depth: 10, seed: 13, roadCoverage: 0.5, scenic: true });
assert.throws(() => new InProcessSolver().solve(palette, request, { worldPlan }), /scenic|recipe|registered/i);

const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 5198, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5198/@vite/client");
  const result = await page.evaluate(`(async () => {
    const { BrowserWorkerSolver } = await import('/src/wfc/browserWorkerSolver.ts');
    const { createPlanarPalette } = await import('/src/wfc/planarWfc.ts');
    const palette = createPlanarPalette('plain', 3, 3, [{ id: 'x', assetId: 'x', weight: 1, rotationDegrees: 0, sockets: { north: 'x', east: 'x', south: 'x', west: 'x', top: '', bottom: '' } }]);
    const makeWorker = () => new Worker('/src/wfc/planarWfcWorker.ts', { type: 'module' });
    const malformed = await new Promise((resolve, reject) => {
      const worker = makeWorker();
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Malformed request timeout')); }, 10000);
      worker.onerror = (event) => { clearTimeout(timeout); worker.terminate(); resolve(event.message.includes('Invalid WFC worker message')); };
      worker.postMessage({ type: 'solve', compact: {} });
    });
    const adapter = new BrowserWorkerSolver(makeWorker);
    const preAborted = new AbortController(); preAborted.abort();
    const cancellation = { subscribe(cancel) { preAborted.signal.addEventListener('abort', cancel); return () => preAborted.signal.removeEventListener('abort', cancel); } };
    const solved = await adapter.solve(palette, { width: 1, depth: 1, seed: 3 }, { cancellation });
    const controller = new AbortController();
    const pending = adapter.solve(palette, { width: 100, depth: 100, seed: 3 }, { cancellation: { subscribe(cancel) { controller.signal.addEventListener('abort', cancel); return () => controller.signal.removeEventListener('abort', cancel); } } });
    controller.abort();
    let cancelled = false; try { await pending; } catch (error) { cancelled = error.name === 'AbortError'; }
    return { malformed, preAborted: solved.status, cancelled };
  })()`);
  assert.deepEqual(result, { malformed: true, preAborted: "solved", cancelled: true });
} finally { await browser?.close(); await server.close(); }
console.log("PASS: codec ordering/Float64/shapes; worker success/failure/setup/cancellation cleanup without retry; blocking in-process limitations; native Chromium malformed transport, pre-abort and active abort.");
