# COROS Training Plan Write API (internal)

Reverse-engineered from the COROS Training Hub web app and verified against the
live API. These endpoints are **undocumented** and may change.

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
| `/training/schedule/query` | GET | Read calendar (`startDate`, `endDate`, `supportRestExercise=1`) |
| `/training/schedule/update` | POST | Add, edit, or delete calendar entries (`status: 1`, `2`, or `3`) |

## Create library workout

1. Build the program payload with `exercises[]`, `sportType`, `name`, etc., and
   clear identity fields (`id: "0"`, etc.).
2. `POST /training/program/calculate` with that payload.
3. Merge `planDistance`, `planDuration`, `planTrainingLoad`, `planSets`,
   `planPitch`, `distanceDisplayUnit`, and `exerciseBarChart` into the program.
4. `POST /training/program/add` with the calculated payload.
5. Response `data` is the new program ID string.

Running workouts use `sportType: 1`. The full `targetType` enum (from the
traininghub web-app bundle, `main-*.js` → `targetTypeName`):

| value | name | targetValue encoding | UI label |
|---|---|---|---|
| 0 | notSet | 0 | — |
| 1 | manualEnd | 0 (no value) | **Open** |
| 2 | time | seconds | **Time** |
| 3 | count | raw | — |
| 4 | heart | raw | — |
| 5 | distance | **centimeters** (meters × 100) | **Distance** |
| 6 | load | raw integer 0–999 | **Training Load** |
| 7 | heartRateRecovery | absolute bpm | **HR Recovery** on Rest steps |
| 8 | cumulativeClimb | centimeters | — |
| 9 | routes | raw | — |

The web app derives `targetValue` as `100 × meters` for distance, `cm` for
cumulativeClimb, and the **raw input value** for everything else (time, load, …).
Related enums: `intensityType` (2=heart, 3=pace, 4=speed, 6=power, 8=adjustedPace,
9=ftp, 11=rpe), `intensityUnit` (1=min/km, 2=min/mi, 3=s/100m, 4=km/h, 5=mph),
`restType` (0=manualEnd, 1=time, 2=heart, 3=noRest, 4=distance).

Distance-step `targetDisplayUnit` is 2 (meters); an overall metric workout uses
`distanceDisplayUnit: 1` (kilometers). Pace targets use seconds per kilometer
multiplied by 1000, `intensityMultiplier: 1000`, and an ordered low/high range.
For example, `4:05-4:15/km` is encoded as `245000..255000` with
`intensityDisplayUnit: 1`.

Heart-rate recovery is a Rest-only completion target. COROS stores the selected
return-to heart rate directly in `targetValue`; unlike a timed recovery, the
watch waits until the athlete's heart rate reaches that bpm.

## Edit an existing workout

Editing must not use the create reset path. Load a fresh full source, retain its
identity, source, and version fields, patch its `exercises[]`, and reject the
save if the source version changed after the editor loaded.

The flattened exercise array uses group-header exercises (`isGroup: true`) and
child exercises whose `groupId` is the header ID. Editing rebuilds `sortNo`,
`groupId`, group counts, and program summaries. Existing exercise IDs stay
stable; new IDs are allocated above the highest source exercise ID. Fields the
Run editor does not understand remain on their original raw objects.

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
  "pbVersion": 2
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
  "pbVersion": 2
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
  "pbVersion": 2
}
```

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

CorosLink's coach “plan” is a local, confirmation-gated draft whose workouts are
written to the athlete's Workout Library and Training Calendar. It does not
create a reusable entry in COROS's separate Training Plan Library via
`/training/plan/add`. Calendar placement is sufficient for COROS App/watch
calendar sync, but the distinction matters when describing the result.

## Fixtures

See `scripts/fixtures/coros-plan-write/` for redacted request/response samples.
For a cleanup-safe live contract check, run `npm run verify:coach-workout-api`
while a COROS session is saved in CorosLink. The verifier creates, schedules,
edits, reads back, checks library/calendar isolation, and deletes both temporary
artifacts in `finally`.
