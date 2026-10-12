import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {decodeMusicInventoryPage,encodeMusicDeleteFile,encodeMusicDeleteHeader,requireMusicDeleteAcknowledgement}=require('../dist-electron/corosBleMusicProtocol.js');
const {crc16Ccitt:crc}=require('../dist-electron/corosBleRouteProtocol.js');

function varint(n) {const out=[];do{out.push((n&127)|(n>127?128:0));n=Math.floor(n/128);}while(n);return Buffer.from(out);}
function bytes(tag,b){return Buffer.concat([varint(tag*8+2),varint(b.length),b]);}
function scalar(tag,n){return Buffer.concat([varint(tag*8),varint(n)]);}
function row(name='/emmc2:/Music/Café & trail.mp3',size=123456,id=42){
 return bytes(1,Buffer.concat([scalar(1,1),scalar(2,size),bytes(3,Buffer.from(name)),scalar(4,id)]));
}
export function musicFile(proto=Buffer.concat([row(),row('/emmc2:/Music/Episode.mp3',654321,43)])) {
 const file=Buffer.alloc(48+proto.length);file.write('HF');file[3]=93;file.writeUInt32LE(file.length-16,8);
 const body=file.subarray(16);body.write('HS');body[7]=255;body.writeUInt16LE(44,10);
 body.writeUInt32LE(4+proto.length,14);body.writeUInt32LE(4+proto.length,18);body.writeUInt32LE(1,22);
 body.writeUInt32LE(proto.length,28);proto.copy(body,32);
 // Match the measured firmware's +60 checksum window including 16 padding bytes.
 body.writeUInt16LE(crc(Buffer.concat([file.subarray(60),Buffer.alloc(16)])),8);
 body.writeUInt16LE(crc(body.subarray(0,26)),26);
 file.writeUInt16LE(crc(body),12);file.writeUInt16LE(crc(file.subarray(0,14)),14);
 return file;
}
assert.deepEqual(decodeMusicInventoryPage(musicFile()),[
 {name:'Café & trail.mp3',watchPath:'/emmc2:/Music/Café & trail.mp3',sizeBytes:123456,watchId:42},
 {name:'Episode.mp3',watchPath:'/emmc2:/Music/Episode.mp3',sizeBytes:654321,watchId:43}
]);
assert.deepEqual(decodeMusicInventoryPage(musicFile(Buffer.alloc(0))),[]);
for(const offset of [0,3,8,12,14,16,22,26,40,48]) {
 const file=musicFile();file[offset]^=1;assert.throws(()=>decodeMusicInventoryPage(file),/invalid/);
}
for(const proto of [Buffer.from([10,255]),row('/emmc2:/Map/example.mp3'),row('/emmc2:/Music/x\0.mp3'),
 row('/emmc2:/Music/no-audio.bin'),Buffer.concat(Array(21).fill(row())),bytes(1,Buffer.from([24,1])),
 bytes(1,Buffer.concat([scalar(2,1),bytes(3,Buffer.from([0xff])),scalar(4,1)]))]) {
 assert.throws(()=>decodeMusicInventoryPage(musicFile(proto)),/invalid/);
}

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
service.state={connected:true,systemBind:'authenticated',modelNumber:'COROS W332',softwareRevision:'3.2008.0',deviceName:'COROS PACE Pro TEST',channels:[]};
service.backendInUse='system';let reads=[],disconnects=0,release;
service.disconnect=async()=>{disconnects++;};
service.send=async(operation,{page})=>{
 assert.equal(operation,'musicInventoryPage');reads.push(page);
 if(page===0)await new Promise(resolve=>{release=resolve;});
 const proto=page===0?Buffer.concat(Array.from({length:20},(_,i)=>row(`/emmc2:/Music/Part ${i}.mp3`,i+1,i+1))):row('/emmc2:/Music/Last.mp3',21,21);
 return {result:service.state,payload:musicFile(proto).toString('base64')};
};
const reading=service.listMusic();assert.equal(reading,service.listMusic(),'deduplicate inventory requests');
await assert.rejects(service.syncRoute({}),/music/);
await assert.rejects(service.listWatchfaceSlots(),/Bluetooth/);
await assert.rejects(service.sendNotification({title:'Test',body:'Test'}),/Bluetooth/);
assert.throws(()=>service.downloadWifiMap('unused'),/music/);
await new Promise(resolve=>setImmediate(resolve));release();
const inventory=await reading;assert.equal(inventory.tracks.length,21);assert.deepEqual(reads,[0,1]);assert.equal(disconnects,0);
service.state.softwareRevision='V 3.2008.0';
service.send=async()=>({payload:musicFile().toString('base64')});
assert.equal((await service.listMusic()).tracks.length,2,'accept the physical watch’s prefixed version label');
service.state.systemBind='not_authenticated';reads=[];
await assert.rejects(service.listMusic(),/authenticate/);assert.deepEqual(reads,[],'unauthenticated reads send nothing');
service.state.systemBind='authenticated';service.state.softwareRevision='unknown';
// A watch CorosLink doesn't recognize sends nothing; supported watches on other firmware are open as beta.
let sent=0;service.send=async()=>{sent++;return {payload:musicFile().toString('base64')};};
service.state.modelNumber='W999';service.state.deviceName='COROS APEX 2 Pro TEST';
await assert.rejects(service.listMusic(),/doesn't support/);assert.equal(sent,0,'an unrecognized watch sends nothing');
service.state.modelNumber='W541';service.state.deviceName='COROS APEX 4 TEST';
assert.equal((await service.listMusic()).tracks.length,2,'other supported watches and firmware are open as beta');
service.state.modelNumber='';service.state.deviceName='COROS NOMAD 81D0';
assert.equal((await service.listMusic()).tracks.length,2,'a watch is recognized by name when its model number is unknown');
service.state.modelNumber='COROS W332';service.state.deviceName='COROS PACE Pro TEST';
service.state.softwareRevision='3.2008.0';service.send=async()=>({payload:Buffer.from('bad').toString('base64')});
await assert.rejects(service.listMusic(),/invalid/);assert.equal(disconnects,1,'failed receive resets the SFT connection');
service.send=async()=>({payload:musicFile(Buffer.concat(Array(20).fill(row()))).toString('base64')});
await assert.rejects(service.listMusic(),/changed/);assert.equal(disconnects,2,'repeated rows fail without returning partial results');

const targetTrack={name:'Café & trail.mp3',watchPath:'/emmc2:/Music/Café & trail.mp3',sizeBytes:123456,watchId:42};
const deleteFile=encodeMusicDeleteFile(targetTrack),deleteHeader=encodeMusicDeleteHeader(deleteFile);
assert.deepEqual(decodeMusicInventoryPage(deleteFile),[targetTrack]);
assert.deepEqual(deleteFile.subarray(48),row(targetTrack.watchPath,targetTrack.sizeBytes,targetTrack.watchId),'single-row protobuf matches independently built inventory row');
assert.equal(deleteFile.readUInt16LE(24),crc(deleteFile.subarray(48)),'HS checksum matches mobile sender');
assert.deepEqual([...deleteHeader.subarray(0,3)],[0x78,0,93]);
assert.equal(deleteHeader[16],0);assert.equal(deleteHeader.readUInt32LE(3),0);
assert.equal(deleteHeader.readUInt32LE(9),deleteFile.length);
assert.equal(deleteHeader.readUInt16LE(13),crc(deleteFile));
for(const changed of [{name:'../x.mp3'}, {watchPath:'/emmc2:/Maps/x.mp3'}, {watchId:-1}, {watchId:2**32}, {sizeBytes:1.5},
 {name:'x\\y.mp3',watchPath:'/emmc2:/Music/x\\y.mp3'}, {name:'x\0.mp3',watchPath:'/emmc2:/Music/x\0.mp3'},
 {name:'é'.repeat(150)+'.mp3',watchPath:'/emmc2:/Music/'+'é'.repeat(150)+'.mp3'}]) {
 assert.throws(()=>encodeMusicDeleteFile({...targetTrack,...changed}));
}
requireMusicDeleteAcknowledgement(Buffer.from([1,1,0,1]));
assert.throws(()=>requireMusicDeleteAcknowledgement(Buffer.from([1,1,0,0x1b])),/Stop playing/);
for(const ack of [[1,1,1,1],[1,1,0],[1,1,0,0xfe],[0,1,0,1]])assert.throws(()=>requireMusicDeleteAcknowledgement(Buffer.from(ack)));

function deleteFixture(){
 const s=new exports.CorosNativeBleService();
 s.state={connected:true,systemBind:'authenticated',modelNumber:'COROS W332',softwareRevision:'V 3.2008.0',
  deviceName:'COROS PACE Pro TEST',deviceId:'watch-one',authenticatedAt:123,channels:[]};s.backendInUse='system';
 const f={s,tracks:[{...targetTrack},{name:'Other.mp3',watchPath:'/emmc2:/Music/Other.mp3',sizeBytes:100,watchId:43}],writes:[],disconnects:0,
  ack:[1,1,0,1],remove:true};
 s.disconnect=async()=>{f.disconnects++;s.state.connected=false;s.musicInventory=undefined;};
 s.send=async(operation,input)=>{
  f.writes.push({operation,input});
  if(operation==='musicInventoryPage')return {payload:musicFile(Buffer.concat(f.tracks.map(t=>row(t.watchPath,t.sizeBytes,t.watchId)))).toString('base64')};
  assert.equal(operation,'musicDelete');
  assert.deepEqual(decodeMusicInventoryPage(Buffer.from(input.block,'base64')),[targetTrack]);
  if(f.transferError)throw Error('Interrupted transfer');
  if(f.remove)f.tracks=f.tracks.filter(t=>t.watchId!==42);
  return {payload:Buffer.from(f.ack).toString('base64')};
 };
 return f;
}
async function mint(f){const i=await f.s.listMusic();return {inventoryId:i.id,watchId:42,watchPath:targetTrack.watchPath};}
let f=deleteFixture(),target=await mint(f),confirmations=0;
const deleted=await f.s.deleteMusic(target,async t=>{confirmations++;assert.deepEqual({...t},targetTrack);return true;});
assert.equal(confirmations,1);assert.equal(deleted.deleted,true);assert.equal(deleted.inventory.tracks.length,1);
assert.notEqual(deleted.inventory.id,target.inventoryId);assert.equal(f.disconnects,0);
assert.deepEqual(f.writes.map(w=>w.operation),['musicInventoryPage','musicInventoryPage','musicDelete','musicInventoryPage']);
await assert.rejects(f.s.deleteMusic(target,async()=>true),/again/,'cannot reuse old inventory');
f=deleteFixture();target=await mint(f);
const cancelled=await f.s.deleteMusic(target,async()=>false);
assert.equal(cancelled.deleted,false);assert.equal(f.writes.length,1,'cancel sends no mutation or further reads');
for(const changed of [{inventoryId:'forged'},{watchId:999},{watchPath:'/emmc2:/Maps/x.mp3'}]){
 await assert.rejects(f.s.deleteMusic({...target,...changed},async()=>{throw Error('must not confirm');}),/again/);
}
f.s.musicInventory.expires=0;await assert.rejects(f.s.deleteMusic(target,async()=>true),/again/);
f=deleteFixture();target=await mint(f);
await assert.rejects(f.s.deleteMusic(target,async()=>{f.tracks[0].watchId=999;return true;}),/changed/);
assert.equal(f.writes.filter(w=>w.operation==='musicDelete').length,0,'changed row is never sent');
f=deleteFixture();target=await mint(f);let resolveConfirmation;
const pendingDelete=f.s.deleteMusic(target,()=>new Promise(resolve=>{resolveConfirmation=resolve;}));
await new Promise(resolve=>setImmediate(resolve));
let confirmationPolls=0;
f.s.worker={};f.s.request=async operation=>{assert.equal(operation,'status');confirmationPolls++;return f.s.state;};
await f.s.status();assert.equal(confirmationPolls,1,'keep connection status live while confirmation is open');
await assert.rejects(f.s.listMusic(),/Bluetooth/);await assert.rejects(f.s.syncRoute({}),/music/);
await assert.rejects(f.s.listWatchfaceSlots(),/Bluetooth/);await assert.rejects(f.s.sendNotification({title:'x',body:'x'}),/Bluetooth/);
await assert.rejects(f.s.refresh(),/music/);await assert.rejects(f.s.connect(),/music/);
assert.throws(()=>f.s.downloadWifiMap('unused'),/music/);
f.s.state.authenticatedAt++;resolveConfirmation(true);
await assert.rejects(pendingDelete,/changed/);assert.equal(f.writes.length,1,'new session cannot use the confirmed old target');
for(const kind of ['playing','still present','invalid response','interrupted']){
 f=deleteFixture();target=await mint(f);
 if(kind==='playing'){f.ack=[1,1,0,0x1b];f.remove=false;}
 if(kind==='still present')f.remove=false;
 if(kind==='invalid response')f.ack=[1,1,1,1];
 if(kind==='interrupted')f.transferError=true;
 await assert.rejects(f.s.deleteMusic(target,async()=>true),kind==='playing'?/Stop playing/:kind==='still present'?/still lists/:kind==='interrupted'?/Interrupted/:/invalid/);
 assert.equal(f.s.musicInventory,undefined,'failure invalidates deletion targets');
 assert.equal(f.disconnects,['invalid response','interrupted'].includes(kind)?1:0,'reset only interrupted or invalid transport');
}
for(const change of [{connected:false},{systemBind:'not_authenticated'},{softwareRevision:'unknown'},{modelNumber:'Other'}]){
 f=deleteFixture();target=await mint(f);Object.assign(f.s.state,change);
 await assert.rejects(f.s.deleteMusic(target,async()=>{throw Error('must not confirm');}));
 assert.equal(f.writes.length,1,'unsupported/disconnected sessions send no delete request');
}
console.log('Bluetooth music deletion: single-row encoding, confirmation/cancel, session binding, freshness, serialization, playing refusal, interruption and verified removal passed.');

if(process.platform==='darwin') {
 const source=fs.readFileSync('native/corebluetooth/main.swift','utf8');
 const receiver=source.slice(source.indexOf('// Read-only W332 music metadata'),source.indexOf('\nlet worker = BluetoothWorker()'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coros-music-swift-'));
 try {
  const code=`import Foundation\n${receiver}\n
func expect(_ value: Bool, _ message: String) { if !value { fatalError(message) } }
func checksum(_ b: Data) -> Int { var c: UInt16=0xffff;for x in b {c ^= UInt16(x)<<8;for _ in 0..<8 {c=(c &<< 1) ^ (c & 0x8000 == 0 ? 0 : 0x1021)}};return Int(c) }
func header(_ r: CorosMusicPageReceiver, _ b: Data, _ remaining: Int, window: UInt8=60) -> Data {
 var p=Data(repeating:0,count:19);p.replaceSubrange(4..<6,with:r.integer(b.count,2));p.replaceSubrange(6..<10,with:r.integer(remaining,4));p.replaceSubrange(10..<12,with:r.integer(checksum(b),2));p[13]=240;p[14]=window;p[15]=93;p[16]=3;return Data([0x7c,0])+p+Data([p.reduce(UInt8(0),{$0 &+ $1})])
}
func acceptHeader(_ r: CorosMusicPageReceiver, _ b: Data, _ remaining: Int, window: UInt8=60) throws {
 let result=try r.accept(header(r,b,remaining,window:window),control:true);expect(result.bulk && result.frames==[Data([0x7c,0,93])],"read-only window request")
}
func finish(_ r: CorosMusicPageReceiver, _ b: Data) throws -> CorosMusicReadResult {
 var result=CorosMusicReadResult();for o in stride(from:0,to:b.count,by:237) {result=try r.accept(Data([0x7c,UInt8(r.sequence),93])+b.subdata(in:o..<min(o+237,b.count)),control:false)};return result
}
let r=CorosMusicPageReceiver(page:0);let b=Data([${[...musicFile()]}]);try acceptHeader(r,b,b.count)
let acknowledgement=try finish(r,b);expect(acknowledgement.frames[0][0]==0x7d,"acknowledge verified block")
expect(acknowledgement.payload==nil,"wait for final watch acknowledgement")
let done=try r.accept(Data([0x7d,0,1,93,94]),control:true);expect(done.payload==b,"complete metadata only after acknowledgement")
let multi=CorosMusicPageReceiver(page:1);let first=Data(repeating:1,count:4096),second=Data(repeating:2,count:300)
try acceptHeader(multi,first,first.count+second.count,window:2);_ = try finish(multi,first)
let next=try multi.accept(Data([0x7d,0,1,93,94]),control:true);expect(next.frames[0][0]==0x7c && next.payload==nil,"request next block")
try acceptHeader(multi,second,second.count);_ = try finish(multi,second)
let all=try multi.accept(Data([0x7d,0,1,93,94]),control:true);expect(all.payload==first+second,"multiple blocks and receive windows")
let bad=CorosMusicPageReceiver(page:0);try acceptHeader(bad,b,b.count)
do {_ = try bad.accept(Data([0x7c,1,93,1]),control:false);fatalError("accepted missing first packet")}catch CorosMusicReadError.invalid {}
let corrupt=CorosMusicPageReceiver(page:0);try acceptHeader(corrupt,b,b.count);var broken=b;broken[0] ^= 1
do {_ = try finish(corrupt,broken);fatalError("accepted corrupted block")}catch CorosMusicReadError.invalid {}
let oversized=CorosMusicPageReceiver(page:0)
do {_ = try oversized.accept(header(oversized,b,262145),control:true);fatalError("accepted oversized metadata")}catch CorosMusicReadError.invalid {}
let control=CorosMusicPageReceiver(page:0);var brokenHeader=header(control,b,b.count);brokenHeader[3]^=1
do {_ = try control.accept(brokenHeader,control:true);fatalError("accepted corrupt control checksum")}catch CorosMusicReadError.invalid {}
print("Music receiver: windows, multiple blocks, checksums, missing packets, bounds and final acknowledgements passed.")
`;
  const file=path.join(dir,'receiver.swift');fs.writeFileSync(file,code);
  console.log(execFileSync('/usr/bin/swift',[file],{encoding:'utf8',timeout:60000}).trim());
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
console.log('Music metadata decoder: filenames, sizes, empty lists, UTF-8, wrapper integrity and bounds passed.');
