import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEnvironmentPackageStore } from "../server/environmentPackageStore";

describe("createEnvironmentPackageStore", () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("read returns null when no package has been written for the scene", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);

    expect(await store.read("scene-1")).toBeNull();
  });

  test("replace writes both files, and read returns them back", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);

    await store.replace("scene-1", '{"format":"steerlab-environment"}', Buffer.from([1, 2, 3]));
    const read = await store.read("scene-1");

    expect(read?.manifest).toBe('{"format":"steerlab-environment"}');
    expect(read?.glb).toEqual(Buffer.from([1, 2, 3]));
  });

  test("replace atomically swaps an existing package for a new one", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);
    await store.replace("scene-1", "old-manifest", Buffer.from("old"));

    await store.replace("scene-1", "new-manifest", Buffer.from("new"));

    const read = await store.read("scene-1");
    expect(read?.manifest).toBe("new-manifest");
    expect(read?.glb.toString()).toBe("new");
  });

  test("replace leaves no stray staging or previous directories behind", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);
    await store.replace("scene-1", "old-manifest", Buffer.from("old"));

    await store.replace("scene-1", "new-manifest", Buffer.from("new"));

    const entries = await readdir(root);
    expect(entries).toEqual(["scene-1.environment"]);
  });

  test("copy duplicates a scene's package under a new scene ID", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);
    await store.replace("scene-1", "manifest", Buffer.from("glb"));

    await store.copy("scene-1", "scene-2");

    expect(await store.read("scene-2")).toEqual({ manifest: "manifest", glb: Buffer.from("glb") });
    expect(await store.read("scene-1")).toEqual({ manifest: "manifest", glb: Buffer.from("glb") });
  });

  test("copy is a no-op when the source scene has no package", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);

    await store.copy("scene-1", "scene-2");

    expect(await store.read("scene-2")).toBeNull();
  });

  test("two concurrent replace() calls for the same scene never produce a torn or cross-mixed package", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);

    // Both calls race for the same final directory name. With unique staging/previous
    // directory names (randomUUID instead of Date.now()), the two calls can never corrupt
    // each other's in-flight files — whichever call's final rename loses the race simply
    // rejects (leaving its own now-orphaned staging directory, a separately deferred, known
    // minor finding), while the winner leaves a fully complete, self-consistent package.
    // What must never happen is a torn package (mixed manifest/GLB) or a total loss of any
    // package, which is what this test asserts.
    const results = await Promise.allSettled([
      store.replace("scene-1", "manifest-A", Buffer.from("glb-A")),
      store.replace("scene-1", "manifest-B", Buffer.from("glb-B"))
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);

    const read = await store.read("scene-1");
    expect(read).not.toBeNull();
    const manifestSuffix = read?.manifest.slice(-1);
    const glbSuffix = read?.glb.toString().slice(-1);
    expect(manifestSuffix).toBe(glbSuffix);
    expect(["A", "B"]).toContain(manifestSuffix);
  });

  test("remove deletes a scene's package directory", async () => {
    root = await mkdtemp(join(tmpdir(), "steerlab-env-store-"));
    const store = createEnvironmentPackageStore(root);
    await store.replace("scene-1", "manifest", Buffer.from("glb"));

    await store.remove("scene-1");

    expect(await store.read("scene-1")).toBeNull();
  });
});
