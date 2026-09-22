import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildHealthInsightArgs, normalizeHealthTime, parseHealthInsightResponse: parse } = require('../dist-electron/healthInsightsParser.js');
const { discoverTools } = require('../dist-electron/mcpToolDiscovery.js');

// Representative payload fixtures, not captures from a live COROS account.
const stress = parse('stress', JSON.stringify({ data: [
  { timestamp: '2026-09-20T11:00:00Z', stress: 32, stressHrv: 48 },
  { date: '20260920', timestamp: '2026-09-20T10:00:00Z', stress: 0, stressHrv: null },
  { timestamp: '2026-09-20T12:00:00Z', stress: -1 }
] }));
assert.deepEqual(stress.series[0].points, [{ time: '2026-09-20T10:00:00Z', value: 0 }, { time: '2026-09-20T11:00:00Z', value: 32 }]);
assert.equal(stress.metrics.find(m => m.key === 'stress').value, 32);
assert.equal(stress.metrics.find(m => m.key === 'hrv').value, 48);
assert.equal(parse('stress', '{"stress":null}').metrics.length, 0);
assert.equal(parse('stress', '{"stress": "no data"}').metrics.length, 0);
assert.equal(parse('stress', '{"stress": "12 unknown units"}').metrics.length, 0);
assert.equal(normalizeHealthTime('20260230'), undefined);
assert.equal(normalizeHealthTime(0), undefined);
assert.equal(normalizeHealthTime(1789948800), '2026-09-21T00:00:00.000Z');
assert.equal(parse('stress', '{"stress":25}').series.length, 0, 'Do not fabricate a timestamp');

const check = parse('healthCheck', JSON.stringify({ data: { happenDay: '20260920', heartRate: '62 bpm', hrv: 49, respiratoryRate: 14, spo2: '98%', stress: 0 } }));
assert.equal(check.metrics.length, 5);
assert.equal(check.metrics.find(m => m.key === 'spo2').unit, '%');
// Live Health Check report format, with synthetic measurements and device names.
const wellnessReport = [
  'Health Check Time Series — Latest in 2026-09-15 to 2026-09-21',
  '========================', '', 'Date: 2026-09-21',
  'timestamp=1789948800, timezone=-16, source=dailyRhmList, device=Test Watch, dataSource=Test Watch',
  'Heart Rate List: [1789948800=62 bpm, 1789948860=64 bpm]',
  'HRV List: [1789948800=49 ms]',
  'Stress List: [1789948800=0]',
  'Respiration Rate List: [1789948800=14/min]',
  'SpO2 List: [1789948800=98%]',
  'Stress Level: 1', 'Resting Heart Rate: 51 bpm'
].join('\n');
const wellness = parse('healthCheck', JSON.stringify(wellnessReport));
assert.deepEqual(Object.fromEntries(wellness.metrics.map(m => [m.key, m.value])), {
  heartRate: 64, hrv: 49, stress: 0, respiratoryRate: 14, spo2: 98,
  level: 'Relaxed', restingHeartRate: 51
});
assert.equal(wellness.series.length, 5);
assert.deepEqual(wellness.series.find(s => s.key === 'heartRate').points, [
  { time: '2026-09-21T00:00:00.000Z', value: 62 },
  { time: '2026-09-21T00:01:00.000Z', value: 64 }
]);
assert.equal(wellness.report, undefined);
assert.equal(parse('healthCheck', 'Heart Rate List: []\nHRV List: []').metrics.length, 0);
assert.equal(parse('healthCheck', 'Heart Rate List: [1789948800=0 bpm]\nHRV List: [1789948800=0 ms]').metrics.length, 0);
const nested = parse('healthCheck', JSON.stringify({ heartRateSeries: [{ time: '2026-09-20T10:00:00Z', value: 65 }] }));
assert.equal(nested.series[0].points[0].value, 65);
const hrv = parse('sleepHrv', '```json\n{"date":"20260920","avgSleepHrv":62,"normalRange":[48,72],"evaluation":"Normal"}\n```');
assert.equal(hrv.metrics.find(m => m.key === 'normalRange').value, '48–72');
assert.equal(hrv.metrics.find(m => m.key === 'evaluation').value, 'Normal');
const cycle = parse('cycle', JSON.stringify({ todayStatus: 'Follicular phase', cycleDay: 9, nextPeriodDate: '2026-10-10', cycleLength: 28 }));
assert.equal(cycle.metrics.length, 4);
assert.equal(cycle.series.length, 0);
const wrapped = parse('stress', JSON.stringify({ content: [{ type: 'text', text: '{"date":"20260920","stress":25}' }] }));
assert.equal(wrapped.metrics[0].value, 25);
const combined = parse('stress', 'COROS stress report\n{"date":"20260920","stress":25}\n{"date":"20260920","stress":25}');
assert.equal(combined.series[0].points.length, 1);
assert.equal(combined.report, 'COROS stress report');
assert.equal(parse('healthCheck', 'No health checks recorded.').report, 'No health checks recorded.');
assert.equal(parse('healthCheck', '{"data":[]}').metrics.length, 0);
assert.throws(() => parse('healthCheck', '{"data":[{"unrecognizedMeasurement":12}]}'), /format/);
// COROS text reports: section titles, date headers, key=value records, labelled summaries.
const stressReport = parse('stress', JSON.stringify([
  'Stress Time Series — 2026-09-19 to 2026-09-20', '========================', '',
  '2026-09-19:', '  timestamp=1789800000, timezone=-16, stress=17, score=1, stressHrv=0, stressHr=0',
  '  timestamp=1789800300, timezone=-16, stress=46, score=2, stressHrv=0, stressHr=0',
  '2026-09-20:', '  timestamp=1789886400, timezone=-16, stress=60, score=3, stressHrv=0, stressHr=0'
].join('\n')));
assert.deepEqual(stressReport.series.map(s => [s.key, s.points.length]), [['stress', 3]], 'zero HRV/HR placeholders are not measurements');
assert.equal(stressReport.metrics.find(m => m.key === 'stress').value, 60);
assert.equal(stressReport.metrics.find(m => m.key === 'level').value, 'Medium');
assert.equal(stressReport.report, undefined);
// MCP structured output may wrap a text report or serialized JSON in result/data.
for (const wrapper of ['result', 'data', 'structuredContent']) {
  const report = 'Stress Time Series\n========================\n2026-09-20:\n  timestamp=1789886400, stress=60, score=3';
  const wrappedReport = parse('stress', JSON.stringify({ [wrapper]: report }));
  assert.deepEqual(wrappedReport, parse('stress', report), wrapper);
  const jsonReport = JSON.stringify({ date: '20260920', stress: 25 });
  assert.deepEqual(parse('stress', JSON.stringify({ [wrapper]: jsonReport })), parse('stress', jsonReport), wrapper);
}
assert.deepEqual(
  parse('stress', JSON.stringify({ structuredContent: { result: { data: 'Stress: 25' } } })),
  parse('stress', 'Stress: 25'),
  'Nested response envelopes retain their report'
);
assert.throws(() => parse('stress', '{"result":{"unrecognizedMeasurement":12}}'), /format/);
const hrvReport = parse('sleepHrv', [
  'Sleep HRV — 2026-09-20', '========================', 'Note: dates are wake-up days.', '',
  'HRV Assessment — Last 1 days', '========================', '',
  '2026-09-20:', '  HRV Avg: 83 ms — Normal', '  Normal Range: 75 - 105 ms', '  Baseline: 90 ms', '',
  'Sleep HRV Time Series — Last 1 days', '========================', '',
  '2026-09-20:', '  timestamp=1789886400, timezone=-16, hrv=68 ms, status=4, confidence=100000', '  timestamp=1789886700, timezone=-16, hrv=104 ms, status=4, confidence=96153'
].join('\n'));
assert.deepEqual(hrvReport.metrics.map(m => [m.key, m.value]), [['average', 83], ['normalRange', '75–105'], ['baseline', 90], ['evaluation', 'Normal'], ['hrv', 104]]);
assert.deepEqual(hrvReport.series.map(s => [s.key, s.points.length]), [['average', 1], ['hrv', 2]], 'baseline is summary-only');
assert.equal(hrvReport.report, 'Note: dates are wake-up days.');
const cycleReport = parse('cycle', 'Menstrual Cycle Data\n====================\nQuery Range: 2026-09-15 to 2026-09-21\nToday: 2026-09-21 | No cycle includes today\nCurrent Cycle: Not found in returned cycles\nNext Period Start: Unknown\nGeneral: usual period 7 days, usual cycle 28 days\n\nNo menstrual cycle data found for this range.');
assert.deepEqual(cycleReport.metrics.map(m => [m.key, m.value]), [['usualCycleLength', 28], ['usualPeriodLength', 7]], 'Unknown placeholders are dropped');
assert.equal(cycleReport.report, 'No menstrual cycle data found for this range.');
assert.equal(parse('healthCheck', JSON.stringify('No complete health check time series data found in 2026-09-21.')).metrics.length, 0);
const pretty = JSON.stringify({ date: '20260920', stress: 25 }, null, 2);
assert.equal(parse('stress', pretty + '\n' + pretty).series[0].points.length, 1);


const schema = properties => ({ name: 'queryStressTimeSeries', inputSchema: { type: 'object', properties } });
const now = new Date(2026, 8, 21, 12);
assert.deepEqual(buildHealthInsightArgs(schema({ startDate: { type: 'string' }, endDate: { type: 'string' }, days: { type: 'integer' } }), 7, now), { startDate: '2026-09-15', endDate: '2026-09-21', days: 7 });
assert.deepEqual(buildHealthInsightArgs(schema({ startDate: { type: 'string', description: 'yyyyMMdd' }, endDate: { type: 'integer' } }), 1, now), { startDate: '20260921', endDate: 20260921 });
assert.deepEqual(buildHealthInsightArgs(schema({ days: { type: 'integer' } }), 1, now), { days: 1 });
assert.throws(() => buildHealthInsightArgs(schema({}), 8), /between 1 and 7/);
assert.throws(() => buildHealthInsightArgs(schema({}), NaN), /between 1 and 7/);
assert.throws(() => buildHealthInsightArgs({ inputSchema: { properties: {}, required: ['unknown'] } }, 7), /unsupported parameters/);
assert.throws(() => buildHealthInsightArgs(schema({ days: { enum: [1, 3] } }), 7), /changed/);

const pages = [];
const discovered = await discoverTools({ listTools: async args => {
  pages.push(args);
  return args?.cursor ? { tools: [{ name: 'queryMenstruationCycles', inputSchema: {} }] } : { tools: [{ name: 'queryStressTimeSeries', inputSchema: {} }], nextCursor: 'next' };
} });
assert.equal(discovered.length, 2);
assert.deepEqual(pages, [undefined, { cursor: 'next' }]);
await assert.rejects(discoverTools({ listTools: async () => ({ tools: [], nextCursor: 'same' }) }), /repeated/);

// Exercise service isolation without OAuth, network, or personal health data.
const mcpPath = require.resolve('../dist-electron/corosMcpService.js');
const old = require.cache[mcpPath];
let connected = true;
let available = true;
let failCall = false;
let callCount = 0;
let reply = '{"stress":0}';
const tool = schema({ days: { type: 'integer' } });
require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: {
  ensureCorosMcpConnected: async () => connected,
  getCorosMcpTools: () => available ? [tool] : [],
  listCorosMcpTools: async () => available ? [tool] : [],
  callCorosMcpTool: async (_name, args) => { callCount++; assert.equal(args.days, 7); if (failCall) throw new Error('Server unavailable'); return reply; }
} };
try {
  const { getTrainingHealthInsight } = require('../dist-electron/healthInsightsService.js');
  assert.equal((await getTrainingHealthInsight('stress')).status, 'ready');
  reply = JSON.stringify('No complete health check time series data found in 2026-09-21.');
  const emptyResult = await getTrainingHealthInsight('stress');
  assert.equal(emptyResult.status, 'empty');
  assert.match(emptyResult.message, /No complete/);
  reply = JSON.stringify({ result: 'No stress data found in this range.' });
  const wrappedEmpty = await getTrainingHealthInsight('stress');
  assert.equal(wrappedEmpty.status, 'empty');
  assert.equal(wrappedEmpty.message, 'No stress data found in this range.');
  reply = '{"stress":0}';
  connected = false;
  assert.equal((await getTrainingHealthInsight('stress')).status, 'disconnected');
  assert.equal(callCount, 3);
  connected = true; available = false;
  assert.equal((await getTrainingHealthInsight('stress')).status, 'unavailable');
  available = true; failCall = true;
  assert.equal((await getTrainingHealthInsight('stress')).status, 'error');
  assert.equal(callCount, 4, 'No repeated request guessing on failure');
  await assert.rejects(getTrainingHealthInsight('invalid'), /Unknown/);
  await assert.rejects(getTrainingHealthInsight('stress', 90), /between 1 and 7/);
} finally { if (old) require.cache[mcpPath] = old; else delete require.cache[mcpPath]; }
console.log('Health insights parser, query windows, catalog pagination, and service tests passed.');
