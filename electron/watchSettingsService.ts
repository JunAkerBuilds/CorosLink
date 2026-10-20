import { getSetting, setSetting } from "./database";
import type { WatchModelId } from "./watchModels";
import { applySettingEdits, decodeExtSwitches, decodeSwitches, decodeSwitchWord, extSwitchFieldsFor, switchFieldsFor, type ExtSwitchKey, type ExtSwitches, type SwitchKey, type WatchSwitches } from "./corosWatchSettings";

/**
 * The watch's system switches as last read on connecting, changes made from
 * CorosLink (updateWatchSettings), and what changed between reads: changing one setting on the watch and
 * reconnecting shows exactly which field it is, which confirms a meaning the
 * watch doesn't label.
 */

const SWITCHES_SETTING = "watch.systemSwitches";
const MAX_CHANGES = 40;

export interface WatchSettingChange { at: string; field: string; extended: boolean; from: number; to: number }

export interface WatchSettingsSummary {
  readAt: string;
  /** The watch the settings were read from, when CorosLink recognised it; Watch settings is locked for a model it hasn't checked. */
  model?: WatchModelId;
  raw: number;
  values: WatchSwitches;
  /** The extended switches (type 31), when the watch sent them: only the fields the model uses. */
  extRaw?: string;
  ext?: ExtSwitches;
  /** Newest first. */
  changes: WatchSettingChange[];
}

interface Stored { readAt: string; raw: number; extRaw?: string; model?: WatchModelId; changes: WatchSettingChange[] }

function stored(): Stored | undefined {
  try {
    const value = JSON.parse(getSetting(SWITCHES_SETTING) || "null") as Stored | null;
    return value && Number.isSafeInteger(value.raw) && Array.isArray(value.changes) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every field that differs between two reads, including bits no known field covers,
 * by the model's own fields (a field that doesn't apply to the model shows as its bits).
 */
function diffSwitches(before: Stored, raw: number, extRaw: string | undefined, at: string, model?: WatchModelId): WatchSettingChange[] {
  const changes: WatchSettingChange[] = [];
  const old = decodeSwitches(before.raw); const now = decodeSwitches(raw);
  for (const field of switchFieldsFor(model)) {
    const key = field.key as SwitchKey;
    if (old[key] !== now[key]) changes.push({ at, field: key, extended: false, from: old[key], to: now[key] });
  }
  if (before.extRaw && extRaw && before.extRaw !== extRaw) {
    const fields = extSwitchFieldsFor(model);
    const a = decodeExtSwitches(Buffer.from(before.extRaw, "hex"), model); const b = decodeExtSwitches(Buffer.from(extRaw, "hex"), model);
    for (const field of fields) {
      const key = field.key as ExtSwitchKey;
      if (a[key] !== b[key]) changes.push({ at, field: key, extended: true, from: a[key]!, to: b[key]! });
    }
    // Bits outside the known fields, by number, so nothing goes unnoticed.
    const known = fields.reduce((mask, field) => mask | ((1n << BigInt(field.width)) - 1n) << BigInt(field.bit), 0n);
    const x = Buffer.from(before.extRaw, "hex").readBigUInt64LE(0); const y = Buffer.from(extRaw, "hex").readBigUInt64LE(0);
    for (let bit = 0n; bit < 64n; bit++) {
      if ((known >> bit & 1n) === 0n && ((x ^ y) >> bit & 1n) === 1n) changes.push({ at, field: `bit${bit}`, extended: true, from: Number(x >> bit & 1n), to: Number(y >> bit & 1n) });
    }
  }
  return changes;
}

export function storeWatchSwitches(bytes: Buffer, ext?: Buffer, now = new Date(), model?: WatchModelId): void {
  const raw = decodeSwitchWord(bytes);
  if (ext) decodeExtSwitches(ext); // refuse to keep something that doesn't parse
  const extRaw = ext ? ext.subarray(0, 8).toString("hex") : undefined;
  // Another model's record says nothing about this one: no changes, no extended record carried over.
  const previous = stored();
  const before = previous?.model === model ? previous : undefined;
  // A read without the extended switches (its separate request failed) keeps the last ones read from this model.
  const keptExt = extRaw ?? before?.extRaw;
  const at = now.toISOString();
  const changes = [...(before ? diffSwitches(before, raw, keptExt, at, model) : []), ...(before?.changes ?? [])].slice(0, MAX_CHANGES);
  const record: Stored = { readAt: at, raw, ...(keptExt ? { extRaw: keptExt } : {}), ...(model ? { model } : {}), changes };
  setSetting(SWITCHES_SETTING, JSON.stringify(record));
}

export function getWatchSettings(): WatchSettingsSummary | undefined {
  const value = stored();
  if (!value) return undefined;
  try {
    return {
      readAt: value.readAt, raw: value.raw, values: decodeSwitches(value.raw), changes: value.changes, ...(value.model ? { model: value.model } : {}),
      ...(value.extRaw ? { extRaw: value.extRaw, ext: decodeExtSwitches(Buffer.from(value.extRaw, "hex"), value.model) } : {})
    };
  } catch {
    return undefined;
  }
}

/**
 * Changes settings on the connected watch: reads both records, changes only
 * the edited fields (those the connected model uses), writes the records back
 * and checks the watch kept every value. A value the watch didn't keep is
 * reported, never shown as saved.
 */
export async function updateWatchSettings(
  edits: unknown,
  link: {
    read(): Promise<{ word: Buffer; ext?: Buffer; model?: WatchModelId }>;
    write(word: Buffer, ext?: Buffer): Promise<{ word: Buffer; ext?: Buffer; model?: WatchModelId }>;
  }
): Promise<WatchSettingsSummary> {
  if (!edits || typeof edits !== "object" || Array.isArray(edits) || !Object.keys(edits).length) throw new Error("No settings to change.");
  const current = await link.read();
  const next = applySettingEdits(decodeSwitchWord(current.word), current.ext, edits as Record<string, unknown>, current.model);
  const word = Buffer.from(current.word);
  word.writeUInt32LE(next.word, 0);
  const after = await link.write(word, next.extChanged ? next.ext : undefined);
  const main = decodeSwitches(decodeSwitchWord(after.word));
  const ext = after.ext ? decodeExtSwitches(after.ext, current.model) : undefined;
  const missed = Object.entries(edits as Record<string, unknown>).filter(([key, value]) =>
    (key in main ? main[key as keyof WatchSwitches] : ext?.[key as ExtSwitchKey]) !== Number(value));
  if (missed.length) throw new Error(`The watch didn't keep ${missed.map(([key]) => key).join(", ")}. Reconnect and try again.`);
  return getWatchSettings()!;
}

