// Builds a final watch archive off the main process's thread (dist/main/watchfaceArchive.cjs): decoding and scaling
// the 800 px background for every layout takes longer than the app should wait on.
import { parentPort } from "node:worker_threads";
import { buildWatchfaceArchive, type WatchfaceBuildInput } from "./build";
import { getWatchfaceTarget } from "../watchfaceTargets";

/** `native`: build from the face's own layout for that watch, with its carrier's files (build.ts). */
export interface ArchiveWorkerRequest { starter: Uint8Array; input: WatchfaceBuildInput; native?: { model: string; carrier: { name: string; data: Uint8Array }[] } }
export type ArchiveWorkerResponse = { archive: Uint8Array } | { error: string };

parentPort?.on("message", (message: ArchiveWorkerRequest) => {
  let response: ArchiveWorkerResponse;
  try {
    const buffer = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const target = message.native ? getWatchfaceTarget(message.native.model) : undefined;
    if (message.native && !target) throw new Error("Choose a supported watch.");
    const native = message.native && target ? { target, carrier: message.native.carrier.map((e) => ({ name: e.name, data: buffer(e.data) })) } : undefined;
    response = { archive: buildWatchfaceArchive(buffer(message.starter), message.input, native) };
  } catch (error) {
    response = { error: error instanceof Error ? error.message : "Could not build the watch face." };
  }
  parentPort!.postMessage(response);
});
