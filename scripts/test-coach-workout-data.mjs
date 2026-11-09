import assert from 'node:assert/strict';
import { formatActivityDetailForChat, formatActivityListLine, handleChatActivityTool } from '../dist-electron/chatActivityTools.js';
import { parseScheduledExercises, formatScheduledExercisesForChat } from '../dist-electron/trainingHubService.js';
import { formatRecentActivityMix } from '../dist-electron/chatCoachContext.js';
import { configureDataSources } from '../dist-electron/localSync/activitySource.js';

// Coach's dates must agree with the local calendar, on both sides of UTC.
const oldTZ = process.env.TZ;
try {
  for (const [zone, instant, day] of [
    ['Asia/Ho_Chi_Minh', '2026-11-08T23:30:00Z', '2026-11-09'],
    ['America/Los_Angeles', '2026-11-09T02:30:00Z', '2026-11-08']
  ]) {
    process.env.TZ = zone;
    const activity = { activityId: 'date', sportType: 100, startTime: Date.parse(instant) / 1000, laps: [], raw: {} };
    assert.ok(formatActivityListLine(activity, 'metric').includes(day));
    assert.ok(formatActivityDetailForChat(activity, false).includes(`Date: ${day}`));
  }
} finally {
  if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ;
}
assert.match(formatRecentActivityMix([{ activityId: 'run', sportType: 100, duration: 7200, movingTime: 3600 }], 'metric'), /1 h(?: ·|$)/);
assert.doesNotMatch(formatRecentActivityMix([{ activityId: 'run', sportType: 100, duration: 7200, movingTime: 3600 }], 'metric'), /2 h/);

const detail = {
  activityId: 'recorded', sportType: 100, duration: 3600, movingTime: 0, laps: [], raw: {},
  note: 'Knee sore in the last interval', trainingLoad: 0,
  trainingEffect: { aerobic: 3.2, anaerobic: 0, focus: 4, sevenDayLoad: 450, recommendedLoadMin: 300, recommendedLoadMax: 600 },
  runningDynamics: { groundTimeMs: 250, verticalOscillationMm: 85, verticalRatio: 8, stepLengthMm: 1100 },
  avgTemperature: 0,
  heartRateRecovery: { startBpm: 150, oneMinuteBpm: 125, twoMinuteBpm: 110, dropOneMinute: 25, dropTwoMinutes: 40, samples: [] }
};
const text = formatActivityDetailForChat(detail, false);
for (const expected of ['Duration: 1:00:00', 'Knee sore', 'Training load: 0', 'Aerobic training effect: 3.2',
  'Anaerobic training effect: 0', 'Training focus: Threshold', '7-day load at workout time: 450',
  '300–600', 'Ground contact time: 250 ms', 'Vertical oscillation: 85 mm', 'Step length: 1100 mm',
  'Avg sensor temperature: 0 °C', '1 min 125 bpm (drop 25 bpm)']) assert.ok(text.includes(expected), expected);
assert.match(formatActivityDetailForChat(detail, false, 'imperial'), /32 °F/);

const steps = parseScheduledExercises({ exercises: [
  { id: 'g', name: 'Main set', isGroup: true, sets: 4 },
  { name: 'Run', groupId: 'g', targetType: 5, targetValue: 80000, intensityType: 3, intensityValue: 240000, intensityValueExtend: 250000, intensityMultiplier: 1000 },
  { name: 'Squat', targetType: 3, targetValue: 8, intensityType: 1, intensityValue: 60, restType: 1, restValue: 90 },
  { name: 'Load budget', targetType: 6, targetValue: 80 },
  { name: 'Long ride', targetType: 2, targetValue: 10800 },
  { name: 'Recover', targetType: 7, targetValue: 120 },
  { name: 'Warmup', targetType: 1, targetValue: 0 }
] });
assert.equal(steps[2].reps, 8);
assert.equal(steps[2].weight, 60);
assert.equal(steps[3].weight, undefined);
assert.equal(steps[4].targetLabel, '180:00');
const plan = formatScheduledExercisesForChat(steps, 'metric');
for (const expected of ['4 sets', 'repeat group g', 'in group g', '4:00–4:10/km', '8 reps', '60.0 kg', 'rest 90 s', 'training load 80', 'HR below 120 bpm', 'Open (until lap button)']) assert.ok(plan.includes(expected), `${expected}: ${plan}`);
assert.doesNotMatch(plan, /80 kg/);
assert.match(formatScheduledExercisesForChat(steps, 'imperial'), /132\.3 lb/);

const swimText = formatActivityDetailForChat({ sportType: 300, laps: [{ index: 1, distance: 100, duration: 120,
  stroke: 'freestyle', step: { range: { kind: 'pace', low: 1200, high: 1300 } } }], raw: {} }, false);
assert.match(swimText, /2:00\/100m–2:10\/100m/);
assert.doesNotMatch(swimText, /20:00\/km/);

const strength = formatActivityDetailForChat({ sportType: 402, laps: [], raw: {}, strength: {
  summary: {}, exercises: [{ nameKey: 'custom', rawName: 'Plank', totalReps: 0, entries: [{ reps: 0, weightKg: 0, workSec: 60, restSec: 30, rpe: 8, type: 'normal' }] }]
} }, false);
for (const expected of ['Plank', 'timed set', 'work 1:00', 'rest 0:30', 'RPE 8/10']) assert.ok(strength.includes(expected));

// Fetching list metadata is optional when an individual workout remains readable.
const source = { kind: 'local', listActivities: async () => { throw new Error('list offline'); }, getActivityDetail: async () => detail };
configureDataSources({ useLocal: () => true, localActivities: source, cloudActivities: source });
assert.match(await handleChatActivityTool('get_activity_detail', { activity_id: 'recorded', sport_type: 100 }), /Knee sore/);
console.log('Coach workout data regressions passed');
