/**
 * The Chinese calendar date a watch face shows. PACE Pro firmware 3.2008.0
 * (the face drawing code at 0x4553c0–0x455c88) turns the Gregorian date into
 * four numbers and draws pictures from three frame tables, only while the
 * watch language is Chinese (Simplified reads `chinese_lunar_*`, Traditional
 * `chinese_tw_lunar_*`):
 *
 *  - year, 23 frames: the heavenly stem (0–9), the earthly branch (10–21) and
 *    the character 年 (22), drawn side by side, each frame's width apart;
 *  - month, 13 frames: months 1–12 (0–11) and, for a leap month, the marker
 *    at frame 12 drawn first with the month half a frame width after it;
 *  - day, 30 frames: days 1–30.
 */
export interface LunarDate {
  /** Position in the 60-year cycle, 1–60 (1 is jiǎ-zǐ). */
  cycleYear: number;
  leap: boolean;
  /** 1–12. */
  month: number;
  /** 1–30. */
  day: number;
}

export type LunarField = "lunar_year" | "lunar_month" | "lunar_day";

const formatter = (() => {
  try { return new Intl.DateTimeFormat("en-u-ca-chinese-nu-latn", { year: "numeric", month: "numeric", day: "numeric" }); } catch { return null; }
})();

/** The Chinese calendar date of a local date; the sixth month of 2025 (a leap month) has `leap` set. */
export function lunarDateOf(date: Date): LunarDate {
  const parts = Object.fromEntries((formatter?.formatToParts(date) ?? []).map(part => [part.type, part.value]));
  const related = Number(parts.relatedYear), month = parseInt(parts.month ?? "", 10), day = Number(parts.day);
  if (!Number.isFinite(related) || !Number.isFinite(month) || !Number.isFinite(day)) return { cycleYear: 1, leap: false, month: 1, day: 1 };
  return { cycleYear: (((related - 4) % 60) + 60) % 60 + 1, leap: /bis/.test(parts.month ?? ""), month, day };
}

const STEMS = [..."甲乙丙丁戊己庚辛壬癸"], BRANCHES = [..."子丑寅卯辰巳午未申酉戌亥"];
const MONTHS = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
const DAY_UNITS = [..."一二三四五六七八九"];
const DAYS = [
  ...DAY_UNITS.map(unit => `初${unit}`), "初十",
  ...DAY_UNITS.map(unit => `十${unit}`), "二十",
  ...DAY_UNITS.map(unit => `廿${unit}`), "三十"
];

/** The text each frame of a lunar table starts with. */
export const LUNAR_FRAME_TEXTS: Readonly<Record<LunarField, readonly string[]>> = {
  lunar_year: [...STEMS, ...BRANCHES, "年"],
  lunar_month: [...MONTHS, "闰"],
  lunar_day: DAYS
};

/** How many frame widths a table's reading is laid out in: a year is three frames, a leap month one and a half. */
export const LUNAR_SPAN: Readonly<Record<LunarField, number>> = { lunar_year: 3, lunar_month: 1.5, lunar_day: 1 };

/** The frames the firmware draws for a date, in order, each with its offset from the reading's left edge in frame widths. */
export function lunarFrames(field: LunarField, lunar: LunarDate): { frame: number; offset: number }[] {
  const index = lunar.cycleYear - 1;
  if (field === "lunar_year") return [{ frame: index % 10, offset: 0 }, { frame: 10 + index % 12, offset: 1 }, { frame: 22, offset: 2 }];
  if (field === "lunar_month") return [...(lunar.leap ? [{ frame: 12, offset: 0 }] : []), { frame: lunar.month - 1, offset: lunar.leap ? 0.5 : 0 }];
  return [{ frame: lunar.day - 1, offset: 0 }];
}

export const isLunarField = (id: string): id is LunarField => id === "lunar_year" || id === "lunar_month" || id === "lunar_day";
