import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { validateEnvironmentPackage } from "../../src/environment/packageValidator";
import type { SceneChoice, SceneReference } from "../../src/scenario-studio/domain/scene";
import type { EnvironmentManifest } from "../../src/environment/types";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export class PublishedScenes {
  constructor(private readonly root: string) {}

  async list(): Promise<SceneChoice[]> {
    const root = await realpath(this.root);
    const folders: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      if (entries.some((entry) => entry.name === "environment.json" || entry.name === "environment.glb")) folders.push(dir);
      for (const entry of entries) if (entry.isDirectory()) await visit(join(dir, entry.name));
    };
    await visit(root);
    const choices = await Promise.all(folders.map(async (folder) => {
      const key = relative(root, folder).split(sep).join("/") || ".";
      const [manifestBytes, modelBytes] = await Promise.all([
        this.source(join(folder, "environment.json")).catch(() => null),
        this.source(join(folder, "environment.glb")).catch(() => null)
      ]);
      const diagnostics: string[] = [];
      let manifest: unknown;
      try { manifest = manifestBytes ? JSON.parse(manifestBytes.toString("utf8")) : null; }
      catch { diagnostics.push("environment.json is not valid JSON."); }
      if (!manifestBytes) diagnostics.push("environment.json is missing.");
      if (!modelBytes) diagnostics.push("environment.glb is missing.");
      if (manifestBytes && !diagnostics.length && (!manifest || typeof manifest !== "object" || Array.isArray(manifest))) {
        diagnostics.push("environment.json must contain a manifest object.");
      }
      if (manifest && modelBytes) {
        try { diagnostics.push(...validateEnvironmentPackage(manifest, modelBytes).diagnostics); }
        catch { diagnostics.push("environment.json contains malformed package data."); }
      }
      const candidate = manifest as Partial<EnvironmentManifest> | null;
      if (candidate?.model && (!Number.isFinite(candidate.model.unitsPerMeter) || candidate.model.unitsPerMeter <= 0)) {
        diagnostics.push("Manifest unitsPerMeter must be finite and positive.");
      }
      const reference: SceneReference = {
        key,
        modelSha256: modelBytes ? hash(modelBytes) : "",
        manifestSha256: manifestBytes ? hash(manifestBytes) : "",
        formatVersion: typeof candidate?.formatVersion === "number" ? candidate.formatVersion : 0
      };
      const thumbnail = join(folder, "thumbnail.png");
      const hasThumbnail = await this.file(thumbnail).then((path) => stat(path)).then((info) => info.isFile(), () => false);
      return {
        label: key === "." ? "Published environment" : basename(folder).replace(/[-_]/g, " "),
        reference,
        thumbnailUrl: hasThumbnail ? `/scenario-assets/scenes/${key === "." ? "" : `${key}/`}thumbnail.png` : null,
        available: diagnostics.length === 0,
        diagnostics
      } satisfies SceneChoice;
    }));
    return choices.sort((a, b) => a.label.localeCompare(b.label));
  }

  async load(reference: SceneReference): Promise<{ manifest: EnvironmentManifest; glb: Buffer }> {
    const directory = await this.directory(reference.key);
    const [manifestBytes, glb] = await Promise.all([
      this.source(join(directory, "environment.json")),
      this.source(join(directory, "environment.glb"))
    ]);
    if (hash(manifestBytes) !== reference.manifestSha256 || hash(glb) !== reference.modelSha256) {
      throw new Error("This scene changed. Refresh the catalog and select it again.");
    }
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as EnvironmentManifest;
    const validation = validateEnvironmentPackage(manifest, glb);
    if (!validation.valid) throw new Error(validation.diagnostics.join(" "));
    if (!Number.isFinite(manifest.model.unitsPerMeter) || manifest.model.unitsPerMeter <= 0) throw new Error("Invalid scene units.");
    if (manifest.formatVersion !== reference.formatVersion) throw new Error("Scene version changed. Refresh the catalog.");
    return { manifest, glb };
  }

  async source(relativePath: string): Promise<Buffer> {
    const path = await this.file(relativePath);
    return readFile(path);
  }

  private async directory(key: string): Promise<string> {
    if (!key || key === ".") return realpath(this.root);
    if (key.includes("\\") || key.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid scene key.");
    const path = await this.file(key);
    if (!(await stat(path)).isDirectory()) throw new Error("Scene package not found.");
    return path;
  }

  private async file(path: string): Promise<string> {
    const root = await realpath(this.root);
    const target = await realpath(resolve(root, path));
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Asset path is outside the published directory.");
    return target;
  }
}
