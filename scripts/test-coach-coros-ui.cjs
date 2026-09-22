// Real React card, preload IPC, action service, and SQLite persistence; remote COROS is mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');
const temporaryRoot = path.join(os.tmpdir(), `coroslink-coach-ui-${process.pid}`);
app.setPath('userData', path.join(temporaryRoot, 'user-data'));
app.on('window-all-closed', () => {});

async function until(read, accept, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${label}`);
}

async function main() {
  await app.whenReady();
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const database = require('../dist-electron/database.js');
  const history = require('../dist-electron/chatHistoryStore.js');
  const { createCorosActionService } = require('../dist-electron/coachCorosActions.js');
  const { tools } = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures/coros-mcp-workout-schemas.json'), 'utf8'));
  const db = database.initializeDatabase(app.getPath('userData'));
  const calls = [];
  let source = JSON.stringify({ name: 'Original source', editable: true });
  let releaseWrite;
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  const deps = {
    tools: () => tools,
    load: () => database.getSetting('chat.corosActions'),
    save: value => database.setSetting('chat.corosActions', value),
    connectionKey: () => 'isolated-test-authorization',
    canConfirm: () => true,
    call: async (name, args) => {
      calls.push({ name, args });
      if (name.startsWith('coros__query')) return source;
      if (args.course?.courseName === 'Uncertain run') throw new Error('Connection dropped after dispatch');
      await gate;
      return JSON.stringify('Workout ID: 9223372036854775701\nSaved.');
    }
  };
  let service = createCorosActionService(deps);
  const create = name => service.stage('coros__createSingleWorkout', {
    review_summary: `Save ${name} to the library.`,
    course: { courseName: name, courseDescription: 'Easy aerobic run.', sportType: 1, sections: [{ sectionType: 2, targetType: 2, targetValue: 600 }] }
  });
  const saved = await create('Easy run');
  const stale = await service.stage('coros__scheduleWorkout', { workoutId: '123', date: '20990101', review_summary: 'Schedule the existing workout.' });
  const uncertain = await create('Uncertain run');
  const interrupted = await create('Interrupted run');
  const stored = JSON.parse(deps.load());
  stored.find(action => action.preview.requestId === interrupted.requestId).preview.state = 'saving';
  deps.save(JSON.stringify(stored));
  service = createCorosActionService(deps);
  const session = history.createChatSession('chatgpt');
  history.saveChatSession(session.id, [saved, stale, uncertain, interrupted].map(preview => ({ kind: 'corosAction', preview })));
  ipcMain.handle('chat:getSession', (_event, id) => history.getChatSession(id).map(entry => entry.kind === 'corosAction' ? { ...entry, preview: service.restore(entry.preview) } : entry));
  ipcMain.handle('chat:saveSession', (_event, id, entries) => history.saveChatSession(id, entries));
  ipcMain.handle('chat:confirmCorosAction', (_event, id) => service.confirm(id));
  let window, vite;
  const watchdog = setTimeout(() => app.exit(1), 90_000);
  try {
    vite = await createServer({ root, configFile: false, plugins: [react()], cacheDir: path.join(temporaryRoot, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
    await vite.listen();
    window = new BrowserWindow({ show: false, width: 900, height: 1100, webPreferences: { preload: path.join(root, 'dist-electron/preload.js'), sandbox: false, contextIsolation: true, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code, true);
    const section = preview => `document.querySelector('[data-action="${preview.requestId}"]')`;
    const text = preview => js(`${section(preview)}?.textContent`);
    const buttonCount = preview => js(`${section(preview)}?.querySelectorAll('button').length`);
    const click = preview => js(`${section(preview)}.querySelector('button').click(); void 0;`);
    const writes = () => calls.filter(call => !call.name.startsWith('coros__query'));
    const ready = () => until(() => js('document.querySelectorAll("[data-action]").length'), count => count === 4, 'four review cards');
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/coach-coros.html?session=${session.id}`);
    await ready();
    assert.equal(writes().length, 0, 'Rendering pending cards cannot write');
    assert.match(await text(interrupted), /previous save was interrupted/);
    assert.equal(await buttonCount(interrupted), 0);

    await click(saved);
    await until(() => Promise.resolve(writes().length), count => count === 1, 'first write dispatch');
    assert.equal(await js(`${section(saved)}.querySelector('button').disabled`), true);
    assert.match(await text(saved), /Saving/);
    await assert.rejects(service.confirm(saved.requestId), /already being saved/);
    releaseWrite();
    await until(() => text(saved), value => value?.includes('saved item is available to read'), 'saved card and read-back');
    assert.equal(await buttonCount(saved), 0);
    assert.ok(calls.some(call => call.name === 'coros__queryWorkoutDetails' && call.args.workoutId === '9223372036854775701'));

    source = JSON.stringify({ name: 'Changed source', editable: true });
    await click(stale);
    await until(() => text(stale), value => value?.includes('changed since the preview'), 'stale-source alert');
    assert.equal(writes().length, 1, 'A stale review cannot write');
    await click(uncertain);
    await until(() => text(uncertain), value => value?.includes('COROS did not confirm the save'), 'uncertain outcome');
    assert.equal(await buttonCount(uncertain), 0);
    assert.equal(writes().length, 2);
    assert.equal((await service.confirm(uncertain.requestId)).state, 'uncertain');
    assert.equal(writes().length, 2, 'Uncertain saves cannot retry');

    service = createCorosActionService(deps);
    const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    window.webContents.reload();
    await reloaded;
    await ready();
    assert.equal(await buttonCount(saved), 0, 'Saved state survives service and renderer restart');
    assert.equal(await buttonCount(uncertain), 0);
    assert.equal(await buttonCount(interrupted), 0);
    const context = await js('document.querySelector("[data-testid=coach-context]").textContent');
    assert.match(context, /saved/);
    assert.match(context, /uncertain/);
    assert.equal(history.getChatSession(session.id).filter(entry => entry.kind === 'corosAction').length, 4, 'Status updates replace cards in history');
    assert.equal(writes().length, 2);
    console.log('Coach COROS UI passed: stage, real preload IPC, save, 64-bit read-back, stale rejection, uncertain/interrupted outcomes, SQLite history, restart.');
  } finally {
    clearTimeout(watchdog);
    releaseWrite();
    window?.destroy();
    await vite?.close();
    db.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
