# Strength editing through Coach and MCP

Status: initial implementation completed locally, 2026-09-21. See [implementation notes and verification limits](strength-ai-editing.md). Live COROS test-account verification remains outstanding; no remote workouts were changed during implementation.

## Outcome and scope

An athlete can ask Coach to change an existing strength workout's sets, reps, timed target, load, or rest, inspect the exact changes, and save them in place. They can also request an equipment progression such as “change my 26 lb kettlebell to 36 lb,” review the matching workouts, and apply the selected updates with an accurate result for each workout.

Use the same edit service for Coach and external MCP clients. Initial delivery covers strength library workouts and independently editable future calendar occurrences. Other sports can use the architecture later, but are not enabled merely because the manual editor supports them. HYROX requires its own capability and regression coverage.

“Every workout” means all discovered matches within the explicitly displayed destinations and date range, not every historical record or all future workouts forever. This is a one-time update, not a persistent equipment substitution rule.

## Current evidence

- `electron/chatWorkoutTools.ts` exposes search, drafting, upload staging, calendar listing, and deletion staging; there is no local edit-existing tool.
- `electron/trainingHubService.ts` provides `getWorkoutForEdit`, `previewWorkoutEdit`, and `saveWorkoutEdit`, including source revision checks and read-back verification.
- `electron/corosWorkoutEditor.ts` maps strength exercises, sets, rest, targets, and intensity; preserves source data; and builds library/calendar writes. Unsupported steps can remain visible but uneditable.
- `electron/types.ts` identifies a library workout by `programId`; a calendar occurrence requires `happenDay`, `planId`, `idInPlan`, and `planProgramId`. Preserve IDs as strings.
- `electron/coachCorosTools.ts` routes strength away from the official MCP authoring schema. Official MCP sport numbers differ from local ones.
- `electron/watchfaceAutomationServer.ts` exposes local watch-face automation only.
- Native plan writes remain disabled. See `docs/training-library-architecture.md` and `docs/coros-plan-write-api.md`. A plan conversion helper does not prove remote plan-update support.
- Some API documentation is stale about official MCP being entirely read-only; update that wording during implementation without claiming a COROS roadmap.

These findings describe the current working tree, which already contains unrelated uncommitted changes. Integrate with those changes without reverting them.

## User experience and tool contract

1. Discover candidates through local Training Hub reads, without requiring the official COROS MCP connection. Return source, name, date, ownership, freshness, and edit capabilities. Exhaust pagination or explicitly report an incomplete search.
2. Read a full editable document and return an opaque document handle, revision, and stable step handles. Duplicate names never identify a write target.
3. Prepare a typed patch proposal. Return an immutable proposal ID, exact before/after diff, exclusions, scan completeness, and `awaiting_confirmation`. No update endpoint is called.
4. Show one review card in Coach, or a pending review in CorosLink for an external client. The athlete can deselect workouts. Changing selection or any values creates a new bound review version.
5. Save from the trusted app review action. Persist results and let either client query progress. A model-supplied `confirmed: true` is not execution authority.

Proposed tools:

| Tool | Contract |
| --- | --- |
| `find_editable_workouts` | Paginated discovery by source, sport, date range, and optional query; reports completeness and capabilities |
| `read_workout_for_edit` | Full readable document, revision, exact step handles, ownership, and unsupported fields |
| `prepare_workout_edit` | Single document handle/revision plus allowlisted absolute field changes |
| `prepare_exercise_load_update` | Explicit scope, catalog exercise IDs and/or reviewed step selections, old/new load with units; prepares a bounded batch |
| `get_workout_edit_status` | Proposal and per-item result, including verified, conflicted, and uncertain outcomes |
| `cancel_workout_edit` | Cancel pending work or stop between writes; never claims to undo completed saves |

Tool names are proposed; align them with existing naming conventions during implementation. Share their schemas and handlers across transports. Keep the execution function out of the model tool registry.

Single-edit patches use typed setters for sets, target, intensity/load, and rest, with expected previous values. No raw COROS payloads, arbitrary JSON paths, identifiers, ownership fields, sport conversion, insertion, deletion, or reorder in the initial release. Resolve handles against the stored source revision, not a later array index. Reject duplicate/conflicting patches instead of applying order-dependent behavior.

## Shared service and persistence

Add `electron/workoutEditService.ts` for discovery orchestration, eligibility, patching, diffs, preview, and execution; `electron/workoutEditStore.ts` for durable proposals and progress; and shared types in `electron/types.ts`. Reuse the existing editor codecs and Training Hub endpoints. Keep React, Coach, and MCP adapters thin.

Store a proposal with account identity and region, creation/expiry time, scope/date interpretation, scan completeness, base revisions, source snapshots, expected patched documents, selected items, preview hash, and per-item execution journal. Do not store credentials. Use an additive database migration and a defined retention period; expired proposal payloads are pruned. Start with a 24-hour proposal expiry; revalidation is still required at every save.

Bind approval to account, proposal version/hash, exact selection, and expected changes. Switching account/region invalidates pending approval. Changes after review require a fresh review. App restart restores pending reviews but never silently resumes writes; interrupted in-flight writes enter reconciliation.

Suggested item states: `prepared`, `excluded`, `writing`, `verified`, `saved_unverified`, `conflicted`, `failed`, `unknown_outcome`, `cancelled`. The batch summary is derived from item states; it never collapses partial success into “updated everything.” An acknowledged save without matching read-back is distinct from a timeout whose write outcome is unknown.

## Matching, units, and preservation

| Case | Required behavior |
| --- | --- |
| “26 lb to 36 lb” without exercise/equipment context | Discover candidates and surface ambiguity; do not replace unrelated dumbbell, machine, or barbell loads |
| Equipment metadata missing | Catalog IDs and reviewed selections are authoritative; names can suggest candidates but cannot silently authorize equipment matching |
| Approximate commercial label, e.g. 26 lb vs 12 kg | Show as a possible match requiring selection; do not widen exact matching with an arbitrary tolerance |
| kg/lb conversion | Use existing codec precision and canonical units; distinguish representational rounding from a genuinely different load; show source and resulting units |
| Account display-unit change | Preserve stored proposal meaning; do not reinterpret an old number using new settings |
| Per-hand vs total load | Preserve COROS's existing convention; ask for missing semantics when needed, never automatically double or halve |
| Bodyweight, missing load, zero, assisted/negative load | Distinguish representations and validate against verified capabilities; never infer that zero means a weighted exercise |
| Multiple identical exercises | Match catalog identity plus step handle and expected old load; enumerate all changed occurrences |
| Warmups, drop sets, unilateral steps, varied loads | Only update selected matching steps; preserve different loads, reps, timing, and exercise order |
| Sets vs repeat groups | Keep exercise sets and circuit repetitions separate; never multiply one into the other |
| Time/open targets | A load-only patch leaves target kind/value unchanged; reps conversion requires an explicit target patch |
| Rest modes | Preserve timed/open/HR recovery semantics; validate compatible rest fields together |
| Unknown metadata or unsupported steps | Retain them unchanged; reject changes to unsupported fields and block writes if lossless preservation cannot be demonstrated |
| Invalid or already-applied patch | Reject nonfinite/out-of-range values and unsupported units; report a no-op without sending an update |

Diff the final serialized program against the original as well as the editor draft. Allow only requested fields and documented derived calculation fields. Audit conversion defaults/clamping so loading and reserializing a legacy workout cannot silently normalize unrelated data. Verify calculated output does not alter the approved prescription.

## Destination and calendar rules

- Library templates and scheduled copies are separate targets. Deduplicate by full account-scoped reference, never workout name or library ID alone. Updating one does not authorize or imply updating the other.
- Require an explicit calendar end date in the prepared scope. If the request omits it, show a proposed horizon in the review; never imply an unbounded search. Library-only edits need no date range.
- Use COROS calendar-day semantics consistently. Validate actual dates, not only eight digits. Freeze date interpretation in the proposal and recheck eligibility at save, including midnight and timezone changes.
- Exclude past occurrences. Exclude completed or active occurrences, including today, when completion/activity evidence exists. Today requires verified eligibility rather than assuming every non-past entry is editable.
- If a workout is moved, deleted, completed, or reassigned after review, invalidate that target. Do not follow a similar name or a new date automatically.
- Classify native plan ownership before staging. Block native plan-owned mutations until the applicable write path and version behavior are verified; do not route them through a standalone endpoint as a workaround. If ownership cannot be established, report that target as unresolved.
- Local grouped templates and embedded plan workouts are a separate scope and later adapter. Do not silently change them when modifying a remote library reference, or claim that local edits update a native COROS plan.
- Cached data can populate discovery but cannot authorize a write. Missing pages, failed detail reads, unavailable account context, and unresolved exercise catalogs appear as exclusions or incomplete scope. Never claim “all” after a partial scan.

## Concurrency, failures, and retries

Preflight every selected item immediately before starting: account/session, capability, ownership, date/status, source revision, validation, and preview consistency. If any selected item fails preflight, perform zero writes and offer an updated review. Serialize writes initially, with bounded batch size and discovery ranges exposed as capabilities; reject oversized requests rather than silently truncating. Choose numeric limits from endpoint behavior and measurement before release.

Use a durable execution claim and account/target locking to prevent double-clicks or two clients executing the same proposal. Cover manual editor writes too where practical. Recheck the target revision immediately before each write. Verify whether COROS supports server-enforced conditional writes; local revision checks alone cannot eliminate the read/write race with the official app. Document that residual limitation if no remote condition is available.

Persist `writing` before sending each update. After each write, read back the prescription and relevant derived values through the existing verification mechanism. Use bounded read-only retries for eventual consistency. A library write must not cause later scheduled-copy saves to proceed from stale assumptions.

On a mid-batch conflict or write failure, stop before the next item and report already verified items plus unsent items. Authentication loss stops the batch. Cancellation waits for the current request to settle; it cannot retract an accepted write.

For timeout, network loss, process crash, or ambiguous response: reconcile by reading the target. Matching desired state means verified; a different state means conflict/uncertainty, not permission to overwrite. Do not blindly resend or create a replacement workout. Retry/resume prepares a review of unresolved items; completed items remain immutable in the original journal. Apply read retry/backoff and rate-limit handling, but retry mutations only when non-application is established and the reviewed target is still current.

There is no multi-workout transaction. Do not promise atomic bulk edits or automatically roll back successful ones. A future “revert” is a new reviewed proposal using saved before-values and checking that the current values still match the prior result.

## Coach and external MCP integration

Coach routing should choose the local edit tools for eligible strength requests, instead of drafting duplicates or calling incompatible official MCP tools. Information-only requests do not stage changes. Tool errors and text state whether work is proposed, saved, or verified. Support the same structured tool results and review events across configured Claude/OpenAI providers.

Add a reusable edit card with source/date, exercise and set context, old/new values with units, exclusions, exact counts, completeness warning, selection, progress, and per-item results. Provide an app-level pending-review location so an external request does not require a Coach conversation. Refresh library/calendar caches and metadata only according to actual results.

External workout automation is a separate opt-in capability from watch-face automation. Existing watch-face tokens must not silently gain workout access. Reuse proven loopback authentication/Host/Origin checks, strict schema validation, request limits, and credential redaction where appropriate, while preserving existing watch-face behavior. Bind proposals to the account and permitted client context; revocation disables access and prevents further execution through that capability.

Release local MCP support only for clients verified to reach the local server. In-app OpenAI support is not equivalent to hosted ChatGPT connector support. Verify current official client documentation and actual connectivity during this phase. If hosted ChatGPT needs remote hosting or a bridge, write a separate deployment/authentication design; do not expose the loopback endpoint publicly as a shortcut. Report the supported client matrix explicitly.

## Implementation sequence and acceptance gates

1. **Establish contracts and fixtures.** Audit codec round-trips, weight precision, ownership/completion detection, revision coverage, pagination, and remote conditional-write behavior. Capture sanitized representative fixtures. Resolve preservation/eligibility gaps before exposing writes.
2. **Single strength edit service.** Implement typed patches, deterministic diffs, persistence, approval binding, execution journal, reconciliation, and error taxonomy. Reuse verified endpoints. Acceptance: one reviewed edit changes only its selected prescription fields and retains identity.
3. **Coach integration.** Add tools, routing, IPC/preload types, persisted review card, status, cancellation, and cache refresh. Acceptance: both provider paths prepare the same changes and cannot save through a tool call alone.
4. **Bulk progression.** Add complete scoped discovery, exact matching, candidate review, per-item selection, preflight, sequential writes, stop/resume behavior, and summaries. Acceptance: mixed library/calendar updates report exact outcomes with zero duplicate writes under injected failures.
5. **External MCP.** Add separately enabled workout capabilities and app review inbox. Acceptance: verified local clients can discover, prepare, inspect, and cancel proposals, with save controlled by the app; watch-face authorization remains unchanged.
6. **Release verification and documentation.** Run isolated live checks on temporary library and future calendar workouts with explicit test-account authorization. Verify strength prescription changes, identity preservation, library/copy independence, read-back, and cleanup. Do not use native plan writes or real training history as test fixtures. Publish capabilities and known limits.

Each phase should be reviewable independently. The user scenario is complete after bulk Coach support; external-client parity is a separate required milestone for an external MCP release. Native plan editing and hosted ChatGPT connectivity remain explicit extensions until their gates pass.

## Validation matrix

- Pure service/codec tests: kg/lb precision, approximate labels, bodyweight/zero, reps/time/open, set vs repeat semantics, rest modes, duplicate exercises, unknown fields, out-of-range legacy values, no-ops, and forbidden patches.
- Reference/discovery tests: string IDs beyond safe integer range, same-name workouts, multiple copies on one day, pagination/deduplication, missing pages/details, incomplete searches, native ownership, status changes, invalid dates, midnight/DST, and account/region switching.
- Execution tests with injected adapters: zero updates before approval; preview endpoints never call update; mismatched proposal hash; double-click/two-client races; stale revisions; partial failure at each write position; auth/rate limit errors; acknowledged-but-unverified saves; timeout after acceptance; crash/restart; cancellation; reconciliation without blind mutation retry.
- UI/provider tests: Claude and OpenAI tool schemas, selection/review binding, reload persistence, exact old/new units, exclusions, incomplete scopes, disabled ineligible rows, partial-result wording, and cache refresh.
- MCP tests: authentication and scope isolation, revoked tokens, malformed requests, arbitrary refs/payload rejection, status access control, app closed/unavailable behavior, concurrent clients, and watch-face regression coverage.
- Build both Electron and renderer. Run relevant existing workout editor, intensity codec, chat tools/routing, training-library, Training Hub write, and automation suites once, then new targeted service/UI/MCP tests. Broaden only for touched paths or unresolved failures.
- Live acceptance example: temporary fixture contains one library workout and two future copies with selected 26 lb kettlebell steps, an unrelated 26 lb exercise, and a different-load warmup. Review shows exactly the selected changes to 36 lb; read-back confirms those changes while unrelated fields and copies outside the scope remain unchanged. A second attempt is a no-op. A separate injected conflict demonstrates truthful partial results.

## Definition of done

An athlete can discover existing strength workouts, review an exact single or bulk edit, save once, and see reliable per-workout outcomes after reload or interruption. Unknown/unsupported data is preserved, historical and gated plan targets are excluded, incomplete searches are explicit, and no interface claims external client support or COROS roadmap commitments without evidence.
