import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseExportArgs, writePackageFiles } from "../scripts/exportEnvironmentCli";

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
