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

Running workouts use `sportType: 1`. Distance targets use `targetType: 5` with
values in **centimeters** (meters × 100). Time targets use `targetType: 2` with
seconds.

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
