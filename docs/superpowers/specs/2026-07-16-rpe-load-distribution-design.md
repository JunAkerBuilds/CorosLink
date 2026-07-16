# RPE Load Distribution — Design

**Date:** 2026-07-16
**Branch:** `feat/rpe-load-distribution`
**Status:** Approved, ready for implementation plan

## Goal

Add an **RPE-level distribution** to the Training Hub — showing how many sessions
(or how much sRPE / time) fell at each perceived-effort level (RPE 1→5) over the
last 4 weeks — and consolidate it with the two existing zone-distribution donuts
(HR zones, distance) under a single **"Load Profile"** section.

This closes the gap left by the RPE Load feature (PR #55): the RPE *trend curve*
and the TL/RPE *heatmap toggle* already exist, but there is no way to see the
**breakdown of effort by RPE level** ("did I do a lot of 3s? mostly easy?").

## Non-goals (explicitly out of scope)

Decided during brainstorming — do NOT build these:

- RPE in the summary tiles (`TrainingSummaryTiles`).
- RPE in the calendar (`WeekStatsCell` / `DayCell` / `DayDetailPanel`).
- A "target RPE" field on planned workouts (`AddWorkoutModal`).
- Any write-back of feelType to COROS (none exists; RPE is retrospective, pulled
  from the activity-detail backfill only).
- A selectable time window. The section is **fixed at 4 weeks**, matching the
  existing donuts.

## Context — what already exists

- **RPE Load curve**: `TrainingTrendChart.tsx` renders an RPE Load area chart
  (`dataKey="rpeLoad"`) beside Training Load. ✓
- **TL/RPE heatmap toggle**: `TrainingHeatmapPanel.tsx`. ✓
- **HR-zone + distance distributions**: `TrainingZoneDistributionCharts.tsx`
  renders two donut panels via the reusable `ZoneDistributionPanel`, each with a
  metric dropdown (Frequency / Training Load / Time). ✓ — this is the
  "aerobic zone distribution" (Z1/Z2/Z3…) the user also mentioned; it is done.
- **RPE math**: `electron/rpeLoad.ts` — `feelTypeToCr10` (feelType × 2), `sessionSrpe`
  (CR10 × durationMinutes), `dailyRpeLoad`. ✓
- **RPE data in DB**: `training_activities.feel_type` (0 = unrated, 1..5 = the five
  smileys). Read via `listTrainingActivityRpeInputs(sinceEpochSeconds)` which
  returns only rated rows (`feel_type > 0`).

## Key architectural fact

The existing zone distributions come **pre-computed from COROS** (`hrTlAreaList`,
`hrDisAreaList`, …) and are parsed in `parseZoneDistributions` from the summary
payload. COROS provides **no** RPE distribution — RPE is our own concept — so the
RPE distribution must be **computed locally** from `training_activities.feel_type`,
in `electron/`, where the sRPE (Foster CR10) helpers already live. We do not
duplicate that math in the renderer.

## Data model

### New pure helper (in `electron/rpeLoad.ts`)

```ts
export interface RpeDistributionBucket {
  /** RPE level 1..5. */
  level: number;
  /** Number of rated sessions at this level. */
  frequency: number;
  /** Sum of session sRPE (Foster CR10 × duration minutes) at this level. */
  srpe: number;
  /** Sum of duration seconds at this level. */
  timeSeconds: number;
}

export interface RpeDistribution {
  /** Exactly 5 buckets, level 1..5, always present (zeros allowed). */
  buckets: RpeDistributionBucket[];
  coverage: {
    /** Activities with feel_type in 1..5 within the window. */
    rated: number;
    /** All activities within the window (rated + unrated). */
    total: number;
  };
}

export function buildRpeDistribution(
  ratedInputs: { startTime?: number; duration?: number; feelType?: number | null }[],
  totalActivityCount: number
): RpeDistribution;
```

- Buckets are seeded 1..5 with zeros, then each rated input adds
  `frequency += 1`, `srpe += sessionSrpe(feelType, duration/60)`,
  `timeSeconds += duration`.
- Inputs with `feelType` outside 1..5 (e.g. 0/null) are ignored — the caller only
  passes rated rows via `listTrainingActivityRpeInputs`, but the helper guards
  anyway.
- `coverage.rated` = number of rated inputs consumed; `coverage.total` =
  `totalActivityCount` (passed in).

### New DB query (in `electron/database.ts`)

```ts
export function countTrainingActivitiesSince(sinceEpochSeconds: number): number;
// SELECT COUNT(*) FROM training_activities WHERE start_time >= ?
```

### Types (`electron/types.ts`)

Add to `TrainingHubAnalytics`:

```ts
rpeDistribution: RpeDistribution;
```

(Import `RpeDistribution` from a shared location — since `types.ts` is the shared
contract, define `RpeDistribution` / `RpeDistributionBucket` in `types.ts` and
have `rpeLoad.ts` import them, to avoid a cycle.)

### Wiring (`electron/trainingHubService.ts`)

Where analytics is assembled (near `zoneDistributions: parseZoneDistributions(summary)`):

```ts
const fourWeeksAgoSec = Math.floor((Date.now() - 28 * 24 * 60 * 60 * 1000) / 1000);
const rpeInputs = listTrainingActivityRpeInputs(fourWeeksAgoSec);
const totalCount = countTrainingActivitiesSince(fourWeeksAgoSec);
// ...
rpeDistribution: buildRpeDistribution(rpeInputs, totalCount),
```

## UI

### `TrainingZoneDistributionCharts.tsx`

1. Wrap the existing grid in a **"Load Profile"** section with a heading
   (`Load Profile` + `(4 Weeks)`), keeping the two existing donut panels.
2. Add a **third `ZoneDistributionPanel`** with a new `variant: "rpe"`:
   - `title`: `"Perceived Effort"`, `subtitle`: `"RPE"`.
   - `heroKicker`: `"Most sessions"`.
   - Data from a new `buildRpeData(rpeDistribution, metric)`.
   - Metric dropdown: **Frequency / sRPE / Time** (new `RpeMetric` type +
     option list, mirroring the existing dropdowns).
   - `getCaption`: short RPE-level description (see labels below).
3. **Coverage line**: render `"{rated} rated / {total} sessions"` in the panel
   header area (new optional `coverageNote?: string` prop on
   `ZoneDistributionPanel`, shown under the subtitle). Always visible when data
   exists so sparse RPE never reads as "barely trained".

### `buildRpeData(rpeDistribution, metric)`

Produces `ZoneDistributionDatum[]` (the existing shape). Percent = value / total
across the 5 buckets. Labels and colors:

| Level | Label            | Color (green→red) |
|-------|------------------|-------------------|
| 1     | RPE 1 · Very light | `#8fd48f` |
| 2     | RPE 2 · Light      | `#c9d879` |
| 3     | RPE 3 · Moderate   | `#f2c14e` |
| 4     | RPE 4 · Hard       | `#f08a4b` |
| 5     | RPE 5 · Very hard  | `#e5563f` |

(Colors are a green→amber→red ramp echoing the COROS feel smileys; final hex
values may be nudged for contrast during implementation.)

Metric formatting:
- `frequency` → `"N sessions"` / `"1 session"`.
- `srpe` → rounded integer (matches TL formatting).
- `time` → `formatDurationSeconds` when ≥ 1h else `"N min"` (reuse existing
  `formatActivityMetricValue` time branch).

Panel icon (variant `"rpe"`): a `Gauge` (lucide) rendered in the donut center,
alongside the existing `Heart` / `Footprints`.

## Edge cases

- **No rated sessions** (`coverage.rated === 0`, or all buckets zero): panel shows
  empty state `"No RPE-rated sessions in the last 4 weeks."` (same
  `training-zone-body-empty` treatment as the other panels).
- **Unrated activities** (feel_type 0): excluded from buckets, still counted in
  `coverage.total`.
- **Zero total activities**: empty state; coverage note hidden.

## Testing

Extend `scripts/test-rpe-load.mjs` (or a sibling `test-rpe-distribution.mjs`)
with unit tests for `buildRpeDistribution`:

- Buckets are always length 5, levels 1..5, zeros when no input.
- Frequency counts, sRPE sums (verify against `sessionSrpe`), and time sums are
  correct for a mixed set of rated inputs.
- `coverage.rated` counts only rated inputs; `coverage.total` echoes the passed
  total; sparse case (2 rated of 40) reports `{ rated: 2, total: 40 }`.
- Out-of-range feelType (0, 6, null) is ignored by the helper.

Run: `node --experimental-strip-types scripts/test-rpe-load.mjs`.
Full `npm run build` must pass (electron + renderer typecheck).

## File touch list

- **Modify** `electron/types.ts` — `RpeDistribution`, `RpeDistributionBucket`,
  `rpeDistribution` on `TrainingHubAnalytics`.
- **Modify** `electron/rpeLoad.ts` — `buildRpeDistribution`.
- **Modify** `electron/database.ts` — `countTrainingActivitiesSince`.
- **Modify** `electron/trainingHubService.ts` — wire the distribution into analytics.
- **Modify** `src/training/components/TrainingZoneDistributionCharts.tsx` —
  "Load Profile" section wrapper, RPE panel, `buildRpeData`, RPE metric dropdown,
  coverage note.
- **Modify** `src/styles.css` (or `training` styles) — RPE variant + coverage note
  styling.
- **Modify** `scripts/test-rpe-load.mjs` — `buildRpeDistribution` tests.
