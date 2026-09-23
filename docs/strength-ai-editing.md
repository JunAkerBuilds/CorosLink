# Strength edits in Coach and external MCP

Implemented locally on 2026-09-21. Automated verification uses isolated fixtures
and mocked COROS responses; this feature has not yet been verified with live
strength writes on a COROS test account.

## Use in Coach

Connect Training Hub, then ask Coach to edit an existing strength workout's
sets, reps, timed/open target, weight/bodyweight, or timed inter-set rest.
Coach reads the original workout and prepares a before/after review. Select
workouts and click **Save to COROS**. Tool calls cannot approve or execute saves.

For equipment progression, specify the equipment/exercises, old and new load,
and destinations. For example: “Change my kettlebell swing steps from 26 lb to
36 lb in my library and calendar from September 22 through October 31.”
The tool matches exact catalog exercise IDs and COROS's 0.01 kg storage
precision. A 12 kg prescription is not silently treated as a 26 lb prescription.
Pound values read back from COROS may show small rounding differences.

Library templates and calendar copies are separate. Only reviewed, selected
workouts change. Reps, warmup loads, unrelated exercises, circuit repeat counts,
and unknown metadata are retained unless explicitly changed. Patches operate
on original raw exercises instead of rebuilding the entire workout.

## External clients

Open **Settings → External AI → Strength workouts**, enable workout access,
and copy the Codex configuration. Other local MCP clients can use the displayed
HTTP URL with the displayed token in a Bearer authorization header. This is a
separate endpoint/token from watch-face access. Disabling it revokes the token,
invalidates external document handles, and cancels pending external edits.

Keep CorosLink open. Prepared requests appear under **Workout reviews** in
Settings. Refresh reviews, inspect the exact changes, and save in the app.
The client can call `get_workout_edit_status` to report the result. The MCP
protocol is tested with the SDK client; individual Claude Desktop/Codex app
connection flows have not been manually certified. Hosted ChatGPT connectors
cannot use this loopback endpoint. In-app OpenAI Coach uses the same edit service.

Tools: `find_editable_workouts`, `read_workout_for_edit`,
`prepare_workout_edit`, `prepare_exercise_load_update`,
`get_workout_edit_status`, and `cancel_workout_edit`.

## Limits and failure handling

- Strength only. HYROX, other sports, local embedded plan templates, and native
  COROS plan writes are outside this release.
- Calendar dates must be strictly in the future. Today's workouts and history
  are excluded. An explicit search range can cover at most 90 days.
- Native-plan ownership is checked with a fresh inventory. A nonzero calendar
  `planId` does not by itself mean native ownership. A matching native plan is
  excluded; an installed or insufficiently described native plan makes ownership
  ambiguous and calendar edits are blocked. Library edits remain available.
- At most 200 discovery candidates and 25 workouts per proposal. Larger searches
  are rejected, not truncated. A failed detail read is an explicit exclusion.
  “All” never means beyond the displayed references and date range.
- Reviews expire after 24 hours; resolved results are retained for seven days.
  Unresolved writes remain retained until read-back establishes their outcome. Changing
  account/region invalidates approval. A restarted app does not resume writes.
- Full source fingerprints are checked during staging, whole-batch preflight,
  and immediately before each mutation. If preflight fails, nothing is sent.
  COROS does not provide a verified conditional-write contract here, so a remote
  edit in the final read/write interval remains a limitation.
- Saves are sequential and journaled before dispatch. Mutations are sent once
  with a 30-second timeout; there is no automatic retry or rollback. Cancellation
  stops remaining items after an in-flight request settles.
- Each acknowledged save is read back. A timeout is **unknown outcome**;
  acknowledgement without matching read-back is **saved unverified**. Refresh
  status reconciles by reading only. Unresolved saves block new proposals for
  the same workout until reconciled. Do not keep submitting replacement edits.
- A partial batch reports each result. Unsent items need a fresh review. Saving
  to COROS does not claim that a physical watch has synchronized yet.

## Implementation and verification

`strengthWorkoutPatch.ts` owns strict patch validation, canonical load matching,
raw-field preservation, source fingerprints, and read-back comparison.
`workoutEditService.ts` owns proposals, account binding, selection validation,
preflight, cancellation, and the execution journal. `workoutEditRuntime.ts`
connects it to Training Hub and the existing SQLite settings store.
`workoutAutomation.ts` exposes separately authenticated local MCP staging and
trusted main-window review IPC. Coach and Settings share `WorkoutEditCard`.

Run:

```sh
npm run test:strength-workout-edits
npm run test:strength-review-ui
npm run build
```

The tests cover preservation, units, bodyweight/zero, repeat groups, stale
revisions, account changes, invalid/duplicate patches, no-op edits, selection,
partial failures, cancellation, restart, expiry, duplicate approval, uncertain
write reconciliation, local MCP authentication/schema isolation, and a real
React/preload/service/SQLite review flow. Existing Coach, editor, intensity,
Training Hub write-response, and watch-face server regressions also pass.

Before a production release, use an explicitly designated test account to
verify temporary library and future standalone calendar edits and cleanup.
Native plans remain gated. Do not use real workout history as test data.
