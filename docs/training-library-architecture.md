# Training Library architecture

The Training Library is CorosLink's unified workspace for reusable workouts,
grouped training plans, local templates, and plan-to-activity adherence. It
extends the existing workout codecs and Training Hub service instead of
creating a second workout protocol.

## Model and ownership

- `TrainingLibraryWorkout` decorates a COROS library summary with local
  favorites, tags, collection membership, references, cache metadata, and sync
  state. Full workout reads and edits still use the existing lossless workout
  editor document and revision check.
- `TrainingPlanDocument` is the grouped local model. Entries can reference an
  existing `programId`, embed a typed `PlanWorkoutEntryInput`, represent rest or
  notes, or stay in a holding area. Plan phases, metadata, dates, known remote
  identity/version fields, and planned metrics remain on the grouped object.
- Native plans use `NativeCorosPlanDetail` at the API boundary. Known fields are
  typed; the raw response is cached unchanged so unknown first-party fields are
  not discarded.
- `TrainingActivityMatch` links a scheduled occurrence to a completed activity
  with confidence, planned/completed metrics, status, and a durable manual
  override.

SQLite tables are additive: `training_plans`, `training_workout_metadata`,
`training_collections`, `training_plan_workout_links`, and
`training_activity_matches`. Startup uses `CREATE TABLE IF NOT EXISTS`; the
existing database and legacy database migration are preserved.

## Sync strategy

The renderer requests one `TrainingLibrarySnapshot` through typed preload/IPC
methods. The main process loads workouts, native plans, and the relevant
calendar range in parallel. Successful remote reads update the cache. A failed
source contributes a human-readable partial failure while cached workouts and
plans remain visible. Items distinguish `local`, `synced`, `pending`,
`conflicted`, `failed`, and `stale` states.

Remote plan logic stays in `corosTrainingPlanAdapter.ts` and
`trainingLibraryService.ts`; React does not call COROS endpoints. Snapshot
refresh is explicit and shared across tabs to avoid per-card API waterfalls.

Native plan edits currently fork to a local copy. This prevents a local change
from claiming to overwrite COROS when native update semantics have not been
verified. Local plan/template edits, duplication, date shifting, week
operations, comparison, and metadata changes remain fully available.

## Verified COROS surface

As of 2026-07-29:

- Verified existing flows: workout program query/detail/calculate/add/update/
  delete and calendar query/update.
- Verified read-only native plan discovery: `POST /training/plan/query`.
- Verified read-only native plan detail: `GET /training/plan/detail` with `id`
  and `supportRestExercise=1`.
- Observed in the first-party bundle but not live-write-verified:
  `/training/plan/add`, `update`, `copy`, `delete`,
  `/training/schedule/executeSubPlan`, and
  `/training/schedule/quitSubPlan`.

All native writes are feature-gated. The reason is returned as typed capability
data and shown in both the Training Plan Library and Coach confirmation card.
No guessed payload is sent.

## Safety and fallbacks

- Remote workout deletion, plan deletion, collection deletion, and bulk
  deletion require an explicit confirmation flag; the renderer displays the
  affected records and known references first.
- Coach tool calls can create a draft but cannot execute a plan upload. Only the
  athlete's confirmation card invokes the write IPC method after a destination
  is selected and the writes/conflicts are displayed.
- Coach fallbacks are COROS Workout Library, direct COROS Calendar scheduling,
  and a zero-remote-write local template.
- Authentication tokens and request headers are never included in plan logs or
  stored raw payloads.
- Native write verification must remain opt-in and isolated. A future verifier
  must create uniquely named temporary data and remove activation, calendar,
  plan, and workout artifacts in `finally` before any write capability is
  enabled.

## Tests

`npm run test:training-library` covers additive legacy migration and data
preservation, typed/native parsing with unknown-field retention, persistence
links, schedule shifting, week operations, plan comparison, conflict counting,
automatic/manual activity pairing, confirmation guards, and the existing
workout/intensity codecs. The SQLite portion runs with Electron's embedded Node
ABI, matching the packaged application.
