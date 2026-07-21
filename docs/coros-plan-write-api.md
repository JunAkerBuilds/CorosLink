# COROS Training Plan Write API (internal)

Reverse-engineered from the COROS Training Hub web app and corroborated against
community MCP implementations. These endpoints are **undocumented** and may change.

All requests use the existing Training Hub session (`accesstoken` + `yfheader`
with `userId`) against the regional `teamapi*.coros.com` host.

## Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/training/program/calculate` | POST | Optional pre-save metrics (duration, load) |
| `/training/program/add` | POST | Save workout to library |
| `/training/program/query` | POST | List library workouts |
| `/training/program/delete` | POST | Delete library workout(s) |
| `/training/schedule/query` | GET | Read calendar (`startDate`, `endDate`, `supportRestExercise=1`) |
| `/training/program/delete` | POST | Delete library workout(s), body: `["programId"]` |
| `/training/schedule/update` | POST | Add/update/delete calendar entries (`status: 3` = delete) |

## Create library workout

1. Build program payload with `exercises[]`, `sportType`, `name`, etc.
2. `POST /training/program/add` with identity fields cleared (`id: "0"`, etc.)
3. Response `data` is the new program ID string.

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
| 7 | heartRateRecovery | raw | — |
| 8 | cumulativeClimb | centimeters | — |
| 9 | routes | raw | — |

The web app derives `targetValue` as `100 × meters` for distance, `cm` for
cumulativeClimb, and the **raw input value** for everything else (time, load, …).
Related enums: `intensityType` (2=heart, 3=pace, 4=speed, 6=power, 8=adjustedPace,
9=ftp, 11=rpe), `intensityUnit` (1=min/km, 2=min/mi, 3=s/100m, 4=km/h, 5=mph),
`restType` (0=manualEnd, 1=time, 2=heart, 3=noRest, 4=distance).

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
    "sortNoInSchedule": 1
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

1. Create in library via `/training/program/add` (optional but recommended)
2. Schedule each occurrence via `/training/schedule/update` with the program
   embedded in `programs[]`

One-off calendar workouts can skip the library step and embed the program
directly in the schedule update payload.

## Fixtures

See `scripts/fixtures/coros-plan-write/` for redacted request/response samples.
