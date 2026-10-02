const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const temp = path.join(os.tmpdir(), `coroslink-weather-test-${process.pid}`);
app.setPath('userData', path.join(temp, 'data'));

async function renderWeather(details) {
  const weather = await import('/src/watchfaces/weatherAssets.ts');
  const studio = await import('/src/watchfaces/watchfaceStudio.ts');
  const check = (value, message) => { if (!value) throw new Error(message); };
  const style = { enabled: true, x: 574, y: 262, scale: 1 };
  const assets = await weather.buildWeatherSpriteReplacements(details, style);
  const overrides = weather.buildWeatherOverrides(details, style);
  check(assets.length === details.resolutions.length * 96, 'Complete day/night, digits, symbols and units for every resolution');
  for (const resolution of details.resolutions) {
    const values = overrides.find(o => o.path === `${resolution.directory}/config.txt`).values;
    check(values.weather_dark_icon_dir === 'weather2', 'Native night key');
    check(values.weather_temp_font === 'cl_weather_temp', 'Native temperature font');
    check(!('temperature_rect' in values), 'No experimental temperature key');
    for (const folder of ['weather', 'weather2']) {
      const sprite = assets.find(a => a.path === `${resolution.directory}/${folder}/00.png`);
      const image = await studio.loadStudioImage(sprite.dataUrl);
      check(image.width === Math.round(89 * resolution.width / 800), 'Resolution-scaled icon');
    }
  }
  const off = weather.buildWeatherOverrides(details, { ...style, enabled: false });
  check(off.every(o => Object.values(o.values).every(v => v === studio.COROS_CONFIG_DELETE_VALUE)), 'Disable removes all weather fields');
  const iconOnly = weather.buildWeatherOverrides(details, { ...style, temperatureEnabled: false });
  check(iconOnly.every(o => o.values.weather_temp_rect === studio.COROS_CONFIG_DELETE_VALUE), 'Independent temperature toggle');
  const customCanvas = document.createElement('canvas'); customCanvas.width = 12; customCanvas.height = 12;
  const customContext = customCanvas.getContext('2d'); customContext.fillStyle = '#ff0000'; customContext.fillRect(0, 0, 12, 12);
  const customStyle = { ...style, assets: { day: { '0': customCanvas.toDataURL() } } };
  check(weather.weatherAssetUrl('day', 0, customStyle) === customCanvas.toDataURL(), 'Custom state');
  check(weather.weatherAssetUrl('day', 1, customStyle) === weather.weatherAssetUrl('day', 1), 'Partial replacement retains defaults');
  check(weather.weatherAssetUrl('night', 0, customStyle) === weather.weatherAssetUrl('night', 0), 'Night defaults independent of day');
  const customAssets = await weather.buildWeatherSpriteReplacements({ ...details, resolutions: [details.resolutions.find(r => r.width === 800)] }, customStyle);
  const customDay = customAssets.find(a => a.path.endsWith('/weather/00.png'));
  check(customDay && customDay.dataUrl !== assets.find(a => a.path === customDay.path).dataUrl, 'Custom day state changes exported pixels');
  const customNight = customAssets.find(a => a.path.endsWith('/weather2/00.png'));
  check(customNight.dataUrl === assets.find(a => a.path === customNight.path).dataUrl, 'Custom day state preserves exported night defaults');
  const preview = await weather.weatherPreviewDataUrl(800, undefined, customStyle);
  const customImage = await studio.loadStudioImage(preview);
  customCanvas.width = 89; customCanvas.height = 89; customContext.drawImage(customImage, 0, 0);
  check(customContext.getImageData(44,44,1,1).data[0] === 255, 'Custom preview matches replacement');
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 800;
  canvas.getContext('2d').fillRect(0,0,800,800);
  const backgroundDataUrl = canvas.toDataURL();
  await weather.drawWeatherTemperaturePreview(canvas, 800, style);
  canvas.getContext('2d').drawImage(await studio.loadStudioImage(await weather.weatherPreviewDataUrl(800)), style.x, style.y);
  const { composeWatchfaceReplacements } = await import('/src/watchfaces/watchfaceCompose.ts');
  const design = { version: 1, backgroundColor: '#000000', accentColor: '#ffffff', artwork: null,
    zoom: 1, fontFamily: '', digitColor: '#ffffff', tintLabels: false, tintIcons: false,
    previewComplication: 'heartRate', metricChanges: {}, metricStyles: {}, timeStyles: {},
    staticSeparators: { colon: { enabled: false, x: 0, y: 0, size: 10, color: '#ffffff' }, dateSlash: { enabled: false, x: 0, y: 0, size: 10, color: '#ffffff' } },
    layoutOffsets: {}, weatherIndicator: style };
  const composed = await composeWatchfaceReplacements(details, design, async paths => {
    const response = await fetch('/__weather_assets', {method: 'POST', body: JSON.stringify(paths)});
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  check(composed.minWatchFaceVersion === undefined, 'Full composition must not raise version for weather');
  return { assets: composed.assetReplacements, overrides: composed.configOverrides, backgroundDataUrl, preview: canvas.toDataURL(), customStyle };
}

(async () => {
  let vite, window;
  let exitCode = 0;
  try {
    await app.whenReady();
    await fs.mkdir(temp, { recursive: true });
    require(path.join(root, 'dist-electron/database.js')).initializeDatabase(app.getPath('userData'));
    const service = require(path.join(root, 'dist-electron/corosWatchfaceService.js'));
    const { createStoreZip } = require(path.join(root, 'dist-electron/zipStore.js'));
    const png = await fs.readFile(path.join(root, 'build/icon.png'));
    const entries = [{name: 'info.json', data: Buffer.from('{"o_template_id":260902,"o_diy_version":1,"o_wf_ver":0}')}, {name:'watchface_customize.png',data:png}];
    for (const width of [240,260,280,800]) {
      const directory = `watchface_${width}x${width}`;
      entries.push({name:`${directory}/config.txt`,data:Buffer.from('[background_icon]=background.png\n[weather_icon_pos]={1,2}\n[weather_icon_dir]=weather\n[weather_icon_pos]=\n[weather_icon_dir]=\n')}, {name:`${directory}/background.png`,data:png}, {name:`${directory}/thmb.png`,data:png});
    }
    const fixture = path.join(temp, 'fixture.dat');
    await fs.writeFile(fixture, createStoreZip(entries));
    const source = await service.selectCorosWatchfaceArchive(process.argv[2] || fixture);
    const details = await service.describeCorosWatchfaceTemplate(source.archiveId);
    const { createServer } = await import('vite');
    vite = await createServer({ root, optimizeDeps:{noDiscovery:true,include:[]}, server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false}, logLevel:'error', plugins:[{name:'weather-test',configureServer(server){server.middlewares.use('/__weather_assets', async (req,res) => { try { const chunks=[]; for await (const chunk of req) chunks.push(chunk); const paths=JSON.parse(Buffer.concat(chunks).toString()); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(await service.loadCorosWatchfaceTemplateAssets(source.archiveId, paths))); } catch(error) { res.statusCode=500;res.end(String(error)); } });server.middlewares.use('/__weather_test',(_,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><body></body></html>');});}}] });
    await vite.listen();
    window = new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true}});
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/__weather_test`);
    const result = await window.webContents.executeJavaScript(`(${renderWeather.toString()})(${JSON.stringify(details)})`);
    const output = await service.createCorosWatchfaceArchive({ sourceArchiveId:source.archiveId, backgroundDataUrl:result.backgroundDataUrl, assetReplacements:result.assets, configOverrides:result.overrides });
    const exported = await service.describeCorosWatchfaceTemplate(output.archiveId);
    assert.equal(output.watchFaceVersion, 0, 'Weather must preserve SIMPLE version 0');
    for(const resolution of exported.resolutions) {
      assert.equal(resolution.config.weather_icon_dir,'weather', 'Duplicate empty keys repaired');
      assert.equal(resolution.config.weather_dark_icon_dir,'weather2');
      assert.equal(resolution.config.weather_temp_font,'cl_weather_temp');
      for (const [folder,count] of [['weather',41],['weather2',41],['cl_weather_temp',10],['cl_weather_units',2]]) {
        assert.equal(resolution.spriteFolders.find(f=>f.folder===folder)?.files.length,count, `${resolution.directory}/${folder} survives archive validation/pruning`);
      }
      const symbols = await service.loadCorosWatchfaceTemplateAssets(output.archiveId, [0,1].map(i => `${resolution.directory}/cl_weather_symbols/0${i}.png`));
      assert.equal(symbols.length, 2);
    }
    const saved = await service.saveCorosWatchfaceProject({name:'Weather custom assets',sourceArchiveId:source.archiveId,design:{version:1,weatherIndicator:result.customStyle},previewDataUrl:result.preview});
    const loaded = await service.loadCorosWatchfaceProject(saved.projectId);
    assert.deepEqual(loaded.design.weatherIndicator,result.customStyle,'Save/reopen preserves custom weather assets');
    await fs.writeFile('/tmp/coroslink-simple-weather-preview.png',Buffer.from(result.preview.split(',')[1],'base64'));
    console.log(`Weather export passed: ${result.assets.length} sprites, ${exported.resolutions.length} resolutions, native keys, defaults/custom preview, project round trip.`);
  } catch(error) { console.error(error); exitCode=1; }
  finally { window?.destroy(); await vite?.close(); app.exit(exitCode); }
})();
