/**
 * COROS watch face `config.txt` / `AODconfig.txt` reading, matching the 4.9.9
 * parser's observed behavior (`GetTitleValue`, `GetPos`, `GetRect`).
 */

/** `[key]=value` lines; the first occurrence of a key wins and empty values count as absent. */
export function parseConfig(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*=(.*)$/);
    if (!match) continue;
    const key = match[1]!.trim(), value = match[2]!.trim();
    if (value && !values.has(key)) values.set(key, value);
  }
  return values;
}

/** `{x,y}`: COROS takes the first two runs of digits, so minus signs and decimals are not honored. */
export function parsePos(value: string): [number, number] {
  const digits = value.match(/\d+/g) ?? [];
  if (digits.length < 2) return [0, 0];
  return [Number(digits[0]) | 0, Number(digits[1]) | 0];
}

const H_LEFT = 1, H_CENTER = 2, H_RIGHT = 4, V_TOP = 8, V_CENTER = 0x10, V_BOTTOM = 0x20;

/** C `atoi`: optional whitespace and sign, then digits. */
function atoi(text: string): number {
  const match = text.match(/^\s*([+-]?\d+)/);
  return match ? Number(match[1]) | 0 : 0;
}

const int16 = (value: number) => (value << 16) >> 16;

/**
 * `{x0,y0,x1,y1,flags}` with int16 corners. A present flags field defaults
 * each axis to centered; a missing one stores no alignment at all.
 */
export function parseRect(value: string): { x0: number; y0: number; x1: number; y1: number; align: number } {
  const parts = value.replace(/^\s*\{|\}\s*$/g, "").split(",");
  const [x0, y0, x1, y1] = [0, 1, 2, 3].map(i => int16(atoi(parts[i] ?? "")));
  let align = 0;
  if (parts.length > 4) {
    let horizontal = H_CENTER, vertical = V_CENTER;
    for (const token of parts.slice(4).join(",").split("|").map(t => t.trim().toLowerCase())) {
      if (token === "left") horizontal = H_LEFT;
      else if (token === "hcenter") horizontal = H_CENTER;
      else if (token === "right") horizontal = H_RIGHT;
      else if (token === "top") vertical = V_TOP;
      else if (token === "vcenter") vertical = V_CENTER;
      else if (token === "bottom") vertical = V_BOTTOM;
    }
    align = horizontal | vertical;
  }
  return { x0: x0!, y0: y0!, x1: x1!, y1: y1!, align };
}

/** Integer keys (`atoi`), accepting the 0x prefix COROS colors use. */
export function parseNumber(value: string): number {
  return /^\s*0x/i.test(value) ? parseInt(value.trim().slice(2), 16) || 0 : atoi(value);
}

/** 0xRRGGBB packed to one rgb222 byte, each channel rounded to 0–3. */
export function rgb222(color: number): number {
  const channel = (shift: number) => Math.round(((color >> shift) & 0xff) * 3 / 255);
  return (channel(16) << 4) | (channel(8) << 2) | channel(0);
}

/** Config paths use backslashes; resolve them under the layout directory. */
export function configPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}
