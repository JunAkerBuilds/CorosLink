// Fixed battery rotation: quarter turns baked into isolated state PNGs, a
// matching preview, and a template folder shared with the selectable battery
// left untouched. Run: npm run test:watchface-battery-rotation
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', path.join(require('node:os').tmpdir(), `coroslink-battery-rotation-${process.pid}`));

async function verifyBatteryRotation() {
  const studio = await import('/src/watchfaces/watchfaceStudio.ts');
  const states = await import('/src/watchfaces/watchfaceBatteryStates.ts');
  const { composeWatchfaceReplacements } = await import('/src/watchfaces/watchfaceCompose.ts');
  const { makeDefaultDesign } = await import('/src/watchfaces/watchfaceBackground.ts');
  let tests = 0; globalThis.__stage = 'setup';
  const check = (condition, label) => { if (!condition) throw new Error(label); tests += 1; };
  // A 30×12 frame: white body with a red cap on its left end.
  const frame = () => {
    const canvas = document.createElement('canvas'); canvas.width = 30; canvas.height = 12;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(4, 0, 26, 12);
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 4, 12);
    return canvas.toDataURL('image/png');
  };
  const pixel = async (dataUrl, x, y) => {
    const image = await studio.loadStudioImage(dataUrl);
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, rgba: [...context.getImageData(x, y, 1, 1).data] };
  };
  const red = (rgba) => rgba[0] > 200 && rgba[1] < 60 && rgba[3] > 200;

  check(states.batteryIconRotation({ rotation: -90 }) === 270 && states.batteryIconRotation({ rotation: 450 }) === 90 &&
    states.batteryIconRotation(undefined) === 0, 'Rotation normalizes to clockwise quarter turns');

  const turned = await pixel(await studio.rotateSpriteQuarterTurns(frame(), 90), 6, 1);
  check(turned.width === 12 && turned.height === 30 && red(turned.rgba), 'A clockwise quarter turn moves the left cap to the top');

  const root = 'watchface_416x416';
  const files = [...Array(3)].map((_, index) => ({ path: `${root}/battery/0${index}.png`, width: 30, height: 12 }));
  const sources = new Map(files.map((file) => [file.path, { ...file, dataUrl: frame() }]));
  const black = document.createElement('canvas'); black.width = 416; black.height = 416;
  black.getContext('2d').fillRect(0, 0, 416, 416);
  sources.set(`${root}/background.png`, { path: `${root}/background.png`, width: 416, height: 416, dataUrl: black.toDataURL('image/png') });
  const load = async (paths) => paths.map((p) => {
    const source = sources.get(p);
    if (!source) throw new Error(`The template does not contain the requested image: ${p}`);
    return source;
  });
  const fixture = (config) => ({ archiveId: 'battery-rotation', resolutions: [{ directory: root, width: 416, height: 416,
    config: { background_icon: 'background.png', battery_icon_dir: 'battery', battery_icon_pos: '{100,200}', ...config },
    aodConfig: {}, icons: [], spriteFolders: [{ folder: 'battery', kind: 'state', files }] }] });
  const design = (rotation) => JSON.parse(JSON.stringify({ ...makeDefaultDesign(),
    configAssetOverrides: { 'config:battery_icon': { rotation } } }));

  // Template frames, folder shared with the selectable battery.
  const shared = fixture({ control_battery_icon_dir: 'battery' });
  const composed = await composeWatchfaceReplacements(shared, design(90), load);
  const rotatedFrames = composed.assetReplacements.filter((entry) => entry.path.startsWith(`${root}/cl_battery_icon/`));
  check(rotatedFrames.length === 3 && rotatedFrames.every((entry) => entry.allowDimensionOverride), 'Every template state is copied into the Studio folder');
  const exportedFrame = await pixel(rotatedFrames[0].dataUrl, 6, 1);
  check(exportedFrame.width === 12 && exportedFrame.height === 30 && red(exportedFrame.rgba), 'Exported states carry the quarter turn');
  check(!composed.assetReplacements.some((entry) => entry.path.startsWith(`${root}/battery/`)), 'The shared template folder stays untouched');
  const config = studio.applyConfigOverridesToDetails(shared, composed.configOverrides).resolutions[0].config;
  check(config.battery_icon_dir === 'cl_battery_icon' && config.battery_icon_pos === '{100,200}',
    `The fixed battery reads the rotated folder at its own position (${JSON.stringify([config.battery_icon_dir, config.battery_icon_pos])})`);

  globalThis.__stage = 'unrotated';
  const unrotated = await composeWatchfaceReplacements(shared, design(0), load);
  check(!unrotated.assetReplacements.some((entry) => entry.path.includes('/cl_battery_icon/')), 'No rotation leaves the battery export as it was');

  // Imported states rotate too.
  const imported = design(270);
  imported.configAssetOverrides['config:battery_icon'] = { rotation: 270, enabled: true,
    stateReplacements: Object.fromEntries([0, 1, 2].map((index) => [String(index), { dataUrl: frame(), width: 30, height: 12 }])) };
  globalThis.__stage = 'imported';
  const importedOut = await composeWatchfaceReplacements(fixture({}), imported, load);
  const importedFrames = importedOut.assetReplacements.filter((entry) => entry.path.startsWith(`${root}/cl_battery_icon/`));
  const importedFrame = importedFrames[0] && await pixel(importedFrames[0].dataUrl, 6, 28);
  check(importedFrames.length === 3 && importedFrame.width === 12 && importedFrame.height === 30 && red(importedFrame.rgba),
    'Imported states turn counter-clockwise for 270°, cap at the bottom');

  // The preview draws the turned frame at the same top-left position.
  globalThis.__stage = 'preview';
  const preview = document.createElement('canvas'); preview.width = 416; preview.height = 416;
  await studio.drawStudioPreview(preview, sources.get(`${root}/background.png`).dataUrl, fixture({}), { fontFamily: '', digitColor: '#ffffff', accentColor: '#ffffff',
    tintIcons: false, tintLabels: false, configAssetOverrides: { 'config:battery_icon': { rotation: 90 } } }, load);
  const at = (x, y) => [...preview.getContext('2d').getImageData(x, y, 1, 1).data];
  check(red(at(106, 201)) && !red(at(106, 220)) && at(120, 206).slice(0, 3).every((channel) => channel < 20), 'Preview shows the turned battery at its position');
  return { tests };
}

(async () => {
  let vite, window, exitCode = 0;
  try {
    await app.whenReady();
    const { createServer } = await import('vite');
    vite = await createServer({ root: path.resolve(__dirname, '..'), optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error', plugins: [{ name: 'battery-rotation-page', configureServer(server) { server.middlewares.use('/__battery_rotation', (_, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html><body></body></html>'); }); } }] });
    await vite.listen();
    window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/__battery_rotation`);
    const results = await window.webContents.executeJavaScript(`(${verifyBatteryRotation.toString()})().catch((error) => { throw new Error(globalThis.__stage + ": " + error.message); })`);
    console.log(`Battery rotation tests passed (${results.tests} checks)`);
  } catch (error) { console.error(error); exitCode = 1; }
  finally { window?.destroy(); await vite?.close(); app.exit(exitCode); }
})();
