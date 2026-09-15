import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateScenarioRecord, type ScenarioRecord, type ScenarioSummary } from "../../src/scenario-studio/domain/scenarioRecord";

export class ScenarioStore {
  constructor(private readonly root: string) {}

  async list(): Promise<ScenarioSummary[]> {
    await this.ensureRoot();
    const files = (await readdir(this.root)).filter((file) => file.endsWith(".json"));
    const summaries = await Promise.all(files.map(async (file) => {
      const path = join(this.root, file);
      const expectedId = file.slice(0, -".json".length);
      const [record, info] = await Promise.all([this.read(path, expectedId), stat(path)]);
      return Object.freeze({ id: record.id, name: record.name, agentCount: record.agents.length, updatedAt: info.mtime.toISOString() });
    }));
    return summaries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async open(id: string): Promise<ScenarioRecord> {
    await this.ensureRoot();
    try { return await this.read(this.path(id), id); }
    catch (error) {
      if (isMissing(error)) throw new Error("Scenario not found.");
      throw error;
    }
  }

  async save(record: unknown): Promise<ScenarioRecord> {
    const valid = validateScenarioRecord(record);
    await this.ensureRoot();
    const finalPath = this.path(valid.id);
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(valid, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, finalPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
    return valid;
  }

  private async ensureRoot(): Promise<void> { await mkdir(this.root, { recursive: true }); }

  private path(id: string): string {
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new Error("Scenario ID contains unsupported characters.");
    return join(this.root, `${id}.json`);
  }

  private async read(path: string, expectedId: string): Promise<ScenarioRecord> {
    let source: string;
    try { source = await readFile(path, "utf8"); }
    catch (error) {
      if (isMissing(error)) throw error;
      throw new Error("Stored scenario could not be read.");
    }
    let value: unknown;
    try { value = JSON.parse(source); }
    catch { throw new Error("Stored scenario is not valid JSON."); }
    const record = validateScenarioRecord(value);
    if (record.id !== expectedId) throw new Error("Stored scenario identity does not match its filename.");
    return record;
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
