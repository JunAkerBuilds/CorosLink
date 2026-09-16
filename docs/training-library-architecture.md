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

Native plan edits in the Training Plan Library UI still fork to a local copy
rather than push back through `/training/plan/update` — that UI flow hasn't
been built yet, independent of the fact that update semantics are now
verified (see below). Local plan/template edits, duplication, date shifting,
week operations, comparison, and metadata changes remain fully available.

## Verified COROS surface

As of 2026-09-12 (issue #4):

- Verified existing flows: workout program query/detail/calculate/add/update/
  delete and calendar query/update.
- Verified native plan discovery: `POST /training/plan/query`.
- Verified native plan detail: `GET /training/plan/detail` with `id` and
  `supportRestExercise=1`.
- Verified native plan writes: `/training/plan/add`, `update`, `copy`,
  `delete`, `/training/schedule/executeSubPlan`, and
  `/training/schedule/quitSubPlan` — see
  [`docs/coros-plan-write-api.md`](coros-plan-write-api.md) for the captured
  request/response shapes and
  `scripts/verify-coros-plan-write-api.mjs` for the cleanup-safe live check.

Coach's "COROS Plan" and "COROS Plan on Calendar" destinations use
`uploadNativeTrainingPlan`/`activateNativeTrainingPlan` to create (and
optionally activate) a grouped native plan. No other native-plan UI flow
(editing, duplicating, or deleting a plan already in the COROS Plan Library)
has been wired up yet, even though the underlying write functions
(`updateNativeTrainingPlan`, `copyNativeTrainingPlan`,
`deleteNativeTrainingPlan`) exist and are exercised by the verifier.

## Safety and fallbacks

- Remote workout deletion, plan deletion, collection deletion, and bulk
  deletion require an explicit confirmation flag; the renderer displays the
  affected records and known references first.
- Coach tool calls can create a draft but cannot execute a plan upload. Only the
  athlete's confirmation card invokes the write IPC method after a destination
  is selected and the writes/conflicts are displayed.
- Coach plans save as grouped local plans by default. Explicit alternatives are
  individual COROS Workout Library writes, direct COROS Calendar scheduling, a
  zero-remote-write local template, or a grouped native COROS Plan (optionally
  activated straight onto the Calendar).
- Authentication tokens and request headers are never included in plan logs or
  stored raw payloads.
- Native write verification is opt-in and isolated:
  `npm run verify:coros-plan-write-api` creates a uniquely named temporary
  plan and removes its activation, calendar, and library artifacts in
  `finally`, with a defensive by-name sweep so a failed assertion midway
  through can't strand a plan on the account.

## Tests

`npm run test:training-library` covers additive legacy migration and data
preservation, typed/native parsing with unknown-field retention, persistence
links, schedule shifting, week operations, plan comparison, conflict counting,
automatic/manual activity pairing, confirmation guards, and the existing
workout/intensity codecs. The SQLite portion runs with Electron's embedded Node
ABI, matching the packaged application.
