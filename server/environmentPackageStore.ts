import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeId } from "./sceneStore";

export function createEnvironmentPackageStore(sceneRoot: string) {
  const dirFor = (sceneId: string) => join(sceneRoot, `${safeId(sceneId)}.environment`);

  return {
    async read(sceneId: string): Promise<{ manifest: string; glb: Buffer } | null> {
      const dir = dirFor(sceneId);
      try {
        const [manifest, glb] = await Promise.all([readFile(join(dir, "environment.json"), "utf8"), readFile(join(dir, "environment.glb"))]);
        return { manifest, glb };
      } catch {
        return null;
      }
    },

    async replace(sceneId: string, manifestJson: string, glb: Buffer): Promise<void> {
      const dir = dirFor(sceneId);
      const stagingDir = `${dir}.staging-${randomUUID()}`;
      await mkdir(stagingDir, { recursive: true });
      await writeFile(join(stagingDir, "environment.json"), manifestJson, "utf8");
      await writeFile(join(stagingDir, "environment.glb"), glb);

      const previousDir = `${dir}.previous-${randomUUID()}`;
      const hadExisting = await rename(dir, previousDir).then(
        () => true,
        (error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      );
      await rename(stagingDir, dir);
      if (hadExisting) await rm(previousDir, { recursive: true, force: true });
    },

    async copy(fromSceneId: string, toSceneId: string): Promise<void> {
      const from = dirFor(fromSceneId);
      const existing = await this.read(fromSceneId);
      if (!existing) return;
      await cp(from, dirFor(toSceneId), { recursive: true });
    },

    async remove(sceneId: string): Promise<void> {
      await rm(dirFor(sceneId), { recursive: true, force: true });
    }
  };
}
