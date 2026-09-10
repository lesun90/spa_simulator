import { expect, test, vi } from "vitest";
import { createPlanarPalette } from "../src/wfc/planarWfc";
import { solvePlanarWfcInWorker } from "../src/wfc/sceneLayout";

const palette = createPlanarPalette("test", 1, 1, [
  {
    id: "tile",
    assetId: "tiles.tile",
    rotationDegrees: 0,
    sockets: { north: "road", east: "road", south: "road", west: "road", top: "flat", bottom: "flat" },
    weight: 1
  }
]);

test("solves in a worker and reports the solve workload", async () => {
  const onProgress = vi.fn();
  let terminateCount = 0;
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: vi.fn(),
    terminate: () => terminateCount++
  };
  worker.postMessage.mockImplementation(() => {
    worker.onmessage?.({ data: { type: "result", result: { status: "solved", seed: 7, cells: [], decisions: 0, backtracks: 0 } } } as MessageEvent);
  });

  const result = await solvePlanarWfcInWorker(palette, { width: 2, depth: 3, seed: 7 }, { onProgress, workerFactory: () => worker });

  expect(onProgress).toHaveBeenCalledWith({ status: "solving", cells: 6, variants: 1, decisions: 0, backtracks: 0, collapsedCells: 0, objects: [] });
  expect(result.status).toBe("solved");
  expect(terminateCount).toBe(1);
});
