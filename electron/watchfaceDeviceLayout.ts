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

// The watch draws a 12-frame month table as one label only when its rect is a
// point (x0==x1, y0==y1) at the label's top-left, as official faces store it;
// any box makes it compose the month from digits (October = frames 1+0).
// Studio edits a box, so export collapses it and records the box for reopening.
const MONTH_LABEL_MARKER = /^(\uFEFF?)\/\/ CorosLink month labels: ([^\r\n]*)\r?\n/;
const MONTH_RECT = /^([\t ]*\[([a-z_]+)_date_month_rect\][\t ]*=)([^\r\n]*)/gm;
const RECT_PARTS = /^\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*((?:,[^{}\r\n]+)?)\}\s*$/;

function restoreMonthLabelRects(text: string): string {
  const marker = text.match(MONTH_LABEL_MARKER);
  if (!marker) return text;
  // Entries are `language=box@x,y`, the box Studio edits and the point exported.
  const boxes = new Map(marker[2]!.split(";").map(pair => pair.match(/^([a-z_]+)=(\{[^{}]*\})@(-?\d+),(-?\d+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match && RECT_PARTS.test(match[2]!)))
    .map(match => [match[1]!, { box: match[2]!, x: match[3]!, y: match[4]! }]));
  return text.replace(MONTH_LABEL_MARKER, "$1").replace(MONTH_RECT, (line, prefix: string, language: string, value: string) => {
    const point = value.match(RECT_PARTS);
    const saved = boxes.get(language);
    // Only undo our own collapse; a hand-edited rect stays as written.
    return saved && point && point[1] === saved.x && point[3] === saved.x &&
      point[2] === saved.y && point[4] === saved.y ? prefix + saved.box : line;
  });
}

/** Restore authoring coordinates when previewing, editing or converting our exports. */
export function restoreWatchfaceDateLayout(text: string): string {
  text = restoreMonthLabelRects(text);
  if (!MARKER_LINE.test(text)) return text;
  const canonical = text.replace(MARKER_LINE, "$1");
  const bom = canonical.startsWith("\uFEFF") ? "\uFEFF" : "";
  return bom + exchangeDateRects(canonical.slice(bom.length));
}

function pngFrames(entries: Entry[], directory: string, folder: string): Entry[] {
  const relative = folder.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!relative) return [];
  const prefix = `${directory}/${relative}/`.toLowerCase();
  return entries.filter(entry => {
    const name = entry.name.toLowerCase();
    return name.startsWith(prefix) && name.endsWith(".png") && !name.slice(prefix.length).includes("/");
  }).sort((left, right) => left.name.localeCompare(right.name, "en", { numeric: true }));
}

function collapseMonthLabelRects(text: string, entries: Entry[], directory: string): string {
  const fonts = new Map([...text.matchAll(/^[\t ]*\[([a-z_]+)_date_month_font\][\t ]*=([^\r\n]*)/gm)]
    .map(match => [match[1]!, match[2]!.trim()]));
  const boxes: string[] = [];
  const collapsed = text.replace(MONTH_RECT, (line, prefix: string, language: string, value: string) => {
    const rect = value.match(RECT_PARTS);
    const frames = pngFrames(entries, directory, fonts.get(language) ?? "");
    const first = frames[0]?.data;
    if (!rect || frames.length !== 12 || !first || first.length < 24 ||
        first.subarray(12, 16).toString("ascii") !== "IHDR") return line;
    const [x0, y0, x1, y1] = rect.slice(1, 5).map(Number) as [number, number, number, number];
    const width = first.readUInt32BE(16), height = first.readUInt32BE(20);
    // A two-glyph-wide box is a digit month (a stale 12-frame folder after
    // switching formats); leave it a box.
    if (x1 <= x0 || y1 <= y0 || x1 - x0 >= 2 * width) return line;
    // Keep the label where the editor drew it: centered in the box.
    const x = Math.max(0, Math.round((x0 + x1 - width) / 2));
    const y = Math.max(0, Math.round((y0 + y1 - height) / 2));
    boxes.push(`${language}=${value.trim()}@${x},${y}`);
    return `${prefix}{${x},${y},${x},${y}${rect[5]}}`;
  });
  if (!boxes.length) return text;
  const bom = collapsed.startsWith("\uFEFF") ? "\uFEFF" : "";
  const newline = collapsed.includes("\r\n") ? "\r\n" : "\n";
  return `${bom}// CorosLink month labels: ${boxes.join(";")}${newline}${collapsed.slice(bom.length)}`;
}

/**
 * Preserve authored date positions for every watch. The former PACE 3-only
 * swap can counteract COROS's date ordering preference; do not infer that
 * preference from the watch model. Undo marked legacy exports on rebuild.
 */
export function finalizeWatchfaceDeviceLayout(entries: Entry[]): Entry[] {
  return entries.map(entry => {
    const match = entry.name.match(/^(watchface_\d+x\d+)\/(?:AOD)?config\.txt$/i);
    if (!match) return entry;
    const original = entry.data.toString("utf8");
    const text = collapseMonthLabelRects(restoreWatchfaceDateLayout(original), entries, match[1]!);
    return text === original ? entry : { ...entry, data: Buffer.from(text, "utf8") };
  });
}
