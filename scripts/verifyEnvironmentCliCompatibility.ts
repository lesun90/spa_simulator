import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExportCli } from "./exportEnvironmentCli";
import { validateEnvironmentPackage } from "../src/environment/packageValidator";

// Integration verification: real catalog, solver, geometry compiler and CLI files.
const evidencePath = "docs/superpowers/verification/2026-09-13-lean-modular/pre-step-7-cli.json";
const directory = await mkdtemp(join(tmpdir(), "lean-modular-cli-"));
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const observations: Record<string, unknown> = {};
try {
  for (const seams of [false, true]) {
    const output = join(directory, seams ? "seams" : "plain");
    const args = ["--size", "10", "--cell-size", "3", "--seed", "13", "--chunk-size", "5", "--output", output];
    if (seams) args.push("--remove-seam-faces");
    const log: string[] = [];
    const originalLog = console.log;
    try {
      console.log = (...values: unknown[]) => log.push(values.join(" "));
      await runExportCli(args);
    } finally { console.log = originalLog; }
    const manifestBytes = await readFile(join(output, "environment.json"));
    const glb = await readFile(join(output, "environment.glb"));
    const validation = validateEnvironmentPackage(JSON.parse(manifestBytes.toString()), glb);
    assert.equal(validation.valid, true, JSON.stringify(validation));
    let overwriteDiagnostic = "";
    try { await runExportCli(args); }
    catch (error) { overwriteDiagnostic = (error as Error).message; }
    assert.equal(overwriteDiagnostic, "Output directory already contains an environment package; pass --force to replace it.");
    assert.deepEqual(await readFile(join(output, "environment.json")), manifestBytes);
    assert.deepEqual(await readFile(join(output, "environment.glb")), glb);
    await runExportCli([...args, "--force"]);
    assert.deepEqual(await readFile(join(output, "environment.json")), manifestBytes);
    assert.deepEqual(await readFile(join(output, "environment.glb")), glb);
    observations[seams ? "seams" : "plain"] = {
      manifestSha256: sha256(manifestBytes), glbSha256: sha256(glb), glbBytes: glb.length,
      output: log.map((line) => line.replace(/elapsedMs=\d+/g, "elapsedMs=<variable>")), overwriteDiagnostic
    };
  }
  let invalidDiagnostic = "";
  try { await runExportCli(["--size", "0", "--output", join(directory, "invalid")]); }
  catch (error) { invalidDiagnostic = (error as Error).message; }
  assert.equal(invalidDiagnostic, "--width must be an integer from 1 through 100");
  observations.invalidDiagnostic = invalidDiagnostic;
  if (process.argv.includes("--capture")) await writeFile(evidencePath, JSON.stringify(observations, null, 2) + "\n");
  else assert.deepEqual(observations, JSON.parse(await readFile(evidencePath, "utf8")));
  console.log(JSON.stringify(observations, null, 2));
  console.log("CLI compatibility passed: exact package bytes, seams, overwrite protection, forced replacement and diagnostics.");
} finally { await rm(directory, { recursive: true, force: true }); }
