// Every watch CorosLink knows, not just PACE Pro: recognizing the connected watch, compiling for its
// screen (AMOLED and memory-in-pixel), reading its slots, and refusing a BIN built for another screen.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const targets=require('../dist-electron/watchfaceTargets.js');
const {compileWatchface,WatchfaceCompileError}=require('../dist-electron/watchfaceCompiler/compiler.js');
const {to2222,encodeMipFramesBlock,encodeMipImageBlock,mipBackground,mipBlockOverflows}=require('../dist-electron/watchfaceCompiler/bitmap.js');
const {prepareLocalWatchfaceZip}=require('../dist-electron/corosWatchfaceCompiler.js');
const {createStoreZip}=require('../dist-electron/zipStore.js');
const {encodeWatchfaceFile,decodeWatchfaceInventory,emptyWatchfaceSlot,selectWatchfaceSlot}=require('../dist-electron/corosBleWatchfaceProtocol.js');
const {crc16Ccitt}=require('../dist-electron/corosBleRouteProtocol.js');

// --- Recognizing the watch ---------------------------------------------------
const byModel=value=>targets.watchfaceTargetForModelNumber(value)?.model;
assert.equal(byModel('W332'),'pace-pro');
assert.equal(byModel('COROS W332'),'pace-pro');
assert.equal(byModel('W332-3.2008.0'),'pace-pro');
assert.equal(byModel('W541'),'apex-4');
assert.equal(byModel('B19S'),'vertix-2s','the longer hardware ID wins');
assert.equal(byModel('B19'),'vertix-2');
for (const [hardware,model] of [['B16','vertix'],['B17','apex-pro'],['B18','pace-2'],['B20','apex-2-pro'],['B21','apex-2']]) assert.equal(byModel(hardware),model);
assert.equal(byModel('W999'),undefined);
assert.equal(byModel(undefined),undefined);
const byName=value=>targets.watchfaceTargetForDeviceName(value)?.model;
assert.equal(byName('COROS PACE Pro 2F1A6C'),'pace-pro');
assert.equal(byName('COROS PACE 4 Pro 2F1A'),'pace-4-pro');
assert.equal(byName('COROS PACE 4 2F1A'),'pace-4');
assert.equal(byName('COROS VERTIX 2S 81D0'),'vertix-2s');
assert.equal(byName('COROS APEX 4'),'apex-4');
assert.equal(byName('COROS APEX 2 Pro 81D0'),'apex-2-pro');
assert.equal(byName('COROS VERTIX 81D0'),'vertix');
assert.equal(byName('COROS APEX 4 Pro 81D0'),undefined);
assert.deepEqual(targets.connectedWatchfaceTarget({modelNumber:'W332',deviceName:'COROS APEX 4 81D0'})?.target.model,'pace-pro','the model number wins');
assert.equal(targets.connectedWatchfaceTarget({modelNumber:'W999',deviceName:'COROS APEX 4 81D0'})?.source,'name');
assert.equal(targets.connectedWatchfaceTarget({modelNumber:'W999',deviceName:'COROS APEX 9 81D0'}),undefined);
assert.equal(targets.isValidatedWatch({modelNumber:'W332',softwareRevision:'V3.2008.0'}),true);
assert.equal(targets.isValidatedWatch({modelNumber:'W332',softwareRevision:'3.2009.0'}),false);
assert.equal(targets.isValidatedWatch({modelNumber:'W541',softwareRevision:'3.2008.0'}),false);

// --- BIN shape per watch (magic: screen reversed, A or R; thumbnail measured from COROS) ---
const expected={'pace-pro':['614A',315],'pace-4-pro':['664A',353],'pace-4':['093A',295],'pace-3':['042R',182],
  'apex-4':['062R',197],'nomad':['062R',197],'vertix-2':['082R',212],'vertix-2s':['082R',212],
  'pace-2':['042R',182],'apex-2-pro':['062R',197],'apex-2':['042R',182],'apex-pro':['042R',182],'vertix':['042R',182]};
for (const target of targets.WATCHFACE_TARGETS) {
  const bin=targets.watchfaceBinTarget(target);
  assert.deepEqual([bin.magic,bin.thumbnail],expected[target.model],target.model);
  assert.equal(bin.layout,`watchface_${target.previewSize}x${target.previewSize}`);
}
assert.deepEqual(targets.watchfaceTargetsForMagic('062R').map(t=>t.model).sort(),['apex-2-pro','apex-4','nomad']);
assert.deepEqual(targets.watchfaceTargetsForMagic('999A'),[]);

// --- Memory-in-pixel pixels (C-LINK's measured COROS rules) ---
const ramp=to2222({width:256,height:1,data:Uint8Array.from(Array.from({length:256},(_,i)=>[i,0,0,255]).flat())});
assert.deepEqual([ramp[42],ramp[43],ramp[127],ramp[128],ramp[212],ramp[213]],[0x00,0x10,0x10,0x20,0x20,0x30]);
const fade=to2222({width:256,height:1,data:Uint8Array.from(Array.from({length:256},(_,i)=>[255,0,0,i]).flat())});
assert.deepEqual([fade[63],fade[64],fade[128],fade[192]],[0xff,0xb0,0x70,0x30]);
const white={width:3,height:2,data:new Uint8Array(24).fill(255)};
const frames=encodeMipFramesBlock([white,white]);
assert.equal(frames.readUInt16LE(0),3);assert.equal(frames[5],0x08);assert.equal(frames[6],2);assert.equal(frames[7],0);
assert.equal(frames.readUInt16LE(10),0);assert.equal(frames.readUInt16LE(14),frames.readUInt16LE(12)*2);
assert.equal(mipBlockOverflows(frames),false);

// --- Memory-in-pixel backgrounds: byte-identical to COROS 4.9.9's OptimizeBitmap + edge ring ---
// A background that touches every step of COROS's MIP pipeline: gradients, hues, flat
// enhanced colors, an anti-aliased disc on transparency and partly transparent noise.
const mipFixture=size=>{
  let seed=size;const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
  const data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const at=(y*size+x)*4,u=x/size,v=y/size,band=Math.floor(v*4);
    let px=band===0?[u*255,u*255,u*255,255]
      :band===1?[255*Math.abs(Math.sin(u*3)),255*Math.abs(Math.sin(u*3+2)),255*Math.abs(Math.sin(u*3+4)),255]
      :band===2?(u<0.5?[0x00,0x55,0xff,255]:[0xaa,0xaa,0xaa,255])
      :[rnd()*256,rnd()*256,rnd()*256,rnd()<0.2?0:rnd()*256];
    const d=Math.hypot(x+0.5-size*0.7,y+0.5-size*0.3),edge=Math.max(0,Math.min(1,size*0.15-d));
    if(d<size*0.15+1)px=[200,120,40,Math.round(edge*255)];
    data.set(px.map(Math.floor),at);
  }
  return {width:size,height:size,data};
};
// SHA-256 of COROS's own output (libw4-watchface 4.9.9 emulated, 64-color palette, bg_color 0x557799).
const corosMip={240:'221624c7e07fd546ecea1cda591e8aee94a2f360931c1196aaf241daf15c9c5d',
  260:'8bfb4f73c37cc8d7738315a8e8dbf87a4dceae53a4520294930913dae607d86c',
  280:'e98c38cdc9a6944cdf9f4501f11adeade1ae2cd4a3a6e57b86cbf02cabfb6668'};
for (const [size,hash] of Object.entries(corosMip)) {
  assert.equal(crypto.createHash('sha256').update(mipBackground(mipFixture(Number(size)),0x557799)).digest('hex'),hash,`${size} px background`);
}
{
  // Transparent pixels stay transparent, apart from the black ring COROS draws round the edge.
  const clear=mipBackground({width:260,height:260,data:new Uint8Array(260*260*4)});
  assert.equal(clear[130*260+130],0xff);assert.equal(clear[130*260],0x00,'ring at the left edge');
  // Thumbnails are only rounded, as COROS does (it photo-processes backgrounds alone).
  const photo=mipFixture(197);
  assert.deepEqual(encodeMipImageBlock(photo,2),encodeMipImageBlock(photo,0));
  assert.notDeepEqual(encodeMipImageBlock(photo,1),encodeMipImageBlock(photo,0));
}

// --- Smooth edges (experimental): soft sprite edges encoded for the watch's k/3 alpha ---
{
  const one=(r,g,b,a,smooth)=>to2222({width:1,height:1,data:Uint8Array.from([r,g,b,a])},smooth)[0];
  // Opaque and fully transparent pixels stay exactly as COROS writes them.
  for (let v=0;v<256;v+=5) { assert.equal(one(v,255-v,v>>1,255,true),one(v,255-v,v>>1,255,false)); assert.equal(one(v,v,v,0,true),0xff); }
  // COROS drops alpha 1–63 and turns 192–254 opaque; the watch draws the levels as 0, 1/3, 2/3, 1.
  assert.deepEqual([50,63,200,212].map(a=>one(255,255,255,a,false)),[0xff,0xff,0x3f,0x3f]);
  assert.deepEqual([20,50,63,200,212,213].map(a=>one(255,255,255,a,true)),[0xff,0xaa,0xbf,0x7f,0x7f,0x3f]);
  const flat=mipFixture(64);flat.data.forEach((_,i)=>{if(i%4===3)flat.data[i]=flat.data[i]<128?0:255;});
  assert.deepEqual(encodeMipFramesBlock([flat],true),encodeMipFramesBlock([flat]),'a sprite without soft edges is unchanged');
  const soft=mipFixture(64);
  assert.notDeepEqual(encodeMipFramesBlock([soft],true),encodeMipFramesBlock([soft]));
  assert.deepEqual(encodeMipImageBlock(soft,1,0,true),encodeMipImageBlock(soft,1),'backgrounds stay COROS-exact');
  assert.deepEqual(encodeMipImageBlock(soft,2,0,true),encodeMipImageBlock(soft,2),'thumbnails stay COROS-exact');
}

// --- Compiling for each kind of screen ---
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type,'latin1'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([len,body,crc]);};
function png(width,height){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const rows=Buffer.concat(Array.from({length:height},()=>Buffer.concat([Buffer.from([0]),Buffer.alloc(width*4,255)])));
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const face=size=>new Map([
  ['info.json',Buffer.from('{"m_name":"T","m_preview":"watchface_customize.png","o_wf_ver":5}')],
  ['watchface_customize.png',png(4,4)],
  [`watchface_${size}x${size}/config.txt`,Buffer.from('[background_icon]=bg.png\n[background_icon_pos]={0,0}\n')],
  [`watchface_${size}x${size}/bg.png`,png(4,4)],
]);
const bin=model=>targets.watchfaceBinTarget(targets.getWatchfaceTarget(model));
const apex=compileWatchface(face(260),{faceId:7,target:bin('apex-4')});
assert.equal(apex.bin.toString('latin1',0,4),'062R');
const background=apex.bin.readUInt32LE(0x1a);
assert.equal(apex.bin.readUInt16LE(background),260,'background scaled to the APEX 4 screen');
assert.equal(apex.bin[background+5],0x08,'memory-in-pixel exporter flag');
const thumbnail=apex.bin.readUInt32LE(0x1e);
assert.equal(apex.bin.readUInt16LE(thumbnail),197,'APEX 4 picker thumbnail');
assert.equal(apex.bin.readUInt32LE(8),apex.bin.length-18);assert.equal(apex.bin.readUInt16LE(12),crc16Ccitt(apex.bin.subarray(18)));
assert.deepEqual(compileWatchface(face(260),{faceId:7,target:bin('apex-4'),smoothEdges:true}).bin,apex.bin,'smooth edges leave opaque art alone');
assert.deepEqual(compileWatchface(face(416),{faceId:7,smoothEdges:true}).bin,compileWatchface(face(416),{faceId:7}).bin,'smooth edges are memory-in-pixel only');
const pace4=compileWatchface(face(466),{faceId:7,target:bin('pace-4-pro')});
assert.equal(pace4.bin.toString('latin1',0,4),'664A');
assert.equal(pace4.bin[pace4.bin.readUInt32LE(0x1a)+5],0x20,'AMOLED exporter flag');
assert.throws(()=>compileWatchface(face(260),{faceId:7}),error=>error instanceof WatchfaceCompileError && /416 × 416 PACE Pro/.test(error.message));
assert.equal(encodeWatchfaceFile(apex.bin).magic,'062R','the transfer accepts any supported screen');

// --- Normalizing an archive for one watch ---
const work=fs.mkdtempSync(path.join(os.tmpdir(),'coroslink-multi-watch-'));
try {
  const write=(name,files)=>{const file=path.join(work,name);fs.writeFileSync(file,createStoreZip([...files].map(([n,data])=>({name:n,data}))));return file;};
  const both=write('both.zip',new Map([...face(416),...face(260)]));
  const preferred=await prepareLocalWatchfaceZip(both,targets.getWatchfaceTarget('apex-4'));
  assert.equal(preferred.target.model,'apex-4');
  assert.ok([...preferred.files.keys()].every(name=>!name.startsWith('watchface_416x416/')),'only the chosen layout is kept');
  assert.equal(JSON.parse(preferred.files.get('info.json').toString()).m_app,'watchface_260x260');
  assert.equal((await prepareLocalWatchfaceZip(both)).target.model,'pace-pro','PACE Pro first without a watch');
  assert.equal(targets.watchfaceBinTarget((await prepareLocalWatchfaceZip(write('apex.zip',face(260)))).target).layout,'watchface_260x260','else the first layout it has');
  await assert.rejects(prepareLocalWatchfaceZip(write('pro.zip',face(416)),targets.getWatchfaceTarget('nomad')),/260 × 260 NOMAD/);
} finally { fs.rmSync(work,{recursive:true,force:true}); }

// --- Slots: PACE Pro is padded to ten as always; other watches get what they report ---
const five=Buffer.alloc(20);for(let i=0;i<5;i++)five.writeUInt32LE(i+1,i*4);
assert.equal(decodeWatchfaceInventory(five).length,10);
assert.deepEqual(decodeWatchfaceInventory(five,false),[1,2,3,4,5]);
assert.throws(()=>emptyWatchfaceSlot([1,2,3,4,5]),/occupied/);
assert.throws(()=>selectWatchfaceSlot([1,2,3,4,5],{slot:7,expectedFaceId:null,replaceExisting:false}),/valid/);
assert.equal(selectWatchfaceSlot([1,2,0xffffffff],{slot:2,expectedFaceId:null,replaceExisting:false}),2);
assert.throws(()=>decodeWatchfaceInventory(Buffer.alloc(6),false),/unsupported/);

// --- The service: a NOMAD takes an APEX 4 BIN, refuses a PACE Pro one before sending ---
const servicePath=path.resolve('dist-electron/corosNativeBleService.js');
const serviceRequire=createRequire(servicePath),exports={};
vm.runInNewContext(fs.readFileSync(servicePath,'utf8'),{exports,Buffer,setTimeout,clearTimeout,
  process:{platform:'darwin',arch:'arm64',env:{}},
  require(id){
    if(id==='electron')return {app:{isPackaged:false,getAppPath:()=>'/project'}};
    if(id==='./database')return {getSetting:()=>undefined,setSetting:()=>{}};
    return serviceRequire(id);
  }
},{filename:servicePath});
const service=new exports.CorosNativeBleService();
service.backendInUse='system';
service.state={connected:true,systemBind:'authenticated',modelNumber:'',deviceName:'COROS NOMAD 81D0',deviceId:'watch',
  softwareRevision:'4.1.0',channels:[]};
const snapshot=service.publicState();
assert.deepEqual([snapshot.watchModel,snapshot.watchModelSource,snapshot.watchValidated],['nomad','name',false]);
let slots=[0x11,0xffffffff,0xffffffff,0xffffffff,0xffffffff],sentBlocks=0,disconnects=0;
service.disconnect=async()=>{disconnects++;};
service.send=async(operation,extra)=>{
  if(operation==='exchange'){const payload=Buffer.alloc(slots.length*4);slots.forEach((id,i)=>payload.writeUInt32LE(id>>>0,i*4));return {result:service.state,payload:payload.toString('base64')};}
  if(operation==='watchfaceBlock'){
    sentBlocks++;const header=Buffer.from(extra.header,'base64');
    if(header.readUInt32LE(9)===Buffer.from(extra.block,'base64').length)slots[header[16]]=7;
    return {result:service.state};
  }
  throw new Error(`unexpected ${operation}`);
};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coroslink-bins-'));
try {
  fs.writeFileSync(path.join(dir,'pro.bin'),compileWatchface(face(416),{faceId:9}).bin);
  fs.writeFileSync(path.join(dir,'apex.bin'),apex.bin);
  const pro=await service.prepareWatchface(path.join(dir,'pro.bin'));
  assert.deepEqual(pro.models,['pace-pro']);
  await assert.rejects(service.syncWatchface(pro.id),/built for a 416 px PACE Pro, not your NOMAD/);
  assert.equal(sentBlocks,0,'nothing is sent to the wrong screen');assert.equal(disconnects,0);
  const inventory=await service.listWatchfaceSlots();
  assert.equal(inventory.slots.length,5,'a watch reporting five slots has five');
  const shared=await service.prepareWatchface(path.join(dir,'apex.bin'));
  assert.deepEqual([...shared.models].sort(),['apex-2-pro','apex-4','nomad']);
  const done=await service.syncWatchface(shared.id);
  assert.equal(done.phase,'complete');assert.equal(done.watchSlot,1);assert.ok(sentBlocks>0);
  // A watch CorosLink doesn't recognize gets no face transfers.
  service.state={...service.state,deviceName:'COROS APEX 9 81D0',modelNumber:'W999'};
  await assert.rejects(service.listWatchfaceSlots(),/doesn't support/);
} finally { fs.rmSync(dir,{recursive:true,force:true}); }

console.log('multi-watch: ok');
