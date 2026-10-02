// Authenticated, read-only verification of live Coach MCP contracts and response stability.
// Usage: npm run verify:coach-coros-mcp
// Override COROSLINK_USER_DATA only when testing another saved CorosLink profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

app.setName('coroslink');
app.setPath('userData', process.env.COROSLINK_USER_DATA || path.join(app.getPath('appData'), 'coroslink'));
const readNames = new Set(['queryWorkoutLibrary', 'queryWorkoutDetails', 'queryScheduledWorkoutDetails', 'queryTrainingPlanLibrary', 'queryTrainingPlanDetails', 'queryTrainingSchedule']);
const normalizeSchema = value => Array.isArray(value) ? value.map(normalizeSchema)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalizeSchema(child)]))
    : value;
const decode = value => { try { const parsed = JSON.parse(value); return typeof parsed === 'string' ? parsed : value; } catch { return value; } };

async function main() {
  await app.whenReady();
  const database = require('../dist-electron/database.js');
  const manager = require('../dist-electron/mcpClientManager.js');
  const { AjvJsonSchemaValidator } = require('@modelcontextprotocol/sdk/validation/ajv');
  const db = database.initializeDatabase(app.getPath('userData'));
  const watchdog = setTimeout(() => app.exit(1), 60_000);
  try {
    await manager.connectMcpServer('coros', false);
    const tools = await manager.getMcpServerTools('coros');
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/coros-mcp-workout-schemas.json'), 'utf8'));
    for (const captured of fixture.tools) {
      const live = tools.find(tool => `coros__${tool.name}` === captured.name);
      assert.ok(live, `Missing live tool: ${captured.name}`);
      assert.deepEqual(normalizeSchema(live.inputSchema), normalizeSchema(captured.inputSchema), `Schema changed: ${captured.name}`);
    }
    console.log(`Verified ${fixture.tools.length} captured read/write schemas against authenticated COROS tools/list.`);
    const read = async (name, args) => {
      assert.ok(readNames.has(name), 'This verifier permits only read tools');
      const tool = tools.find(tool => tool.name === name);
      assert.ok(tool, `Missing read tool: ${name}`);
      const checked = new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(args);
      assert.equal(checked.valid, true, `${name}: ${checked.errorMessage}`);
      return manager.callMcpTool(`coros__${name}`, args);
    };
    const library = decode(await read('queryWorkoutLibrary', {}));
    const schedule = decode(await read('queryTrainingSchedule', {}));
    const plans = decode(await read('queryTrainingPlanLibrary', {}));
    const workoutId = library.match(/\[Running\][^\n]*\n\s+Workout ID: ([0-9]+)/)?.[1]
      ?? library.match(/Workout ID: ([0-9]+)/)?.[1];
    const planId = plans.match(/Plan ID: ([0-9]+)/)?.[1] ?? schedule.match(/Plan ID: ([0-9]+)/)?.[1];
    const standalone = schedule.split('\n\n').find(block => block.includes('Standalone workout'));
    const date = standalone?.match(/\d{4}-\d{2}-\d{2}/)?.[0].replaceAll('-', '');
    const idInPlan = standalone?.match(/idInPlan: ([0-9]+)/)?.[1];
    for (const [name, args] of [
      ['queryWorkoutDetails', { workoutId }],
      ['queryScheduledWorkoutDetails', { date, idInPlan }],
      ['queryTrainingPlanDetails', { planId }]
    ]) {
      if (Object.values(args).some(value => !value)) {
        console.log(`${name}: skipped (no existing target in the inspected library/current schedule).`);
        continue;
      }
      const responses = [];
      for (let sample = 0; sample < 3; sample++) {
        if (sample) await new Promise(resolve => setTimeout(resolve, 600));
        responses.push(await read(name, args));
      }
      // Report only contract/stability results, never credentials or account content.
      console.log(`${name}: 3 reads, ${responses.every(value => value === responses[0]) ? 'identical responses' : 'responses differ; investigate before changing digest rules'}.`);
    }
  } finally {
    clearTimeout(watchdog);
    await manager.disconnectMcpServer('coros', { clearAuthorization: false });
    db.close();
  }
}
main().then(() => app.exit(0), error => { console.error(error.message); app.exit(1); });
