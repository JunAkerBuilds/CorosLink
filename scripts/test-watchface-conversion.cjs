const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {app, nativeImage} = require('electron');
const root = path.resolve(__dirname, '..');
const temp = path.join(os.tmpdir(), `coroslink-conversion-${process.pid}`);
app.setPath('userData', path.join(temp, 'user-data'));

function png(w,h,color=180) {
 const bitmap=Buffer.alloc(w*h*4); for(let i=0;i<bitmap.length;i+=4){bitmap[i]=color;bitmap[i+1]=100;bitmap[i+2]=20;bitmap[i+3]=255;}
 return nativeImage.createFromBitmap(bitmap,{width:w,height:h}).toPNG();
}
function fixture(sizes,aod=true,id='90071992547409931') {
 const entries=[{name:'info.json',data:Buffer.from(`{"o_template_id":${id},"o_diy_version":1,"o_wf_ver":4}`)},{name:'watchface_customize.png',data:png(80,80)}];
 for (const size of sizes) {
  const dir=`watchface_${size}x${size}`;const k=size/800;
  const config=`[watchface_id]=54\r\n[background_icon]=background.png\r\n[time_hour_high_pos]={${160*k},${240*k}}\r\n[time_hour_high_font]=digits\r\n[autoalign_time_digit_one_real_xsize]=${40*k}\r\n[kcal_progress_arc]={${400*k},${400*k},${300*k},${300*k},-135,135,${20*k},1}\r\n[time_hour_icon]=hands/hour.png\r\n[time_center_pos]={${400*k},${400*k}}\r\n`;
  entries.push({name:`${dir}/config.txt`,data:Buffer.from(config)},{name:`${dir}/background.png`,data:png(size,size)},{name:`${dir}/thmb.png`,data:png(80,80)},{name:`${dir}/hands/hour.png`,data:png(Math.round(20*k),Math.round(160*k))});
  for(let n=0;n<10;n++)entries.push({name:`${dir}/digits/${String(n).padStart(2,'0')}.png`,data:png(Math.round(40*k),Math.round(80*k),150+n)});
  if(aod)entries.push({name:`${dir}/AODconfig.txt`,data:Buffer.from(config.replace('[time_hour_high_pos]','[time_minute_high_pos]'))});
 }
 return entries;
}
async function main(){
 await app.whenReady();await fs.mkdir(temp,{recursive:true});
 const {convertWatchfaceEntries,prepareRecoveredWatchfaceExport,scaleWatchfaceConfig,RETAINED_AOD_CONFIG}=require('../dist-electron/watchfaceArchiveConversion.js');
 const {WATCHFACE_TARGETS,getWatchfaceTarget}=require('../dist-electron/watchfaceTargets.js');
 const source=fixture([416,800]);const original=source.map(e=>({name:e.name,data:Buffer.from(e.data)}));
 const map=entries=>new Map(entries.map(e=>[e.name,e.data]));
 const cfg=(entries,path)=>map(entries).get(path).toString('utf8');
 assert.match(scaleWatchfaceConfig('[kcal_progress_arc]={400,400,300,300,-135,135,20,1}',.3),/\{120,120,90,90,-135,135,6,1\}/);
 assert.equal(scaleWatchfaceConfig('[watchface_id]=800\n[chart_bar_width]=8\n[watchface_time_format]=1',.3),'[watchface_id]=800\n[chart_bar_width]=2\n[watchface_time_format]=1');
 assert.throws(()=>scaleWatchfaceConfig('[unknown_shape]={10,20,30}',.3),/unrecognized geometry/);
 for(const target of WATCHFACE_TARGETS){
  const carrier=fixture(target.sizes,target.display==='amoled','90071992547409933');
  const converted=convertWatchfaceEntries(source,carrier,target);
  assert.match(cfg(converted.entries,'info.json'),/90071992547409933/);
  assert.deepEqual(map(converted.entries).get('watchface_800x800/digits/00.png'),map(source).get('watchface_800x800/digits/00.png'));
  for(const size of target.sizes){
   assert.match(cfg(converted.entries,`watchface_${size}x${size}/config.txt`),new RegExp(`\\{${Math.round(160*size/800)},${Math.round(240*size/800)}\\}`));
   const hand=nativeImage.createFromBuffer(map(converted.entries).get(`watchface_${size}x${size}/hands/hour.png`)).getSize();
   assert.deepEqual(hand,{width:Math.round(20*size/800),height:Math.round(160*size/800)});
  }
  if(target.display==='mip'){
   assert(!converted.entries.some(e=>/\/AODconfig\.txt$/.test(e.name)));
   assert(map(converted.entries).has(`watchface_800x800/${RETAINED_AOD_CONFIG}`));
   const back=convertWatchfaceEntries(converted.entries,source,getWatchfaceTarget('pace-pro'));
   assert.equal(cfg(back.entries,'watchface_800x800/AODconfig.txt'),cfg(source,'watchface_800x800/AODconfig.txt'));
   assert.deepEqual(map(back.entries).get('watchface_800x800/digits/00.png'),map(source).get('watchface_800x800/digits/00.png'));
  }
 }
 assert.deepEqual(source,original,'conversion must never mutate source entries');
 const cachedBuildSource=[...source,{name:'watchface_416x416/watchface.bin',data:Buffer.from('old compiled build')},{name:'watchface_416x416/watchface_ota.bin',data:Buffer.from('old OTA build')}];
 const rebuilt=convertWatchfaceEntries(cachedBuildSource,source,getWatchfaceTarget('pace-pro'));
 assert(!rebuilt.entries.some(e=>e.name.endsWith('.bin')), 'discard stale native binaries when editable configs exist');
 assert.throws(()=>convertWatchfaceEntries([...source,{name:'custom/custom.pb',data:Buffer.from('unknown compiled state')}],source,getWatchfaceTarget('pace-pro')),/editable source/);

 const recovered=fixture([416]).map(e=>e.name==='info.json'?{...e,data:Buffer.from('{"m_name":"Recovered $ face","o_template_id":"478450947264200704","o_diy_version":1,"o_wf_ver":4,"coroslinkRecovery":{"partial":true}}')}:e)
  .filter(e=>!e.name.endsWith('/thmb.png'));
 recovered.push({name:'recovery/source.bin',data:Buffer.from('original firmware')},{name:'recovery/layout.json',data:Buffer.from('{}')});
 const nativeOriginal=structuredClone(recovered);
 for(const destination of WATCHFACE_TARGETS){
  const diy=fixture(destination.sizes,true,'90071992547409933');
  const built=prepareRecoveredWatchfaceExport(recovered,diy,destination);
  const manifest=JSON.parse(cfg(built,'info.json').replace(/("o_template_id":)(\d+)/,'$1"$2"'));
  assert.equal(manifest.o_template_id,'90071992547409933');
  assert.equal(manifest.m_name,'Recovered $ face');
  assert.equal(manifest.m_app,'watchface_800x800');assert.equal(manifest.m_preview,'watchface_customize.png');
  assert(!manifest.coroslinkRecovery);assert(!built.some(e=>e.name.startsWith('recovery/')));
  for(const size of destination.sizes){
   const config=cfg(built,`watchface_${size}x${size}/config.txt`);
   assert.match(config,/\[watchface_thmb_icon\]=thmb.png/);
   assert.equal(nativeImage.createFromBuffer(map(built).get(`watchface_${size}x${size}/background.png`)).getSize().width,size);
   assert.equal(nativeImage.createFromBuffer(map(built).get(`watchface_${size}x${size}/thmb.png`)).getSize().width,80);
  }
  if(destination.model==='pace-pro'){
   assert.deepEqual(map(built).get('watchface_416x416/digits/00.png'),map(recovered).get('watchface_416x416/digits/00.png'),'native sprites are byte-identical, never scaled up and down');
   assert.match(cfg(built,'watchface_416x416/config.txt'),/\{83.2,124.80000000000001\}/,'native layout coordinates survive exactly');
  }
 }
 assert.deepEqual(structuredClone(recovered),nativeOriginal);
 // Older recovered starters used forward-slash asset references; the watch needs backslashes.
 const legacySlashes=recovered.map(e=>e.name==='watchface_416x416/config.txt'?{...e,data:Buffer.from(e.data.toString('utf8').replace('[time_hour_high_font]=digits','[time_hour_high_font]=recovered/group-15\r\n[arc_cut_icon]=recovered/group-14/00.png'))}:e);
 const legacyBuilt=prepareRecoveredWatchfaceExport(legacySlashes,fixture([416,800],true,'90071992547409933'),getWatchfaceTarget('pace-pro'));
 const legacyConfig=cfg(legacyBuilt,'watchface_416x416/config.txt');
 assert.match(legacyConfig,/\[time_hour_high_font\]=recovered\\group-15/);
 assert.match(legacyConfig,/\[arc_cut_icon\]=recovered\\group-14\\00\.png/);
 assert.throws(()=>prepareRecoveredWatchfaceExport(source,source,getWatchfaceTarget('pace-pro')),/Only a recovered/);
 assert.throws(()=>prepareRecoveredWatchfaceExport([...recovered,{name:'unexpected.bin',data:Buffer.from('x')}],source,getWatchfaceTarget('pace-pro')),/editable source/);

 const target=getWatchfaceTarget('pace-3');const carrier=fixture(target.sizes,false);
 const editPath='watchface_416x416/config.txt';const raw=cfg(source,editPath).replace('[time_hour_high_pos]={83.2,124.80000000000001}','[time_hour_high_pos]={104,156}');
 const edited=convertWatchfaceEntries(source,carrier,target,{[editPath]:raw});
 assert.equal(edited.appliedRawConfigEditCount,1);
 assert.match(cfg(edited.entries,'watchface_800x800/config.txt'),/\[time_hour_high_pos\]=\{200,300\}/);
 assert.match(cfg(edited.entries,'watchface_240x240/config.txt'),/\[time_hour_high_pos\]=\{60,90\}/);
 // Raw edits of CRLF templates must remain separate lines for Studio's parser.
 // Include comments and blank-key deletion, as in saved custom watch faces.
 const commented=source.map(e=>e.name.endsWith('/config.txt')?{...e,data:Buffer.from('// layout\r\n[unused]=\r\n'+e.data.toString('utf8'))}:e);
 const rawWithDeletion=raw.replace('[time_hour_high_font]=digits','[time_hour_high_font]=custom');
 const rewritten=convertWatchfaceEntries(commented,carrier,target,{[editPath]:rawWithDeletion});
 for(const size of target.sizes){
  const text=cfg(rewritten.entries,`watchface_${size}x${size}/config.txt`);
  assert(!/\r(?!\n)/.test(text),'raw edits must not turn CRLF into bare CR');
  const lines=text.split(/\r?\n/);
  assert(lines.includes('[time_hour_high_font]=custom'));
  assert(lines.includes(`[time_hour_high_pos]={${Math.round(200*size/800)},${Math.round(300*size/800)}}`));
  assert(lines.includes('[watchface_id]=54'));
  assert(!lines.some(line=>line.startsWith('[unused]')));
 }
 assert.throws(()=>convertWatchfaceEntries(source,carrier,target,{'watchface_390x390/config.txt':'[x]=1'}),/does not belong/);
 const mip=fixture([240,260,280,800],false);const amoled=convertWatchfaceEntries(mip,source,getWatchfaceTarget('pace-pro'));
 assert.equal(amoled.generatedAod,true);assert.equal(cfg(amoled.entries,'watchface_800x800/AODconfig.txt'),cfg(amoled.entries,'watchface_800x800/config.txt'));
 const physicalAod=source.filter(e=>e.name!=='watchface_800x800/AODconfig.txt');
 const derived=convertWatchfaceEntries(physicalAod,carrier,target);
 assert.match(cfg(derived.entries,`watchface_800x800/${RETAINED_AOD_CONFIG}`),/cl_aod_source\/digits/);
 assert(map(derived.entries).has('watchface_800x800/cl_aod_source/digits/00.png'));
 // Production service: automatic carrier lookup, export, and retained AOD sprites.
 const {createStoreZip}=require('../dist-electron/zipStore.js');
 const service=require('../dist-electron/corosWatchfaceService.js');
 const cache=path.join(app.getPath('userData'),'watchface-conversion-carriers');await fs.mkdir(cache,{recursive:true});
 await fs.writeFile(path.join(cache,'pace-3.zip'),createStoreZip(carrier));
 const retainedSource = source.map(entry => ({ ...entry,
  name: entry.name.replace('/digits/', '/studio/aod_digits/'),
  data: /config.txt$/.test(entry.name) ? Buffer.from(entry.data.toString('utf8').replaceAll('=digits', '=studio/aod_digits')) : entry.data
 }));
 const input=path.join(temp,'source.dat');await fs.writeFile(input,createStoreZip(retainedSource));
 const malformedPath=path.join(temp,'legacy-separators.dat');
 await fs.writeFile(malformedPath,createStoreZip(source.map(e=>({...e,name:e.name.replace('800x800','800×800')}))));
 const malformed=await service.selectCorosWatchfaceArchive(malformedPath);
 const normalizedDetails=await service.describeCorosWatchfaceTemplate(malformed.archiveId);
 assert(normalizedDetails.resolutions.some(r=>r.width===800), 'malformed legacy directories must author at 800px before converting');
 const archive=await service.selectCorosWatchfaceArchive(input);
 const result=await service.convertCorosWatchfaceArchive({sourceArchiveId:archive.archiveId,watchModel:'pace-3'});
 assert.equal(result.archive.firmwareType,'COROS W331');
 const details=await service.describeCorosWatchfaceTemplate(result.archive.archiveId);
 assert(details.resolutions.every(r=>!Object.keys(r.aodConfig).length));
 const built=await service.createCorosWatchfaceArchive({sourceArchiveId:result.archive.archiveId,name:'Converted',firmwareType:'COROS W331',watchModel:'pace-3',backgroundDataUrl:nativeImage.createFromBuffer(png(800,800)).toDataURL()});
 assert.equal(built.firmwareType,'COROS W331');
 await fs.writeFile(path.join(cache,'pace-pro.zip'),createStoreZip(source));
 const restored = await service.convertCorosWatchfaceArchive({ sourceArchiveId: built.archiveId, watchModel: 'pace-pro' });
 const restoredDetails = await service.describeCorosWatchfaceTemplate(restored.archive.archiveId);
 assert(restoredDetails.resolutions.every(r => Object.keys(r.aodConfig).length));
 assert(restoredDetails.resolutions.find(r=>r.width===800).spriteFolders.some(f=>f.folder==='studio/aod_digits'));
 // W337: reject smaller starter trees, then convert and export both display modes.
 for (const identity of [{watchModel:'pace-4-pro'}, {firmwareType:'COROS W337'}]) {
  await assert.rejects(service.createCorosWatchfaceArchive({sourceArchiveId:archive.archiveId,name:'Wrong size',...identity}), /PACE 4 Pro.*requires 466×466 and 800×800.*missing 466x466/);
 }
 const proTarget=getWatchfaceTarget('COROS W337');
 assert.equal(proTarget.model,'pace-4-pro');assert.equal(proTarget.previewSize,466);
 await fs.writeFile(path.join(cache,'pace-4-pro.zip'),createStoreZip(fixture(proTarget.sizes,true)));
 const pro=await service.convertCorosWatchfaceArchive({sourceArchiveId:archive.archiveId,watchModel:'pace-4-pro'});
 assert.equal(pro.archive.firmwareType,'COROS W337');
 assert.equal(pro.archive.resolutionProfile,'amoled-466-800');
 const proDetails=await service.describeCorosWatchfaceTemplate(pro.archive.archiveId);
 assert.deepEqual(proDetails.resolutions.map(r=>r.width).sort((a,b)=>a-b),[466,800]);
 assert(proDetails.resolutions.every(r=>Object.keys(r.aodConfig).length));
 const proBuilt=await service.createCorosWatchfaceArchive({sourceArchiveId:pro.archive.archiveId,name:'PACE 4 Pro export',firmwareType:'COROS W337',watchModel:'pace-4-pro',backgroundDataUrl:nativeImage.createFromBuffer(png(800,800)).toDataURL()});
 assert.equal(proBuilt.firmwareType,'COROS W337');assert.equal(proBuilt.resolutionProfile,'amoled-466-800');
 const proBuiltDetails=await service.describeCorosWatchfaceTemplate(proBuilt.archiveId);
 assert.deepEqual(proBuiltDetails.resolutions.map(r=>r.width).sort((a,b)=>a-b),[466,800]);
 assert(proBuiltDetails.resolutions.every(r=>Object.keys(r.aodConfig).length));
 console.log('Watchface conversion: all supported targets, source immutability, raw edits, analog assets, AOD round trips, automatic cached carrier and production export passed.');
}
main().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)}).finally(()=>fs.rm(temp,{recursive:true,force:true}));
