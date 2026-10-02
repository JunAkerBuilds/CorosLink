# Coach COROS review verification

Verified on September 21, 2026 against the saved COROS US MCP connection. Live verification used only discovery and read tools. Save behavior was tested with a mocked remote service and an isolated local database.

## Review outcomes

| Finding | Result |
| --- | --- |
| Token refresh invalidates pending reviews | Fixed with a persisted authorization identifier. Refresh and app restart preserve it; new authorization grants, credential invalidation, disconnect, and resource changes invalidate old reviews. |
| Hard-coded source-read arguments might differ from COROS | The live schemas confirm `queryWorkoutDetails(workoutId)`, `queryScheduledWorkoutDetails(date, idInPlan)`, and `queryTrainingPlanDetails(planId)`. All identifiers are strings. Six read schemas were added to the fixture, and test calls now validate against captured schemas. |
| Raw response digests might change due to volatile metadata | Three reads each of an existing library workout, standalone scheduled workout, and training plan were byte-for-byte identical. No volatile metadata was observed. The conservative whole-response digest remains; this sample does not prove future responses will always be stable. |
| Some returned IDs skip read-back | Fixed for numeric JSON, camelCase labels, spaced labels, nested data, and JSON-encoded text. Decimal IDs remain strings, including values beyond JavaScript's safe integer range. |
| Conflicting definitions can prevent Coach from starting | A failing COROS write schema now excludes only that tool and records a diagnostic warning. Tests cover successful chat startup with the remaining tools across all four providers, and rejection if a stale model call still targets the malformed tool. |
| Tool-change notifications lost during discovery | Notifications invalidate the in-flight listing and cause a follow-up request before refresh completes. |
| Missing exercise is reported as unavailable “Exercise” | The resolver now returns `reason: missing` with explicit ID/name guidance and avoids loading the catalog for a missing reference. Coach's earlier input validation remains in place. |
| Location denial still invokes IP lookup | Permission denial stops before any location/forecast network request. Unavailable/timeout cases retain the IP fallback. |

The live checks also showed that COROS reports `Editable via MCP: no` in human-readable text, sometimes encoded as a JSON string. The update guard now recognizes this response and rejects updates before offering a card. Scheduling an existing read-only library template remains supported.

## Reproducing verification

`npm run verify:coach-coros-mcp` checks the 13 captured schemas against authenticated discovery and performs three detail reads per available target. It uses the saved `coroslink` profile; `COROSLINK_USER_DATA` can select another profile. It never calls workout write tools or prints credentials, account contents, or identifiers. Targets absent from the inspected library/current schedule are reported as skipped.

The automated checks are:

- `npm run build:electron` and `npx tsc --noEmit`.
- `npm run test:coach-coros` for all seven workflows, captured read/write schemas, read-only responses, exact IDs, stale sources, persistence, and duplicate-write protection.
- `npm run test:mcp-authorization` for token rotation, restart, account/authorization changes, and disconnects.
- `npm run test:mcp-server-removal` for lifecycle cleanup and notifications during discovery.
- `npm run test:overview-weather` for permission denial and fallback behavior.
- `npm run test:chat-service` and `npm run test:chat-workout-tools` for provider routing, schema isolation, and exercise diagnostics.
- `npm run test:coach-coros-ui` for the real React card, preload IPC, action service, and SQLite history. It checks pending/saving/saved states, 64-bit read-back, stale rejection, uncertain/interrupted outcomes, and service plus renderer restart. COROS writes are mocked.
