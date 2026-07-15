# RPE load: heatmap toggle + trend charts

Date: 2026-07-15
Branch: `feat/rpe-load-heatmap` (based on `feat/heatmap-sport-colors`)

## Problem

Training Load (TL) is HR-derived, so it is great for cardio but near-useless for
strength: a hard gym session barely raises HR, so its TL is tiny even when the
session is genuinely brutal. COROS records a subjective feeling at the end of
each activity (`sportFeelInfo.feelType`, a 1–5 smiley). We use that to compute a
Foster-style session-RPE load and let the user view the heatmap by RPE instead
of TL.

## Data source (verified live)

- `feelType` lives ONLY in `/activity/detail/query` → `data.sportFeelInfo.feelType`
  (~1 MB payload per activity). The bulk activity-list and daily-metrics
  endpoints do NOT carry it.
- Values: `0` = not rated; `1..5` = the five smileys.
- Confirmed direction (user): 1 = très léger … 5 = très difficile (ascending
  difficulty).

## RPE model (`electron/rpeLoad.ts`, pure, TDD)

- feelType → CR10 RPE (×2): 1→2, 2→4, 3→6, 4→8, 5→10.
- Session sRPE (AU) = `CR10 × durationMinutes`.
- Day rpeLoad = sum of sRPE over that day's **rated** activities (feelType 1–5).
  Unrated (0) contribute nothing → a day with no rated session has no RPE load
  (blank cell in RPE mode).

## Data pipeline

- New column `feel_type INTEGER` on `training_activities` (NULL = never fetched,
  0 = unrated, 1–5 = rated).
- Backfill service (electron): on sync, fetch `/activity/detail/query` for
  activities whose `feel_type` is NULL, throttled (low concurrency), cache the
  result. New activities cost 1–2 detail calls per sync; history is a one-time
  background backfill over the heatmap window (365 days). Opportunistic: when an
  activity detail is fetched for the detail panel, cache its feelType too.
- Electron computes per-day `rpeLoad` from cached feel types + durations and
  attaches it to the snapshot: `TrainingHubDailyMetric.rpeLoad` and
  `TrainingTrendPoint.rpeLoad`. The renderer never handles raw feelType.

## Heatmap toggle (renderer)

- Segmented control in the panel header: **Training Load | RPE**.
- Intensity source switches between `trainingLoad` and `rpeLoad`; the summary
  line adapts (rated days · streak · total AU).
- Sport hue + multi-sport pie are unchanged in both modes (reuse existing
  coloring). A day with load but no rated session is blank in RPE mode.

## Trend charts → 2×2 grid (`TrainingTrendCharts`)

Existing panel renders 3 charts (Training Load, HRV vs Baseline, Sleep Duration)
over `trendPoints`. Reorganize into 2 rows × 2 columns and add an RPE chart:

- Row 1: Training Load (existing) · **RPE** (new — daily sRPE, same chart style)
- Row 2: HRV vs Baseline (existing) · Sleep Duration (existing)

`.training-chart-grid` becomes a 2-column grid.

## Out of scope / untouched

- TL mode behavior, calendar sport colors, and Settings are unchanged.
- No new runtime dependencies.

## Testing

- `rpeLoad.ts`: unit tests for mapping, session sRPE, daily aggregation,
  unrated exclusion, missing duration.
- Build + live verification (toggle switches intensity; RPE chart renders;
  backfill fills in).
