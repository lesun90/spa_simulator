import type { PlanarWfcPalette } from "./planarWfc";
import type { GenerateWfcLayoutRequest } from "./sceneLayoutTypes";
import type { PlanarSolver } from "./solverPort";
import { solveWithSceneProgress, type SceneSolveOptions } from "./sceneSolveProgress";
import { InProcessSolver } from "./inProcessSolver";
import { BrowserWorkerSolver, createWfcWorker, type WfcWorkerFactory } from "./browserWorkerSolver";
export type { WfcWorkerFactory } from "./browserWorkerSolver";
const inProcess = new InProcessSolver();
const browser = new BrowserWorkerSolver(createWfcWorker);
export function selectSolver(factory?: WfcWorkerFactory): PlanarSolver {
  return factory ? new BrowserWorkerSolver(factory) : typeof Worker === "undefined" ? inProcess : browser;
}
export function solvePlanarWfcInWorker(palette: PlanarWfcPalette, request: GenerateWfcLayoutRequest, options: SceneSolveOptions & { workerFactory?: WfcWorkerFactory } = {}) {
  return solveWithSceneProgress(selectSolver(options.workerFactory), palette, request, options);
}
