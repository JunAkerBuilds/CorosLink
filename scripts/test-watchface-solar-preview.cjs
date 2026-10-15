const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow } = require('electron');

async function verifyExportedFace(fixture) {
  const { renderCompiledWatchfacePreview } = await import('/src/watchfaces/compiledWatchfacePixels.ts');
  const { loadStudioImage } = await import('/src/watchfaces/watchfaceStudio.ts');
  const assets = new Map(fixture.assets.map(asset => [asset.path, asset]));
  const results = [];
  for (const resolution of fixture.details.resolutions) {
    const result = await renderCompiledWatchfacePreview(fixture.details, resolution, 'current', async paths => paths.map(p => assets.get(p)).filter(Boolean),
      { chartSource: 'chart_sunrise', values: { sunriseset: '7:45' } });
    const canvas = document.createElement('canvas'); canvas.width = resolution.width; canvas.height = resolution.height;
    canvas.getContext('2d').drawImage(await loadStudioImage(result.dataUrl), 0, 0);
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const rect = key => resolution.config[key].match(/-?\d+/g).slice(0, 4).map(Number);
    const count = (bounds, test) => {
      let matched = 0;
      for (let y = bounds[1]; y < bounds[3]; y++) for (let x = bounds[0]; x < bounds[2]; x++) {
        const i = (y * canvas.width + x) * 4;
        if (test(pixels[i], pixels[i + 1], pixels[i + 2])) matched++;
      }
      return matched;
    };
    const curvePixels = count(rect('chart_rect'), (r, g, b) => g > r * 1.3 && g > b * 1.2 && g > 70);
    const hour = rect('sunriseset_hour_rect'), minute = rect('sunriseset_minute_rect');
    const timePixels = count([hour[0], hour[1], minute[2], minute[3]], (r, g, b) => r > 150 && g > 150 && b > 150);
    if (curvePixels < 100 || timePixels < 100) throw new Error(`Actual ${resolution.width}px export missing graph (${curvePixels}) or solar time (${timePixels})`);
    results.push({ width: resolution.width, curvePixels, timePixels, dataUrl: result.dataUrl });
  }
  return results;
}

async function loadExportedFace(archivePath) {
  const zip = await require('unzipper').Open.file(archivePath);
  const entries = new Map(zip.files.map(file => [file.path, file]));
  const parse = text => Object.fromEntries([...text.matchAll(/^\[([^\]]+)\][\t ]*=[\t ]*(.*)$/gm)].map(match => [match[1], match[2].trim()]));
  const assets = [];
  for (const file of zip.files.filter(file => file.path.endsWith('.png'))) {
    const bytes = await file.buffer();
    assets.push({ path: file.path, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` });
  }
  const resolutions = [];
  for (const file of zip.files.filter(file => /^watchface_\d+x\d+\/config.txt$/.test(file.path))) {
    const directory = file.path.split('/')[0], width = Number(directory.match(/\d+/)[0]);
    const config = parse((await file.buffer()).toString());
    const aod = entries.get(`${directory}/AODconfig.txt`);
    const aodConfig = aod ? parse((await aod.buffer()).toString()) : {};
    const folders = [...new Set([...Object.values(config), ...Object.values(aodConfig)].map(value => value.replace(/\\/g, '/')))]
      .filter(value => assets.some(asset => asset.path.startsWith(`${directory}/${value}/`)));
    const spriteFolders = folders.map(folder => {
      const files = assets.filter(asset => asset.path.startsWith(`${directory}/${folder}/`)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
      return { folder, kind: files.length === 12 ? 'month' : files.length === 7 ? 'week' : files.length === 10 ? 'digits' : 'state', files };
    });
    const icons = assets.filter(asset => asset.path.startsWith(`${directory}/`) && !spriteFolders.some(folder => folder.files.includes(asset)));
    resolutions.push({ directory, width, height: width, config, aodConfig, icons, spriteFolders });
  }
  return { assets, details: { archiveId: 'exported-face-regression', resolutions } };
}

async function verifySolarPreview() {
  const { renderCompiledWatchfacePreview } = await import('/src/watchfaces/compiledWatchfacePixels.ts');
  const { recoverWatchfaceDesign } = await import('/src/watchfaces/recoveredWatchfaceDesign.ts');
  const { loadStudioImage } = await import('/src/watchfaces/watchfaceStudio.ts');
  let checks = 0;
  const check = (condition, label) => { checks++; if (!condition) throw new Error(label); };
  const png = (width, height, color) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL();
  };
  const inspect = async dataUrl => {
    const image = await loadStudioImage(dataUrl);
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas;
  };
  const pixel = (canvas, x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
  const near = (actual, expected) => actual.every((channel, i) => Math.abs(channel - expected[i]) <= 3);
  let currentImage, aodImage;
  for (const width of [416, 800]) {
    const scale = width / 416, n = value => Math.round(value * scale);
    const root = `watchface_${width}x${width}`, assets = new Map(), folders = [];
    const add = (relative, w, h, color) => {
      const asset = { path: `${root}/${relative}`, width: n(w), height: n(h), dataUrl: png(n(w), n(h), color) };
      assets.set(asset.path, asset); return asset;
    };
    add('background.png', 416, 416, '#000000');
    for (const [mode, color] of [['current', '#e03010'], ['aod', '#1030e0']]) {
      const files = Array.from({ length: 10 }, (_, i) => add(`${mode}/digits/0${i}.png`, 16, 24, color));
      folders.push({ folder: `${mode}/digits`, kind: 'digits', files });
      add(`${mode}/rise/00.png`, 12, 8, mode === 'current' ? '#ffff00' : '#00ffff');
      add(`${mode}/set/01.png`, 12, 8, '#ff00ff');
      add(`${mode}/colon/03.png`, 10, 24, '#ffffff');
    }
    const config = (mode, dy) => ({
      background_icon: 'background.png',
      chart_rect: `{${n(60)},${n(260 + dy)},${n(220)},${n(320 + dy)},left|vcenter}`,
      chart_bar_width: '0', chart_bar_interval: '0', chart_curves_width: String(n(4)),
      chart_curves_upper_color: '0x59C983', chart_curves_lower_color: '0x386E50',
      sunriseset_hour_rect: `{${n(250)},${n(250 + dy)},${n(282)},${n(274 + dy)},left|vcenter}`,
      sunriseset_minute_rect: `{${n(292)},${n(250 + dy)},${n(324)},${n(274 + dy)},left|vcenter}`,
      sunriseset_font: `${mode}\\digits`, sunriseset_icon_pos: `{${n(250)},${n(230 + dy)}}`,
      sunriseset_sunrise_icon: `${mode}\\rise\\00.png`, sunriseset_sunset_icon: `${mode}/set/01.png`,
      sunriseset_colon_icon: `${mode}/colon/03.png`
    });
    // Direct numbered icons are deliberately absent from the archive metadata.
    const resolution = { directory: root, width, height: width, config: config('current', 0), aodConfig: config('aod', -60),
      icons: [], spriteFolders: folders };
    const details = { archiveId: 'solar-regression', resolutions: [resolution] };
    const before = JSON.stringify(details);
    const load = async paths => paths.map(p => assets.get(p)).filter(Boolean);
    for (const [mode, dy, color, iconColor] of [['current', 0, [224, 48, 16], [255, 255, 0]], ['aod', -60, [16, 48, 224], [0, 255, 255]]]) {
      const result = await renderCompiledWatchfacePreview(details, resolution, mode, load, { chartSource: 'chart_sunrise', values: { sunriseset: '07:45' } });
      const canvas = await inspect(result.dataUrl);
      check(near(pixel(canvas, n(253), n(253 + dy)), color), `${width} ${mode}: exported hour digits render at their native coordinates`);
      check(near(pixel(canvas, n(295), n(253 + dy)), color), `${width} ${mode}: exported minute digits render after the configured colon gap`);
      check(near(pixel(canvas, n(285), n(253 + dy)), [255, 255, 255]), `${width} ${mode}: exported colon is recovered as symbol 3`);
      check(near(pixel(canvas, n(253), n(233 + dy)), iconColor), `${width} ${mode}: numbered sunrise artwork renders above the value`);
      check(pixel(canvas, n(140), n(268 + dy))[1] > 150, `${width} ${mode}: a graph without numeric readout still renders its exported green curve`);
      check(near(pixel(canvas, n(65), n(260 + dy)), [0, 0, 0]), `${width} ${mode}: chart recovery does not invent a label or number`);
      if (width === 416) { if (mode === 'current') currentImage = result.dataUrl; else aodImage = result.dataUrl; }
    }
    const loadedIcons = [...assets.values()].filter(file => /\/rise\/|\/set\/|\/colon\//.test(file.path));
    const recovered = await recoverWatchfaceDesign({ ...details, resolutions: [{ ...resolution, icons: loadedIcons }] }, load);
    check(recovered.nativeData.sunriseset.assets.digits && Object.keys(recovered.nativeData.sunriseset.assets.digits).length === 10, `${width}: all ten solar digit PNGs survive recovery`);
    check(recovered.nativeData.sunriseset.assets.icon[1], `${width}: sunset artwork is preserved as the second icon state`);
    check(recovered.nativeData.sunriseset.parts.progress.enabled === false, `${width}: disabled progress artwork is not regenerated`);
    check(recovered.nativeData.chart.parts.value.enabled === false, `${width}: graph-only recovery keeps the numeric readout hidden`);
    // Export writes a hidden chart number as 1x1 transparent digits so the watch draws the graph.
    const blankDigits = Array.from({ length: 10 }, (_, i) => ({ path: `${root}/blank/0${i}.png`, width: 1, height: 1, dataUrl: png(1, 1, 'rgba(0,0,0,0)') }));
    for (const file of blankDigits) assets.set(file.path, file);
    const invisible = { ...resolution, config: { ...resolution.config, chart_stress_rect: `{${n(60)},${n(260)},${n(68)},${n(264)},left|vcenter}`, chart_stress_font: 'blank' },
      spriteFolders: [...folders, { folder: 'blank', kind: 'digits', files: blankDigits }] };
    const reopened = (await recoverWatchfaceDesign({ ...details, resolutions: [invisible] }, load)).nativeData.chart;
    check(reopened.chartSource === 'chart_stress' && reopened.parts.value.enabled === false, `${width}: an invisible chart number reopens hidden, on its own chart data`);
    const bothStyles = { ...resolution, config: { ...resolution.config, chart_bar_width: String(n(8)) } };
    const hint = await inspect((await renderCompiledWatchfacePreview(details, bothStyles, 'current', load, { chartSource: 'chart_sunrise' })).dataUrl);
    check(pixel(hint, n(140), n(268))[1] > 150, `${width}: the captured sunrise source selects the curve when bar and line styling both exist`);
    const alternatives = { ...bothStyles, config: { ...bothStyles.config, chart_stress_rect: `{${n(50)},${n(50)},${n(114)},${n(74)},left|vcenter}`, chart_stress_font: 'current/digits' } };
    const selected = await inspect((await renderCompiledWatchfacePreview(details, alternatives, 'current', load, { chartSource: 'chart_sunrise' })).dataUrl);
    check(pixel(selected, n(140), n(268))[1] > 150 && near(pixel(selected, n(53), n(53)), [0, 0, 0]), `${width}: other chart groups do not replace the selected graph when its own readout is hidden`);
    const off = { ...resolution, config: { ...resolution.config, chart_curves_width: '0' } };
    const offCanvas = await inspect((await renderCompiledWatchfacePreview(details, off, 'current', load, { chartSource: 'chart_sunrise' })).dataUrl);
    check(near(pixel(offCanvas, n(140), n(268)), [0, 0, 0]), `${width}: zero line width keeps the graph hidden`);
    const iconOnly = { ...resolution, config: { ...resolution.config, sunriseset_font: '' } };
    const iconCanvas = await inspect((await renderCompiledWatchfacePreview(details, iconOnly, 'current', load)).dataUrl);
    check(near(pixel(iconCanvas, n(253), n(233)), [255, 255, 0]) && near(pixel(iconCanvas, n(253), n(253)), [0, 0, 0]), `${width}: icon-only solar data does not invent missing number glyphs`);
    const noSolarAod = { ...resolution, aodConfig: Object.fromEntries(Object.entries(resolution.aodConfig).filter(([key]) => !key.startsWith('sunriseset'))) };
    const noSolarCanvas = await inspect((await renderCompiledWatchfacePreview(details, noSolarAod, 'aod', load)).dataUrl);
    check(near(pixel(noSolarCanvas, n(253), n(193)), [0, 0, 0]), `${width}: AOD never borrows Current solar assets`);
    check(JSON.stringify(details) === before, `${width}: rendering leaves the archive unchanged`);
  }
  return { checks, currentImage, aodImage };
}

(async () => {
  let vite, window, exitCode = 0;
  try {
    await app.whenReady();
    const { createServer } = await import('vite');
    vite = await createServer({ root: path.resolve(__dirname, '..'), optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error',
      plugins: [{ name: 'solar-preview-test', configureServer(server) { server.middlewares.use('/__solar_test', (_, res) => {
        res.setHeader('Content-Type', 'text/html'); res.end('<html><body></body></html>');
      }); } }] });
    await vite.listen();
    window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/__solar_test`);
    const result = await window.webContents.executeJavaScript(`(${verifySolarPreview.toString()})()`);
    assert.equal(result.checks, 46);
    for (const [name, url] of [['current', result.currentImage], ['aod', result.aodImage]]) {
      await fs.writeFile(`/tmp/coroslink-solar-preview-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(`Watchface solar preview tests passed (${result.checks} checks; 416px and 800px, Current and AOD).`);
    if (process.argv[2]) {
      const fixture = await loadExportedFace(path.resolve(process.argv[2]));
      const exported = await window.webContents.executeJavaScript(`(${verifyExportedFace.toString()})(${JSON.stringify(fixture)})`);
      for (const output of exported) {
        const destination = `/tmp/coroslink-solar-export-${output.width}.png`;
        await fs.writeFile(destination, Buffer.from(output.dataUrl.split(',')[1], 'base64'));
        console.log(`Actual ${output.width}px export: ${output.curvePixels} curve pixels, ${output.timePixels} time pixels (${destination}).`);
      }
    }
  } catch (error) { console.error(error); exitCode = 1; }
  finally { window?.destroy(); await vite?.close(); app.exit(exitCode); }
})();
