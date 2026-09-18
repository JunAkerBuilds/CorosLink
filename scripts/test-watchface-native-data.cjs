const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const temp = path.join(os.tmpdir(), `coroslink-native-data-test-${process.pid}`);
app.setPath('userData', path.join(temp, 'data'));

async function renderNativeData(details) {
  const native = await import('/src/watchfaces/nativeData.ts');
  const studio = await import('/src/watchfaces/watchfaceStudio.ts');
  const { composeWatchfaceReplacements } = await import('/src/watchfaces/watchfaceCompose.ts');
  const { validateWatchfaceAutomationDocument } = await import('/src/watchfaces/watchfaceAutomationSchema.ts');
  const { deriveEditorLayers } = await import('/src/watchfaces/watchfaceEditorModel.ts');
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const nativeData = Object.fromEntries(native.NATIVE_DATA_FIELDS.map((field,index) => [field.id, {...native.defaultNativeDataStyle(field.id),x:60+(index%3)*230,y:60+Math.floor(index/3)*72}]));
  nativeData.stamina.parts = { states: { enabled:true, x:0, y:50, width:100, height:50 } };
  nativeData.stamina.assetTexts = { states: Object.fromEntries(Array.from({length:11}, (_,i)=>[String(i), String(i*10)+'%'])) };
  const design = { version:1, backgroundColor:'#000000', accentColor:'#ffffff', artwork:null,zoom:1,fontFamily:'',digitColor:'#ffffff',tintLabels:false,tintIcons:false,previewComplication:'heartRate',metricChanges:{},metricStyles:{},timeStyles:{},staticSeparators:{colon:{enabled:false,x:0,y:0,size:10,color:'#ffffff'},dateSlash:{enabled:false,x:0,y:0,size:10,color:'#ffffff'}},layoutOffsets:{},designSprites:[],nativeData };
  const diagnostics = validateWatchfaceAutomationDocument({design,projectName:'Native data'}, {details});
  check(!diagnostics.some(d=>d.severity==='error'), 'Schema accepts native data: '+JSON.stringify(diagnostics));
  const load = async paths => {const response=await fetch('/__weather_assets',{method:'POST',body:JSON.stringify(paths)});if(!response.ok)throw new Error(await response.text());return response.json();};
  const composition=await composeWatchfaceReplacements(details,design,load);
  check(composition.minWatchFaceVersion===6,'Sleep score requires format 6');
  const single=await native.composeNativeData(details,{stress:nativeData.stress});check(single.minWatchFaceVersion===3,'Stress uses format 3');
  const solar=await native.composeNativeData(details,{sunriseset:nativeData.sunriseset});check(solar.minWatchFaceVersion===5,'Solar progress uses format 5');
  const off=await native.composeNativeData(details,Object.fromEntries(Object.entries(nativeData).map(([id,style])=>[id,{...style,enabled:false}])));
  check(off.assetReplacements.length===0&&off.configOverrides.every(o=>Object.values(o.values).every(v=>v===studio.COROS_CONFIG_DELETE_VALUE)),'Disabling native data removes exported keys');
  for(const source of native.NATIVE_CHART_SOURCES) {
    const chart=await native.composeNativeData({...details,resolutions:[details.resolutions.find(r=>r.width===800)]},{chart:{...nativeData.chart,chartSource:source.id}});
    const values=chart.configOverrides[0].values;
    const key=source.id==='chart_moon'?'chart_moon_icon':source.id==='chart_sunrise'||source.id==='chart_moonrise'?source.id+'_hour_rect':source.id+'_rect';
    check(values[key]&&values[key]!==studio.COROS_CONFIG_DELETE_VALUE,source.id+' emits its native fields');
    check(values.chart_stress_rect===undefined||values.chart_stress_rect===studio.COROS_CONFIG_DELETE_VALUE||source.id==='chart_stress','Switching charts never writes a stale source');
  }
  // Recovered official faces carry every chart group's readouts; only the
  // selected source, the shared graph and this editor's own leftovers are replaced.
  const official={...details.resolutions.find(r=>r.width===800),config:{...details.resolutions.find(r=>r.width===800).config,chart_tide_rect:'{10,10,50,30,hcenter|vcenter}',chart_tide_font:'recovered/group-13',chart_stress_rect:'{1,1,2,2,left|vcenter}',chart_stress_font:'cl_nd_chart_d',chart_item3_bg:'recovered/group-38/00.png'}};
  const grouped=await native.composeNativeData({...details,resolutions:[official]},{chart:{...nativeData.chart,chartSource:'chart_step'}});
  const groupedValues=grouped.configOverrides[0].values;
  check(groupedValues.chart_tide_rect===undefined&&groupedValues.chart_item3_bg===undefined,'Other chart groups of an official face survive export');
  check(groupedValues.chart_stress_rect===studio.COROS_CONFIG_DELETE_VALUE&&groupedValues.chart_stress_font===studio.COROS_CONFIG_DELETE_VALUE,'Editor-generated leftovers of another source are cleared');
  check(groupedValues.chart_step_rect&&groupedValues.chart_rect&&groupedValues.chart_bg===studio.COROS_CONFIG_DELETE_VALUE,'Selected source and shared graph keys are rewritten');
  // Preview follows the chart layer's group for slot-sharing alternatives.
  const slot=(id,x,y,extra={})=>({...native.defaultNativeDataStyle(id),x,y,...extra});
  const grouping={weather_temp:slot('weather_temp',300,60),chart_sun_angle:slot('chart_sun_angle',300,60),weather_wind:slot('weather_wind',300,140),weather_temp_min:slot('weather_temp_min',300,140),chart:slot('chart',80,300,{chartSource:'chart_sunrise'})};
  check(native.nativeLayerHiddenByChartGroup('weather_temp',grouping)&&!native.nativeLayerHiddenByChartGroup('chart_sun_angle',grouping),'Sun group shows the solar angle instead of the shared temperature slot');
  check(native.nativeLayerHiddenByChartGroup('weather_temp_min',grouping)&&!native.nativeLayerHiddenByChartGroup('weather_wind',grouping),'Sun group shows wind instead of min/max in a shared row');
  const generalGrouping={...grouping,chart:{...grouping.chart,chartSource:'chart_stress'}};
  check(!native.nativeLayerHiddenByChartGroup('weather_temp',generalGrouping)&&native.nativeLayerHiddenByChartGroup('chart_sun_angle',generalGrouping)&&native.nativeLayerHiddenByChartGroup('weather_wind',generalGrouping)&&!native.nativeLayerHiddenByChartGroup('weather_temp_min',generalGrouping),'General group shows temperature and min/max');
  check(!native.nativeLayerHiddenByChartGroup('weather_temp',{...grouping,weather_temp:slot('weather_temp',10,10)}),'Non-overlapping layers are never suppressed');
  check(!native.nativeLayerHiddenByChartGroup('weather_temp',{...grouping,chart:{...grouping.chart,enabled:false}}),'Without a chart layer nothing is suppressed');
  // Recovered NOMAD keeps the solar angle beside a sunrise chart. The chart owns
  // every chart_* key, so its blanket deletion must not erase the earlier field.
  const nomadLike=await native.composeNativeData({...details,resolutions:[details.resolutions.find(r=>r.width===800)]},{chart_sun_angle:{...nativeData.chart_sun_angle,assets:{unit:{0:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='}}},chart:{...nativeData.chart,chartSource:'chart_sunrise'}});
  const nomadValues=nomadLike.configOverrides[0].values;
  check(nomadValues.chart_sun_angle_rect&&nomadValues.chart_sun_angle_rect!==studio.COROS_CONFIG_DELETE_VALUE&&nomadValues.chart_sunrise_hour_rect!==studio.COROS_CONFIG_DELETE_VALUE,'Solar angle survives the chart export in either insertion order');
  check(nomadValues.chart_dgree_icon==='cl_nd_chart_sun_angle_u\\00.png','Solar angle supplies the shared chart degree artwork');
  const eightDirections=await native.composeNativeData({...details,resolutions:[details.resolutions.find(r=>r.width===800)]},{weather_direction:{...nativeData.weather_direction,stateCount:8}});
  check(eightDirections.assetReplacements.filter(a=>a.path.includes('/cl_nd_weather_direction/')).length===8,'A recovered eight-frame direction table exports eight frames');
  const aod=studio.retargetWatchfaceCompositionToAod(details,composition);
  check(aod.configOverrides.every(o=>o.path.endsWith('/AODconfig.txt')),'AOD overrides target AOD config');
  check(aod.assetReplacements.every(a=>!composition.assetReplacements.some(b=>a.path===b.path)),'AOD sprites do not overwrite Current');
  const dataOnly=await native.composeNativeData(details,nativeData);
  const aodDataOnly=studio.retargetWatchfaceCompositionToAod(details,dataOnly);
  const background=document.createElement('canvas');background.width=800;background.height=800;background.getContext('2d').fillRect(0,0,800,800);
  const backgroundDataUrl=background.toDataURL();
  const gallery={weather_temp:{...nativeData.weather_temp,x:80,y:130},weather_humidity:{...nativeData.weather_humidity,x:400,y:130},sleep_score:{...nativeData.sleep_score,x:80,y:300},week_tl:{...nativeData.week_tl,x:400,y:300},sunriseset:{...nativeData.sunriseset,x:80,y:470},chart:{...nativeData.chart,x:400,y:470,chartWidth:280}};
  const ctx=background.getContext('2d');ctx.font='20px Arial';ctx.fillStyle='#999';for(const[id,style]of Object.entries(gallery))ctx.fillText(native.NATIVE_DATA_BY_ID.get(id).label,style.x,style.y-22);
  await native.drawNativeDataPreview(background,800,gallery);
  // Partial replacement changes only the selected glyph, and persists in design.
  const red=document.createElement('canvas');red.width=24;red.height=48;red.getContext('2d').fillStyle='#ff0000';red.getContext('2d').fillRect(0,0,24,48);
  design.nativeData.stress.assets={digits:{'0':red.toDataURL()}};
  check(await native.nativeDataAsset('stress',design.nativeData.stress,'digits',0)!==await native.nativeDataAsset('stress',native.defaultNativeDataStyle('stress'),'digits',0),'Custom glyph used');
  const customData={
    week_tl:{...native.defaultNativeDataStyle('week_tl'),x:80,y:100,assetTexts:{icon:{0:'LOAD'}},parts:{icon:{x:10,y:5,width:100,height:50,color:'#ff4400'},value:{x:130,y:0,width:160,height:72,color:'#44ddff'}}},
    chart:{...native.defaultNativeDataStyle('chart'),x:80,y:360,assetTexts:{icon:{0:'STRESS'},symbols:{3:'|'}},parts:{icon:{width:70},value:{x:80},plot:{x:0,y:80,width:420,height:160},background:{enabled:true,x:0,y:80,width:420,height:160,color:'#101010'},mask:{enabled:true},noDataMask:{enabled:true}},chartStyle:{lineWidth:8,barWidth:12,barGap:7,upperColor:'#11aa22',lowerColor:'#ff00ff',selectedBarColor:'#ffff00',unselectedBarColor:'#223344'},assets:{mask:{0:backgroundDataUrl},noDataMask:{0:red.toDataURL()},decimal:{0:red.toDataURL()}}},
    sunriseset:{...native.defaultNativeDataStyle('sunriseset'),x:430,y:100,assetTexts:{icon:{0:'RISE',1:'SET'},symbols:{3:'|'}},parts:{progress:{x:0,y:70,width:100,height:30}},assets:{progress:{0:red.toDataURL(),1:red.toDataURL()}}}
  };
  const custom=await native.composeNativeData(details,customData);
  const master=custom.configOverrides.find(o=>o.path==='watchface_800x800/config.txt').values;
  check(master.week_tl_icon_pos==='{90,105}'&&master.week_tl_rect==='{210,100,370,172,left|vcenter}','Independent label/number placement exported');
  check(master.chart_rect==='{80,440,500,600,left|vcenter}'&&master.chart_curves_width==='8'&&master.chart_curves_upper_color==='0x11aa22'&&master.chart_curves_lower_color==='0xff00ff','Graph geometry and line appearance exported');
  check(master.chart_bar_width==='12'&&master.chart_bar_interval==='7'&&master.chart_selected_bar_color==='0xffff00'&&master.chart_unselected_bar_color==='0x223344','Bar styling exported');
  for(const key of ['chart_bg','chart_bar_mask','chart_bar_nodata_mask','chart_point_icon','sunrise_progress','sunset_progress','sunriseset_colon_icon']) check(master[key]&&master[key]!==studio.COROS_CONFIG_DELETE_VALUE,key+' retains custom artwork');
  const label=custom.assetReplacements.find(a=>a.path==='watchface_800x800/cl_nd_week_tl_i/00.png');
  const labelImage=await studio.loadStudioImage(label.dataUrl);check(labelImage.width===100&&labelImage.height===50,'Custom label dimensions retained');
  check(label.dataUrl!==await native.nativeDataAsset('week_tl',native.defaultNativeDataStyle('week_tl'),'icon',0),'Typed label changes the exported sprite');
  const hidden=await native.composeNativeData(details,{week_tl:{...customData.week_tl,parts:{icon:{enabled:false}}},chart:{...customData.chart,parts:{plot:{enabled:false}}}});
  const hiddenKeys=hidden.configOverrides[0].values;
  check(hiddenKeys.week_tl_icon===studio.COROS_CONFIG_DELETE_VALUE&&hiddenKeys.week_tl_font!==studio.COROS_CONFIG_DELETE_VALUE,'Hiding label keeps the live value');
  check(hiddenKeys.chart_rect===studio.COROS_CONFIG_DELETE_VALUE&&hiddenKeys.chart_stress_font!==studio.COROS_CONFIG_DELETE_VALUE,'Hiding graph keeps the live value');
  Object.assign(design.nativeData,customData);
  check(!validateWatchfaceAutomationDocument({design,projectName:'Customized'}, {details}).some(d=>d.severity==='error'),'Custom component settings pass validation');
  const invalid=structuredClone(design);invalid.nativeData.chart.chartStyle.lineWidth=-1;
  check(validateWatchfaceAutomationDocument({design:invalid,projectName:'Invalid'}, {details}).some(d=>d.severity==='error'),'Invalid graph thickness is rejected');
  const customPreview=document.createElement('canvas');customPreview.width=800;customPreview.height=800;
  customPreview.getContext('2d').fillRect(0,0,800,800);
  await native.drawNativeDataPreview(customPreview,800,{...customData,chart:{...customData.chart,parts:{...customData.chart.parts,mask:{enabled:false}}}});
  const pixels=customPreview.getContext('2d').getImageData(0,0,800,800).data;
  check(pixels.some((v,i)=>i%4===0&&v===255&&pixels[i+1]===255&&pixels[i+2]===0),'Preview renders the configured selected-bar color');
  // Simulation changes rendered samples without changing assets or design.
  const sampleCanvas = () => { const c=document.createElement('canvas'); c.width=800;c.height=800;return c; };
  const simulatedData = {week_tl:{...native.defaultNativeDataStyle('week_tl'),x:100,y:100},weather_direction:{...native.defaultNativeDataStyle('weather_direction'),x:100,y:200},chart:{...native.defaultNativeDataStyle('chart'),x:100,y:300}};
  const beforeData=JSON.stringify(simulatedData);
  const renderSample=async scenario=>{const c=sampleCanvas();await native.drawNativeDataPreview(c,800,simulatedData,scenario);return c.toDataURL();};
  const defaultSample=await renderSample();
  check(native.defaultNativeDataStyle('chart').chartStyle.previewType==='bars','New charts default to bars');
  const previewWith=async (chartStyle,scenario)=>{const data={...simulatedData,chart:{...simulatedData.chart,chartStyle}};const before=JSON.stringify(data);const c=sampleCanvas();await native.drawNativeDataPreview(c,800,data,scenario);check(JSON.stringify(data)===before,'Preview rendering preserves saved chart settings');return c;};
  const barsPreview=await previewWith({previewType:'bars',lineWidth:30,upperColor:'#00ff00',lowerColor:'#ff0000'});
  check(barsPreview.toDataURL()===(await previewWith({lineWidth:30,upperColor:'#00ff00',lowerColor:'#ff0000'})).toDataURL(),'Charts without a preview type render bars');
  const curvePreview=await previewWith({previewType:'curve',lineWidth:30,upperColor:'#00ff00',lowerColor:'#ff0000'});
  const curvePixels=curvePreview.getContext('2d').getImageData(0,0,800,800).data;
  check(curvePreview.toDataURL()!==barsPreview.toDataURL(),'Line graph preview differs from bars');
  check(curvePixels.some((v,i)=>i%4===0&&v===0&&curvePixels[i+1]===255&&curvePixels[i+2]===0)&&curvePixels.some((v,i)=>i%4===0&&v===255&&curvePixels[i+1]===0&&curvePixels[i+2]===0),'Line graph uses the upper and lower curve colors');
  check(curvePreview.toDataURL()!==(await previewWith({previewType:'curve',lineWidth:30,upperColor:'#00ff00',lowerColor:'#ff0000'},{chartProgress:0.9})).toDataURL(),'chartProgress moves the line-graph marker');
  check(curvePreview.toDataURL()!==(await previewWith({previewType:'curve',lineWidth:30,upperColor:'#00ff00',lowerColor:'#ff0000'},{chartHistory:[1,0,1,0]})).toDataURL(),'chartHistory reshapes the sample line');
  check(defaultSample!==await renderSample({values:{week_tl:'9999'}}),'Training simulation renders new glyphs');
  check(defaultSample!==await renderSample({values:{weather_direction:'8'}}),'Wind simulation selects different state artwork');
  check(defaultSample!==await renderSample({values:{chart_stress:'99'},chartHistory:[0,1,0,1]}),'Chart simulation changes history and value');
  check(JSON.stringify(simulatedData)===beforeData,'Preview leaves native design and assets untouched');
  const weather=await import('/src/watchfaces/weatherAssets.ts');
  const weatherStyle={enabled:true,x:100,y:100,scale:1};
  const warm=sampleCanvas(),cold=sampleCanvas();
  await weather.drawWeatherTemperaturePreview(warm,800,weatherStyle,'18');
  await weather.drawWeatherTemperaturePreview(cold,800,weatherStyle,'-24');
  check(warm.toDataURL()!==cold.toDataURL(),'Weather simulation draws negative temperatures');
  check(await weather.weatherPreviewDataUrl(800,undefined,weatherStyle,{condition:0,night:false})!==await weather.weatherPreviewDataUrl(800,undefined,weatherStyle,{condition:8,night:true}),'Weather simulation changes condition/day-night artwork');
  const assets=new Map();
  const folder=(name,kind,count)=>({folder:name,kind,aod:false,files:Array.from({length:count},(_,i)=>{
    const c=document.createElement('canvas');c.width=20;c.height=20;
    const context=c.getContext('2d');context.fillStyle='rgb('+(40+i*15)+','+(40+i*15)+','+(40+i*15)+')';context.fillRect(0,0,20,20);
    const file={path:'watchface_800x800/'+name+'/'+String(i).padStart(2,'0')+'.png',width:20,height:20};assets.set(file.path,{...file,dataUrl:c.toDataURL()});return file;
  })});
  const batteryDetails={archiveId:'simulation',resolutions:[{directory:'watchface_800x800',width:800,height:800,config:{battery_icon_pos:'{100,100}',battery_icon_dir:'battery',english_date_month_rect:'{200,100,260,120,left|vcenter}',english_date_month_font:'digits',english_date_day_rect:'{200,150,260,170,left|vcenter}',english_date_day_font:'digits',english_date_week_rect:'{200,200,260,220,left|vcenter}',english_date_week_font:'week'},aodConfig:{},icons:[],spriteFolders:[folder('battery','state',12),folder('digits','digits',10),folder('week','week',7)]}]};
  const renderer=async(date,battery)=>{const c=sampleCanvas();await studio.drawStudioPreview(c,backgroundDataUrl,batteryDetails,{fontFamily:'',digitColor:'#ffffff',accentColor:'#ffffff',tintLabels:false,tintIcons:false,previewDate:new Date(date),previewValues:{battery}},async paths=>paths.map(p=>assets.get(p)));return c;};
  const crop=(c,x,y,w,h)=>Array.from(c.getContext('2d').getImageData(x,y,w,h).data).join(',');
  const empty=await renderer('2028-02-29T12:00:00','0'),full=await renderer('2028-03-01T12:00:00','100');
  check(crop(empty,100,100,20,20)!==crop(full,100,100,20,20),'Battery percentage changes icon pixels');
  check(crop(empty,200,100,60,20)!==crop(full,200,100,60,20),'Month digits follow the calendar');
  check(crop(empty,200,150,60,20)!==crop(full,200,150,60,20),'Day digits roll past leap day');
  check(crop(empty,200,200,60,20)!==crop(full,200,200,60,20),'Weekday label follows the calendar');
  return {assets:composition.assetReplacements,overrides:composition.configOverrides,dataOnly,aodDataOnly,custom,customPreview:customPreview.toDataURL(),minWatchFaceVersion:composition.minWatchFaceVersion,design,backgroundDataUrl,preview:background.toDataURL(),fieldCount:native.NATIVE_DATA_FIELDS.length};
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
      entries.push({name:`${directory}/AODconfig.txt`,data:Buffer.from('[background_icon]=background.png\n')});
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
    const result = await window.webContents.executeJavaScript(`(${renderNativeData.toString()})(${JSON.stringify(details)})`);
    const output = await service.createCorosWatchfaceArchive({ sourceArchiveId:source.archiveId, backgroundDataUrl:result.backgroundDataUrl, assetReplacements:result.assets, configOverrides:result.overrides, minWatchFaceVersion:result.minWatchFaceVersion });
    const exported = await service.describeCorosWatchfaceTemplate(output.archiveId);
    const customOutput=await service.createCorosWatchfaceArchive({sourceArchiveId:source.archiveId,backgroundDataUrl:result.backgroundDataUrl,...result.custom});
    const customDetails=await service.describeCorosWatchfaceTemplate(customOutput.archiveId);
    assert.equal(customDetails.resolutions.find(r=>r.width===800).config.chart_curves_width,'8');
    assert.ok(customDetails.resolutions.every(r=>r.config.chart_bg&&r.config.chart_bar_nodata_mask),'Custom graph assets survive archive validation');
    assert.equal(output.watchFaceVersion,6);
    // SIMPLE has no AOD tree; use the separate AOD-capable fixture for this check.
    const aodSource=await service.selectCorosWatchfaceArchive(fixture);
    const combined=await service.createCorosWatchfaceArchive({sourceArchiveId:aodSource.archiveId,backgroundDataUrl:result.backgroundDataUrl,assetReplacements:[...result.dataOnly.assetReplacements,...result.aodDataOnly.assetReplacements],configOverrides:[...result.dataOnly.configOverrides,...result.aodDataOnly.configOverrides],minWatchFaceVersion:6});
    const combinedDetails=await service.describeCorosWatchfaceTemplate(combined.archiveId);
    assert.ok(combinedDetails.resolutions.every(resolution=>resolution.aodConfig?.stress_rect),'Current + AOD export retains native data in both configurations');
    for(const resolution of exported.resolutions) {
      for(const key of ['weather_temp_rect','weather_temp_min_rect','weather_temp_max_rect','weather_rainfall_rect','weather_humidity_rect','weather_uv_rect','weather_aqi_rect','stress_rect','stamina_rect','sleep_score_rect','week_tl_rect','today_run_rect','week_bike_rect','sunriseset_hour_rect','chart_stress_rect']) assert.match(resolution.config[key],/^\{/,key);
      assert.ok(resolution.spriteFolders.find(f=>f.folder==='cl_nd_sleep_score_d')?.files.length===10,'Native digit font retained');
      assert.ok(resolution.config.sleep_hrv_level_icon,'Native HRV status folder retained');
      assert.equal(resolution.spriteFolders.find(f=>f.folder===resolution.config.stamina_level_icon)?.files.length,11,'All stamina frames survive export at every resolution');
      assert.match(resolution.config.stamina_level_pos,/^\{/,'Stamina arc position survives export');
    }
    const saved=await service.saveCorosWatchfaceProject({name:'Native data round trip',sourceArchiveId:source.archiveId,design:result.design,previewDataUrl:result.preview});
    const loaded=await service.loadCorosWatchfaceProject(saved.projectId);
    assert.deepEqual(loaded.design.nativeData,result.design.nativeData);
    await fs.writeFile('/tmp/coroslink-native-data-preview.png',Buffer.from(result.preview.split(',')[1],'base64'));
    await fs.writeFile('/tmp/coroslink-native-customization.png',Buffer.from(result.customPreview.split(',')[1],'base64'));
    console.log(`Native data passed: ${result.fieldCount} layers, ${result.assets.length} sprites, ${exported.resolutions.length} resolutions, all chart sources, AOD retargeting, format versions and project persistence.`);
  } catch(error) { console.error(error); exitCode=1; }
  finally { window?.destroy(); await vite?.close(); app.exit(exitCode); }
})();
