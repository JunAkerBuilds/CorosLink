# RPE Load Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an RPE-level distribution (RPE 1→5 by Frequency / sRPE / Time, with rated-coverage) to the Training Hub, consolidated with the existing HR-zone and distance donuts under one "Load Profile" section.

**Architecture:** Backend computes the RPE distribution locally from `training_activities.feel_type` (COROS provides no RPE distribution) using the existing Foster sRPE helpers, and attaches it to `TrainingHubAnalytics`. The renderer adds a third `ZoneDistributionPanel` (variant `"rpe"`) fed by a new `buildRpeData`, reusing the existing donut + table component wholesale.

**Tech Stack:** Electron + React 19 + TypeScript, recharts, better-sqlite3. Tests: `node --experimental-strip-types scripts/test-rpe-load.mjs`.

## Global Constraints

- Window is **fixed at 4 weeks** (28 days) — no selectable period. Matches the existing donuts' `isActivityInLastFourWeeks`.
- Do NOT touch: `TrainingSummaryTiles`, calendar components, `AddWorkoutModal`. No COROS feelType write-back.
- Never `git add` the iCloud `" 2"` duplicate files or `extracted-watchface-data/`; always add explicit paths.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- feelType semantics: `0`/null = unrated, `1..5` = the five smileys (1 = very light … 5 = very hard).

---

### Task 1: RPE distribution helper + types

**Files:**
- Modify: `electron/types.ts` (add `RpeDistributionBucket`, `RpeDistribution`)
- Modify: `electron/rpeLoad.ts` (add `buildRpeDistribution`)
- Test: `scripts/test-rpe-load.mjs` (append)

**Interfaces:**
- Consumes: existing `sessionSrpe(feelType, durationSeconds)` from `rpeLoad.ts`, existing `RpeActivityInput`.
- Produces: `buildRpeDistribution(ratedInputs: RpeActivityInput[], totalActivityCount: number): RpeDistribution`; types `RpeDistribution { buckets: RpeDistributionBucket[]; coverage: { rated: number; total: number } }`, `RpeDistributionBucket { level: number; frequency: number; srpe: number; timeSeconds: number }`.

- [ ] **Step 1: Add the shared types to `electron/types.ts`**

Add near the other Training Hub analytics types (anywhere top-level in the file):

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
```

- [ ] **Step 2: Write the failing test** (append to `scripts/test-rpe-load.mjs`, before any final "tests passed" log)

First update the import line at the top of the file to also pull in `buildRpeDistribution`:

```js
const { feelTypeToCr10, sessionSrpe, dailyRpeLoad, buildRpeDistribution } = await import(
  `${modUrl.href}?c=${Date.now()}`
);
```

Then append these assertions:

```js
// buildRpeDistribution: 5 buckets always, correct freq/sRPE/time sums + coverage.
const emptyDist = buildRpeDistribution([], 0);
assert.equal(emptyDist.buckets.length, 5);
assert.deepEqual(
  emptyDist.buckets.map((b) => b.level),
  [1, 2, 3, 4, 5]
);
assert.ok(emptyDist.buckets.every((b) => b.frequency === 0 && b.srpe === 0 && b.timeSeconds === 0));
assert.deepEqual(emptyDist.coverage, { rated: 0, total: 0 });

const dist = buildRpeDistribution(
  [
    { startTime: noonMs, duration: 45 * 60, feelType: 4 }, // sRPE 360
    { startTime: noonMs, duration: 30 * 60, feelType: 4 }, // sRPE 240 (same level)
    { startTime: nextDay9, duration: 20 * 60, feelType: 1 }, // sRPE 40
  ],
  40
);
const level4 = dist.buckets.find((b) => b.level === 4);
const level1 = dist.buckets.find((b) => b.level === 1);
const level3 = dist.buckets.find((b) => b.level === 3);
assert.equal(level4.frequency, 2);
assert.equal(level4.srpe, 600); // 360 + 240
assert.equal(level4.timeSeconds, 45 * 60 + 30 * 60);
assert.equal(level1.frequency, 1);
assert.equal(level1.srpe, 40);
assert.equal(level3.frequency, 0); // untouched level stays zero
assert.deepEqual(dist.coverage, { rated: 3, total: 40 });

// Out-of-range / unrated feelType is ignored by the helper (guards the caller).
const guarded = buildRpeDistribution(
  [
    { startTime: noonMs, duration: 60 * 60, feelType: 0 },
    { startTime: noonMs, duration: 60 * 60, feelType: 6 },
    { startTime: noonMs, duration: 60 * 60, feelType: null },
  ],
  10
);
assert.ok(guarded.buckets.every((b) => b.frequency === 0));
assert.deepEqual(guarded.coverage, { rated: 0, total: 10 });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --experimental-strip-types scripts/test-rpe-load.mjs`
Expected: FAIL — `buildRpeDistribution is not a function`.

- [ ] **Step 4: Implement `buildRpeDistribution`** (append to `electron/rpeLoad.ts`)

Import the types at the top of `rpeLoad.ts`:

```ts
import type { RpeDistribution, RpeDistributionBucket } from "./types";
```

Then add:

```ts
// Bucket rated activities by RPE level (1..5) over a window, summing frequency,
// Foster sRPE, and time. COROS has no RPE distribution of its own, so this is
// computed locally from the cached feelType. `totalActivityCount` is the total
// number of activities in the window (rated + unrated) for the coverage ratio.
export function buildRpeDistribution(
  ratedInputs: RpeActivityInput[],
  totalActivityCount: number
): RpeDistribution {
  const buckets: RpeDistributionBucket[] = [1, 2, 3, 4, 5].map((level) => ({
    level,
    frequency: 0,
    srpe: 0,
    timeSeconds: 0
  }));

  let rated = 0;
  for (const activity of ratedInputs) {
    const level = activity.feelType;
    if (
      level === undefined ||
      level === null ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > 5
    ) {
      continue;
    }
    const bucket = buckets[level - 1];
    bucket.frequency += 1;
    bucket.srpe += sessionSrpe(level, activity.duration);
    bucket.timeSeconds += Number.isFinite(activity.duration)
      ? activity.duration ?? 0
      : 0;
    rated += 1;
  }

  return {
    buckets,
    coverage: { rated, total: totalActivityCount }
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types scripts/test-rpe-load.mjs`
Expected: PASS — existing assertions plus the new ones (final "rpe-load tests passed" style log still prints).

- [ ] **Step 6: Commit**

```bash
git add electron/types.ts electron/rpeLoad.ts scripts/test-rpe-load.mjs
git commit -m "$(printf 'feat(rpe): buildRpeDistribution helper + types\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: DB count + wire distribution into analytics

**Files:**
- Modify: `electron/database.ts` (add `countTrainingActivitiesSince`)
- Modify: `electron/types.ts` (add `rpeDistribution` to `TrainingHubAnalytics`)
- Modify: `electron/trainingHubService.ts` (compute + attach in `parseAnalytics`)

**Interfaces:**
- Consumes: `buildRpeDistribution` (Task 1), existing `listTrainingActivityRpeInputs(sinceEpochSeconds)` from `database.ts`.
- Produces: `countTrainingActivitiesSince(sinceEpochSeconds: number): number`; `TrainingHubAnalytics.rpeDistribution: RpeDistribution`.

- [ ] **Step 1: Add `countTrainingActivitiesSince`** to `electron/database.ts` (right after `countTrainingActivitiesMissingFeelType`, ~line 1162)

```ts
export function countTrainingActivitiesSince(sinceEpochSeconds: number): number {
  const row = requireDatabase()
    .prepare(
      `SELECT count(*) AS n
       FROM training_activities
       WHERE start_time >= ?`
    )
    .get(sinceEpochSeconds) as { n: number };
  return row.n;
}
```

- [ ] **Step 2: Add the field to `TrainingHubAnalytics`** in `electron/types.ts`

```ts
export interface TrainingHubAnalytics {
  dayList: TrainingHubDailyMetric[];
  weekList: Record<string, unknown>[];
  sportStatistics: TrainingHubSportStatistic[];
  zoneDistributions: TrainingHubZoneDistributions;
  rpeDistribution: RpeDistribution;
  raw?: Record<string, unknown>;
}
```

- [ ] **Step 3: Wire it into `parseAnalytics`** in `electron/trainingHubService.ts`

Add `countTrainingActivitiesSince` to the existing `./database` import block (near `listTrainingActivityRpeInputs`) and `buildRpeDistribution` to the existing `./rpeLoad` import (currently `import { dailyRpeLoad } from "./rpeLoad";` → `import { buildRpeDistribution, dailyRpeLoad } from "./rpeLoad";`).

Then in `parseAnalytics` (the `return { … }` around line 2055):

```ts
function parseAnalytics(raw: Record<string, unknown>): TrainingHubAnalytics {
  const dayList = extractDayList(raw).map((item) =>
    parseDailyMetric(item as RawDailyMetric)
  );
  const weekList = extractArray(raw, ["weekList", "evoLab.weekList"]);
  const sportStatistics = extractSportStatistics(raw);
  const summary = pickObject(raw, ["summaryInfo"]) ?? {};

  const fourWeeksAgoSec = Math.floor(
    (Date.now() - 28 * 24 * 60 * 60 * 1000) / 1000
  );
  const rpeDistribution = buildRpeDistribution(
    listTrainingActivityRpeInputs(fourWeeksAgoSec),
    countTrainingActivitiesSince(fourWeeksAgoSec)
  );

  return {
    dayList,
    weekList,
    sportStatistics,
    zoneDistributions: parseZoneDistributions(summary),
    rpeDistribution,
    raw
  };
}
```

- [ ] **Step 4: Verify the backend typechecks**

Run: `npm run build:electron`
Expected: PASS (tsc clean). If `TrainingHubAnalytics` is constructed anywhere else without `rpeDistribution`, tsc will flag it — fix those sites by adding the field (there should be only `parseAnalytics`).

- [ ] **Step 5: Commit**

```bash
git add electron/database.ts electron/types.ts electron/trainingHubService.ts
git commit -m "$(printf 'feat(rpe): compute rpeDistribution in analytics\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: RPE distribution panel + Load Profile section

**Files:**
- Modify: `src/training/components/TrainingZoneDistributionCharts.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `analytics.rpeDistribution` (Task 2), the existing `ZoneDistributionPanel`, `MetricDropdown`, `ZoneDistributionDatum`, `formatDurationSeconds`.
- Produces: renders a third donut panel; no exported API change (`TrainingZoneDistributionCharts` already receives `analytics`).

- [ ] **Step 1: Import the RPE types + Gauge icon**

At the top of `TrainingZoneDistributionCharts.tsx`, add `Gauge` to the lucide import and `RpeDistribution`, `RpeDistributionBucket` to the types import:

```ts
import { Check, ChevronDown, Footprints, Gauge, Heart } from "lucide-react";
```
```ts
import type {
  RpeDistribution,
  RpeDistributionBucket,
  TrainingHubAnalytics,
  TrainingHubActivity,
  TrainingHubThresholdZone,
  TrainingHubZoneDistributionEntry
} from "../../../electron/types";
```

- [ ] **Step 2: Add RPE metric type, constants, and value/format/caption helpers**

Add near the other metric type aliases (`type ActivityMetric …`):

```ts
type RpeMetric = "frequency" | "srpe" | "time";
```

Add near the other color/label constants:

```ts
const RPE_ZONE_COLORS = ["#8fd48f", "#c9d879", "#f2c14e", "#f08a4b", "#e5563f"];

const RPE_LEVEL_LABELS: Record<number, string> = {
  1: "RPE 1 · Very light",
  2: "RPE 2 · Light",
  3: "RPE 3 · Moderate",
  4: "RPE 4 · Hard",
  5: "RPE 5 · Very hard"
};

const RPE_METRIC_LABELS: Record<RpeMetric, string> = {
  frequency: "Frequency",
  srpe: "sRPE",
  time: "Time"
};

const RPE_METRIC_OPTIONS: MetricDropdownOption<RpeMetric>[] = [
  { value: "frequency", label: RPE_METRIC_LABELS.frequency },
  { value: "srpe", label: RPE_METRIC_LABELS.srpe },
  { value: "time", label: RPE_METRIC_LABELS.time }
];
```

Add these helper functions (near `activityMetricValue` / `formatActivityMetricValue`):

```ts
function rpeMetricValue(
  bucket: RpeDistributionBucket,
  metric: RpeMetric
): number {
  if (metric === "srpe") {
    return bucket.srpe;
  }
  if (metric === "time") {
    return bucket.timeSeconds;
  }
  return bucket.frequency;
}

function formatRpeMetricValue(value: number, metric: RpeMetric): string {
  if (metric === "srpe") {
    return String(Math.round(value));
  }
  if (metric === "time") {
    if (value >= 3600) {
      return formatDurationSeconds(value);
    }
    return `${Math.round(value / 60)} min`;
  }
  const count = Math.round(value);
  return count === 1 ? "1 session" : `${count} sessions`;
}

function rpeLevelCaption(level: number): string {
  switch (level) {
    case 1:
      return "Recovery / very easy effort";
    case 2:
      return "Easy aerobic effort";
    case 3:
      return "Moderate, sustained effort";
    case 4:
      return "Hard, threshold effort";
    case 5:
      return "Maximal / very hard effort";
    default:
      return "Perceived effort level";
  }
}

function buildRpeData(
  distribution: RpeDistribution | null | undefined,
  metric: RpeMetric
): ZoneDistributionDatum[] {
  const buckets = distribution?.buckets ?? [];
  if (buckets.length === 0) {
    return [];
  }
  const values = buckets.map((bucket) => rpeMetricValue(bucket, metric));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return [];
  }
  return buckets.map((bucket, index) => {
    const value = values[index] ?? 0;
    return {
      label: RPE_LEVEL_LABELS[bucket.level] ?? `RPE ${bucket.level}`,
      detail: formatRpeMetricValue(value, metric),
      percent: (value / total) * 100,
      color: RPE_ZONE_COLORS[(bucket.level - 1) % RPE_ZONE_COLORS.length],
      zoneIndex: bucket.level
    };
  });
}
```

- [ ] **Step 3: Extend `ZoneDistributionPanel` for the rpe variant + coverage note**

Change the `variant` prop type and add `coverageNote`:

```ts
interface ZoneDistributionPanelProps {
  title: string;
  subtitle: string;
  emptyMessage: string;
  variant: "heart" | "distance" | "rpe";
  heroKicker: string;
  metricColumnLabel: string;
  coverageNote?: string;
  data: ZoneDistributionDatum[];
  metricControl: ReactNode;
  getCaption: (datum: ZoneDistributionDatum) => string;
}
```

In the component signature destructure add `coverageNote`. In the header heading block, render the note under the `<h2>`:

```tsx
        <div className="training-zone-heading">
          <p className="eyebrow">{title}</p>
          <h2>
            {subtitle} <span>(4 Weeks)</span>
          </h2>
          {coverageNote ? (
            <p className="training-zone-coverage">{coverageNote}</p>
          ) : null}
        </div>
```

Update the donut-center icon switch to handle `rpe`:

```tsx
            <span className="training-zone-donut-icon">
              {variant === "heart" ? (
                <Heart size={22} strokeWidth={2.2} aria-hidden="true" />
              ) : variant === "rpe" ? (
                <Gauge size={22} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <Footprints size={22} strokeWidth={2.2} aria-hidden="true" />
              )}
            </span>
```

Update the table-head first column label:

```tsx
              <span>
                {variant === "heart"
                  ? "Zone"
                  : variant === "rpe"
                    ? "RPE"
                    : "Distance"}
              </span>
```

- [ ] **Step 4: Add the RPE state + third panel and wrap in a Load Profile section**

In `TrainingZoneDistributionCharts`, add the RPE metric state:

```ts
  const [rpeMetric, setRpeMetric] = useState<RpeMetric>("frequency");
```

Compute the coverage note (inside the component body, before `return`):

```ts
  const rpeCoverage = analytics?.rpeDistribution?.coverage;
  const rpeCoverageNote =
    rpeCoverage && rpeCoverage.total > 0
      ? `${rpeCoverage.rated} rated / ${rpeCoverage.total} sessions`
      : undefined;
```

Replace the returned JSX. Wrap the existing grid in a `training-load-profile` section and append the RPE panel as the third child:

```tsx
  return (
    <section className="training-load-profile">
      <div className="training-load-profile-header">
        <p className="eyebrow">Load Profile</p>
        <h2>
          Distribution <span>(4 Weeks)</span>
        </h2>
      </div>
      <div className="training-chart-grid training-zone-grid">
        <ZoneDistributionPanel
          title="Threshold Heart Rate"
          subtitle="Training Load"
          emptyMessage="No threshold heart rate zone distribution data loaded."
          variant="heart"
          heroKicker="Primary zone"
          metricColumnLabel={HEART_RATE_METRIC_LABELS[heartRateMetric]}
          data={buildHeartRateData(
            lthrZones,
            activities,
            heartRateMetric,
            analytics
          )}
          getCaption={(datum) => heartRateZoneCaption(datum.zoneIndex)}
          metricControl={
            <MetricDropdown
              label="Heart rate distribution metric"
              value={heartRateMetric}
              options={HEART_RATE_METRIC_OPTIONS}
              onChange={setHeartRateMetric}
            />
          }
        />
        <ZoneDistributionPanel
          title="Distance Zones"
          subtitle="Distribution"
          emptyMessage="No distance zone distribution data loaded."
          variant="distance"
          heroKicker="Most runs"
          metricColumnLabel={
            distanceMetric === "frequency"
              ? "Runs"
              : DISTANCE_METRIC_LABELS[distanceMetric]
          }
          data={buildDistanceData(activities, distanceMetric, analytics)}
          getCaption={(datum) => distanceZoneCaption(datum.label)}
          metricControl={
            <MetricDropdown
              label="Distance distribution metric"
              value={distanceMetric}
              options={DISTANCE_METRIC_OPTIONS}
              onChange={setDistanceMetric}
            />
          }
        />
        <ZoneDistributionPanel
          title="Perceived Effort"
          subtitle="RPE"
          emptyMessage="No RPE-rated sessions in the last 4 weeks."
          variant="rpe"
          heroKicker="Most sessions"
          metricColumnLabel={
            rpeMetric === "frequency" ? "Sessions" : RPE_METRIC_LABELS[rpeMetric]
          }
          coverageNote={rpeCoverageNote}
          data={buildRpeData(analytics?.rpeDistribution, rpeMetric)}
          getCaption={(datum) => rpeLevelCaption(datum.zoneIndex)}
          metricControl={
            <MetricDropdown
              label="RPE distribution metric"
              value={rpeMetric}
              options={RPE_METRIC_OPTIONS}
              onChange={setRpeMetric}
            />
          }
        />
      </div>
    </section>
  );
```

(The outer wrapper replaces the old top-level `<div className="training-chart-grid training-zone-grid">`.)

- [ ] **Step 5: Add styles** to `src/styles.css`

```css
.training-load-profile {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.training-load-profile-header .eyebrow {
  margin: 0;
}

.training-load-profile-header h2 {
  margin: 2px 0 0;
  font-size: 1.15rem;
}

.training-load-profile-header h2 span {
  opacity: 0.6;
  font-weight: 500;
}

.training-zone-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 1100px) {
  .training-zone-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .training-zone-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.training-zone-coverage {
  margin: 4px 0 0;
  font-size: 0.78rem;
  opacity: 0.7;
}
```

(The existing `.training-zone-grid { grid-template-columns: repeat(2, …); }` rule is overridden here — update that original rule to `repeat(3, …)` in place rather than duplicating if the linter prefers; either is fine as long as the 3-column rule wins.)

- [ ] **Step 6: Verify the renderer builds**

Run: `npm run build`
Expected: PASS (electron + renderer typecheck + vite bundle). No unused-import or type errors.

- [ ] **Step 7: Visual smoke test**

Run: `npx electron .`, open Training Hub, scroll to the Load Profile section. Confirm: three donut panels; the RPE panel shows buckets, a working Frequency / sRPE / Time dropdown, the "N rated / M sessions" coverage line, and the empty-state message when no rated sessions exist in the window.

- [ ] **Step 8: Commit**

```bash
git add src/training/components/TrainingZoneDistributionCharts.tsx src/styles.css
git commit -m "$(printf 'feat(rpe): RPE distribution panel in Load Profile section\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review notes

- **Spec coverage:** Task 1 = helper + coverage; Task 2 = local computation + analytics wiring; Task 3 = donut panel (Frequency/sRPE/Time), colors, coverage note, empty state, Load Profile section. All spec sections covered.
- **Type consistency:** `RpeDistribution`/`RpeDistributionBucket` defined once in `types.ts`, imported by both `rpeLoad.ts` (Task 1) and the renderer (Task 3). `buildRpeDistribution(ratedInputs, totalActivityCount)` signature identical across Tasks 1→2. `RpeMetric` values (`frequency`/`srpe`/`time`) consistent in constants, `rpeMetricValue`, and `formatRpeMetricValue`.
- **No placeholders:** every code step contains complete code.
