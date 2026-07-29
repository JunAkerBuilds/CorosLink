# COROS Training Plan Write API (internal)

Reverse-engineered from the COROS Training Hub web app. The workout-program and
calendar contracts below have been verified against the live API. Native
Training Plan Library support has only been verified for reads as of
2026-07-29. These endpoints are **undocumented** and may change.

All requests use the existing Training Hub session (`accesstoken` + `yfheader`
with `userId`) against the regional `teamapi*.coros.com` host.

This is the private API used by the first-party Training Hub web app. It is not
the partner-only COROS OpenAPI training-plan push API, and it is not the COROS
MCP service. The COROS MCP is currently read-only; CorosLink performs writes
through the athlete's authenticated Training Hub session.

## Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/training/program/calculate` | POST | Compute distance, duration, load, sets, and bar chart before a write |
| `/training/program/add` | POST | Save workout to library |
| `/training/program/query` | POST | List library workouts |
| `/training/program/detail` | GET | Read a full library workout (`id`, `supportRestExercise=1`) |
| `/training/program/estimate` | POST | Preview a scheduled occurrence with `{ entity, program }` |
| `/training/program/update` | POST | Update a full library workout while retaining identity fields |
| `/training/program/delete` | POST | Delete library workout(s) |
| `/training/exercise/query` | GET | Resolve Strength and HYROX exercise IDs/names |
| `/training/schedule/query` | GET | Read calendar (`startDate`, `endDate`, `supportRestExercise=1`) |
| `/training/schedule/update` | POST | Add, edit, or delete calendar entries (`status: 1`, `2`, or `3`) |
| `/training/plan/query` | POST | List native COROS Training Plan Library records; read verified |
| `/training/plan/detail` | GET | Read native plan detail (`id`, `supportRestExercise=1`); read verified |

## Native COROS Training Plan Library

CorosLink keeps native plans behind `corosTrainingPlanAdapter.ts`, separate
from individual `/training/program/*` workout operations. The adapter maps the
known plan, entity, program, and week-stage fields into typed models while
retaining the complete raw payload for forward-compatible, lossless caching.

The 2026-07-29 first-party Training Hub bundle references these additional
operations:

| Path | Method | Observed first-party purpose | CorosLink status |
|---|---|---|---|
| `/training/plan/add` | POST | Create grouped plan | Feature-gated; write payload not live verified |
| `/training/plan/update` | POST | Update grouped plan | Feature-gated; concurrency/write behavior not live verified |
| `/training/plan/copy` | POST | Duplicate grouped plan | Feature-gated; write payload not live verified |
| `/training/plan/delete` | POST | Delete grouped plan | Feature-gated; delete/active-plan behavior not live verified |
| `/training/schedule/executeSubPlan` | POST | Activate/schedule a plan | Feature-gated; activation payload not live verified |
| `/training/schedule/quitSubPlan` | POST | Remove active plan | Feature-gated; cleanup semantics not live verified |

The bundle assembles plan-create data from fields including `name`, `overview`,
`entities`, `programs`, `weekStages`, `maxIdInPlan`, `totalDay`, `unit`,
`sourceId`, `sourceUrl`, `minWeeks`, `maxWeeks`, `region`, `pbVersion`, and
`versionObjects`. That observation is not sufficient evidence to send a write:
required defaults, identity allocation, version checks, and cleanup behavior
remain uncertain. CorosLink therefore does not guess these payloads.

Native plan query and detail were checked with a saved Training Hub session and
no credentials or sensitive headers were logged. Some active-plan detail
responses omit `programs`; the adapter merges detail-only fields with the full
grouped arrays returned by `/training/plan/query`.

Until a cleanup-safe, explicitly opted-in verifier proves the complete
create/read/update/activate/remove/delete lifecycle, the UI exposes the exact
limitation and preserves the verified alternatives: local grouped templates,
individual Workout Library writes, and direct calendar scheduling.

## Create library workout

1. Build the program payload with `exercises[]`, `sportType`, `name`, etc., and
   clear identity fields (`id: "0"`, etc.).
2. `POST /training/program/calculate` with that payload.
3. Merge `planDistance`, `planDuration`, `planTrainingLoad`, `planSets`,
   `planPitch`, `distanceDisplayUnit`, and `exerciseBarChart` into the program.
4. `POST /training/program/add` with the calculated payload.
5. Response `data` is the new program ID string.

Workout sport IDs are Run 1, Bike 2, Pool Swim 3, Strength 4, Trail Run 5,
Indoor Climb 6, Bouldering 7, XC Ski 8, and HYROX 9. The full `targetType` enum (from the
traininghub web-app bundle, `main-*.js` → `targetTypeName`):

| Sport | Step targets | Intensity types / secondary control |
|---|---|---|
| Run | Time, Distance, Training Load, Open; Rest also HR Recovery | % Max HR, % HRR, % LTHR (preset or custom %), Heart Rate (bpm), % Threshold Pace, Pace, % Effort Pace, Effort Pace, running Power (zone or watts), Cadence, Not set |
| Trail Run | Run targets plus Elevation Gain | Same as Run |
| Bike | Time, Distance, Training Load, Open; Rest also HR Recovery | % Max HR, % HRR, % LTHR, Heart Rate, % FTP, Speed, Power, Cadence, Not set |
| Pool Swim | Distance, Time, Training Load, Open; Rest also HR Recovery; Send-off uses Distance plus interval | Stroke (Freestyle, Breaststroke, Backstroke, Butterfly, Mix, Individual Medley, Drills, Not set) |
| Strength | Training: Reps, Time, Open; other steps: Time/Open; Rest also HR Recovery | Training exercise plus Bodyweight/Weight; non-training steps use Not set |
| XC Ski | Time, Distance, Training Load, Elevation Gain, Open; Rest also HR Recovery | % Max HR, % HRR, % LTHR, Heart Rate, Speed, Not set |
| Indoor Climb / Bouldering | Routes, Time, Open | Relative-to-onsight or absolute Grade using the workout grading system |
| HYROX | Running steps use Run targets; Rest uses Time, HR Recovery, Open; functional targets depend on exercise kind | Running intensity set plus RPE; functional exercise kinds use Cadence/RPE or Weight/RPE as supported |

| value | name | targetValue encoding | UI label |
|---|---|---|---|
| 0 | notSet | 0 | — |
| 1 | manualEnd | 0 (no value) | **Open** |
| 2 | time | seconds | **Time** |
| 3 | count | raw | **Reps** |
| 4 | heart | raw | — |
| 5 | distance | **centimeters** (meters × 100) | **Distance** |
| 6 | load | raw integer 0–999 | **Training Load** |
| 7 | heartRateRecovery | absolute bpm | **HR Recovery** on Rest steps |
| 8 | cumulativeClimb | centimeters | **Elevation Gain** |
| 9 | routes | raw | **Routes** |

The web app derives `targetValue` as `100 × meters` for distance, `cm` for
cumulativeClimb, and the **raw input value** for everything else (time, load, …).
Related enums: `intensityType` (1=weight, 2=heart, 3=pace, 4=speed, 5=stroke,
6=power, 7=cadence, 8=effort pace, 9=FTP, 10=grade, 11=RPE), `intensityUnit`
(1=min/km, 2=min/mi, 3=s/100m, 4=km/h, 5=mph, 6=kg, 7=lbs),
`restType` (0=manualEnd, 1=time, 2=heart, 3=noRest, 4=distance).

Distance-step `targetDisplayUnit` is 2 (meters); an overall metric workout uses
`distanceDisplayUnit: 1` (kilometers). Pace targets use seconds per kilometer
multiplied by 1000, `intensityMultiplier: 1000`, and an ordered low/high range.
For example, `4:05-4:15/km` is encoded as `245000..255000` with
`intensityDisplayUnit: 1`. Speed is stored as km/h ×100. A custom yard pool
length is converted to centimeters and uses `poolLengthUnit: 4` (for example,
25 yd is `poolLength: 2286`).

The program `pbVersion` is feature-sensitive: effort pace requires at least 3,
zone IDs 6/7 require 5, FTP requires 6, climbing starts at 7, swim drills and
send-off/package steps require 8, and XC Ski/HYROX require 9.

Heart-rate recovery is a Rest-only completion target. COROS stores the selected
return-to heart rate directly in `targetValue`; unlike a timed recovery, the
watch waits until the athlete's heart rate reaches that bpm.

### Intensity codec

All new callers use the typed intensity objects in `electron/types.ts`; legacy
raw fields remain read-compatible but cannot be mixed with typed intensity on
one step. Percentage values are written in COROS's official ×1000 format and
the reader accepts both scaled values and older CorosLink unscaled values.

The issue #72 absolute-heart-rate form is deliberately encoded as
`intensityType: 2`, `hrType: 2`, `isIntensityPercent: false`,
`intensityCustom: 0`, with the requested bpm in `intensityValue` and
`intensityValueExtend`. The percent flag, not `hrType` by itself, distinguishes
absolute Heart Rate from Heart Rate Reserve.

Preset IDs are protocol values, not dropdown indexes. Max-HR zones are
Recovery 6 then Warm Up/Fat Burn/Aerobic Endurance/Threshold/Anaerobic 1–5;
HRR/LTHR use Recovery 6 then zones 1–5; threshold/effort pace use Recovery 7,
then 1, 2, 3, 5, 6. FTP uses 1–7 and running power 1–5. Swim strokes are
Freestyle 1, Breaststroke 2, Backstroke 3, Butterfly 4, Drills 6, Individual
Medley 7, Mix 255, and Not set 0.

## Edit an existing workout

Editing must not use the create reset path. Load a fresh full source, retain its
identity, source, and version fields, patch its `exercises[]`, and reject the
save if the source version changed after the editor loaded.

The flattened exercise array uses group-header exercises (`isGroup: true`) and
child exercises whose `groupId` is the header ID. Editing rebuilds `sortNo`,
`groupId`, group counts, and program summaries. Existing exercise IDs stay
stable; new IDs are allocated above the highest source exercise ID. Fields the
sport-aware editor does not understand remain on their original raw objects.

### Library definition

1. `GET /training/program/detail?id=...&supportRestExercise=1`.
2. Preview with `POST /training/program/calculate`.
3. On save, re-read and compare the version.
4. Calculate the edited full program without clearing IDs or versions.
5. Merge calculated distance, duration, load, sets, pitch, display unit, and bar
   chart.
6. `POST /training/program/update` with that full program.
7. Read `/training/program/detail` back and verify structure and totals.

### Scheduled occurrence

1. Load the matching raw `entity` and `program` from `/training/schedule/query`.
2. Preview with `POST /training/program/estimate` and body `{ entity, program }`.
3. On save, re-read and compare the version, then calculate the edited program.
4. `POST /training/schedule/update` with the original full entity and:

```json
{
  "entities": [{ "...original entity...": "..." }],
  "programs": [{ "...calculated edited program...": "..." }],
  "versionObjects": [{
    "id": "101",
    "status": 2,
    "planProgramId": "101",
    "planId": "425868133463670784"
  }],
  "pbVersion": "<program.pbVersion>"
}
```

`status: 2` is the first-party Training Hub's occurrence-edit operation. It is
not the move operation; CorosLink still moves workouts by add-then-delete.
Library and scheduled programs are independent copies, so neither edit flow
propagates into the other.

## Schedule on calendar

1. `GET /training/schedule/query?startDate=YYYYMMDD&endDate=YYYYMMDD&supportRestExercise=1`
2. Read `maxIdInPlan` from response data; next slot is `maxIdInPlan + 1`
3. Set `program.idInPlan` to that value
4. `POST /training/schedule/update`:

```json
{
  "entities": [{
    "happenDay": "20260707",
    "idInPlan": 42,
    "sortNoInSchedule": 1,
    "exerciseBarChart": [{ "...calculated chart entry...": "..." }]
  }],
  "programs": [{ "...full program payload..." }],
  "versionObjects": [{ "id": 42, "status": 1 }],
  "pbVersion": "<program.pbVersion>"
}
```

`status: 1` = add/update, `status: 3` = delete.

### Delete from calendar

```json
{
  "versionObjects": [{
    "id": "101",
    "planProgramId": "101",
    "planId": "425868133463670784",
    "status": 3
  }],
  "pbVersion": "<program.pbVersion>"
}
```

The shown value is always copied from the computed program; it is not hardcoded
to the Run base version.

### Delete from library

`POST /training/program/delete` with body `["425868133463670784"]`.

## Multi-day plan flow

For each unique workout definition:

1. Calculate it via `/training/program/calculate`.
2. Create it in the workout library via `/training/program/add` (optional).
3. Schedule each occurrence via `/training/schedule/update` with the program
   embedded in `programs[]`

One-off calendar workouts can skip the library step and embed the program
directly in the schedule update payload.

CorosLink's Coach “plan” is a local, confirmation-gated draft. The athlete must
choose Workout Library, Calendar, local CorosLink template, COROS Plan Library,
or Plan + Calendar on the card. The native grouped choices remain disabled
while their writes are unverified. The active alternatives write individual
workouts, write dated calendar occurrences, or save only to local SQLite. An AI
tool call cannot execute the upload path.

## Fixtures

See `scripts/fixtures/coros-plan-write/` for redacted request/response samples.
For a cleanup-safe live contract check, run `npm run verify:coach-workout-api`
while a COROS session is saved in CorosLink. The verifier creates, schedules,
edits, reads back, checks library/calendar isolation for Run, then creates,
round-trips, edits, and deletes a representative workout for every supported
sport. All temporary artifacts are deleted in `finally`.
