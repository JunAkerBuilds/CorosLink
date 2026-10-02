/** Usage: electron scripts/audit-watchface-conversion.cjs <downloaded-template-audit.json> <report.json> */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {app}=require('electron');
const unzipper=require('unzipper');
async function main(){
 await app.whenReady();
 const {convertWatchfaceEntries,normalizeConversionPath}=require('../dist-electron/watchfaceArchiveConversion.js');
 const {getWatchfaceTarget}=require('../dist-electron/watchfaceTargets.js');
 const rows=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 const read=async row=>{const z=await unzipper.Open.file(path.resolve(row.path));return Promise.all(z.files.filter(e=>e.type==='File').map(async e=>({name:e.path,data:await e.buffer()})));};
 const targets=['pace-pro','pace-4','pace-3'].map(getWatchfaceTarget);
 const carriers=await Promise.all(targets.map(async target=>read(rows.find(r=>target.sizes.every(n=>r.configs[`watchface_${n}x${n}/config.txt`])))));
 const report=[];
 for (let i=0;i<rows.length;i++){
  const row=rows[i];const source=await read(row);const failures=[];
  let maxFiles=0,maxBytes=0;
  for(let j=0;j<targets.length;j++){
   try{
    const result=convertWatchfaceEntries(source,carriers[j],targets[j]);
    const entries=new Map(result.entries.map(e=>[e.name,e.data]));
    assert.equal(entries.size,result.entries.length,'duplicate output paths');
    for(const e of source){
     const name=normalizeConversionPath(e.name);
     if(/^watchface_800x800\/.*\.png$/.test(name))assert.deepEqual(entries.get(name),e.data,`master pixels ${name}`);
    }
    for(const size of targets[j].sizes){
     const config=entries.get(`watchface_${size}x${size}/config.txt`);assert(config,`missing ${size}`);
     if(targets[j].display==='amoled')assert(entries.has(`watchface_${size}x${size}/AODconfig.txt`));
    }
    if(targets[j].display==='mip')assert(!result.entries.some(e=>/\/AODconfig.txt$/.test(e.name)));
    const bytes=result.entries.reduce((total,e)=>total+e.data.length,0);
    assert(result.entries.length<=5000,'export file limit');assert(bytes<=100*1024*1024,'archive byte limit');
    maxFiles=Math.max(maxFiles,result.entries.length);maxBytes=Math.max(maxBytes,bytes);
   }catch(e){failures.push({target:targets[j].model,error:e.message});}
  }
  report.push({id:row.id,name:row.name,packageUrl:row.url,resolutions:Object.keys(row.configs),normalizedFolderNames:source.some(e=>normalizeConversionPath(e.name)!==e.name),discardedDeviceBuilds:source.filter(e=>/\/watchface(?:_ota)?\.bin$/.test(e.name)).length,hasMasterAod:Boolean(row.configs['watchface_800x800/AODconfig.txt']),maxConvertedFiles:maxFiles,maxConvertedBytes:maxBytes,failures});
  if((i+1)%10===0)console.log(`Audited ${i+1}/${rows.length}`);
 }
 const output={auditedAt:new Date().toISOString(),uniquePackages:rows.length,targetFamilies:targets.map(t=>({model:t.model,display:t.display,sizes:t.sizes})),conversions:rows.length*targets.length,failedPackages:report.filter(r=>r.failures.length).length,templates:report};
 await fs.writeFile(process.argv[3],JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({conversions:output.conversions,failedPackages:output.failedPackages,failures:report.filter(r=>r.failures.length).map(r=>({id:r.id,failures:r.failures}))},null,2));
 if(output.failedPackages)throw new Error('Template conversions failed');
}
main().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)});
