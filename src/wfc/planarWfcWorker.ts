/// <reference lib="webworker" />
import { solvePlanarWfc } from "./planarWfc";
import { encodeCells, expandCompactPalette, restorePlan, validateSolveMessage, validateWorkerMessage, type WorkerMessage } from "./workerCodec";
import { prepareSolvePlan } from "./solvePlanning";

self.onmessage = ({ data }: MessageEvent<unknown>) => {
  validateSolveMessage(data);
  const palette = expandCompactPalette(data.compact, data.descriptors);
  const send = (message: WorkerMessage) => {
    validateWorkerMessage(message, data.compact.variantCount, data.request);
    self.postMessage(message);
  };
  let request = data.request;
  if (data.worldPlan) {
    try {
      const prepared = prepareSolvePlan(palette, request, data);
      request = prepared.request;
      send({ type: "plan", plan: restorePlan(prepared.plan!, data.descriptors!) });
    } catch (error) {
      send({ type: "result", result: { status: "failed", seed: request.seed, reason: "quality-policy", diagnostics: [error instanceof Error ? error.message : "Scenery planning failed"] } });
      return;
    }
  }
  const result = solvePlanarWfc(palette, request, {
    onProgress: (progress) => send({ type: "progress", ...progress, cells: encodeCells(progress.cells) })
  });
  send({ type: "result", result: result.status === "failed" ? result : { ...result, cells: encodeCells(result.cells) } });
};
export {};
