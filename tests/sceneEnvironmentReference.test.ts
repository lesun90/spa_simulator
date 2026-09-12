import { describe, expect, test } from "vitest";
import { createScene, isSceneEnvironmentReference, normalizeScene } from "../src/editor-core/scene";

describe("Scene.environment", () => {
  test("createScene defaults environment to null", () => {
    expect(createScene("Test").environment).toBeNull();
  });

  test("normalizeScene backfills a missing environment field to null", () => {
    const legacy = { ...createScene("Test") } as { environment?: unknown };
    delete legacy.environment;

    expect(normalizeScene(legacy as never).environment).toBeNull();
  });

  test("normalizeScene keeps a valid environment reference and discards a malformed one", () => {
    const withReference = { ...createScene("Test"), environment: { sha256: "a".repeat(64), manifestVersion: 1 } };
    expect(normalizeScene(withReference).environment).toEqual({ sha256: "a".repeat(64), manifestVersion: 1 });

    const withMalformed = { ...createScene("Test"), environment: { sha256: 123 } };
    expect(normalizeScene(withMalformed as never).environment).toBeNull();
  });
});

describe("isSceneEnvironmentReference", () => {
  test("accepts a well-formed reference and rejects everything else", () => {
    expect(isSceneEnvironmentReference({ sha256: "a".repeat(64), manifestVersion: 1 })).toBe(true);
    expect(isSceneEnvironmentReference(null)).toBe(false);
    expect(isSceneEnvironmentReference({ sha256: "a".repeat(64) })).toBe(false);
    expect(isSceneEnvironmentReference({ manifestVersion: 1 })).toBe(false);
  });
});
