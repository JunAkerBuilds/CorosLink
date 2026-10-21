import assert from "node:assert/strict";
import { buildReadiness } from "../src/overview/overviewBriefingModel.ts";

const now = Date.UTC(2026, 9, 19, 8, 0, 0);
const snapshot = (summary) => ({ summary, trendPoints: [], racePredictor: null, dashboard: null, analytics: null, dailyMetrics: null, sleep: null, dailyHealth: null });
const plan = (name) => [{ name, happenDay: "20261019" }];

// Connected Mode: COROS's recovery %, and the COROS app is where the watch syncs.
const cloud = buildReadiness(snapshot({ recoveryPct: 82 }), []);
assert.equal(cloud.tone, "high");
assert.equal(cloud.percent, 82);
const waiting = buildReadiness(snapshot({}), []);
assert.equal(waiting.title, "Waiting for a sync");
assert.equal(waiting.message, "Sync your watch with the COROS app to see today's recovery.");
assert.equal(waiting.needsSync, undefined);
assert.equal(buildReadiness(snapshot({ recoveredAt: now / 1000 + 3600 }), []).hoursLeft, undefined, "the watch's recovery time is a Local-Only figure");

// Local-Only Mode, no watch data yet: sync in CorosLink.
const local = { localOnly: true, now };
const empty = buildReadiness(snapshot({}), [], local);
assert.equal(empty.tone, "neutral");
assert.equal(empty.message, "Sync your watch to see today's recovery.");
assert.equal(empty.needsSync, true);
assert.ok(!/COROS app/.test(`${empty.title} ${empty.message}`));
assert.equal(buildReadiness(null, [], local).needsSync, true);

// Local-Only Mode with the watch's recovery time: hours left, then recovered. No invented percent.
const recoveredAt = Date.UTC(2026, 9, 19, 22, 0, 0) / 1000;
const recovering = buildReadiness(snapshot({ recoveredAt }), [], local);
assert.deepEqual([recovering.tone, recovering.title, recovering.hoursLeft, recovering.percent, recovering.needsSync], ["mid", "Recovering · 14 h left", 14, undefined, undefined]);
assert.equal(recovering.message, "You're still recovering. Easy to moderate effort today.");
assert.equal(buildReadiness(snapshot({ recoveredAt }), plan("Tempo run"), local).message, "You're still recovering. Keep Tempo run at a controlled effort.");
const recovered = buildReadiness(snapshot({ recoveredAt }), [], { localOnly: true, now: recoveredAt * 1000 });
assert.deepEqual([recovered.tone, recovered.title, recovered.hoursLeft, recovered.percent], ["high", "Recovered", 0, undefined]);
assert.equal(buildReadiness(snapshot({ recoveredAt }), plan("Intervals"), { localOnly: true, now: recoveredAt * 1000 + 86_400_000 }).message,
  "Your watch counts you as fully recovered. A good day for Intervals.");

// A sync more than 12 hours old isn't today's advice: it says when it's from and offers a sync.
const later = recoveredAt * 1000 + 86_400_000;
const stale = buildReadiness(snapshot({ recoveredAt }), plan("Intervals"), { localOnly: true, now: later, syncedAt: later - 3 * 86_400_000 });
assert.deepEqual([stale.tone, stale.title, stale.needsSync], ["neutral", "Recovered", true]);
assert.match(stale.message, /^As of your last sync, .+\. Sync your watch to see today's recovery\.$/);
assert.ok(!/cleared|good day/i.test(stale.message), "no go-ahead from old data");
const staleRecovering = buildReadiness(snapshot({ recoveredAt }), [], { localOnly: true, now, syncedAt: now - 13 * 3_600_000 });
assert.deepEqual([staleRecovering.title, staleRecovering.needsSync], ["Recovering · 14 h left", true]);
assert.equal(buildReadiness(snapshot({ recoveredAt }), [], { localOnly: true, now: later, syncedAt: later - 3_600_000 }).message,
  "Your watch counts you as fully recovered. You're cleared for a hard session.", "a recent sync keeps today's wording");

// A COROS recovery % still leads in Local-Only Mode when a COROS session provides one.
const both = buildReadiness(snapshot({ recoveryPct: 35, recoveredAt }), [], local);
assert.deepEqual([both.tone, both.percent, both.hoursLeft], ["low", 35, undefined]);

console.log("Overview briefing passed: Connected Mode keeps the COROS-app wording; Local-Only Mode shows the watch's recovery time or asks for a sync in CorosLink.");
