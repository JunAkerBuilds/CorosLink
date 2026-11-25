/**
 * Count-up for big figures: given the text as it is written ("1,842 km", "4:46 /km", "1:42:31.05", "7h 42m"),
 * returns a function that writes the figure at progress p (0 to 1), keeping its format.
 * Returns null for text that should not animate: words, zero, and clock times such as 08:00.
 */
export function countUpFormat(text: string): ((p: number) => string) | null {
  const raw = text;
  const txt = raw.trim();
  if (!txt || txt.length > 14) return null;
  const lead = raw.slice(0, raw.indexOf(txt));
  const tail = raw.slice(raw.indexOf(txt) + txt.length);
  const wrap = (f: (p: number) => string) => (p: number) => (p >= 1 ? raw : lead + f(p) + tail);

  const num = /^([+−-]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s?(?:%|k|km|kg|bpm|spm|GB|ms|kcal|g|min|\/km|h|y)?)$/;
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(\.\d+)?(\s?\/km)?$/;
  const hm = /^(\d+)h (\d+)m$/;
  const hSpace = /^(\d+) h (\d{2})$/;
  const pad = (v: number) => (v < 10 ? "0" : "") + v;

  let m = txt.match(num);
  if (m) {
    const [, sign, whole, frac = "", unit] = m;
    const dec = frac ? frac.length - 1 : 0;
    const commas = whole.includes(",");
    const target = parseFloat(whole.replace(/,/g, "") + frac);
    if (target === 0) return null;
    return wrap((p) => {
      const v = target * p;
      const body = dec ? v.toFixed(dec) : String(Math.round(v));
      const [int, part] = body.split(".");
      const grouped = commas ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
      return sign + grouped + (part ? "." + part : "") + unit;
    });
  }
  m = txt.match(clock);
  // A leading zero means a time of day (08:00), not a duration.
  if (m && !/^0\d:/.test(txt)) {
    const [, a, b, c, frac = "", unit = ""] = m;
    const hasH = c != null;
    const digits = frac ? frac.length - 1 : 0;
    const scale = 10 ** digits;
    const total = (hasH ? +a * 3600 + +b * 60 + +c : +a * 60 + +b) * scale + (digits ? Math.round(parseFloat(frac) * scale) : 0);
    return wrap((p) => {
      const v = Math.round(total * p);
      const f = v % scale;
      const s = Math.floor(v / scale);
      let out = hasH ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
      if (digits) out += "." + String(f).padStart(digits, "0");
      return out + unit;
    });
  }
  m = txt.match(hm);
  if (m) {
    const total = +m[1] * 60 + +m[2];
    return wrap((p) => { const v = Math.round(total * p); return `${Math.floor(v / 60)}h ${v % 60}m`; });
  }
  m = txt.match(hSpace);
  if (m) {
    const total = +m[1] * 60 + +m[2];
    return wrap((p) => { const v = Math.round(total * p); return `${Math.floor(v / 60)} h ${pad(v % 60)}`; });
  }
  return null;
}

/** The canvas easing: cubic ease-out. */
export const easeOut = (p: number) => 1 - (1 - p) ** 3;
export const COUNT_DELAY_MS = 320;
export const COUNT_DURATION_MS = 1300;
