import { describe, expect, test, vi } from "vitest";
import { PerformanceMonitor } from "../src/engine/PerformanceMonitor";

describe("PerformanceMonitor", () => {
  test("mounts a hideable stats panel", () => {
    const root = document.createElement("div");
    const stats = makeStats();

    const monitor = new PerformanceMonitor(root, () => stats);

    expect(root.contains(stats.dom)).toBe(true);
    expect(root.querySelector("button")?.textContent).toBe("Perf");
    expect(stats.dom.style.right).toBe("0px");
    expect(stats.dom.style.left).toBe("");
    expect(root.querySelector("button")?.style.right).toBe("0px");
    expect(root.querySelector("button")?.style.left).toBe("");
    expect(stats.dom.style.display).toBe("");

    root.querySelector("button")?.click();

    expect(stats.dom.style.display).toBe("none");

    root.querySelector("button")?.click();

    expect(stats.dom.style.display).toBe("");
    monitor.dispose();
  });

  test("wraps frames and disposes mounted elements", () => {
    const root = document.createElement("div");
    const stats = makeStats();
    const monitor = new PerformanceMonitor(root, () => stats);

    monitor.begin();
    monitor.end();
    monitor.dispose();

    expect(stats.begin).toHaveBeenCalledTimes(1);
    expect(stats.end).toHaveBeenCalledTimes(1);
    expect(root.contains(stats.dom)).toBe(false);
    expect(root.querySelector("button")).toBeNull();
  });
});

function makeStats() {
  return {
    dom: document.createElement("div"),
    showPanel: vi.fn(),
    begin: vi.fn(),
    end: vi.fn()
  };
}
