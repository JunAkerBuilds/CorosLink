/**
 * The sample athlete's readings for the parts of the Sports pages that no synced item can fill yet, copied from the
 * C-LINK redesign canvas. A signed-in page shows them only inside a block marked "Sample data".
 */
import type { LineChart, RidePage, RunPage, SwimPage } from "@/data/sports";

export const SAMPLE_PREDICTION_TREND: LineChart = {
  values: [2750, 2744, 2738, 2730, 2721, 2712], marks: ["45:12", "45:31", "45:50"], dates: ["8 Oct", "29 Oct", "19 Nov"], flip: true,
  label: "Sample data: a 10K prediction over six weeks, falling from 45:50 on 8 October to 45:12. Faster is higher.",
};

export const SAMPLE_RUN_TREND: NonNullable<Extract<RunPage["engine"], { headline: string }>["sampleTrend"]> = {
  chart: SAMPLE_PREDICTION_TREND, text: "10K prediction 0:38 faster than on 8 Oct · VO₂ max up 1",
};

export const SAMPLE_BIGGEST_CLIMB: NonNullable<Extract<RidePage["climb"], { headline: string }>["sampleBiggest"]> = {
  title: "412 m up in 38:20", detail: "6.4 km at 6.4%", tag: "Cat 2", rate: "On climbs like it: 645 m/h against 608 m/h before, 6% faster.",
};

export const SAMPLE_CSS_TREND: LineChart = {
  values: [109, 108.4, 108, 107.2, 106.6, 106], marks: ["1:46", "1:48", "1:49"], dates: ["8 Oct", "29 Oct", "19 Nov"], flip: true,
  label: "Sample data: critical swim speed over six weeks, from 1:49 to 1:46 per 100 m. Faster is higher.",
};

export const SAMPLE_CSS: Extract<SwimPage["css"], { headline: string }> = {
  sample: true, chip: { tone: "good", text: "Faster" }, headline: "Critical swim speed 1:46 /100 m",
  sub: "Estimated from your best 200 m (3:18.40) and 400 m (6:51.20). 2 s per 100 faster than six weeks ago.",
  bands: [{ name: "Easy", text: "slower than 1:56", hue: "run" }, { name: "Threshold", text: "1:44 to 1:48", hue: "gold" }, { name: "Fast", text: "quicker than 1:40", hue: "coral" }],
  sampleTrend: SAMPLE_CSS_TREND,
};

export const SAMPLE_SWOLF: SwimPage["swolf"] = {
  chip: { tone: "good", text: "Smoother" }, headline: "Your SWOLF is down 2 at the same pace",
  sub: "Fewer strokes or less time per length: your stroke is getting more efficient.",
  compare: [{ value: "41.5", label: "Last 4 weeks" }, { value: "43.5", label: "The 8 before" }],
  chart: {
    values: [43.8, 43.4, 43.1, 42.6, 42.0, 41.5], marks: ["41.5", "42.6", "43.8"], dates: ["8 Oct", "29 Oct", "19 Nov"], flip: true,
    label: "Sample data: SWOLF at the same pace over six weeks, falling from 43.8 to 41.5. Lower is higher on the chart.",
  },
  stats: [{ value: "18.4", label: "Strokes a length" }, { value: "23.1 s", label: "Time a length" }, { value: "1:55", label: "Pace /100 m" }],
};

export const SAMPLE_STROKES: SwimPage["strokes"] = {
  chip: null, headline: "72% freestyle", sub: "By distance over the last 4 weeks.",
  rows: [
    { name: "Freestyle", percent: 72, detail: "6,912 m", hue: "swim" }, { name: "Breaststroke", percent: 14, detail: "1,344 m", hue: "ride" },
    { name: "Backstroke", percent: 8, detail: "768 m", hue: "violet" }, { name: "Drill", percent: 6, detail: "576 m", hue: "slate" },
  ],
};

export const SAMPLE_SWIM_RECORDS: Extract<SwimPage["records"], { headline: string }> = {
  sample: true, chip: { tone: "attention", text: "New record" }, headline: "New record: 400 m in 6:51.20", sub: "4.60 s under your old best, on Tue 10 Nov.",
  rows: [
    { name: "50 m", value: "0:41.80", date: "3 Nov", fresh: false }, { name: "100 m", value: "1:31.50", date: "3 Nov", fresh: false },
    { name: "200 m", value: "3:18.40", date: "27 Oct", fresh: false }, { name: "400 m", value: "6:51.20", date: "10 Nov", fresh: true },
    { name: "800 m", value: "14:22.60", date: "13 Sep", fresh: false }, { name: "1,500 m", value: "27:48.30", date: "2 Aug", fresh: false },
  ],
};
