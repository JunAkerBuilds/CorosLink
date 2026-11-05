import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateWifiMusicOptions } = require("../dist-electron/corosWifiMusicTypes.js");
const { CorosWifiMusicService } = require("../dist-electron/corosWifiMusicService.js");
const { serveWifiMusic } = require("../dist-electron/corosWifiMusicServer.js");
const { parseDownloadSettings, encodeLocalDownloadSettings, decodePodcastTask, encodePodcastStart } = require("../dist-electron/corosWifiMusicProtocol.js");
const { resolveWifiMusicLibraryFiles } = require("../dist-electron/corosWifiMusicLibrary.js");

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "coros-wifi-tests-"));
const field = b => Buffer.concat([Buffer.from([b.length]), b]);
const baseline = Buffer.concat([Buffer.from([2,4]), ...[Buffer.alloc(32,116),Buffer.from("en-US"),Buffer.from([1,2,3,4,5,6]),
  Buffer.from("0=coros.com&1=api-bsp&2=p-bsp&3=mapstatic&4=faq-bsp"),Buffer.from("US")].map(field)]);
const identity = { deviceName:"COROS PACE Pro TEST", accountUserId:"42", serialNumber:"serial-one" };
const key = randomBytes(32);
function encrypt(text) { const nonce=randomBytes(12), cipher=createCipheriv("aes-256-gcm",key,nonce), body=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),body]).toString("base64"); }
function decrypt(encoded) { const b=Buffer.from(encoded,"base64"),cipher=createDecipheriv("aes-256-gcm",key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString(); }
const tagged = Buffer.concat([Buffer.from("ID3"),Buffer.alloc(100),Buffer.from([255,251,144,0]),Buffer.alloc(300)]);
const source = path.join(tmp,"Original title.mp3");await fs.writeFile(source,tagged);
const untagged = path.join(tmp,"Needs a title.mp3");await fs.writeFile(untagged,Buffer.concat([Buffer.from([255,251,144,0]),Buffer.alloc(400)]));
const library = new Map([["library-one",{filePath:source}], ["library-two",{filePath:untagged}]]);
const libraryFiles = resolveWifiMusicLibraryFiles(["library-two","library-one"],id=>library.get(id));
assert.deepEqual(libraryFiles,[untagged,source],"only stored library paths are resolved, preserving the selected order");
for (const invalid of [null,[],Array.from({length:501},(_,i)=>`track-${i}`),["library-one","library-one"],[source],[{filePath:source}], ["../../outside"]]) {
 assert.throws(()=>resolveWifiMusicLibraryFiles(invalid,()=>{throw Error("must not resolve invalid IDs");}),/different library tracks/);
}
assert.throws(()=>resolveWifiMusicLibraryFiles(["removed"],id=>library.get(id)),/no longer/);
assert.throws(()=>resolveWifiMusicLibraryFiles(["not-mp3"],()=>({filePath:path.join(tmp,"example.txt")})),/no longer/);
assert.throws(()=>resolveWifiMusicLibraryFiles(["relative"],()=>({filePath:"relative.mp3"})),/no longer/);
assert.throws(()=>resolveWifiMusicLibraryFiles(["alias-one","alias-two"],()=>({filePath:source})),/different MP3 files/);
const backup = path.join(tmp,"backup.enc");
const makeBackup = (extra={}) => Buffer.from(encrypt(JSON.stringify({deviceName:identity.deviceName,payload:baseline.toString("base64"),
  sha256:createHash("sha256").update(baseline).digest("hex"),source:new Date().toISOString(),...extra})),"base64");
await fs.writeFile(backup,makeBackup());
function task(id, downloaded, total, status=3, error=0) {const row=Buffer.alloc(39);row[0]=status;row.write(id,1);row.writeBigUInt64LE(BigInt(downloaded),10);row.writeBigUInt64LE(BigInt(total),18);row.writeUInt16LE(error,33);return Buffer.concat([Buffer.from([1,1]),row]);}
const original=parseDownloadSettings(baseline),local=parseDownloadSettings(encodeLocalDownloadSettings(baseline,"127.0.0.1:12345/a1b2c3/"));
for (const k of ["token","language","mac","country"]) assert.deepEqual(local[k],original[k],`${k} is preserved`);
assert.deepEqual(local.entries.filter(e=>![1,3].includes(e.type)),original.entries.filter(e=>![1,3].includes(e.type)));
assert.equal(decodePodcastTask(task("ABCD0123",17,34),"ABCD0123",17).complete,true,"podcast completion uses its status and exact audio count even if old manifest totals were doubled");
assert.throws(()=>encodeLocalDownloadSettings(baseline,"example.com:12345/a1b2c3/"));

async function harness(mode="ok",existingStore,options) {
 const store=existingStore??new Map(),calls=[],batches=[],samples=[];const refuseRemoval=mode==="remove-refused";let current={...identity},connected=true,staged=[],taskId,bytes=0,started=false,reconnects=0,readinessChecks=0,busyReplies=0,service;
 const bridge={identity(){if(!connected)throw Error("Watch disconnected");return current;},supported:()=>true,
  async reconnect(expected){reconnects++;if(mode==="restore-failure")throw Error("Watch unavailable");current={...expected};connected=true;},
  getSetting:k=>store.get(k),setSetting:(k,v)=>store.set(k,v),encrypt,decrypt,temporaryDirectory:()=>tmp,
  async exchange(opcode,payload){
   calls.push({opcode,payload:Buffer.from(payload)});
   if(opcode===0xb2){
    assert.ok(store.get("coros.ble.wifiMusic.restorePending"),"journal exists before every settings write");
    if(payload.equals(baseline)) {
     if(mode==="restore-failure"||(mode==="restore-failure-batch-2"&&batches.length===2))throw Error("restore unavailable");
     if(mode==="cancel-between-batches")service.cancel();
     return Buffer.from([1]);
    }
    assert.equal(JSON.parse(decrypt(store.get("coros.ble.wifiMusic.restorePending"))).taskId,taskId,"journal belongs to the active batch");
    const s=parseDownloadSettings(payload);const host=s.entries.find(e=>e.type===3).prefix;
    const url=`http://${host}.coros.com/openapi/map/getMapDetail/${taskId}`;
    const overview=await (await fetch(url)).json();assert.equal(overview.data.files_size,0,"regular audio is counted only in d_size");
    const page=await (await fetch(url+"?page=1")).json();assert.equal(page.data.d_list.length,staged.length);
    bytes=overview.data.d_size;
    for(const item of page.data.d_list){
     let audioUrl=overview.data.host+item.url+"/"+item.name;
     if(options?.destination==="netease") {
      assert.equal(item.subtype,1);assert.equal(item.vip_flag,false);
      assert.equal(overview.data.playlist.title,options.playlistName);
      assert.equal(overview.data.playlist.id,batches.at(-1).playlistId,"manifest keeps the queue playlist ID");
      const metadata=await fetch(overview.data.host+overview.data.info_prefix+"/"+item.id+".json");
      assert.equal(Number(metadata.headers.get("content-length")),item.info_size);
      assert.equal((await metadata.json()).album_name,options.playlistName);
      const renewPrefix=s.entries.find(e=>e.type===4).prefix;
      assert.equal(renewPrefix,"relay.coroslink.com/AbCdEf_123/","URL renewal uses the trusted relay");
      assert.equal(s.token.toString(),"0123456789abcdef0123456789abcdef","original watch credential is never sent to the relay");
      const renewal=await fetch(`http://${host}.coros.com/openapi/music163/song/download/renew`,{method:"POST",body:JSON.stringify({task_id:taskId,file_id:item.id,device_id:"test"})});
      assert.equal(renewal.status,200);audioUrl=(await renewal.json()).data.url;
     }
     const response=await fetch(audioUrl);assert.equal(response.status,200);
     const body=Buffer.from(await response.arrayBuffer());const file=staged.find(f=>f.id===item.id);
     assert.deepEqual(body,await fs.readFile(file.path),"only the staged snapshot is served intact");
     const partial=await fetch(audioUrl,{headers:{Range:"bytes=3-9"}});
     assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),body.subarray(3,10));
     assert.equal((await fetch(audioUrl,{headers:{Range:"bytes=99999999-"}})).status,416);
    }
    return Buffer.from([1]);
   }
   if(payload[0]===25){
    readinessChecks++;
    if(mode==="cancel-before-write")service.cancel();
    let flags=0;
    if(mode==="busy-screen-clears"&&readinessChecks<=2)flags=0x100;
    if(mode==="busy-screen-between"&&batches.length===1&&busyReplies++<3)flags=0x100;
    if(mode==="busy-screen-between-long"&&batches.length===1&&busyReplies++<40)flags=0x100;
    if(mode==="busy-screen-stuck"||mode==="cancel-waiting")flags=0x100;
    if(mode==="activity-blocked")flags=8;
    if(mode==="usb-and-screen-blocked")flags=0x104;
    const reply=Buffer.alloc(17);reply[0]=1;reply.writeUInt32LE(flags,1);return reply;
   }
   if(payload[0]===10){
    assert.deepEqual(payload,encodePodcastStart(taskId,options?.destination));started=true;
    if(mode==="fail-batch-2"&&batches.length===2)mode="download-failure";
    if(mode==="cancel-batch-2"&&batches.length===2)mode="cancel";
    if(mode==="cancel")service.cancel();return Buffer.from([1]);
   }
   if(payload[0]===4)return Buffer.from([1]);
   if(payload[0]===5){assert.equal(payload.subarray(1).toString(),taskId,"only the active task is removed");return Buffer.from([refuseRemoval?0x1a:1]);}
   if(payload[0]===11){
    if(!started)return Buffer.from([1,0]);
    if(mode==="lost-connection"){mode="ok-after-disconnect";connected=false;throw Error("Watch disconnected");}
    if(mode==="wrong-watch"){mode="restore-failure";current={...identity,deviceName:"COROS PACE Pro OTHER"};throw Error("Connection changed");}
    return task(taskId,mode==="cancel"||mode==="download-failure"?0:bytes,bytes,mode==="cancel"?2:3,mode==="download-failure"?0x2001:0);
   }
   throw Error("Unexpected probe command");
  }};
 service=new CorosWifiMusicService(bridge,{batchFiles:["big-batch","legacy-relay"].includes(mode)?undefined:20,wait:async()=>{samples.push(service.status());if(mode==="cancel-waiting")service.cancel();},openLookup:async input=>{
  if(mode==="lookup-failure")throw Error("lookup unavailable");
  if(mode==="legacy-relay"&&input.fileIds.length>20)throw Error("Could not prepare the secure NetEase lookup. Secure lookup setup failed (400).");
  return {prefix:"relay.coroslink.com/AbCdEf_123/",token:"0123456789abcdef0123456789abcdef",close:async()=>{calls.push({operation:"lookup-closed"});}};
 },serve:async(files,id,_host,transferOptions,playlistId)=>{
  staged=files;taskId=id;started=false;batches.push({id,playlistId,files:[...files]});
  const server=await serveWifiMusic(files,id,"127.0.0.1",transferOptions,playlistId);
  return server;
 }});
 return {service,store,calls,batches,samples,get staged(){return staged;},get reconnects(){return reconnects;},get readinessChecks(){return readinessChecks;},setMode:v=>{mode=v;},resetIdentity:()=>{current={...identity};connected=true;}};
}
try {
 const h=await harness();assert.equal(h.service.status().ready,false);await h.service.importBackup(backup);assert.equal(h.service.status().ready,true);
 assert.equal(JSON.stringify(h.service.status()).includes(baseline.toString("base64")),false,"settings payload never reaches renderer status");
 const success=await h.service.send(resolveWifiMusicLibraryFiles(["library-one","library-two"],id=>library.get(id)));assert.equal(success.phase,"complete",success.error);assert.equal(success.completedFiles,2);assert.equal(success.restorePending,false);
 assert.deepEqual(h.calls.filter(c=>c.opcode===0xb2).at(-1).payload,baseline,"exact original packet is restored after success");
 assert.deepEqual(await fs.readFile(source),tagged,"source files are never edited");
 for(const f of h.staged)await assert.rejects(fs.stat(f.path),"staged audio is removed");
 assert.ok([...h.store.values()].filter(Boolean).every(v=>!v.includes(identity.deviceName)),"persistent profile/journal use encrypted storage");
 const netease={destination:"netease",playlistName:"Trail 音乐"};
 const unavailable=await harness("lookup-failure",undefined,netease);await unavailable.service.importBackup(backup);
 const unavailableResult=await unavailable.service.send([source],netease);
 assert.equal(unavailableResult.phase,"failed");assert.match(unavailableResult.error,/lookup unavailable/);
 assert.equal(unavailable.calls.some(c=>c.opcode===0xb2),false,"relay failures happen before watch settings change");
 const n=await harness("ok",undefined,netease);await n.service.importBackup(backup);
 const result=await n.service.send([source,untagged],netease);
 assert.equal(result.phase,"complete");assert.equal(result.destination,"netease");assert.equal(result.playlistName,netease.playlistName);
 assert.equal(result.completedFiles,2);assert.equal(result.restorePending,false);
 assert.equal(n.calls.filter(c=>c.operation==="lookup-closed").length,1,"lookup revoked after the batch");
 assert.deepEqual(n.calls.filter(c=>c.opcode===0xb2).at(-1).payload,baseline);
 const queueFiles=[];
 for(let i=0;i<45;i++){const filename=path.join(tmp,`Queue ${String(i).padStart(2,"0")}.mp3`);await fs.writeFile(filename,tagged);queueFiles.push(filename);}
 const queueIds=queueFiles.map((_,i)=>`queue-${i}`);
 assert.deepEqual(resolveWifiMusicLibraryFiles(queueIds,id=>({filePath:queueFiles[Number(id.slice(6))]})),queueFiles,"large library selections retain their order");
 for(const destination of [undefined,netease]){
  const queue=await harness("ok",undefined,destination);await queue.service.importBackup(backup);
  const sent=await queue.service.send(queueFiles.slice(0,32),destination);
  assert.equal(sent.phase,"complete");assert.equal(sent.completedFiles,32);assert.equal(sent.totalFiles,32);
  assert.equal(sent.downloadedBytes,32*tagged.length);assert.equal(sent.totalBytes,32*tagged.length);
  assert.equal(sent.batchIndex,2);assert.equal(sent.batchCount,2);
  assert.deepEqual(queue.batches.map(b=>b.files.length),[20,12],"32 tracks are queued as 20+12");
  assert.equal(new Set(queue.batches.map(b=>b.id)).size,2,"each batch has its own task");
  assert.equal(new Set(queue.batches.map(b=>b.playlistId)).size,1,"all batches share one NetEase playlist ID");
  assert.deepEqual(queue.batches.flatMap(b=>b.files.map(f=>f.name)),queueFiles.slice(0,32).map(f=>path.basename(f)),"batches preserve track order");
  assert.equal(new Set(queue.batches.flatMap(b=>b.files.map(f=>f.id))).size,32,"queued file IDs remain unique");
  assert.equal(queue.calls.filter(c=>c.opcode===0xb2&&c.payload.equals(baseline)).length,2,"settings restore after each batch");
  const destinationName=destination?.destination??"podcasts";
  const onWatch=queue.batches.flatMap(b=>b.files.map(file=>({id:file.id,destination:destinationName,sizeBytes:file.size})));
  assert.deepEqual(queue.service.labelWirelessAudio(onWatch).map(file=>file.name),queueFiles.slice(0,32).map(file=>path.basename(file)),"completed transfers retain display names for live inventory IDs");
  assert.deepEqual(queue.service.labelWirelessAudio([]),[],"saved names never invent files absent from the watch");
  assert.equal(queue.service.labelWirelessAudio([{id:"UNKNOWN1",destination:destinationName,sizeBytes:10}])[0].name,undefined,"older uploads stay identified by their actual watch ID");
  const relaunch=await harness("ok",queue.store,destination);
  assert.equal(relaunch.service.labelWirelessAudio([onWatch[0]])[0].name,onWatch[0]?path.basename(queueFiles[0]):undefined,"labels survive app restart");
  const progress=queue.samples.map(s=>s.downloadedBytes);
  assert.ok(progress.every((value,index)=>index===0||value>=progress[index-1]),"overall byte progress never resets between batches");
  assert.ok(queue.samples.some(s=>s.batchIndex===2&&s.completedFiles===20),"second batch retains the first 20 completed tracks");
  for(const batch of queue.batches)for(const file of batch.files)await assert.rejects(fs.stat(file.path));
 }
 for(const mode of ["busy-screen-clears","busy-screen-between","busy-screen-between-long"]){
  const queue=await harness(mode,undefined,netease);await queue.service.importBackup(backup);
  const result=await queue.service.send(queueFiles.slice(0,32),netease);
  assert.equal(result.phase,"complete",mode);assert.equal(result.completedFiles,32);
  assert.ok(queue.samples.some(s=>s.phase==="waiting"),"screen transitions show a cancellable wait");
  assert.deepEqual(queue.batches.map(b=>b.files.length),[20,12]);
  if(mode==="busy-screen-between")assert.ok(queue.samples.some(s=>s.phase==="waiting"&&s.completedFiles===20),"completed first batch is preserved while waiting");
  // The watch keeps its download-finished screen up until a button press: wait well past the start-of-queue limit and say so.
  if(mode==="busy-screen-between-long")assert.ok(queue.samples.some(s=>s.phase==="waiting"&&s.waitingFor==="screen"),"between batches the queue asks for a button press");
  if(mode==="busy-screen-clears")assert.equal(queue.samples.some(s=>s.waitingFor==="screen"),false,"the first wait is not a button prompt");
 }
 {
  // Real batch size: 32 songs are one download task, so the watch's finished screen needs one press.
  const big=await harness("big-batch",undefined,netease);await big.service.importBackup(backup);
  const result=await big.service.send(queueFiles.slice(0,32),netease);
  assert.equal(result.phase,"complete");assert.equal(result.completedFiles,32);assert.equal(result.batchCount,1);
  assert.deepEqual(big.batches.map(b=>b.files.length),[32],"32 songs go in one download task");
  // A relay deployed before larger lookups refuses them before any watch setting changes; the queue continues in 20s.
  const legacy=await harness("legacy-relay",undefined,netease);await legacy.service.importBackup(backup);
  const fallback=await legacy.service.send(queueFiles.slice(0,32),netease);
  assert.equal(fallback.phase,"complete");assert.equal(fallback.completedFiles,32);assert.equal(fallback.batchCount,2);
  assert.deepEqual(legacy.batches.map(b=>b.files.length),[32,20,12],"the refused 32-song task is retried as 20+12");
  assert.equal(new Set(legacy.batches.map(b=>b.playlistId)).size,1,"every batch adds to the same playlist");
 }
 {
  // The firmware parses at most 4096 bytes of each list page: 100 songs are served across several pages.
  const many=Array.from({length:100},(_,i)=>({id:(0xA0000000+i).toString(16).toUpperCase(),path:source,name:`Song ${i}.mp3`,size:987654321}));
  const server=await serveWifiMusic(many,"ABCDEF12","127.0.0.1",{destination:"netease",playlistName:"界".repeat(21)},"ABCDEF12");
  try{
   const base=`http://${server.prefix}`.replace(/\/$/,"")+"/.coros.com/openapi/map/getMapDetail/ABCDEF12";
   const overview=(await (await fetch(base+"?page=0")).json()).data;
   assert.equal(overview.d_count,100);assert.ok(overview.d_total_page>1,"a long list spans pages");
   const ids=[];
   for(let page=1;page<=overview.d_total_page;page++){
    const body=await (await fetch(`${base}?page=${page}`)).text();
    assert.ok(Buffer.byteLength(body)<=3584,`page ${page} fits the firmware's 4 KB page buffer`);
    ids.push(...JSON.parse(body).data.d_list.map(item=>item.id));
   }
   assert.deepEqual(ids,many.map(file=>file.id),"pages list every song once, in order");
   assert.equal((await fetch(`${base}?page=${overview.d_total_page+1}`)).status,404);
  }finally{await server.close();}
 }
 for(const mode of ["busy-screen-stuck","activity-blocked","usb-and-screen-blocked","cancel-waiting"]){
  const blocked=await harness(mode,undefined,netease);await blocked.service.importBackup(backup);
  const result=await blocked.service.send([source],netease);
  assert.equal(result.phase,mode==="cancel-waiting"?"cancelled":"failed");
  assert.equal(blocked.calls.some(c=>c.opcode===0xb2),false,"waiting never changes download settings");
  assert.equal(blocked.batches.length,0,"a blocked watch starts no audio task");
  if(mode==="busy-screen-stuck"){assert.equal(blocked.readinessChecks,16);assert.match(result.error,/busy screen/);}
  if(mode==="activity-blocked"||mode==="usb-and-screen-blocked"){
   assert.equal(blocked.readinessChecks,1,"real blockers are never retried or ignored");assert.equal(blocked.samples.length,0);
  }
 }
 for(const mode of ["cancel-batch-2","fail-batch-2","cancel-between-batches","restore-failure","restore-failure-batch-2"]){
  const queue=await harness(mode,undefined,netease);await queue.service.importBackup(backup);
  const stopped=await queue.service.send(queueFiles,netease);
  assert.equal(stopped.phase,mode.startsWith("restore-failure")?"restore-required":mode.startsWith("cancel")?"cancelled":"failed",mode);
  assert.equal(queue.batches.length,["cancel-batch-2","fail-batch-2","restore-failure-batch-2"].includes(mode)?2:1,"remaining batches never start after cancellation/failure");
  assert.equal(stopped.completedFiles,mode==="restore-failure-batch-2"?40:20,"completed earlier batches remain counted");
  if(mode==="cancel-batch-2"){
   const removed=queue.calls.filter(c=>c.opcode===0xb6&&c.payload[0]===5);
   assert.equal(removed.length,1);assert.equal(removed[0].payload.subarray(1).toString(),queue.batches[1].id,"only the current batch is removed");
   assert.equal(queue.calls.some(c=>c.opcode===0xb6&&c.payload[0]===4),false,"a removed task is not also paused");
  }
  if(mode.startsWith("restore-failure")){
   assert.equal(stopped.restorePending,true);
   assert.equal(JSON.parse(decrypt(queue.store.get("coros.ble.wifiMusic.restorePending"))).taskId,queue.batches.at(-1).id);
   const recovery=await harness("ok",queue.store,netease);await recovery.service.restore();
   assert.equal(recovery.service.status().restorePending,false,"a restarted app recovers the active batch journal");
  }else assert.equal(stopped.restorePending,false);
 }
 for(const destination of [undefined,netease]) for(const mode of ["download-failure","cancel","cancel-before-write","lost-connection"]){
  const scenario=await harness(mode,undefined,destination);await scenario.service.importBackup(backup);const result=await scenario.service.send([source],destination);
  assert.equal(result.restorePending,false,mode+" restores/retains normal settings");
  assert.equal(result.phase,mode.startsWith("cancel")?"cancelled":"failed");
  if(mode==="download-failure")assert.match(result.error,/code 0x2001/,'report the full firmware error code');
  if(mode==="cancel-before-write")assert.equal(scenario.calls.some(c=>c.opcode===0xb2),false,"cancelled preparation changes no settings");
  else assert.deepEqual(scenario.calls.filter(c=>c.opcode===0xb2).at(-1).payload,baseline);
  if(mode==="cancel"||mode==="download-failure")assert.ok(scenario.calls.some(c=>c.opcode===0xb6&&c.payload[0]===5),"the unfinished task is removed from the watch");
  if(mode==="lost-connection")assert.equal(scenario.reconnects,1);
 }
 {
  // The watch refuses removal with its USB cable in: a still-running task is paused instead.
  const refused=await harness("remove-refused");await refused.service.importBackup(backup);refused.setMode("cancel");
  const result=await refused.service.send([source]);
  assert.equal(result.phase,"cancelled");assert.equal(result.restorePending,false);
  const ops=refused.calls.filter(c=>c.opcode===0xb6&&[4,5].includes(c.payload[0])).map(c=>c.payload[0]);
  assert.deepEqual(ops,[5,4],"falls back to pausing when removal is refused");
 }
 {
  // Adding to an existing playlist keeps its ID; CorosLink remembers the name for next time.
  const reuse=await harness("ok",undefined,{destination:"netease",playlistName:"Morning run",playlistId:"1234ABCD"});await reuse.service.importBackup(backup);
  assert.deepEqual(reuse.service.neteasePlaylists(),[]);
  const done=await reuse.service.send([source],{destination:"netease",playlistName:"Morning run",playlistId:"1234ABCD"});
  assert.equal(done.phase,"complete");assert.equal(reuse.batches[0].playlistId,"1234ABCD","the manifest names the existing playlist");
  assert.equal(done.playlistId,"1234ABCD","status names the playlist it added to");
  assert.deepEqual(reuse.service.neteasePlaylists().map(({id,name})=>({id,name})),[{id:"1234ABCD",name:"Morning run"}]);
  assert.ok(Math.abs(reuse.service.neteasePlaylists()[0].updatedAt-Date.now())<60_000,"a send stamps when the playlist was last updated");
  const fresh=await harness("ok",reuse.store,netease);const created=await fresh.service.send([source],netease);
  assert.deepEqual(fresh.service.neteasePlaylists().map(p=>p.name),["Morning run","Trail 音乐"],"a new playlist is remembered by its new ID");
  assert.equal(fresh.service.neteasePlaylists()[1].id,fresh.batches[0].playlistId);
  assert.equal(created.playlistId,fresh.batches[0].playlistId,"a new playlist's ID comes back with the finished send");
  // Names are local: rename a remembered playlist, or name one the watch has but CorosLink never named.
  fresh.service.renameNeteasePlaylist("1234ABCD"," Tempo ");
  assert.deepEqual(fresh.service.neteasePlaylists().map(p=>p.name),["Tempo","Trail 音乐"],"renaming keeps the order and trims");
  assert.ok(fresh.service.neteasePlaylists()[0].updatedAt,"renaming keeps the last update time");
  assert.deepEqual(fresh.service.renameNeteasePlaylist("C5EC7F80","Found on watch").at(-1),{id:"C5EC7F80",name:"Found on watch"});
  for(const [id,name] of [["c5ec7f80","x"],["C5EC7F80"," "],["C5EC7F80","界".repeat(22)],["C5EC7F80","a\nb"]])
   assert.throws(()=>fresh.service.renameNeteasePlaylist(id,name),/Choose a playlist|Enter a playlist name/);
  for(const playlistId of ["1234abcd","1234ABC",12,"../x"])assert.throws(()=>validateWifiMusicOptions({destination:"netease",playlistName:"x",playlistId}),/Choose a playlist/);
 }
 const broken=await harness("wrong-watch");await broken.service.importBackup(backup);const interrupted=await broken.service.send([source]);
 assert.equal(interrupted.phase,"restore-required");assert.equal(interrupted.restorePending,true);
 assert.equal(broken.calls.filter(c=>c.opcode===0xb2&&c.payload.equals(baseline)).length,0,"never writes the original settings to another watch");
 const resumed=await harness("ok",broken.store);await resumed.service.restore();assert.equal(resumed.service.status().restorePending,false,"a new service instance recovers the durable journal");
 assert.deepEqual(resumed.calls.filter(c=>c.opcode===0xb2).at(-1).payload,baseline);
 const missing=await harness();await assert.rejects(missing.service.send([source]),/backup/);assert.equal(missing.calls.length,0);
 await fs.writeFile(backup,makeBackup({deviceName:"COROS PACE Pro OTHER"}));await assert.rejects(missing.service.importBackup(backup),/this watch/);
 await fs.writeFile(backup,makeBackup({accountUserId:"another-account"}));await assert.rejects(missing.service.importBackup(backup),/this watch and COROS account/);
 const capturedAt=new Date(Date.now()-21*24*60*60_000).toISOString();
 await fs.writeFile(backup,makeBackup({source:capturedAt}));await missing.service.importBackup(backup);
 assert.equal(missing.service.status().ready,true,"an existing backup can be imported without a daily refresh");
 assert.equal(missing.service.status().backupSavedAt,Date.parse(capturedAt),"import keeps the real capture date");
 for(const sourceDate of ["invalid",new Date(Date.now()+24*60*60_000).toISOString(),new Date(0).toISOString()]) {
  await fs.writeFile(backup,makeBackup({source:sourceDate}));await assert.rejects(missing.service.importBackup(backup),/capture date/);
 }
 await fs.writeFile(backup,makeBackup({sha256:"bad"}));await assert.rejects(missing.service.importBackup(backup),/integrity/);
 await fs.writeFile(backup,makeBackup({source:capturedAt}));const saved=await harness();await saved.service.importBackup(backup);
 const realNow=Date.now;Date.now=()=>realNow()+25*60*60_000;
 try {
  assert.equal(saved.service.status().ready,true,"the saved backup remains ready after another day passes");
  assert.equal(saved.service.status().backupSavedAt,Date.parse(capturedAt),"reuse does not rewrite the capture date");
  const reused=await saved.service.send([source]);assert.equal(reused.phase,"complete");
  assert.deepEqual(saved.calls.filter(c=>c.opcode===0xb2).at(-1).payload,baseline,"reuse still restores the exact saved packet");
  const restarted=await harness("ok",saved.store);
  assert.equal(restarted.service.status().ready,true,"a saved backup remains reusable across app restarts");
  assert.equal(restarted.service.status().backupSavedAt,Date.parse(capturedAt));
 } finally {Date.now=realNow;}
 console.log("Wi-Fi MP3 sync: library ID/path boundaries, automatic batches (one task for 32 songs, 20+12 with an older relay), 4 KB list pages, shared NetEase playlist, aggregate progress, transient screen readiness retries, readiness cancellation/blockers, later-batch failure recovery, preserved settings, private HTTP snapshots/ranges, cancellation, disconnect recovery, durable crash recovery, identity binding, encrypted backup reuse and capture-date checks passed.");
} finally {await fs.rm(tmp,{recursive:true,force:true});}
