import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseExportArgs, runExportCli, writePackageFiles } from "../scripts/exportEnvironmentCli";

describe("parseExportArgs", () => {
  test("parses required arguments with documented defaults", () => {
    const options = parseExportArgs(["--width", "10", "--depth", "20", "--cell-size", "2", "--seed", "5", "--output", "./out"]);

    expect(options).toEqual({
      width: 10,
      depth: 20,
      cellSize: 2,
      seed: 5,
      output: "./out",
      chunkSize: 10,
      removeSeamFaces: false,
      assetRoot: "./assets",
      force: false
    });
  });

  test("--size is square shorthand for --width and --depth", () => {
    const options = parseExportArgs(["--size", "50", "--cell-size", "1", "--seed", "1", "--output", "./out"]);

    expect(options.width).toBe(50);
    expect(options.depth).toBe(50);
  });

  test("rejects mixing --size with --width or --depth", () => {
    expect(() => parseExportArgs(["--size", "50", "--width", "10", "--cell-size", "1", "--seed", "1", "--output", "./out"])).toThrow(
      "--size cannot be combined with --width or --depth"
    );
  });

  test("rejects width or depth outside 1-100", () => {
    expect(() => parseExportArgs(["--width", "101", "--depth", "10", "--cell-size", "1", "--seed", "1", "--output", "./out"])).toThrow(
      "--width must be an integer from 1 through 100"
    );
  });

  test("rejects a non-positive cell size", () => {
    expect(() => parseExportArgs(["--width", "10", "--depth", "10", "--cell-size", "0", "--seed", "1", "--output", "./out"])).toThrow(
      "--cell-size must be greater than zero"
    );
  });

  test("rejects a seed outside unsigned 32-bit range", () => {
    expect(() => parseExportArgs(["--width", "10", "--depth", "10", "--cell-size", "1", "--seed", "-1", "--output", "./out"])).toThrow(
      "--seed must be an unsigned 32-bit integer"
    );
  });

  test("rejects a negative chunk size", () => {
    expect(() =>
      parseExportArgs(["--width", "10", "--depth", "10", "--cell-size", "1", "--seed", "1", "--output", "./out", "--chunk-size", "-1"])
    ).toThrow("--chunk-size must be zero or a positive integer");
  });

  test("requires --output", () => {
    expect(() => parseExportArgs(["--width", "10", "--depth", "10", "--cell-size", "1", "--seed", "1"])).toThrow("--output is required");
  });

  test("sets --remove-seam-faces and --force as boolean flags", () => {
    const options = parseExportArgs([
      "--width", "10", "--depth", "10", "--cell-size", "1", "--seed", "1", "--output", "./out", "--remove-seam-faces", "--force"
    ]);

    expect(options.removeSeamFaces).toBe(true);
    expect(options.force).toBe(true);
  });

  test("rejects an unknown option", () => {
    expect(() => parseExportArgs(["--bogus"])).toThrow("Unknown option: --bogus");
  });
});

describe("writePackageFiles", () => {
  let outputDir: string;

  afterEach(async () => {
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
  });

  test("writes both fixed-name files into a fresh output directory, leaving no staging directory behind", async () => {
    outputDir = await mkdtemp(join(tmpdir(), "steerlab-export-"));
    await rm(outputDir, { recursive: true, force: true });

    await writePackageFiles(outputDir, '{"format":"steerlab-environment"}', new Uint8Array([1, 2, 3]), false);

    expect(await readFile(join(outputDir, "environment.json"), "utf8")).toBe('{"format":"steerlab-environment"}');
    expect(await readFile(join(outputDir, "environment.glb"))).toEqual(Buffer.from([1, 2, 3]));
    const remaining = await readdir(outputDir);
    expect(remaining.sort()).toEqual(["environment.glb", "environment.json"]);
  });

  test("rejects an existing package without --force, and leaves the existing files untouched", async () => {
    outputDir = await mkdtemp(join(tmpdir(), "steerlab-export-"));
    await writeFile(join(outputDir, "environment.json"), "old-manifest");

    await expect(writePackageFiles(outputDir, "new-manifest", new Uint8Array(), false)).rejects.toThrow(
      "Output directory already contains an environment package; pass --force to replace it."
    );
    expect(await readFile(join(outputDir, "environment.json"), "utf8")).toBe("old-manifest");
  });

  test("replaces an existing package when --force is set", async () => {
    outputDir = await mkdtemp(join(tmpdir(), "steerlab-export-"));
    await writeFile(join(outputDir, "environment.json"), "old-manifest");
    await writeFile(join(outputDir, "environment.glb"), "old-glb");

    await writePackageFiles(outputDir, "new-manifest", new Uint8Array([9]), true);

    expect(await readFile(join(outputDir, "environment.json"), "utf8")).toBe("new-manifest");
    expect(await readFile(join(outputDir, "environment.glb"))).toEqual(Buffer.from([9]));
  });

  test("does not remove unrelated files already in the output directory", async () => {
    outputDir = await mkdtemp(join(tmpdir(), "steerlab-export-"));
    await writeFile(join(outputDir, "notes.txt"), "keep me");

    await writePackageFiles(outputDir, "manifest", new Uint8Array(), false);

    expect(await readFile(join(outputDir, "notes.txt"), "utf8")).toBe("keep me");
  });
});

describe("runExportCli", () => {
  let outputDir: string;
  let assetRoot: string;

  afterEach(async () => {
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  test("generates a small scene and writes a valid package, printing metrics", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-cli-assets-"));
    await mkdir(join(assetRoot, "props", "cone"), { recursive: true });
    // A companion non-metadata file (here a thumbnail) is required for discoverAssetCatalog's
    // folder scan to pick up this directory at all, and a self-matching wfc.variants entry (all
    // four sides share one socket type) is required for paletteFromAssets to produce a
    // non-empty, solvable palette — without both, generateWfcScene always reports failure.
    await writeFile(join(assetRoot, "props", "cone", "cone.png"), "");
    await writeFile(
      join(assetRoot, "props", "cone", "asset.json"),
      JSON.stringify({
        id: "props.cone",
        label: "Cone",
        category: "props",
        wfc: {
          height: 1,
          diagnostics: [],
          variants: [
            {
              variantId: "props.cone@r0",
              rotationDegrees: 0,
              sockets: { north: "road", east: "road", south: "road", west: "road", top: "top", bottom: "bottom" }
            }
          ]
        }
      })
    );
    outputDir = join(await mkdtemp(join(tmpdir(), "steerlab-cli-out-")), "package");

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message: string) => logs.push(message);
    try {
      await runExportCli(["--width", "2", "--depth", "1", "--cell-size", "3", "--seed", "7", "--output", outputDir, "--asset-root", assetRoot]);
    } finally {
      console.log = originalLog;
    }

    const manifest = JSON.parse(await readFile(join(outputDir, "environment.json"), "utf8"));
    expect(manifest.format).toBe("steerlab-environment");
    expect(logs.some((line) => line.includes("seed 7"))).toBe(true);
  });

  test("throws a specific diagnostic and leaves no output when generation fails", async () => {
    assetRoot = await mkdtemp(join(tmpdir(), "steerlab-cli-assets-"));
    outputDir = join(await mkdtemp(join(tmpdir(), "steerlab-cli-out-")), "package");

    await expect(
      runExportCli(["--width", "2", "--depth", "1", "--cell-size", "3", "--seed", "7", "--output", outputDir, "--asset-root", assetRoot])
    ).rejects.toThrow();
    await expect(readFile(join(outputDir, "environment.json"), "utf8")).rejects.toThrow();
  });
});
