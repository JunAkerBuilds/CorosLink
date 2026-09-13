const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', path.join(require('node:os').tmpdir(), `coroslink-glyph-test-${process.pid}`));

async function verifyPixels() {
  const studio = await import('/src/watchfaces/watchfaceStudio.ts');
  const layout = await import('/src/watchfaces/watchfaceGlyphLayout.ts');
  const compiled = await import('/src/watchfaces/compiledWatchfacePixels.ts');
  const check = (condition, label) => { if (!condition) throw new Error(label); };
  const png = (w, h, x, y, iw, ih, color = '#ffffff') => {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(x, y, iw, ih);
    return canvas.toDataURL();
  };
  const inspect = async (url) => {
    const image = await studio.loadStudioImage(url);
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const ink = []; let x0 = canvas.width, x1 = -1, y0 = canvas.height, y1 = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (data[(y * canvas.width + x) * 4 + 3] >= 8) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      ink.push(...data.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4));
    }
    return { width: canvas.width, height: canvas.height, x0, x1, y0, y1, ink, canvas, image };
  };
  const one = png(40, 90, 10, 30, 6, 40), eight = png(50, 50, 5, 5, 32, 40);
  const font = { label: 'Mixed padded PNGs', glyphs: '0123456789', columns: 10, dataUrl: eight, tint: false,
    sprites: Object.fromEntries([...Array(10)].map((_, d) => [String(d), d === 1 ? one : eight])) };
  const a = await inspect(await studio.renderRasterFontSprite('1', 48, 60, font, '#ffffff'));
  const b = await inspect(await studio.renderRasterFontSprite('8', 48, 60, font, '#ffffff'));
  check(a.y0 === b.y0 && a.y1 === b.y1, 'Mixed PNGs must share cap height and baseline');
  check(a.x1 - a.x0 < (b.x1 - b.x0) / 3, 'Narrow digits must retain their shape');
  const spaced = await inspect(await layout.spaceWatchfaceGlyph(await studio.renderRasterFontSprite('8', 48, 60, font, '#ffffff'), .2));
  check(spaced.width === 60 && JSON.stringify(spaced.ink) === JSON.stringify(b.ink), 'Tracking must add 12 pixels without changing any glyph pixels');
  const tightened = await inspect(await layout.spaceWatchfaceGlyph(await studio.renderRasterFontSprite('8', 48, 60, font, '#ffffff'), -.35));
  check(JSON.stringify(tightened.ink) === JSON.stringify(b.ink), 'Negative tracking must not clip ink');
  const shifted = await inspect(await studio.renderRasterFontSprite('8', 48, 60, { ...font, glyphLayout: { height: .5, baseline: .8 } }, '#ffffff'));
  check(shifted.y1 === 47 && shifted.y1 - shifted.y0 + 1 === 30, 'Glyph height and baseline must be independent');
  const moves = layout.glyphBaselineMovements([{ id: 'digits', top: 30, bottom: 90 }, { id: 'unit', top: 80, bottom: 100 }, { id: 'colon', top: 70, bottom: 90, colon: true }]);
  check(moves.unit.dy === -10 && moves.colon.dy === -20 && moves.digits.dy === 0, 'Baseline alignment must place units and colons relative to cap height');
  const digit1 = await inspect(studio.renderDigitSprite('1', 48, 60, 'Arial', '#ffffff'));
  const digit8 = await inspect(studio.renderDigitSprite('8', 48, 60, 'Arial', '#ffffff'));
  check(Math.abs(digit1.y1 - digit8.y1) <= 1, 'Desktop digits must share a baseline');
  const sources = new Map();
  const root = 'watchface_416x416';
  const asset = (p, url, width = 12, height = 8) => sources.set(p, { path: p, dataUrl: url, width, height });
  asset(`${root}/background.png`, png(416, 416, 0, 0, 416, 416, '#000000'), 416, 416);
  const files = [...Array(10)].map((_, d) => ({ path: `${root}/digits/0${d}.png`, width: 20, height: 30 }));
  for (const file of files) asset(file.path, png(20, 30, 3, 2, 14, 26, '#ff0000'), 20, 30);
  asset(`${root}/pm.png`, png(12, 8, 0, 0, 12, 8, '#00ff00'));
  asset(`${root}/am.png`, png(12, 8, 0, 0, 12, 8, '#0000ff'));
  const resolution = { directory: root, width: 416, height: 416, config: {
    background_icon: 'background.png', time_hour_high_pos: '{130,120}', time_hour_low_pos: '{156,120}',
    time_hour_high_font: 'digits', time_hour_low_font: 'digits',
    am_pm_icon_pos: '{230,200}', am_icon: 'am.png', pm_icon: 'pm.png',
    step_rect: '{130,220,160,250,left|bottom}', step_font: 'digits'
  }, aodConfig: { background_icon: 'background.png', time_hour_high_pos: '{200,160}', time_hour_high_font: 'digits' },
    spriteFolders: [{ folder: 'digits', kind: 'digits', files }], icons: [ { path: `${root}/am.png`, width: 12, height: 8 }, { path: `${root}/pm.png`, width: 12, height: 8 } ] };
  const details = { archiveId: 'compiled-fixture', resolutions: [resolution] };
  const load = async (paths) => paths.map((p) => sources.get(p)).filter(Boolean);
  const output = await compiled.renderCompiledWatchfacePreview(details, resolution, 'current', load, { date: new Date(2026, 8, 13, 20, 58), values: { steps: '88888' } });
  const actual = await inspect(output.dataUrl);
  const px = (x,y) => [...actual.canvas.getContext('2d').getImageData(x,y,1,1).data];
  check(actual.width === 416 && actual.height === 416, 'Compiled output must stay at native resolution');
  check(px(134,123)[0] === 255 && px(134,123)[1] === 0, 'Compiled digit pixels must keep archive color and coordinates');
  check(px(232,202)[1] === 255, 'Compiled preview must include configured PM sprite');
  check(output.checks.some((s) => s.includes('rectangle')), 'Compiled preview must report undersized firmware rectangles');
  check(px(161,230)[0] === 0, 'Compiled value rendering must clip to firmware rectangle');
  const aod = await inspect((await compiled.renderCompiledWatchfacePreview(details, resolution, 'aod', load)).dataUrl);
  check(aod.canvas.getContext('2d').getImageData(204,163,1,1).data[0] === 255, 'AOD must use its own compiled coordinates without dimming again');
  // Generated direct PNG references can be numbered, even in single-file
  // folders which older archive descriptions omit from both asset lists.
  for (const [name, color] of [['sunset', '#ffff00'], ['sunrise', '#ff00ff'], ['aod_sunset', '#00ffff'], ['am', '#0000ff'], ['pm', '#00ff00']]) {
    asset(`${root}/studio/${name}/00.png`, png(12, 8, 0, 0, 12, 8, color));
  }
  const solarConfig = {
    ...resolution.config, rect_control1_pos: '{100,100}',
    am_icon: 'studio\\am\\00.png', pm_icon: 'studio/pm/00.png',
    control_sunset_icon: 'studio\\sunset\\00.png', control_sunset_icon_pos: '{4,5}',
    control_sunset_hour_rect: '{0,50,40,80,left|top}', control_sunset_minute_rect: '{45,50,85,80,left|top}', control_sunset_font: 'digits',
    control_sunrise_icon: 'studio/sunrise/00.png', control_sunrise_icon_pos: '{60,5}',
    control_sunrise_hour_rect: '{0,50,40,80,left|top}', control_sunrise_minute_rect: '{45,50,85,80,left|top}', control_sunrise_font: 'digits'
  };
  const solarResolution = { ...resolution, config: solarConfig, aodConfig: {
    ...solarConfig, rect_control1_pos: '{160,100}', control_sunset_icon: 'studio/aod_sunset/00.png',
    am_icon: '', pm_icon: '', am_pm_icon_pos: ''
  }, icons: [] };
  const solarBefore = JSON.stringify(solarResolution);
  const readPixel = async (mode, complication, hour, x, y) => {
    const rendered = await compiled.renderCompiledWatchfacePreview(details, solarResolution, mode, load, { date: new Date(2026,8,13,hour), complication });
    const raster = await inspect(rendered.dataUrl);
    return [...raster.canvas.getContext('2d').getImageData(x,y,1,1).data].slice(0,3).join(',');
  };
  check(await readPixel('current', 'sunset', 10, 105,106) === '255,255,0', 'Compiled sunset must render a configured numbered icon omitted from archive metadata');
  check(await readPixel('current', 'sunset', 10, 161,106) === '0,0,0', 'Sunset preview must not paint the sunrise state');
  check(await readPixel('current', 'sunrise', 10, 161,106) === '255,0,255', 'Compiled sunrise must select its own numbered icon');
  check(await readPixel('current', 'sunrise', 10, 105,106) === '0,0,0', 'Sunrise preview must not paint the sunset state');
  check(await readPixel('current', 'sunset', 10, 232,202) === '0,0,255', 'Compiled AM must load its direct numbered PNG');
  const numberedPmPixel = await readPixel('current', 'sunset', 20, 232,202);
  check(numberedPmPixel.split(',').every((channel, i) => Math.abs(Number(channel) - [0,255,0][i]) <= 3), `Compiled PM must load its direct numbered PNG (got ${numberedPmPixel})`);
  const aodSolarPixel = await readPixel('aod', 'sunset', 10, 165,106);
  check(aodSolarPixel.split(',').every((channel, i) => Math.abs(Number(channel) - [0,255,255][i]) <= 3), `AOD must use its own numbered solar artwork and origin (got ${aodSolarPixel})`);
  check(await readPixel('aod', 'sunset', 10, 105,106) === '0,0,0', 'AOD must not paint Current solar artwork');
  check(await readPixel('aod', 'sunset', 10, 232,202) === '0,0,0', 'AOD must respect disabled AM/PM references');
  check(JSON.stringify(solarResolution) === solarBefore, 'Compiled asset discovery must not mutate the archive description');
  const pixels = compiled.createCompiledPixelChecks(416,416);
  pixels.sprite('first', b.image, 120,120,48,60); pixels.sprite('second', b.image,120,120,48,60);
  pixels.sprite('edge', b.image,0,0,48,60);
  check([...pixels.checks].some((s) => s.includes('overlap')) && [...pixels.checks].some((s) => s.includes('display edge')), 'Pixel checks must detect real overlaps and circular clipping');
  const clear = compiled.createCompiledPixelChecks(416,416);
  const tiny = await inspect(png(30,30,0,0,2,2));
  clear.sprite('first',tiny.image,200,200,30,30); clear.sprite('second',tiny.image,215,200,30,30);
  check(clear.checks.size === 0, 'Transparent boxes may overlap without a collision');
  const styles = { steps: { scale: 1, rasterFont: font, fontFamily: '', letterSpacing: .2 } };
  const generated = await studio.buildMetricSpriteReplacements(details, styles, '', load);
  const metrics = await Promise.all(generated.map((entry) => inspect(entry.dataUrl)));
  check(metrics.length === 10 && metrics.every((entry) => entry.width === 26 && entry.height === 30), 'Metric export must store spacing in each digit advance cell');
  const previewCanvas = document.createElement('canvas'); previewCanvas.width=416; previewCanvas.height=416;
  await studio.drawStudioPreview(previewCanvas, sources.get(`${root}/background.png`).dataUrl, details, { fontFamily:'', digitColor:'#ffffff', accentColor:'#ffffff', tintIcons:false, tintLabels:false, metricStyles:styles }, load);
  return { dataUrl: output.dataUrl, checks: output.checks, tests: 26 };
}

(async () => {
  let vite, window, exitCode = 0;
  try {
    await app.whenReady();
    const { createServer } = await import('vite');
    vite = await createServer({ root: path.resolve(__dirname,'..'), optimizeDeps: { noDiscovery: true, include: [] }, server: { host:'127.0.0.1', port:0, strictPort:false, hmr:false }, logLevel:'error', plugins:[{ name:'glyph-test-page', configureServer(server) { server.middlewares.use('/__glyph_test', (_, res) => { res.setHeader('Content-Type','text/html'); res.end('<html><body></body></html>'); }); } }] });
    await vite.listen();
    window = new BrowserWindow({ show:false, webPreferences:{ contextIsolation:true, sandbox:true } });
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/__glyph_test`);
    const results = await window.webContents.executeJavaScript(`(${verifyPixels.toString()})()`);
    assert.equal(results.tests,26);
    await fs.writeFile('/tmp/coroslink-export-pixel-test.png', Buffer.from(results.dataUrl.split(',')[1], 'base64'));
    console.log('Watchface glyph and compiled pixel tests passed', results.checks);
  } catch(error) { console.error(error); exitCode=1; }
  finally { window?.destroy(); await vite?.close(); app.exit(exitCode); }
})();
