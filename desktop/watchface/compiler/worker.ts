import { parentPort } from "node:worker_threads";
import { compileWatchface, WatchfaceCompileError } from "./compiler";

export interface WorkerRequest { entries: Array<[string, Uint8Array]>; faceId: number; target?: import("../watchfaceTargets").WatchfaceBinTarget; fullColor?: boolean; smoothEdges?: boolean }
export type WorkerResponse = { bin: Uint8Array; warnings: string[] } | { error: string; face: boolean };

/** Runs the TypeScript compiler off the main thread. `face` marks errors in the face rather than in the compiler. */
parentPort?.on("message", (message: WorkerRequest) => {
  let response: WorkerResponse;
  try {
    response = compileWatchface(new Map(message.entries), { faceId: message.faceId, target: message.target, fullColor: message.fullColor, smoothEdges: message.smoothEdges });
  } catch (error) {
    response = { error: error instanceof Error ? error.message : "Could not compile the watch face.", face: error instanceof WatchfaceCompileError };
  }
  parentPort!.postMessage(response);
});
