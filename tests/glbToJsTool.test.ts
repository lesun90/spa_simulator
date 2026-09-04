import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const toolPath = resolve("tools", "glb-to-js.mjs");

describe("glb-to-js tool", () => {
  test("writes an importable JS module containing the GLB bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-glb-tool-"));
    const inputPath = join(root, "chair.glb");
    const outputPath = join(root, "chair.js");
    const glbBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00]);
    await writeFile(inputPath, glbBytes);

    await execFileAsync(process.execPath, [toolPath, inputPath, outputPath]);

    const moduleSource = await readFile(outputPath, "utf8");
    expect(moduleSource).toContain("model/gltf-binary");
    const generated = await importGeneratedModule(outputPath);
    expect(generated.filename).toBe("chair.glb");
    expect(generated.mimeType).toBe("model/gltf-binary");
    expect(Buffer.from(generated.base64, "base64")).toEqual(glbBytes);
    expect(generated.dataUrl).toBe(`data:model/gltf-binary;base64,${glbBytes.toString("base64")}`);
    expect(generated.default).toBe(generated.dataUrl);
  });

  test("defaults the output path to a same-name JS file", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-glb-tool-"));
    const inputPath = join(root, "table.glb");
    const expectedOutputPath = join(root, "table.js");
    await writeFile(inputPath, Buffer.from("glTF"));

    await execFileAsync(process.execPath, [toolPath, inputPath]);

    const generated = await importGeneratedModule(expectedOutputPath);
    expect(generated.filename).toBe("table.glb");
    expect(generated.base64).toBe(Buffer.from("glTF").toString("base64"));
  });

  test("rejects non-GLB input paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-glb-tool-"));
    const inputPath = join(root, "chair.txt");
    await writeFile(inputPath, "not a glb");

    await expect(execFileAsync(process.execPath, [toolPath, inputPath])).rejects.toMatchObject({
      stderr: expect.stringContaining("Input file must use the .glb extension.")
    });
  });
});

async function importGeneratedModule(modulePath: string) {
  const moduleUrl = pathToFileURL(modulePath).href;
  const script = `
    const generated = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(JSON.stringify({
      filename: generated.filename,
      mimeType: generated.mimeType,
      base64: generated.base64,
      dataUrl: generated.dataUrl,
      defaultExport: generated.default
    }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script]);
  const parsed = JSON.parse(stdout);
  return {
    ...parsed,
    default: parsed.defaultExport
  };
}
