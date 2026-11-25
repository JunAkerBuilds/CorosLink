/** Number and time formatting. Athlete data keeps full precision: nothing here rounds away hundredths. */

/** Seconds as m:ss or h:mm:ss, with `decimals` fractional digits kept (5:08.31). */
export function clock(seconds: number, decimals = 0): string {
  const neg = seconds < 0;
  const scale = 10 ** decimals;
  let total = Math.round(Math.abs(seconds) * scale);
  const frac = total % scale;
  total = (total - frac) / scale;
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const tail = decimals ? `.${String(frac).padStart(decimals, "0")}` : "";
  const body = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return `${neg ? "−" : ""}${body}${tail}`;
}

/** Pace in seconds per km as m:ss /km. */
export function pace(secPerKm: number, decimals = 0): string {
  return `${clock(secPerKm, decimals)} /km`;
}

export function km(metres: number, decimals = 2): string {
  // Rounded on whole metres, so 24,650 m is 24.7 km to one place (toFixed alone gives 24.6: 24.65 isn't exact in binary).
  const step = 10 ** Math.max(0, 3 - decimals);
  return `${(decimals <= 3 ? (Math.round(metres / step) * step) / 1000 : metres / 1000).toFixed(decimals)} km`;
}

/** A signed number with a real minus sign: +4, −7, 0. */
export function signed(value: number, decimals = 0): string {
  const abs = Math.abs(value).toFixed(decimals);
  return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : abs;
}

export function thousands(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** Local calendar day as YYYY-MM-DD (never via toISOString, which shifts across time zones). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
