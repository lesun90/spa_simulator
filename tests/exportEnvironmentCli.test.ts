import { describe, expect, test } from "vitest";
import { parseExportArgs } from "../scripts/exportEnvironmentCli";

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
