import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { CorosWifiMusicService } = require("../dist-electron/corosWifiMusicService.js");
const { serveWifiMusic } = require("../dist-electron/corosWifiMusicServer.js");
const { parseDownloadSettings, encodeLocalDownloadSettings, decodePodcastTask } = require("../dist-electron/corosWifiMusicProtocol.js");
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
for (const invalid of [null,[],Array.from({length:21},(_,i)=>`track-${i}`),["library-one","library-one"],[source],[{filePath:source}], ["../../outside"]]) {
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
function task(id, downloaded, total, status=3, error=0) {const row=Buffer.alloc(39);row[0]=status;row.write(id,1);row.writeBigUInt64LE(BigInt(downloaded),10);row.writeBigUInt64LE(BigInt(total),18);row[33]=error;return Buffer.concat([Buffer.from([1,1]),row]);}
const original=parseDownloadSettings(baseline),local=parseDownloadSettings(encodeLocalDownloadSettings(baseline,"127.0.0.1:12345/a1b2c3/"));
for (const k of ["token","language","mac","country"]) assert.deepEqual(local[k],original[k],`${k} is preserved`);
assert.deepEqual(local.entries.filter(e=>![1,3].includes(e.type)),original.entries.filter(e=>![1,3].includes(e.type)));
assert.equal(decodePodcastTask(task("ABCD0123",17,34),"ABCD0123",17).complete,true,"podcast completion uses its status and exact audio count even if old manifest totals were doubled");
assert.throws(()=>encodeLocalDownloadSettings(baseline,"example.com:12345/a1b2c3/"));

async function harness(mode="ok",existingStore) {
 const store=existingStore??new Map(),calls=[];let current={...identity},connected=true,staged=[],taskId,bytes=0,started=false,reconnects=0,service;
 const bridge={identity(){if(!connected)throw Error("Watch disconnected");return current;},supported:()=>true,
  async reconnect(expected){reconnects++;if(mode==="restore-failure")throw Error("Watch unavailable");current={...expected};connected=true;},
  getSetting:k=>store.get(k),setSetting:(k,v)=>store.set(k,v),encrypt,decrypt,temporaryDirectory:()=>tmp,
  async exchange(opcode,payload){
   calls.push({opcode,payload:Buffer.from(payload)});
   if(opcode===0xb2){
    assert.ok(store.get("coros.ble.wifiMusic.restorePending"),"journal exists before every settings write");
    if(payload.equals(baseline)) {if(mode==="restore-failure")throw Error("restore unavailable");return Buffer.from([1]);}
    const s=parseDownloadSettings(payload);const host=s.entries.find(e=>e.type===3).prefix;
    const url=`http://${host}.coros.com/openapi/map/getMapDetail/${taskId}`;
    const overview=await (await fetch(url)).json();assert.equal(overview.data.files_size,0,"regular audio is counted only in d_size");
    const page=await (await fetch(url+"?page=1")).json();assert.equal(page.data.d_list.length,staged.length);
    bytes=overview.data.d_size;
    for(const item of page.data.d_list){
     const response=await fetch(overview.data.host+item.url+"/"+item.name);assert.equal(response.status,200);
     const body=Buffer.from(await response.arrayBuffer());const file=staged.find(f=>f.id===item.id);
     assert.deepEqual(body,await fs.readFile(file.path),"only the staged snapshot is served intact");
     const partial=await fetch(overview.data.host+item.url+"/"+item.name,{headers:{Range:"bytes=3-9"}});
     assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),body.subarray(3,10));
     assert.equal((await fetch(overview.data.host+item.url+"/"+item.name,{headers:{Range:"bytes=99999999-"}})).status,416);
    }
    return Buffer.from([1]);
   }
   if(payload[0]===25){if(mode==="cancel-before-write")service.cancel();return Buffer.from([1,0,0,0,0]);}
   if(payload[0]===10){started=true;if(mode==="cancel")service.cancel();return Buffer.from([1]);}
   if(payload[0]===4)return Buffer.from([1]);
   if(payload[0]===11){
    if(!started)return Buffer.from([1,0]);
    if(mode==="lost-connection"){mode="ok-after-disconnect";connected=false;throw Error("Watch disconnected");}
    if(mode==="wrong-watch"){mode="restore-failure";current={...identity,deviceName:"COROS PACE Pro OTHER"};throw Error("Connection changed");}
    return task(taskId,mode==="cancel"||mode==="download-failure"?0:bytes,bytes,mode==="cancel"?2:3,mode==="download-failure"?17:0);
   }
   throw Error("Unexpected probe command");
  }};
 service=new CorosWifiMusicService(bridge,{wait:async()=>{},serve:async(files,id)=>{staged=files;taskId=id;return serveWifiMusic(files,id,"127.0.0.1");}});
 return {service,store,calls,get staged(){return staged;},get reconnects(){return reconnects;},setMode:v=>{mode=v;},resetIdentity:()=>{current={...identity};connected=true;}};
}
try {
 const h=await harness();assert.equal(h.service.status().ready,false);await h.service.importBackup(backup);assert.equal(h.service.status().ready,true);
 assert.equal(JSON.stringify(h.service.status()).includes(baseline.toString("base64")),false,"settings payload never reaches renderer status");
 const success=await h.service.send(resolveWifiMusicLibraryFiles(["library-one","library-two"],id=>library.get(id)));assert.equal(success.phase,"complete");assert.equal(success.completedFiles,2);assert.equal(success.restorePending,false);
 assert.deepEqual(h.calls.filter(c=>c.opcode===0xb2).at(-1).payload,baseline,"exact original packet is restored after success");
 assert.deepEqual(await fs.readFile(source),tagged,"source files are never edited");
 for(const f of h.staged)await assert.rejects(fs.stat(f.path),"staged audio is removed");
 assert.ok([...h.store.values()].filter(Boolean).every(v=>!v.includes(identity.deviceName)),"persistent profile/journal use encrypted storage");
 for(const mode of ["download-failure","cancel","cancel-before-write","lost-connection"]){
  const scenario=await harness(mode);await scenario.service.importBackup(backup);const result=await scenario.service.send([source]);
  assert.equal(result.restorePending,false,mode+" restores/retains normal settings");
  assert.equal(result.phase,mode.startsWith("cancel")?"cancelled":"failed");
  if(mode==="cancel-before-write")assert.equal(scenario.calls.some(c=>c.opcode===0xb2),false,"cancelled preparation changes no settings");
  else assert.deepEqual(scenario.calls.filter(c=>c.opcode===0xb2).at(-1).payload,baseline);
  if(mode==="cancel")assert.ok(scenario.calls.some(c=>c.opcode===0xb6&&c.payload[0]===4),"only the selected task is paused");
  if(mode==="lost-connection")assert.equal(scenario.reconnects,1);
 }
 const broken=await harness("wrong-watch");await broken.service.importBackup(backup);const interrupted=await broken.service.send([source]);
 assert.equal(interrupted.phase,"restore-required");assert.equal(interrupted.restorePending,true);
 assert.equal(broken.calls.filter(c=>c.opcode===0xb2&&c.payload.equals(baseline)).length,0,"never writes the original settings to another watch");
 const resumed=await harness("ok",broken.store);await resumed.service.restore();assert.equal(resumed.service.status().restorePending,false,"a new service instance recovers the durable journal");
 assert.deepEqual(resumed.calls.filter(c=>c.opcode===0xb2).at(-1).payload,baseline);
 const missing=await harness();await assert.rejects(missing.service.send([source]),/backup/);assert.equal(missing.calls.length,0);
 await fs.writeFile(backup,makeBackup({deviceName:"COROS PACE Pro OTHER"}));await assert.rejects(missing.service.importBackup(backup),/this watch/);
 await fs.writeFile(backup,makeBackup({source:new Date(Date.now()-48*60*60_000).toISOString()}));await assert.rejects(missing.service.importBackup(backup),/fresh/);
 await fs.writeFile(backup,makeBackup({sha256:"bad"}));await assert.rejects(missing.service.importBackup(backup),/integrity/);
 await fs.writeFile(backup,makeBackup());const stale=await harness();await stale.service.importBackup(backup);
 const realNow=Date.now;Date.now=()=>realNow()+25*60*60_000;
 try {
  assert.equal(stale.service.status().ready,false,"a backup older than a day is not ready");
  assert.ok(stale.service.status().backupSavedAt,"a stale backup still reports its date");
  await assert.rejects(stale.service.send([source]),/more than a day old/);
  assert.equal(stale.calls.length,0,"a stale backup never changes watch settings");
 } finally {Date.now=realNow;}
 console.log("Wi-Fi MP3 sync: library ID/path boundaries, selected batch completion, preserved settings, private HTTP snapshots/ranges, cancellation, disconnect recovery, durable crash recovery, identity binding, encrypted and stale backup checks passed.");
} finally {await fs.rm(tmp,{recursive:true,force:true});}
