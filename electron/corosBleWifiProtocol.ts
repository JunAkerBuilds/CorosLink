import type { CorosWifiMapTask } from "./corosWifiMapTypes";

export function decodeWifiMapTasks(payload: Buffer): CorosWifiMapTask[] {
  if (payload.length < 2 || payload[0] !== 1 || payload[1]! > 100 || payload.length !== 2 + payload[1]! * 39) {
    throw new Error("The watch returned an unsupported map-task response.");
  }
  return Array.from({ length: payload[1]! }, (_, index) => {
    const row = payload.subarray(2 + index * 39, 2 + (index + 1) * 39);
    const id = row.subarray(1, 9).toString("ascii");
    if (!/^[a-zA-Z0-9_-]{8}$/.test(id)) throw new Error("The watch returned an invalid map-task identifier.");
    const downloaded = row.readBigUInt64LE(10), total = row.readBigUInt64LE(18);
    if (downloaded > BigInt(Number.MAX_SAFE_INTEGER) || total > BigInt(Number.MAX_SAFE_INTEGER) || downloaded > total) {
      throw new Error("The watch returned invalid map-download sizes.");
    }
    const status = row[0]!, error = row[33]!;
    return { id, statusCode: status, downloadedBytes: Number(downloaded), totalBytes: Number(total), errorCode: error,
      state: error !== 0 ? "failed" : status === 3 && downloaded === total ? "complete" : status === 2 ? "queued" : status === 0 ? "downloading" : "unknown" };
  });
}

export function encodeWifiMapStart(id: string): Buffer {
  if (!/^[a-zA-Z0-9_-]{8}$/.test(id)) throw new Error("The COROS map service returned an invalid map identifier.");
  return Buffer.concat([Buffer.from([0x0a]), Buffer.from(id, "ascii"), Buffer.from([0, 0xff, 0xff])]);
}

/**
 * Removes a download the watch holds (opcode B6, subcommand 5, 3.2008.0 firmware): the
 * task manager deletes the task, whether it waits for Wi-Fi or is part way through.
 */
export function encodeWifiTaskRemove(id: string): Buffer {
  // The firmware reads an empty ID or eight 0xFF bytes as "every task": only a real ID gets through.
  if (!/^[a-zA-Z0-9_-]{8}$/.test(id)) throw new Error("Choose a download from the watch's list.");
  return Buffer.concat([Buffer.from([5]), Buffer.from(id, "ascii")]);
}

export function requireWifiTaskRemoved(payload: Buffer): void {
  if (payload.length === 1 && payload[0] === 1) return;
  // 0x1A: the watch refuses while its USB cable is in (the readiness check's bit 2).
  if (payload[0] === 0x1a) throw new Error("Unplug the watch's USB cable, then cancel the download again.");
  throw new Error(payload.length ? `The watch couldn't cancel the download (code ${payload[0]}).` : "The watch couldn't cancel the download.");
}

export function requireWifiDownloadReady(payload: Buffer): void {
  if (![5, 17].includes(payload.length) || payload[0] !== 1) throw new Error("The watch could not check map-download readiness.");
  const flags = payload.readUInt32LE(1);
  if (!flags) return;
  const messages = ["Charge the watch before downloading maps.", "Stop music playback on the watch.",
    "Disconnect the watch's USB cable.", "Finish the current activity on the watch.", "Charge the watch before downloading maps.",
    "Exit navigation on the watch.", "Finish the call on the watch.", "Wait for the watch to finish switching maps.", "Return to the watch face."];
  const bit = messages.findIndex((_, bit) => flags & (1 << bit));
  throw new Error(bit >= 0 ? messages[bit]! : "The watch is busy. Return to the watch face and try again.");
}
