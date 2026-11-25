// COROS's model code for a watch ("W332"), which map packages are made per. The name comes from the Bluetooth link
// (CorosKit's label, "PACE Pro") or the USB drive's label ("PACE Pro", "APEX 4 46mm"); the code is the face firmware
// type (desktop/watchface/watchfaceTargets.ts). PACE 4 reports R4 over Bluetooth, but its packages are W336.
import { WATCHFACE_TARGETS, watchfaceTargetHardware } from "../../../watchface/watchfaceTargets";

const BY_LENGTH = [...WATCHFACE_TARGETS].sort((a, b) => b.label.length - a.label.length);

/** "PACE Pro" → "W332"; "APEX 4 46mm" → "W541"; a code already ("W336") stays; unknown → undefined. */
export function modelCode(name: string | undefined): string | undefined {
  // APEX 4 42 mm is its own model (240 px, W542), not in the face targets.
  if (/APEX\s*4\s*42\s*MM/i.test(name ?? "")) return "W542";
  const n =(name ?? "").toUpperCase().replace(/^COROS\s+/, "").replace(/\s+\d{2}\s?MM\b/, "").replace(/\s+/g, " ").trim();
  if (!n) return undefined;
  const code = BY_LENGTH.map(watchfaceTargetHardware).find((c) => c === n);
  if (code) return code;
  if (n === "R4") return "W336";
  // Longest label first, so "PACE 4 PRO" isn't read as "PACE 4" and "VERTIX 2S" not as "VERTIX 2".
  const target = BY_LENGTH.find((t) => n === t.label.toUpperCase() || n.startsWith(`${t.label.toUpperCase()} `));
  return target ? watchfaceTargetHardware(target) : undefined;
}
