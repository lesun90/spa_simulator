import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createScene, type Scene } from "../src/editor-core/scene";
import { validateSceneJson } from "../src/editor-core/validation";

export interface SceneSummary {
  id: string;
  name: string;
  objectCount: number;
  updatedAt: string;
}

export function createSceneStore(root: string) {
  const scenePath = (id: string) => join(root, `${safeId(id)}.json`);

  async function ensureRoot() {
    await mkdir(root, { recursive: true });
  }

  return {
    async list(): Promise<SceneSummary[]> {
      await ensureRoot();
      const files = (await readdir(root)).filter((file) => file.endsWith(".json"));
      const scenes = await Promise.all(
        files.map(async (file) => {
          const scene = JSON.parse(await readFile(join(root, file), "utf8")) as Scene;
          return {
            id: scene.id,
            name: scene.name,
            objectCount: scene.objects.length,
            updatedAt: new Date().toISOString()
          };
        })
      );
      return scenes.sort((a, b) => a.name.localeCompare(b.name));
    },
    async create(name: string): Promise<Scene> {
      const scene = createScene(name);
      await this.save(scene);
      return scene;
    },
    async open(id: string): Promise<Scene> {
      await ensureRoot();
      const scene = JSON.parse(await readFile(scenePath(id), "utf8")) as Scene;
      const result = validateSceneJson(scene);
      if (!result.valid) {
        throw new Error(result.diagnostics.join(" "));
      }
      return scene;
    },
    async save(scene: Scene): Promise<Scene> {
      await ensureRoot();
      const result = validateSceneJson(scene);
      if (!result.valid) {
        throw new Error(result.diagnostics.join(" "));
      }
      const finalPath = scenePath(scene.id);
      const tempPath = `${finalPath}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(scene, null, 2)}\n`, "utf8");
      await rename(tempPath, finalPath);
      return scene;
    },
    async rename(id: string, name: string): Promise<Scene> {
      const scene = await this.open(id);
      const renamed = { ...scene, name };
      await this.save(renamed);
      return renamed;
    },
    async duplicate(id: string): Promise<Scene> {
      const scene = await this.open(id);
      const copy = {
        ...scene,
        id: createScene(scene.name).id,
        name: `${scene.name} Copy`,
        objects: scene.objects.map((object) => ({ ...object, position: { ...object.position } }))
      };
      await this.save(copy);
      return copy;
    },
    async delete(id: string) {
      await ensureRoot();
      await rm(scenePath(id), { force: true });
    }
  };
}

function safeId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}
