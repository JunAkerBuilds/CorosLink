export interface WatchfaceExportEntry {
  name: string;
  data: Buffer;
}

/**
 * Browser previews can paint glyphs outside their rectangles; device renderers
 * may clip there. Fit exported, generated fonts without moving the text anchor.
 * Stock template fonts and unrelated rectangles are deliberately untouched.
 */
export function fitGeneratedWatchfaceFontRects(
  entries: WatchfaceExportEntry[]
): WatchfaceExportEntry[] {
  const fonts = new Map<string, { width: number; height: number }>();
  for (const entry of entries) {
    if (!/^watchface_\d+x\d+\/(?:studio\/[^/]+|cl_[^/]+)\/\d{2}\.png$/i.test(entry.name)) continue;
    if (entry.data.length < 24 || entry.data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") continue;
    const folder = entry.name.slice(0, entry.name.lastIndexOf("/"));
    const previous = fonts.get(folder);
    fonts.set(folder, {
      width: Math.max(previous?.width ?? 0, entry.data.readUInt32BE(16)),
      height: Math.max(previous?.height ?? 0, entry.data.readUInt32BE(20))
    });
  }
  return entries.map((entry) => {
    if (!/^watchface_\d+x\d+\/(?:AODconfig|config)\.txt$/i.test(entry.name)) return entry;
    const text = entry.data.toString("utf8");
    const config = Object.fromEntries(Array.from(text.matchAll(/^\[([^\]]+)\]=(.*)$/gm), (match) => [match[1]!, match[2]!.trim()]));
    const directory = entry.name.slice(0, entry.name.lastIndexOf("/"));
    const repaired = text.replace(/^(\[([^\]]+_rect)\]=)([^\r\n]*)/gm, (line, prefix: string, key: string, value: string) => {
      const fontKey = key.replace(/_(?:hour|minute|integer|decimal)_rect$/, "_rect").replace(/_rect$/, "_font");
      const folder = config[fontKey]?.replace(/\\/g, "/");
      const font = folder ? fonts.get(`${directory}/${folder}`) : undefined;
      const match = value.match(/^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)([^}]*)\}$/);
      if (!font || !match) return line;
      const [x0, y0, x1, y1] = match.slice(1, 5).map(Number) as [number, number, number, number];
      const suffix = match[5] ?? "";
      const digits = /(?:sunrise|sunset|exercise)_(?:hour|minute)_rect$/.test(key) || /_date_day_rect$/.test(key)
        ? 2
        : /^(?:control_)?(?:step|kcal|elevation)_rect$/.test(key) ? 5 : 1;
      const width = Math.max(x1 - x0, font.width * digits);
      const height = Math.max(y1 - y0, font.height);
      if (width === x1 - x0 && height === y1 - y0) return line;
      const left = /hcenter/.test(suffix) ? Math.floor((x0 + x1 - width) / 2)
        : /(?:,|\|)right(?:\||$)/.test(suffix) ? x1 - width : x0;
      const top = /vcenter/.test(suffix) ? Math.floor((y0 + y1 - height) / 2)
        : /(?:,|\|)bottom(?:\||$)/.test(suffix) ? y1 - height : y0;
      return `${prefix}{${left},${top},${left + width},${top + height}${suffix}}`;
    });
    return repaired === text ? entry : { ...entry, data: Buffer.from(repaired, "utf8") };
  });
}
