import * as THREE from "three";
import { describe, expect, test } from "vitest";
import {
  hasTransformChanged,
  moveOnGround,
  rotateFromHorizontalDrag,
  rotateAroundGroundCenter,
  snapRotationToQuarterTurn,
  scaleFromGroundHandle,
  transformModeForPointerButton
} from "../src/features/world/objectTransform";
import { agentBoundsOverlap, createAgentDraft, scaledAgentCollision, validateAgentDraft } from "../src/scenario-studio/domain/agent";
import { AgentPopulation } from "../src/scenario-studio/domain/AgentPopulation";

const agentAsset = {
  id: "test.agent",
  key: "test-agent",
  label: "Test Agent",
  category: "test",
  modelUrl: "/test.glb",
  thumbnailUrl: null,
  modelSha256: "model",
  metadataSha256: "metadata",
  unitsPerMeter: 2,
  bounds: { min: { x: -1, y: 0, z: -2 }, max: { x: 1, y: 2, z: 2 } },
  collision: { center: { x: 0.25, y: 1, z: -0.5 }, halfExtents: { x: 1, y: 2, z: 3 } }
};

describe("object transform gestures", () => {
  test("moves an object by the horizontal ground-plane pointer delta", () => {
    expect(
      moveOnGround(
        { x: 2, y: 0, z: 3 },
        { x: 10, y: 0, z: 20 },
        { x: 12.5, y: 0, z: 18 }
      )
    ).toEqual({ x: 4.5, y: 0, z: 1 });
  });

  test("scales uniformly from a dragged footprint handle and clamps tiny values", () => {
    expect(
      scaleFromGroundHandle(
        2,
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 }
      )
    ).toBe(4);

    expect(
      scaleFromGroundHandle(
        2,
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 0.01, y: 0, z: 0 }
      )
    ).toBe(0.05);
  });

  test("rotates opposite the ground-angle delta so right-drag follows the mouse direction", () => {
    expect(
      rotateAroundGroundCenter(
        Math.PI / 4,
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }
      )
    ).toBeCloseTo(-Math.PI / 4);
  });

  test("rotates from horizontal mouse movement only", () => {
    expect(rotateFromHorizontalDrag(1, 100, 140)).toBeCloseTo(1.4);
    expect(rotateFromHorizontalDrag(1, 100, 60)).toBeCloseTo(0.6);
    expect(rotateFromHorizontalDrag(1, 100, 100)).toBe(1);
  });

  test("snaps rotation to the nearest quarter turn", () => {
    expect(snapRotationToQuarterTurn(THREE.MathUtils.degToRad(40))).toBeCloseTo(0);
    expect(snapRotationToQuarterTurn(THREE.MathUtils.degToRad(50))).toBeCloseTo(Math.PI / 2);
    expect(snapRotationToQuarterTurn(THREE.MathUtils.degToRad(181))).toBeCloseTo(Math.PI);
  });

  test("ignores no-op transform previews so clicks do not create history entries", () => {
    const start = {
      position: { x: 2, y: 0, z: 3 },
      rotationY: 1,
      scale: 1.5
    };

    expect(hasTransformChanged(start, { position: { x: 2, y: 0, z: 3 }, rotationY: 1, scale: 1.5 })).toBe(false);
    expect(hasTransformChanged(start, { position: { x: 2.2, y: 0, z: 3 }, rotationY: 1, scale: 1.5 })).toBe(true);
    expect(hasTransformChanged(start, { position: { x: 2, y: 2.75, z: 3 }, rotationY: 1, scale: 1.5 })).toBe(true);
  });

  test("maps pointer buttons to direct object transform modes", () => {
    expect(transformModeForPointerButton(0)).toBe("move");
    expect(transformModeForPointerButton(2)).toBe("rotate");
    expect(transformModeForPointerButton(1)).toBe(null);
  });
});

describe("agent instance scaling", () => {
  test("starts agents at asset scale and scales their physics collision proportionally", () => {
    const draft = createAgentDraft(agentAsset);
    expect(draft.scale).toBe(1);
    expect(scaledAgentCollision({ ...draft, scale: 1.5 })).toEqual({
      center: { x: 0.375, y: 1.5, z: -0.75 },
      halfExtents: { x: 1.5, y: 3, z: 4.5 }
    });
  });

  test("rejects zero or negative agent scale", () => {
    const draft = createAgentDraft(agentAsset);
    expect(() => validateAgentDraft({ ...draft, scale: 0 })).toThrow("Agent scale must be positive.");
    expect(() => validateAgentDraft({ ...draft, scale: -1 })).toThrow("Agent scale must be positive.");
  });

  test("uses scaled authored bounds to reject overlapping agents without physics bodies", () => {
    const first = { ...createAgentDraft(agentAsset), scale: 2 };
    const overlapping = { ...createAgentDraft(agentAsset), pose: { position: { x: 3.2, y: 0, z: 0 }, headingRadians: 0 } };
    const separate = { ...overlapping, pose: { ...overlapping.pose, position: { x: 3.3, y: 0, z: 0 } } };
    expect(agentBoundsOverlap(first, overlapping)).toBe(true);
    expect(agentBoundsOverlap(first, separate)).toBe(false);
  });

  test("keeps rotated authored bounding boxes independent when their AABBs overlap", () => {
    const slenderAsset = { ...agentAsset, collision: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 3, y: 1, z: 0.5 } } };
    const first = { ...createAgentDraft(slenderAsset), pose: { position: { x: 0, y: 0, z: 0 }, headingRadians: Math.PI / 4 } };
    const second = { ...createAgentDraft(slenderAsset), pose: { position: { x: Math.SQRT1_2 * 1.2, y: 0, z: Math.SQRT1_2 * 1.2 }, headingRadians: Math.PI / 4 } };
    expect(agentBoundsOverlap(first, second)).toBe(false);
  });

  test("tracks direct dependents in an authored support stack", () => {
    const population = new AgentPopulation();
    const base = population.create(createAgentDraft(agentAsset));
    population.commit(base);
    const child = population.create({
      ...createAgentDraft(agentAsset),
      pose: {
        position: { x: 0, y: 4, z: 0 },
        headingRadians: 0,
        support: { kind: "agent", id: base.id }
      }
    });
    population.commit(child);

    expect(population.hasDependents(base.id)).toBe(true);
    expect(population.hasDependents(child.id)).toBe(false);
  });
});
