const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(os.tmpdir(), `coroslink-battery-test-${process.pid}`));

async function verifyBatteryRendering() {
  const { drawStudioPreview, buildWatchfaceConfigAssetReplacements } = await import('/src/watchfaces/watchfaceStudio.ts');
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const png = (color) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 20, 20);
    return canvas.toDataURL();
  };
  const artwork = { dataUrl: png('#ff0000'), width: 20, height: 20 };
  const background = png('#000000');
  let checks = 0;
  for (const width of [260, 416]) for (const mode of ['current', 'aod']) {
    const prefix = mode === 'aod' ? 'a/' : '';
    const assets = new Map();
    const folder = (name, kind = 'state', count = 12) => ({ folder: prefix + name, kind, aod: mode === 'aod', files: Array.from({ length: count }, (_, i) => {
      const file = { path: `watchface_${width}x${width}/${prefix}${name}/${String(i).padStart(2, '0')}.png`, width: 20, height: 20 };
      // Gray values are invariant across sRGB/P3 and identify each frame exactly.
      assets.set(file.path, { ...file, dataUrl: png(`rgb(${40 + i * 15},${40 + i * 15},${40 + i * 15})`) });
      return file;
    }) });
    const resolution = { directory: `watchface_${width}x${width}`, width, height: width,
      config: { rect_control1_pos: '{0,0}', battery_icon_pos: '{50,50}', battery_icon_dir: prefix + 'fixed',
        control_battery_level_font: prefix + 'digits', control_battery_icon_pos: '{100,50}', control_battery_icon_dir: prefix + 'battery', control_battery_level_rect: '{125,50,150,70,left|vcenter}' },
      aodConfig: {}, icons: [], spriteFolders: [folder('fixed'), folder('battery'), folder('digits', 'digits', 10)] };
    const details = { archiveId: 'battery', resolutions: [resolution] };
    const load = async paths => paths.map(p => assets.get(p)).filter(Boolean);
    const render = async (percent, overrides = {}) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = width;
      await drawStudioPreview(canvas, background, details, { fontFamily: '', digitColor: '#ffffff', accentColor: '#ffffff', tintLabels: false, tintIcons: false,
        previewMode: mode, previewComplication: 'battery', previewValues: { battery: String(percent) }, configAssetOverrides: overrides }, load);
      return canvas;
    };
    const pixel = (canvas, x) => Array.from(canvas.getContext('2d').getImageData(x, 60, 1, 1).data);
    for (const [percent, index] of [[0, 1], [5, 1], [10, 2], [50, 6], [99, 10], [100, 11]]) {
      const canvas = await render(percent);
      for (const x of [60, 110]) {
        const actual = pixel(canvas, x);
        check(Math.abs(actual[0] - (40 + index * 15)) <= 1 && actual[0] === actual[1], `${mode} ${width}px battery ${x} at ${percent}%: ${actual}, expected index ${index}`);
        checks++;
      }
    }
    // A partial import must replace only its own firmware index in each slot.
    const sparse = Object.fromEntries(['config:battery_icon', 'config:control_battery_icon'].map(id => [id, { stateReplacements: { '11': artwork } }]));
    for (const x of [60, 110]) {
      check(pixel(await render(50, sparse), x)[0] === 130, 'A full-only replacement must preserve the template 50% frame');
      const full = pixel(await render(100, sparse), x);
      check(full[0] > full[1] + 100, 'The full-only replacement is selected at 100%');
      checks += 2;
    }
    const exported = await buildWatchfaceConfigAssetReplacements(details, sparse, { loadAssets: load });
    check(exported.length === 2 && exported.every(asset => asset.path.endsWith('/11.png')), 'Sparse exports retain frame 11 in both folders');
    checks++;
  }
  return checks;
}

(async () => {
  let vite, window;
  let exitCode = 0;
  try {
    await app.whenReady();
    const { createServer } = await import('vite');
    vite = await createServer({ root, optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error', plugins: [{ name: 'battery-test', configureServer(server) { server.middlewares.use('/__battery_test', (_, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html><body></body></html>'); }); } }] });
    await vite.listen();
    window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/__battery_test`);
    const checks = await window.webContents.executeJavaScript(`(${verifyBatteryRendering.toString()})()`);
    assert.equal(checks, 68);
    console.log(`Battery passed: ${checks} rendering/export checks, fixed and selectable slots, Current/AOD, 260/416px, sparse imports.`);
  } catch (error) { console.error(error); exitCode = 1; }
  finally { window?.destroy(); await vite?.close(); app.exit(exitCode); }
})();
