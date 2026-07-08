# Design — Add a manual activity to COROS

**Date:** 2026-07-08
**Status:** Approved (design phase). Ships in the same PR/branch as the intervals.icu import feature (`feat/intervals-icu-import`).

## Problem

COROS has no way to add an activity by hand (e.g. a session recorded on no device, or a gym workout you just want logged). This feature adds a small "Add activity to COROS" form in the Training Hub: the user enters the activity's basic facts, and CorosLink generates a minimal activity file and uploads it to their COROS account — reusing the exact upload pipeline already built and verified for the intervals.icu import (STS → zip → S3 → `/activity/fit/import`).

## Why TCX (not FIT)

A manual entry has **no sensor data by definition** — it is metadata only (sport, start, duration, distance, optional calories/HR). TCX is XML and trivial to author correctly; COROS's import already accepts `.tcx` (the existing `uploadActivityFitToCoros` derives the extension from the file name and the S3/zip/import path is format-agnostic). Authoring a binary FIT would be far more work for no benefit. A metadata-only TCX is the faithful, complete representation of a manual entry — not a lossy reconstruction of real sensor data.

## Scope (from brainstorming)

- **Fields:** sport, start date+time, duration, distance, and OPTIONAL calories + average heart rate ("Essentiels + effort").
- **Sport granularity:** three families — Run / Bike / Other — mapping directly to the only values the TCX `Sport` attribute encodes (`Running` / `Biking` / `Other`). No extended list.

## Non-goals

- No FIT authoring; no GPS route entry; no per-lap / interval structure.
- No new runtime dependencies (TCX is built by string assembly).
- No rename of `uploadActivityFitToCoros` — it already handles `.tcx`; reused as-is to avoid churn in the working intervals code.

## Architecture

| Piece | Location | Notes |
|-------|----------|-------|
| TCX builder | `electron/tcxBuilder.ts` (new, pure) | metadata → minimal valid TCX string; unit-tested |
| Upload | reuse `uploadActivityFitToCoros` in `electron/trainingHubService.ts` | already verified live (HTTP 200 to S3) |
| IPC handler | `electron/main.ts` → `coros:addManualActivity` | build TCX → temp `.tcx` → upload → cleanup (try/finally) |
| IPC surface | `electron/preload.ts` + `src/coroslink-api.ts` | `addManualActivityToCoros(input)` |
| Type | `electron/types.ts` → `ManualActivityInput` | shared main/renderer |
| UI | `src/training/components/ManualActivityPanel.tsx` (new) + mount in `TrainingHubView.tsx` | native Training Hub panel, behind the same COROS-auth guard |

### `ManualActivityInput`
```ts
export interface ManualActivityInput {
  sport: "run" | "bike" | "other";
  startTimeIso: string; // ISO-8601 UTC, e.g. "2026-07-08T14:00:00Z"
  durationSec: number;  // > 0
  distanceM: number;    // >= 0 (0 allowed for e.g. strength)
  calories?: number;    // optional, integer
  avgHr?: number;       // optional, bpm
}
```

### TCX shape produced
A single Activity with one Lap. TCX schema requires, in order, inside a Lap:
`TotalTimeSeconds`, `DistanceMeters`, `Calories`, `Intensity`, `TriggerMethod`
(with optional `AverageHeartRateBpm` emitted before `Intensity` when provided).
`Calories` is a required element → default `0` when the user leaves it blank.
The Activity `Sport` attribute is `Running` | `Biking` | `Other`; `Id` is the start time.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-07-08T14:00:00Z</Id>
      <Lap StartTime="2026-07-08T14:00:00Z">
        <TotalTimeSeconds>2700</TotalTimeSeconds>
        <DistanceMeters>8000</DistanceMeters>
        <Calories>500</Calories>
        <AverageHeartRateBpm><Value>145</Value></AverageHeartRateBpm>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
```

## Load-bearing unknown → live spike

Does COROS's import accept a TCX with **no `<Track>`/`<Trackpoint>`** (metadata-only)?
This is the one thing code review cannot settle. First implementation milestone is a
live test (the user is logged into COROS): add one manual activity and confirm it
appears in COROS. **If a trackpoint is required**, emit a single synthetic
`<Track><Trackpoint>` at the start time (with `<Time>` only, no GPS) and re-test.
Everything else (zip/S3/SigV4/import) is already proven.

## Error handling

- Validate input before building: `durationSec > 0`, `startTimeIso` parses, `distanceM >= 0`, optional numerics non-negative. Reject with a clear message.
- Reuse the upload path's existing errors (not signed in, S3 failure, import rejected).
- Temp `.tcx` always cleaned up (try/finally).

## Testing

- **Unit:** `tcxBuilder` — well-formed XML, correct sport mapping, required Lap children present and ordered, optional HR/calories included/omitted correctly, XML-escaping of any free text, and a `null`-effort case defaulting Calories to 0.
- **Manual (real account):** the live spike above, then the UI end-to-end.
