import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCorosActionService } from '../dist-electron/coachCorosActions.js';
import { coachMcpTools, corosInputSchema, claudeCanUseCorosTool, corosCoachRoutingInstructions, isCorosWorkoutWrite } from '../dist-electron/coachCorosTools.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

const { tools } = JSON.parse(readFileSync(new URL('./fixtures/coros-mcp-workout-schemas.json', import.meta.url)));
const workoutId = '9223372036854775701';
const course = { courseName: 'Easy run', courseDescription: 'Steady aerobic running at pace.', sportType: 1, sections: [
  { sectionType: 1, targetType: 2, targetValue: 600, intensityType: 1, sectionIntensity: 1 },
  { intervalGroup: true, repeats: 4, sets: [
    { sectionType: 2, targetType: 1, targetValue: 1000, intensityType: 2, intensityValueStart: 360, intensityValueEnd: 390 },
    { sectionType: 3, targetType: 2, targetValue: 90 }
  ] },
  { sectionType: 4, targetType: 4 }
] };
const create = { course, review_summary: 'Save Easy run to your library.' };
const schedule = { workoutId, date: '20260922', review_summary: 'Repeat your saved strength session tomorrow.' };
const planInfo = { planName: 'Four weeks', planOverview: 'Build consistent easy running.', planStartDate: 20260921, totalWeeks: 4 };
const phaseInfo = { periodization: [{ phaseType: 2, startDate: 20260921, endDate: 20261018, durationWeeks: 4 }] };
const sources = { name: 'Strength A', editable: true, sets: [{ exerciseId: '1001', reps: 10, weight: 30 }] };

function harness() {
  const calls = [];
  let storage, source = JSON.stringify(sources), connectionKey = 'account-a', allowed = true, time = Date.UTC(2026, 8, 21);
  let write = async () => JSON.stringify({ workoutId, idInPlan: workoutId, planId: workoutId });
  let read = async () => source;
  const deps = { tools: () => tools, call: async (name, args) => {
    const tool = tools.find(tool => tool.name === name);
    assert.ok(tool, 'Every call must have a captured live schema: ' + name);
    const checked = new AjvJsonSchemaValidator().getValidator(corosInputSchema(tool.inputSchema))(args);
    assert.equal(checked.valid, true, `${name}: ${checked.errorMessage}`);
    calls.push({ name, args: structuredClone(args) });
    return name.startsWith('coros__query') ? read() : write();
  }, load: () => storage, save: value => { storage = value; }, connectionKey: () => connectionKey,
  canConfirm: claude => !claude || allowed, now: () => time };
  return { service: createCorosActionService(deps), restart: () => createCorosActionService(deps), calls,
    writes: () => calls.filter(c => !c.name.startsWith('coros__query')),
    source: value => { source = JSON.stringify(value); }, account: value => { connectionKey = value; },
    allow: value => { allowed = value; }, advance: value => { time += value; },
    write: fn => { write = fn; }, read: fn => { read = fn; },
    interrupt: () => { const a = JSON.parse(storage); a[0].preview.state = 'saving'; storage = JSON.stringify(a); }
  };
}

// All live schemas resolve their nested $refs, and the model-facing contract keeps review_summary local.
const original = JSON.stringify(tools);
const wrapped = coachMcpTools(tools);
assert.equal(JSON.stringify(tools), original);
for (const tool of wrapped) {
  if (isCorosWorkoutWrite(tool.name)) {
    assert.match(tool.description, /review card only/);
    assert.ok(tool.inputSchema.required.includes('review_summary'));
  }
  new AjvJsonSchemaValidator().getValidator(tool.inputSchema);
}
assert.ok(corosInputSchema(tools.find(t => t.name.endsWith('createSingleWorkout')).inputSchema).$defs.Section);
{
  const bad = { name: 'coros__createSingleWorkout', inputSchema: { type: 'object', $defs: { Section: { type: 'string' } }, properties: { course: { $defs: { Section: { type: 'number' } } } } } };
  const good = tools.filter(tool => tool.name !== bad.name);
  const warnings = [];
  const warn = console.warn;
  try {
    console.warn = message => warnings.push(message);
    assert.deepEqual(coachMcpTools([bad, ...good]), coachMcpTools(good));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /createSingleWorkout/);
  } finally { console.warn = warn; }
  const h = harness();
  // A malformed schema is rejected even if a model calls a previously listed tool.
  const originalSchema = tools.find(tool => tool.name === bad.name).inputSchema;
  try {
    tools.find(tool => tool.name === bad.name).inputSchema = bad.inputSchema;
    await assert.rejects(h.service.stage(bad.name, create), /Conflicting/);
    assert.equal(h.calls.length, 0);
  } finally { tools.find(tool => tool.name === bad.name).inputSchema = originalSchema; }
}
const allPermissions = { recentActivities: true, trainingMetrics: true, upcomingWorkouts: true, sleepData: true, fullActivityFiles: true };
for (const name of ['querySportRecords', 'queryRecoveryStatus', 'querySleepData', 'queryWorkoutDetails', 'createSingleWorkout']) assert.equal(claudeCanUseCorosTool(name, allPermissions), true, name);
assert.equal(claudeCanUseCorosTool('createSingleWorkout', { ...allPermissions, upcomingWorkouts: false }), false);
assert.equal(claudeCanUseCorosTool('queryDailyHealthData', { ...allPermissions, sleepData: false }), false);
assert.equal(claudeCanUseCorosTool('unknownWriteTool', allPermissions), false);
assert.match(corosCoachRoutingInstructions(tools), /search_coros_exercises/);
assert.match(corosCoachRoutingInstructions(tools), /REST DAY, never Strength/);

// Each supported workflow stages a review without writing, then sends exactly the reviewed arguments.
for (const [name, input, destination] of [
  ['createSingleWorkout', create, 'Workout Library'],
  ['createScheduledWorkout', { ...create, date: schedule.date }, 'Calendar'],
  ['scheduleWorkout', schedule, 'Calendar'],
  ['updateWorkoutDetails', { ...create, workoutId }, 'Workout Library'],
  ['updateScheduledWorkout', { ...create, date: schedule.date, idInPlan: workoutId }, 'Calendar'],
  ['createTrainingPlan', { planInfo, courseList: [{ ...course, dayNo: 0 }, { ...course, dayNo: 21 }], phaseInfo, review_summary: 'Build four weeks of easy running.' }, 'Training Plan'],
  ['updateTrainingPlan', { planInfo: { planId: workoutId }, courseList: [{ ...course, dayNo: 1 }], review_summary: 'Change the second day.' }, 'Training Plan']
]) {
  const h = harness();
  const preview = await h.service.stage('coros__' + name, input);
  assert.equal(preview.state, 'pending');
  assert.equal(preview.destination, destination);
  assert.equal(h.writes().length, 0);
  if (name === 'createTrainingPlan') assert.ok(preview.details.some(line => line.startsWith('Base:')));
  const confirmed = await h.restart().confirm(preview.requestId);
  assert.equal(confirmed.state, 'saved');
  const { review_summary, ...expected } = input;
  assert.deepEqual(h.writes(), [{ name: 'coros__' + name, args: expected }]);
  assert.equal(h.calls.at(-1).name.startsWith('coros__query'), true);
  const persisted = await h.restart().confirm(preview.requestId);
  assert.equal(persisted.state, 'saved');
  assert.equal(h.restart().restore(preview).state, 'saved', 'Old transcript cards must restore the recorded save result');
  assert.equal(h.writes().length, 1, 'Restart or repeated confirmation must not duplicate the write');
}

// Create responses preserve decimal IDs even when JSON encodes them as numbers.
for (const [name, input, key, label, readName] of [
  ['createSingleWorkout', create, 'workoutId', 'Workout ID', 'queryWorkoutDetails'],
  ['createScheduledWorkout', { ...create, date: schedule.date }, 'idInPlan', 'idInPlan', 'queryScheduledWorkoutDetails'],
  ['createTrainingPlan', { planInfo, courseList: [{ ...course, dayNo: 0 }], phaseInfo, review_summary: 'Build four weeks.' }, 'planId', 'Plan ID', 'queryTrainingPlanDetails']
]) {
  for (const response of [
    `{"${key}":${workoutId}}`,
    `{"data":{"${key}":${workoutId}}}`,
    `{"${key}":"${workoutId}"}`,
    `${key}: ${workoutId}`,
    `${label}: ${workoutId}`,
    JSON.stringify(`${label}: ${workoutId}\nSaved successfully.`),
    `Saved successfully.\n{"${key}":${workoutId}}`
  ]) {
    const h = harness();
    h.write(async () => response);
    const preview = await h.service.stage('coros__' + name, input);
    const saved = await h.service.confirm(preview.requestId);
    assert.equal(saved.state, 'saved');
    assert.deepEqual(h.calls.at(-1), {
      name: 'coros__' + readName,
      args: { ...(key === 'idInPlan' ? { date: schedule.date } : {}), [key]: workoutId }
    }, response);
    assert.equal(h.writes().length, 1);
  }
}
for (const response of ['{"workoutId":123.45}', '{"workoutId":123e4}', '{"workoutId":-123}', 'workoutId: 123.45', 'otherworkoutId: 123']) {
  const h = harness();
  h.write(async () => response);
  const preview = await h.service.stage('coros__createSingleWorkout', create);
  await h.service.confirm(preview.requestId);
  assert.equal(h.calls.length, 1, 'Do not read back a truncated or unrelated ID: ' + response);
}

// Presentation units change, canonical wire values do not.
{
  const h = harness();
  const preview = await h.service.stage('coros__createSingleWorkout', create, false, 'imperial');
  assert.match(preview.details.join('\n'), /0.62 mi/);
  assert.match(preview.details.join('\n'), /\/mi/);
  await h.service.confirm(preview.requestId);
  assert.deepEqual(h.writes()[0].args.course, course);
}

// Existing strength templates can be scheduled even when the official API cannot edit them.
{
  const h = harness(); h.source({ ...sources, editable: false });
  const preview = await h.service.stage('coros__scheduleWorkout', schedule);
  await h.service.confirm(preview.requestId);
  assert.equal(h.writes()[0].args.workoutId, workoutId);
  await assert.rejects(h.service.stage('coros__updateWorkoutDetails', { ...create, workoutId }), /cannot be edited/);
}

// Live reads use a textual editability marker, sometimes wrapped as a JSON string.
for (const encode of [value => value, JSON.stringify]) {
  const h = harness();
  h.read(async () => encode('Workout Detail\nEditable via MCP: no\nReason: unsupported structure\nCourse JSON: {}'));
  for (const [name, args] of [
    ['updateWorkoutDetails', { ...create, workoutId }],
    ['updateScheduledWorkout', { ...create, date: schedule.date, idInPlan: workoutId }],
    ['updateTrainingPlan', { planInfo: { planId: workoutId }, courseList: [{ ...course, dayNo: 1 }], review_summary: 'Change day two.' }]
  ]) await assert.rejects(h.service.stage('coros__' + name, args), /cannot be edited/);
  const pending = await h.service.stage('coros__scheduleWorkout', schedule);
  assert.equal((await h.service.confirm(pending.requestId)).state, 'saved', 'Read-only library templates can still be scheduled');
}

for (const [field, mutate] of [
  ['stale source', h => h.source({ ...sources, sets: [] })],
  ['account change', h => h.account('account-b')],
  ['permission revoked', h => h.allow(false)],
  ['expired', h => h.advance(25 * 60 * 60_000)]
]) {
  const h = harness();
  const preview = await h.service.stage('coros__scheduleWorkout', schedule, true);
  mutate(h);
  await assert.rejects(h.service.confirm(preview.requestId), undefined, field);
  assert.equal(h.writes().length, 0, field);
}

// Concurrent clicks, interrupted saves, ambiguous network failures, and read-back failure never retry writes.
{
  const h = harness(); let release;
  h.write(() => new Promise(resolve => { release = resolve; }));
  const preview = await h.service.stage('coros__createSingleWorkout', create);
  const pending = h.service.confirm(preview.requestId);
  await assert.rejects(h.service.confirm(preview.requestId), /already being saved/);
  release(JSON.stringify({ workoutId }));
  assert.equal((await pending).state, 'saved');
  assert.equal(h.writes().length, 1);
}
{
  const h = harness();
  const preview = await h.service.stage('coros__createSingleWorkout', create);
  h.interrupt();
  assert.equal(h.restart().restore(preview).state, 'uncertain', 'Interrupted saves restore without a save button');
  assert.equal((await h.restart().confirm(preview.requestId)).state, 'uncertain');
  assert.equal(h.writes().length, 0);
}
{
  const h = harness(); h.write(async () => { throw new Error('connection dropped after dispatch'); });
  const preview = await h.service.stage('coros__createSingleWorkout', create);
  assert.equal((await h.service.confirm(preview.requestId)).state, 'uncertain');
  assert.equal((await h.restart().confirm(preview.requestId)).state, 'uncertain');
  assert.equal(h.writes().length, 1);
}
{
  const h = harness(); h.read(async () => { throw new Error('read-back unavailable'); });
  const preview = await h.service.stage('coros__createSingleWorkout', create);
  const result = await h.service.confirm(preview.requestId);
  assert.equal(result.state, 'saved');
  assert.match(result.message, /Read-back is temporarily unavailable/);
  assert.equal(h.writes().length, 1);
}

// Reject malformed and unsupported prescriptions before the card is offered; never coerce sport/intensity.
for (const changed of [
  { ...course, sportType: 4 },
  { ...course, sportType: 3 },
  { ...course, sections: [] },
  { ...course, sections: [{ sectionType: 2, targetType: 3, targetValue: 300 }] },
  { ...course, sections: [{ sectionType: 2, targetType: 2, targetValue: 300, sectionIntensity: 2 }] },
  { ...course, sections: [{ sectionType: 2, targetType: 2, targetValue: 300, intensityType: 4, sectionIntensity: 2 }] },
  { ...course, sections: [{ sectionType: 2, targetType: 2, targetValue: 300, intensityType: 1, sectionIntensity: 2, intensityValueStart: 130, intensityValueEnd: 140 }] },
  { ...course, sections: [{ intervalGroup: true, repeats: 2, sets: [{ intervalGroup: true, repeats: 2, sets: [] }] }] }
]) {
  const h = harness();
  await assert.rejects(h.service.stage('coros__createSingleWorkout', { ...create, course: changed }));
  assert.equal(h.calls.length, 0);
}
for (const bad of [{ ...schedule, workoutId: Number(workoutId) }, { ...schedule, workoutId: 'abc' }, { ...schedule, date: '20260230' }, { ...schedule, review_summary: '' }]) {
  const h = harness();
  await assert.rejects(h.service.stage('coros__scheduleWorkout', bad));
  assert.equal(h.calls.length, 0);
}
console.log('hybrid COROS Coach tests passed (7 workflows, live schemas, permissions, units, persistence, and duplicate-write protection)');
