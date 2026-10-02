type Entry = { name: string; data: Buffer };
const MARKER_LINE = /^(\uFEFF?)\/\/ CorosLink device layout: pace-3-date-rects-v1\r?\n/;
const DATE_RECT = /^([\t ]*\[english_date_(month|day)_rect\][\t ]*=)([^\r\n]*)/gm;
const RECT_VALUE = /^\s*\{\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+(?:,[^{}\r\n]+)?\}\s*$/;

function exchangeDateRects(text: string): string {
  const matches = [...text.matchAll(DATE_RECT)];
  const months = matches.filter(match => match[2] === "month");
  const days = matches.filter(match => match[2] === "day");
  // Do not invent missing date fields or enable a blank/disabled field.
  if (months.length !== 1 || days.length !== 1 ||
      !RECT_VALUE.test(months[0]![3]!) || !RECT_VALUE.test(days[0]![3]!)) return text;
  return text.replace(DATE_RECT, (_line, prefix: string, part: string) =>
    prefix + (part === "month" ? days[0]![3]! : months[0]![3]!));
}

/** Restore authoring coordinates when previewing, editing or converting our exports. */
export function restoreWatchfaceDateLayout(text: string): string {
  if (!MARKER_LINE.test(text)) return text;
  const canonical = text.replace(MARKER_LINE, "$1");
  const bom = canonical.startsWith("\uFEFF") ? "\uFEFF" : "";
  return bom + exchangeDateRects(canonical.slice(bom.length));
}

/**
 * Preserve authored date positions for every watch. The former PACE 3-only
 * swap can counteract COROS's date ordering preference; do not infer that
 * preference from the watch model. Undo marked legacy exports on rebuild.
 */
export function finalizeWatchfaceDeviceLayout(entries: Entry[]): Entry[] {
  return entries.map(entry => {
    if (!/^watchface_\d+x\d+\/config\.txt$/i.test(entry.name)) return entry;
    const original = entry.data.toString("utf8");
    const text = restoreWatchfaceDateLayout(original);
    return text === original ? entry : { ...entry, data: Buffer.from(text, "utf8") };
  });
}
