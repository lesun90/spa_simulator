import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createSceneStore } from "../server/sceneStore";

describe("scene store", () => {
  test("creates lists renames duplicates and deletes scene files", async () => {
    const root = await mkdtemp(join(tmpdir(), "steerlab-scenes-"));
    const store = createSceneStore(root);

    const created = await store.create("Downtown");
    await store.rename(created.id, "Midtown");
    const duplicated = await store.duplicate(created.id);
    const listed = await store.list();

    expect(listed.map((scene) => scene.name).sort()).toEqual(["Midtown", "Midtown Copy"]);
    expect(duplicated.id).not.toBe(created.id);

    await store.delete(created.id);
    expect(await store.list()).toMatchObject([{ id: duplicated.id, name: "Midtown Copy" }]);
  });
});
