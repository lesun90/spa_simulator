import type { PlanarWfcPalette, PlanarWfcRequest, PlanarWfcResult } from "./planarWfc";
import type { PlanarSolver, SolverOptions } from "./solverPort";
import { WorkerCodec } from "./workerCodec";

export type WfcWorker = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};
export type WfcWorkerFactory = () => WfcWorker;
export const createWfcWorker: WfcWorkerFactory = () => new Worker(new URL("./planarWfcWorker.ts", import.meta.url), { type: "module" });

/** Adapter owns its codec cache; each invocation exclusively owns its worker and subscription. */
export class BrowserWorkerSolver implements PlanarSolver {
  private readonly codecs = new WeakMap<PlanarWfcPalette, WorkerCodec>();
  constructor(private readonly createWorker: WfcWorkerFactory) {}
  solve(palette: PlanarWfcPalette, request: PlanarWfcRequest, options: SolverOptions = {}): Promise<PlanarWfcResult> {
    const codec = this.codecs.get(palette) ?? new WorkerCodec(palette);
    this.codecs.set(palette, codec);
    const worker = this.createWorker(); // Construction failures remain synchronous; no retry.
    return new Promise((resolve, reject) => {
      let terminal = false;
      let unsubscribe: (() => void) | undefined;
      const finish = (error?: unknown, result?: PlanarWfcResult) => {
        if (terminal) return;
        terminal = true;
        worker.onmessage = null;
        worker.onerror = null;
        unsubscribe?.();
        worker.terminate();
        if (error !== undefined) reject(error); else resolve(result!);
      };
      try {
        unsubscribe = options.cancellation?.subscribe(() => finish(new DOMException("WFC generation cancelled", "AbortError")));
        worker.onmessage = ({ data }) => {
          if (terminal) return;
          try {
            const message = codec.decode(data, request);
            if (message.type === "plan") { options.onWorldPlan?.(message.plan); return; }
            if (message.type === "progress") { options.onProgress?.({ ...message, cells: codec.cells(message.cells) }); return; }
            finish(undefined, message.result.status === "failed" ? message.result : { ...message.result, cells: codec.cells(message.result.cells) });
          } catch (error) { finish(error); }
        };
        worker.onerror = (event) => finish(new Error(event.message || "WFC worker failed"));
        const message = codec.encode(request, options);
        worker.postMessage(message, [message.compact.socketIds.buffer, message.compact.weights.buffer, message.compact.compatibility.buffer]);
      } catch (error) { finish(error); }
    });
  }
}
