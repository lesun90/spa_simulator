import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { discoverAssetCatalog } from "../server/assetCatalog";
import { captureCompatibility, type CompatibilityCase } from "./wfcCompatibilityCapture";
import type { AssetCatalogEntry } from "../src/editor-core/assets";

const directory = "docs/superpowers/baselines/2026-09-13-lean-modular";
const capture = process.argv.includes("--capture");
const sourceCommit = process.env.WFC_BASELINE_COMMIT;
if (capture && !sourceCommit?.match(/^[a-f0-9]{40}$/)) throw new Error("Capture requires WFC_BASELINE_COMMIT (git rev-parse HEAD on the host).");
const inputsPath = `${directory}/inputs.json.gz`;
const outputsPath = `${directory}/outputs.json.gz`;
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const canonical = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const cases: CompatibilityCase[] = [
  { id: "roads-10-seed13", catalog: "roads", request: { width: 10, depth: 10, seed: 13 } },
  { id: "roads-16-seed17", catalog: "roads", request: { width: 16, depth: 16, seed: 17, tileWidth: 1, tileDepth: 1 } },
  { id: "roads-24-seed3", catalog: "roads", request: { width: 24, depth: 24, seed: 3, maxBacktracks: 18432 } },
  { id: "plain-weighted", catalog: "plain", request: { width: 4, depth: 3, seed: 42, tileWidth: 2, tileDepth: 5 } },
  { id: "plain-policy", catalog: "plain", request: { width: 3, depth: 2, seed: 19, policies: [{ type: "cell-variants", id: "pinned", column: 0, row: 0, variantIds: ["plain.b@r90"] }] } },
  { id: "plain-pre-aborted", catalog: "plain", request: { width: 2, depth: 2, seed: 7 }, preAborted: true },
  { id: "empty", catalog: "empty", request: { width: 2, depth: 2, seed: 1 } },
  { id: "invalid-size", catalog: "plain", request: { width: 0, depth: 2, seed: 1 } }
];
const plain: AssetCatalogEntry[] = ["a", "b"].map((id, index) => ({
  id: `plain.${id}`, label: id, category: "plain", source: "shared", implementation: "placeholder",
  wfc: { height: 0, defaultWeight: index + 1, diagnostics: [], variants: [{ variantId: `plain.${id}@r${index * 90}`, rotationDegrees: index * 90,
    sockets: { north: "plain", east: "plain", south: "plain", west: "plain", top: "", bottom: "" } }] }
}));
const inputs: { assets: AssetCatalogEntry[]; cases: CompatibilityCase[] } = capture
  ? { assets: [...(await discoverAssetCatalog("assets")).filter((asset) => asset.category === "3d-road-tiles"), ...plain], cases }
  : JSON.parse(gunzipSync(await readFile(inputsPath)).toString());
console.log(`${capture ? "Capturing" : "Comparing"} ${inputs.cases.length} cases: in-process execution`);
const inProcess = await captureCompatibility(inputs.assets, inputs.cases);
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 5197, strictPort: true } });
await server.listen();
let browser;
let worker: Awaited<ReturnType<typeof captureCompatibility>>;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.goto("http://127.0.0.1:5197/@vite/client");
  console.log("Running the same inputs through native browser Workers");
  // Keep the browser import out of vite-node's SSR transform of this orchestration script.
  worker = await page.evaluate(`(async (input) => {
    const { captureCompatibility } = await import("/scripts/wfcCompatibilityCapture.ts");
    return captureCompatibility(input.assets, input.cases);
  })(${JSON.stringify(inputs)})`);
} finally {
  await browser?.close();
  await server.close();
}
const outputs = JSON.parse(JSON.stringify({ inProcess, worker }));
if (capture) {
  await mkdir(directory, { recursive: true });
  // Never replace an accepted baseline accidentally. New captures require a deliberate new location.
  const inputData = gzipSync(JSON.stringify(inputs));
  const outputData = gzipSync(JSON.stringify(outputs));
  await writeFile(inputsPath, inputData, { flag: "wx" });
  await writeFile(outputsPath, outputData, { flag: "wx" });
  await writeFile(`${directory}/manifest.json`, JSON.stringify({
    sourceCommit,
    node: process.version, cases: inputs.cases.map(({ id }) => id),
    inputsSha256: sha256(inputData), outputsSha256: sha256(outputData),
    results: inProcess.map((entry, index) => ({ id: entry.id, inProcess: entry.result.status,
      worker: worker[index].result.status, inProcessProgress: entry.progress.length, workerProgress: worker[index].progress.length }))
  }, null, 2) + "\n", { flag: "wx" });
  console.log(`Saved immutable baseline to ${directory}`);
} else {
  const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8"));
  if (sha256(await readFile(inputsPath)) !== manifest.inputsSha256 || sha256(await readFile(outputsPath)) !== manifest.outputsSha256) {
    throw new Error("Baseline artifact checksum mismatch");
  }
  const expected = JSON.parse(gunzipSync(await readFile(outputsPath)).toString());
  if (!isDeepStrictEqual(expected, outputs)) {
    const actualPath = "/tmp/lean-modular-compatibility-actual.json.gz";
    await writeFile(actualPath, gzipSync(JSON.stringify(outputs)));
    for (const adapter of ["inProcess", "worker"] as const) {
      for (let index = 0; index < outputs[adapter].length; index++) {
        for (const field of Object.keys(outputs[adapter][index])) {
          if (canonical(expected[adapter][index][field]) !== canonical(outputs[adapter][index][field])) console.error(`Drift: ${adapter}/${inputs.cases[index].id}/${field}`);
        }
      }
    }
    throw new Error(`Compatibility drift; actual output: ${actualPath}`);
  }
  console.log(`PASS: ${inputs.cases.length} frozen cases match for both adapters, including palette, plans, ordered cells, transforms, provenance, diagnostics and progress.`);
}
