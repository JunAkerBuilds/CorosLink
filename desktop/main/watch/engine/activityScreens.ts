// Developer mode's Activity screens (desktop/main/watch/activityScreens.ts): the activity's data pages, read (V3 0x9E)
// or written (0x9F) as raw control payloads. Only these two opcodes; the bytes are checked in the main process. The
// CorosKit helper's `activityScreens` command (the retired clink-watch helper's main.swift).
import { CorosError } from "./bytes";
import type { WatchSession } from "./session";

export const ACTIVITY_SCREENS_READ = 0x9e;
export const ACTIVITY_SCREENS_WRITE = 0x9f;

/** `activityScreens`: {op: "read" | "write", payload: hex, at most 1024 bytes} → {payload: hex}. */
export async function activityScreensCommand(session: WatchSession, request: Record<string, unknown>): Promise<{ payload: string }> {
  const { op, payload } = request;
  if (typeof op !== "string" || typeof payload !== "string" || payload.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(payload) || payload.length / 2 > 1024) {
    throw new CorosError("Which activity pages, read or written?");
  }
  const opcode = op === "read" ? ACTIVITY_SCREENS_READ : op === "write" ? ACTIVITY_SCREENS_WRITE : 0;
  if (opcode === 0) throw new CorosError("Activity pages are read or written.");
  const reply = await session.exclusively(() => session.link.exchange(opcode, Buffer.from(payload, "hex"), 244));
  return { payload: Buffer.from(reply).toString("hex") };
}
