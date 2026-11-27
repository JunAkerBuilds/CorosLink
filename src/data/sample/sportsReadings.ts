/**
 * The sample athlete's readings for the parts of the Sports pages that no synced item can fill yet, copied from the
 * C-LINK redesign canvas. A signed-in page shows them only inside a block marked "Sample data". Functions, so
 * the words come in the app's language at the time they are shown.
 */
import type { LineChart, RidePage, RunPage, SwimPage } from "@/data/sports";
import { t } from "@/lib/i18n";
import { clock, thousands } from "@/lib/format";
import { dayMonthOf, weekdayOf } from "@/lib/sports";
import { distance, height, heightIn, heightUnit, imperial, swimDistance, swimPaceIn, swimPaceText } from "@/lib/units";

/** Seconds per 100 m as the clock per 100 of the shown unit. */
const per100 = (seconds: number): string => clock(swimPaceIn(seconds));
/** A climbing rate, metres an hour, in the shown unit: 645 m/h or 2,116 ft/h. */
const rate = (metres: number): string => `${thousands(heightIn(metres))} ${heightUnit()}/h`;

/** A day of the sample's six weeks, as the charts write it ("8 Oct"). The year doesn't show. */
const on = (month: number, day: number): string => dayMonthOf(new Date(2026, month - 1, day));
const sixWeeks = (): string[] => [on(10, 8), on(10, 29), on(11, 19)];

export function samplePredictionTrend(): LineChart {
  return {
    values: [2750, 2744, 2738, 2730, 2721, 2712], marks: ["45:12", "45:31", "45:50"], dates: sixWeeks(), flip: true,
    label: t("Sample data: a 10K prediction over six weeks, falling from 45:50 on {date} to 45:12. Faster is higher.", { date: on(10, 8) }),
  };
}

export function sampleRunTrend(): NonNullable<Extract<RunPage["engine"], { headline: string }>["sampleTrend"]> {
  return { chart: samplePredictionTrend(), text: t("10K prediction 0:38 faster than on {date} · VO₂ max up 1", { date: on(10, 8) }) };
}

export function sampleBiggestClimb(): NonNullable<Extract<RidePage["climb"], { headline: string }>["sampleBiggest"]> {
  return {
    title: t("{height} up in {time}", { height: height(412), time: "38:20" }), detail: t("{distance} at {grade}", { distance: distance(6400, 1), grade: "6.4%" }), tag: "Cat 2",
    rate: t("On climbs like it: {now} against {before} before, {percent}% faster.", { now: rate(645), before: rate(608), percent: 6 }),
  };
}

export function sampleCssTrend(): LineChart {
  return {
    values: [109, 108.4, 108, 107.2, 106.6, 106].map(swimPaceIn), marks: [per100(106), per100(108), per100(109)], dates: sixWeeks(), flip: true,
    label: imperial()
      ? t("Sample data: critical swim speed over six weeks, from {from} to {to} per 100 yd. Faster is higher.", { from: per100(109), to: per100(106) })
      : t("Sample data: critical swim speed over six weeks, from 1:49 to 1:46 per 100 m. Faster is higher."),
  };
}

export function sampleCss(): Extract<SwimPage["css"], { headline: string }> {
  return {
    sample: true, chip: { tone: "good", text: t("Faster") }, headline: t("Critical swim speed {pace}", { pace: swimPaceText(106) }),
    sub: `${t("Estimated from your best 200 m ({b200}) and 400 m ({b400}).", { b200: "3:18.40", b400: "6:51.20" })} ${t("2 s per 100 faster than six weeks ago.")}`,
    bands: [
      { name: t("Easy"), text: t("slower than {pace}", { pace: per100(116) }), hue: "run" },
      { name: t("Threshold"), text: t("{from} to {to}", { from: per100(104), to: per100(108) }), hue: "gold" },
      { name: t("Fast"), text: t("quicker than {pace}", { pace: per100(100) }), hue: "coral" },
    ],
    sampleTrend: sampleCssTrend(),
  };
}

export function sampleSwolf(): SwimPage["swolf"] {
  return {
    chip: { tone: "good", text: t("Smoother") }, headline: t("Your SWOLF is down 2 at the same pace"),
    sub: t("Fewer strokes or less time per length: your stroke is getting more efficient."),
    compare: [{ value: "41.5", label: t("Last 4 weeks") }, { value: "43.5", label: t("The 8 before") }],
    chart: {
      values: [43.8, 43.4, 43.1, 42.6, 42.0, 41.5], marks: ["41.5", "42.6", "43.8"], dates: sixWeeks(), flip: true,
      label: t("Sample data: SWOLF at the same pace over six weeks, falling from 43.8 to 41.5. Lower is higher on the chart."),
    },
    stats: [{ value: "18.4", label: t("Strokes a length") }, { value: "23.1 s", label: t("Time a length") }, { value: per100(115), label: imperial() ? t("Pace /100 yd") : t("Pace /100 m") }],
  };
}

export function sampleStrokes(): SwimPage["strokes"] {
  return {
    chip: null, headline: t("{percent}% freestyle", { percent: 72 }), sub: t("By distance over the last 4 weeks."),
    rows: [
      { name: t("Freestyle"), percent: 72, detail: swimDistance(6912), hue: "swim" }, { name: t("Breaststroke"), percent: 14, detail: swimDistance(1344), hue: "ride" },
      { name: t("Backstroke"), percent: 8, detail: swimDistance(768), hue: "violet" }, { name: t("Drill"), percent: 6, detail: swimDistance(576), hue: "slate" },
    ],
  };
}

export function sampleSwimRecords(): Extract<SwimPage["records"], { headline: string }> {
  return {
    sample: true, chip: { tone: "attention", text: t("New record") }, headline: t("New record: {name} in {time}", { name: "400 m", time: "6:51.20" }),
    sub: t("{seconds} s under your old best, on {day}.", { seconds: "4.60", day: `${weekdayOf(new Date(2026, 10, 10))} ${on(11, 10)}` }),
    rows: [
      { name: "50 m", value: "0:41.80", date: on(11, 3), fresh: false }, { name: "100 m", value: "1:31.50", date: on(11, 3), fresh: false },
      { name: "200 m", value: "3:18.40", date: on(10, 27), fresh: false }, { name: "400 m", value: "6:51.20", date: on(11, 10), fresh: true },
      { name: "800 m", value: "14:22.60", date: on(9, 13), fresh: false }, { name: "1,500 m", value: "27:48.30", date: on(8, 2), fresh: false },
    ],
  };
}
