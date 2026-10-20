import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,constants} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {fixtureFace} from './test-coros-watchface-ble.mjs';
import os from 'node:os';
const facePath=path.join(os.tmpdir(),`coros-direct-face-${process.pid}.bin`);
fs.writeFileSync(facePath,fixtureFace());
const filename=path.resolve('dist-electron/corosNativeBleService.js');
const require=createRequire(filename);
const {CorosBleAccountAuth,crc32Mpeg2,describeBindReply,bindRefusalMessage,corosWatchKeyId,formatCorosWatchKeyId,watchReportsKeyId,BIND_MESSAGES}=require('./corosBleAuth.js');
const {CEP_FILES,parseCepFile,watchHour}=require('./corosWatchCep.js');
const {pushSatelliteData}=require('./localSync/satelliteSync.js');
const {REPORTS,elpoFile,synapticsFile}=await import('./satellite-fixtures.mjs');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const credential={version:1,deviceName:'COROS PACE Pro TEST',accountUserId:'1',
  bindProfile:Buffer.from('019367a53200000000f0012b0700000080','hex').toString('base64'),
  privateKeyDer:privateKey.export({format:'der',type:'pkcs1'}).toString('base64')};
assert.equal(crc32Mpeg2(Buffer.from('123456789')),0x0376e6e7);
const provider=new CorosBleAccountAuth(credential,credential.deviceName);
const signatures=[];
for(const nonce of [Buffer.from('new!'),Buffer.from('next')]) {
  const challenge=Buffer.alloc(17);challenge[0]=0x35;challenge[9]=5;nonce.copy(challenge,11);
  const payload=provider.authenticatedPayload(provider.initialPayload(0x12345678),challenge);
  assert.equal(payload.length,293);
  assert.equal(payload.readUInt32LE(5),0x12345678);
  assert.equal(payload.readBigUInt64LE(281),1n);
  assert.equal(verify('sha256',Buffer.concat([nonce,payload.subarray(281,289)]),
    {key:publicKey,padding:constants.RSA_PKCS1_PADDING},payload.subarray(25,281)),true);
  signatures.push(payload.subarray(25,281));
}
assert.notDeepEqual(...signatures);
assert.throws(()=>new CorosBleAccountAuth({...credential,accountUserId:'2'},credential.deviceName),/invalid/);
assert.throws(()=>provider.authenticatedPayload(Buffer.alloc(17),Buffer.alloc(17)),/key update/);
// A refused reply keeps the card's message but carries its status and flags (never the nonce) for error reports.
const noKey=Buffer.alloc(17);noKey[0]=0x35;noKey[9]=4;Buffer.from('nonc').copy(noKey,11);
assert.throws(()=>provider.authenticatedPayload(Buffer.alloc(17),noKey),error=>error.name==='CorosBindReplyError'&&/key update/.test(error.message)&&
  error.reply==='status 5 (0x35), flags 0x04: no key, auth type 0, challenge, key 0000, reason 0'&&!error.reply.includes('nonc'));
assert.equal(describeBindReply(Buffer.alloc(3)),'3-byte reply');

// The watch reports CRC-16/CCITT-FALSE of [u16 n length][u16 e length][n][e] for its stored key
// (as a PACE 4 computes it; the official app matches it the same way). Checked by an independent table CRC.
const crcTable=Array.from({length:256},(_,i)=>{let c=i<<8;for(let b=0;b<8;b++)c=((c<<1)^(c&0x8000?0x1021:0))&0xffff;return c;});
const tableCrc=data=>[...data].reduce((crc,byte)=>((crc<<8)^crcTable[((crc>>8)^byte)&0xff])&0xffff,0xffff);
assert.equal(tableCrc(Buffer.from('123456789')),0x29b1,'CRC-16/CCITT-FALSE check value');
const jwk=publicKey.export({format:'jwk'});const n=Buffer.from(jwk.n,'base64url'),e=Buffer.from(jwk.e,'base64url');
assert.equal(n.length,256);assert.deepEqual([...e],[1,0,1]);
const blob=Buffer.concat([Buffer.from([0,1,3,0]),n,e]);
assert.equal(corosWatchKeyId(publicKey),tableCrc(blob));
assert.equal(corosWatchKeyId(privateKey),corosWatchKeyId(publicKey),'the private key gives the same ID as its public half');
assert.equal(provider.keyId,tableCrc(blob));
assert.equal(formatCorosWatchKeyId(0x3f1a),'3F1A');assert.equal(formatCorosWatchKeyId(0xa),'000A');
// A challenge naming this key is signed; one naming another key is refused unsigned, since a failed
// signature makes the watch erase the key it holds. 0 means the watch reported no checksum.
const keyChallenge=crc=>{const c=Buffer.alloc(17);c[0]=0x35;c[9]=5;c.writeUInt16LE(crc,7);Buffer.from('nonc').copy(c,11);return c;};
assert.equal(provider.authenticatedPayload(provider.initialPayload(),keyChallenge(provider.keyId)).length,293);
assert.equal(provider.authenticatedPayload(provider.initialPayload(),keyChallenge(0)).length,293);
assert.throws(()=>provider.authenticatedPayload(provider.initialPayload(),keyChallenge(provider.keyId^1)),error=>error.name==='CorosBindReplyError'&&
  error.keyMismatch===true&&error.message===BIND_MESSAGES.keyMismatch&&error.reply.includes(`key ${formatCorosWatchKeyId(provider.keyId^1)}`)&&!error.reply.includes('nonc'));
// On a watch that always reports its key's checksum (the PACE 4), 0000 means it holds no key: refused unsigned with the no-key message.
assert.equal(watchReportsKeyId('pace-4'),true);
for(const model of ['pace-4-pro','pace-pro','pace-3','apex-4',undefined])assert.equal(watchReportsKeyId(model),false,String(model));
const pace4Provider=new CorosBleAccountAuth(credential,credential.deviceName,{keyIdReported:true});
assert.throws(()=>pace4Provider.authenticatedPayload(pace4Provider.initialPayload(),keyChallenge(0)),error=>error.name==='CorosBindReplyError'&&
  error.message===BIND_MESSAGES.keyUpdate&&!error.keyMismatch&&error.reply.includes('key 0000'));
assert.equal(pace4Provider.authenticatedPayload(pace4Provider.initialPayload(),keyChallenge(pace4Provider.keyId)).length,293);
assert.throws(()=>pace4Provider.authenticatedPayload(pace4Provider.initialPayload(),keyChallenge(pace4Provider.keyId^1)),error=>error.keyMismatch===true);
// A watch paired to another account answers the challenge with bond state 2.
const otherAccount=Buffer.alloc(17);otherAccount[0]=0x32;
assert.throws(()=>provider.authenticatedPayload(provider.initialPayload(),otherAccount),error=>error.message===BIND_MESSAGES.otherAccount&&!error.keyMismatch);
// Final replies: state 1 is success; otherwise the reason byte (10) says why.
const finalReply=(state,reason)=>{const r=Buffer.alloc(17);r[0]=0x30|state;r[10]=reason;return r;};
assert.equal(bindRefusalMessage(finalReply(2,0)),BIND_MESSAGES.otherAccount);
assert.equal(bindRefusalMessage(finalReply(5,3)),BIND_MESSAGES.otherAccount);
assert.equal(bindRefusalMessage(finalReply(5,1)),BIND_MESSAGES.timedOut);
assert.equal(bindRefusalMessage(finalReply(5,9)),BIND_MESSAGES.timedOut);
assert.equal(bindRefusalMessage(finalReply(5,4)),BIND_MESSAGES.keyRejected);
assert.equal(bindRefusalMessage(finalReply(5,11)),BIND_MESSAGES.keyUpdate);
assert.equal(bindRefusalMessage(finalReply(5,10)),BIND_MESSAGES.rejected);
assert.equal(bindRefusalMessage(Buffer.alloc(3)),BIND_MESSAGES.rejected);
assert.equal(describeBindReply(finalReply(5,4)),'status 5 (0x35), flags 0x00: no key, auth type 0, no challenge, key 0000, reason 4');

for(const platform of ['darwin','win32','linux']) {
  const settings=new Map([['coros.ble.accountAuth',Buffer.from('encrypted:'+JSON.stringify(credential)).toString('base64')]]);
  const workers=[],writes=[],credentialReads=[],diagnostics=[],notices=[];const exports={};let noKeyReply=false,watchKeyCrc=0,rejectSignature=false,weatherHeaderTimeout=false,connectModel='COROS W332';
  // Devices advertising the watch's name, by Bluetooth identity; `ignorePin` is a helper that connects by name regardless.
  let nearby=['os-id'],ignorePin=false;
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{exports,Buffer,Error,setTimeout,clearTimeout,
    process:{platform,arch:'x64',env:{BUMBLE_SNOOPER:'unsafe',BUMBLE_LOGLEVEL:'DEBUG'},resourcesPath:'/resources'},
    require(id){
      if(id==='electron')return {app:{isPackaged:false,getAppPath:()=>'/project'},safeStorage:{isEncryptionAvailable:()=>true,
        encryptString:t=>Buffer.from('encrypted:'+t),decryptString:b=>b.toString().slice(10)}};
      if(id==='./diagnosticsService')return {recordDiagnosticError:(source,error)=>diagnostics.push({source,message:error.message}),
        recordDiagnosticNotice:(source,message,level)=>notices.push({source,message,level})};
      if(id==='./database')return {getSetting:k=>{
        if(k==='coros.credentials'||k==='trainingHub.credentials')credentialReads.push(k);
        return settings.get(k);
      },setSetting:(k,v)=>settings.set(k,v)};
      if(id==='node:fs')return {existsSync:file=>file.includes('/bin/')||file.endsWith('coros-system-ble.py'),promises:fs.promises};
      if(id==='node:child_process')return {spawn(program,args,options){
        assert.equal(options.env.BUMBLE_SNOOPER,undefined);
        assert.equal(options.env.BUMBLE_LOGLEVEL,undefined);
        if(platform==='darwin')assert.ok(program.endsWith('coros-corebluetooth'));
        else {assert.ok(program.includes('python-runtime'));assert.ok(options.env.PYTHONPATH.endsWith('ble-python'));}
        const worker=new EventEmitter();worker.stdout=new EventEmitter();worker.stdout.setEncoding=()=>{};
        worker.stderr=new EventEmitter();worker.stderr.setEncoding=()=>{};
        let state={phase:'idle',connected:false,encrypted:false,systemBind:'unavailable',channels:[],pairingManagedByOS:true,maximumWriteBytes:244};
        let routeFile=Buffer.alloc(0), storedRoute;
        let faceFile=Buffer.alloc(0), faceIds=Array(10).fill(0xffffffff);faceIds[0]=99;
        worker.fillFaceSlots=()=>{faceIds=Array(10).fill(99);};
        worker.resetFaceSlots=()=>{faceIds=Array(10).fill(0xffffffff);faceIds[0]=99;};
        worker.setFaceSlot=(slot,id)=>{faceIds[slot]=id;};
        worker.getFaceSlots=()=>[...faceIds];
        // The watch's training plans (CONFIG_TRAINING kind 1) and its system switches (12/24 h at bit 13).
        worker.plans=[];worker.planFile=Buffer.alloc(0);worker.failPlanBlock=undefined;
        worker.switchWord=0x0e2d2085;
        worker.stdin={on(){},writableEnded:false,write(line,callback){
          // A real stream refuses writes once stop() has ended it.
          if(this.writableEnded){callback?.(Object.assign(new Error('write after end'),{code:'ERR_STREAM_WRITE_AFTER_END'}));return false;}
          const request=JSON.parse(line);writes.push(request);
          assert.equal(line.includes(credential.privateKeyDer),false,'system workers never receive the account key');
          let payload, responseError, responseDetail, capture, mismatch;
          if(request.operation==='scan')state={...state,discoveredDevices:nearby.map(deviceId=>({deviceId,deviceName:credential.deviceName}))};
          if(request.operation==='connect'){
            // As main.swift does: with a remembered identity only that device, else the chosen or first one with the name.
            const pinned=ignorePin?undefined:request.pinnedId;
            const match=pinned?nearby.find(id=>id.toUpperCase()===pinned.toUpperCase()):nearby.find(id=>id===request.deviceId)??nearby[0];
            if(match)state={...state,phase:'connected',connected:true,deviceName:request.deviceName,deviceId:match,modelNumber:connectModel,softwareRevision:'V 3.2008.0'};
            else {responseError='This doesn’t look like the watch you connected before.';responseDetail={site:'main.swift:380 centralManager(_:didDiscover:advertisementData:rssi:)',operation:'connect'};mismatch={deviceId:nearby[0]};}
          }
          if(request.operation==='exchange') {
            const data=Buffer.from(request.payload,'base64');
            if(request.opcode===0xb2)payload=Buffer.from([1,0]);
            else if(request.opcode===0x8c){assert.equal(data.length,9,'clock: time, two zone units, format, milliseconds');payload=Buffer.from([1]);}
            else if(request.opcode===0xa7){
              const word=Buffer.alloc(4);word.writeUInt32LE(worker.switchWord>>>0);
              // Settings type 13 (FW_INFO) when asked for, as the firmware writes it for the watch's receiver.
              const fwInfo=data[1]===13&&worker.fwInfo?Buffer.concat([Buffer.from([13,worker.fwInfo.length]),worker.fwInfo]):Buffer.alloc(0);
              payload=Buffer.concat([worker.omitSwitches?Buffer.alloc(0):Buffer.concat([Buffer.from([0,4]),word]),data[1]===13?fwInfo:Buffer.from([10,2,8,1])]);
            }
            else if(request.opcode===0xa6){
              // A write the watch applies but whose reply is lost.
              if(worker.loseSettingsReply){worker.loseSettingsReply=false;responseError='The watch did not answer the Bluetooth command.';}
              const records=Buffer.from(request.payload,'base64');if(records[0]===0&&records[1]===4)worker.switchWord=records.readUInt32LE(2);
              payload=Buffer.from([1]);
            }
            else if(request.opcode===0xaf){
              assert.equal(data[0],1,'only the plan list is used here');
              if(data[1]===0){
                payload=Buffer.alloc(9+worker.plans.length*10+2);payload[0]=1;payload[1]=1;payload.writeUInt32LE(65536,3);payload[7]=1;payload[8]=worker.plans.length;
                worker.plans.forEach((id,i)=>{payload.writeBigInt64LE(id,9+i*10);payload[17+i*10]=0;payload[18+i*10]=1;});
              } else {
                assert.equal(data[1],1);const removed=[];for(let i=2;i+9<=data.length;i+=9)removed.push(data.readBigInt64LE(i));
                worker.deletedPlans=(worker.deletedPlans??[]).concat(removed);worker.plans=worker.plans.filter(id=>!removed.includes(id));payload=Buffer.from([1]);
              }
            }
            else if(request.opcode===0xb6){assert.equal(data.toString('hex'),'0bff');payload=Buffer.from([1,0]);}
            else if(request.opcode===0xaa) {
              assert.equal(data.toString('hex'),'00');
              payload=Buffer.alloc(storedRoute?19:6);Buffer.from([0,100,storedRoute?1:0,13,0,0]).copy(payload);
              if(storedRoute){payload[6]=storedRoute.slot;payload.writeBigUInt64LE(storedRoute.id,7);payload.writeUInt16LE(storedRoute.crc,15);}
            }
            else if(request.opcode===0x96) {assert.equal(data.toString('hex'),'00','inventory request must have a logical payload byte');payload=Buffer.alloc(40);faceIds.forEach((id,i)=>payload.writeUInt32LE(id,i*4));}
            else {
              payload=Buffer.alloc(17);
              if(data.length===17){payload[0]=0x35;payload[9]=noKeyReply?4:5;payload.writeUInt16LE(watchKeyCrc,7);Buffer.from('live').copy(payload,11);}
              else {
                assert.equal(verify('sha256',Buffer.concat([Buffer.from('live'),data.subarray(281,289)]),publicKey,data.subarray(25,281)),true);
                // A watch holding another key fails the signature (reason 4) and erases its own key.
                if(rejectSignature){payload[0]=0x35;payload[10]=4;} else payload[0]=0x31;
              }
            }
          }
          if(request.operation==='routeBlock') {
            const header=Buffer.from(request.header,'base64'),block=Buffer.from(request.block,'base64');
            assert.equal(header.readUInt32LE(3),routeFile.length);
            assert.equal(header.readUInt16LE(7),block.length);
            routeFile=Buffer.concat([routeFile,block]);
            if(header.readUInt32LE(9)===block.length) {
              storedRoute={slot:header[16],id:routeFile.readBigUInt64LE(181),crc:routeFile.readUInt16LE(12)};
              routeFile=Buffer.alloc(0);
            }
          }
          if(request.operation==='watchfaceBlock') {
            const header=Buffer.from(request.header,'base64'),block=Buffer.from(request.block,'base64');
            assert.equal(header[2],8);assert.equal(header.readUInt32LE(3),faceFile.length);
            assert.equal(header[16],worker.expectedFaceSlot ?? 1,'use the chosen slot, preserve others');
            if(worker.rejectFaceBlocks) {responseError='The watch rejected the file data block.';
              responseDetail={site:'main.swift:481 peripheral(_:didUpdateValueFor:error:)',operation:'watchfaceBlock',elapsedMs:12,peripheralState:'connected',errorDomain:'CBATTErrorDomain',errorCode:14};}
            faceFile=Buffer.concat([faceFile,block]);
            if(header.readUInt32LE(9)===block.length) {faceIds[header[16]]=faceFile.readUInt32LE(20);faceFile=Buffer.alloc(0);}
          }
          if(request.operation==='syncFileBlock'){
            assert.deepEqual([request.fileIndex,request.offset,request.selector],[14,0,0]);
            const remaining=Buffer.alloc(4);remaining.writeUInt32LE(100);payload=Buffer.concat([remaining,Buffer.alloc(100,7)]);
          }
          if(request.operation==='dataFileBlock'&&request.fileId===42) {
            const header=Buffer.from(request.header,'base64'),block=Buffer.from(request.block,'base64');
            const index=header.readUInt32LE(3)/4096;
            if(worker.failPlanBlock===index){responseError='The watch did not accept the file data block.';responseDetail={site:'main.swift:600 pump()',operation:'dataFileBlock'};}
            else {worker.planFile=Buffer.concat([worker.planFile,block]);if(header.readUInt32LE(9)===block.length){worker.plans=[1n];worker.planFile=Buffer.alloc(0);}}
          }
          if(request.operation==='dataFileBlock'&&[13,68,70].includes(request.fileId)) {
            const header=Buffer.from(request.header,'base64'),block=Buffer.from(request.block,'base64');
            worker.satellite=worker.satellite??[];worker.satellite.push({fileId:request.fileId,offset:header.readUInt32LE(3),remaining:header.readUInt32LE(9),extra:[...header.subarray(16,19)],block});
          }
          if(request.operation==='dataFileBlock'&&weatherHeaderTimeout) {
            // What the helper reports when the watch never answers the first header (main.swift pump()).
            responseError='The watch did not accept the file transfer header.';
            responseDetail={site:'main.swift:203 pump()',operation:'dataFileBlock',timedOut:true,elapsedMs:15538,peripheralState:'connected'};
          }
          if(request.capture===true)capture=[{d:'tx',c:'control',t:0,x:'7c010e'},{d:'rx',c:'bulk',t:5,x:'7c000e07'}];
          if(request.operation==='disconnect')state={...state,phase:'disconnected',connected:false};
          setTimeout(()=>worker.stdout.emit('data',JSON.stringify({id:request.id,result:state,error:responseError,detail:responseDetail,payload:payload?.toString('base64'),capture,mismatch})+'\n'),2);callback?.();
        },end(){this.writableEnded=true;worker.emit('exit',0);setTimeout(()=>worker.emit('close',0),5);}};
        worker.kill=()=>worker.emit('close',1);
        worker.remoteDisconnect=()=>{state={...state,phase:'disconnected',connected:false};};
        workers.push(worker);return worker;
      }};
      return require(id);
    }
  },{filename});
  const service=new exports.CorosNativeBleService();
  assert.equal((await service.status()).available,true,'no dongle bond needed');
  assert.equal((await service.status()).backend,'system');
  assert.equal(workers.length,0,'status does not trigger Bluetooth permission or start a worker');
  const scanning=service.scan();assert.equal(scanning,service.scan());
  assert.equal((await scanning).discoveredDevices.length,1);
  const first=service.connect(false,{backend:'system'});assert.equal(first,service.connect());
  const connected=await first;assert.equal(connected.systemBind,'authenticated');
  assert.equal(connected.pairingManagedByOS,true);assert.equal(connected.encrypted,false,'do not invent an OS encryption status');
  assert.equal(JSON.stringify(connected).includes(credential.privateKeyDer),false);
  assert.equal((await service.status()).systemBind,'authenticated','worker status cannot erase accepted account authentication');
  // Local activity sync: frames are captured only when a capture sink is set, and never through diagnostics.
  {
    const entries=[];
    await assert.rejects(service.readSyncFileBlock(14,0,0),/only inside a local sync/);
    service.setLocalSyncCapture(entry=>entries.push(entry));
    const read=await service.runLocalSync(()=>service.readSyncFileBlock(14,0,0));
    assert.deepEqual([read.remaining,read.block.length],[100,100]);
    assert.equal(writes.at(-1).capture,true);
    assert.deepEqual(entries.map(entry=>[entry.operation,entry.ok,entry.frames.length]),[['syncFileBlock',true,2]]);
    await assert.rejects(service.runLocalSync(()=>service.readSyncFileBlock(93,0,0)),/read-only/);
    service.setLocalSyncCapture(undefined);
    await service.runLocalSync(()=>service.readSyncFileBlock(14,0,0));
    assert.equal(writes.at(-1).capture,undefined,'no capture unless asked for');
    // Never acknowledge: the service has no acknowledge call and no request ever names one.
    assert.equal('ackSyncFileBlock' in service,false);
    assert.equal(writes.some(x=>x.operation==='syncFileAck'),false);
    assert.equal(entries.length,1);
    assert.equal(diagnostics.some(entry=>entry.message.includes('7c000e07')),false);
  }
  // Syncs keep the link: unacknowledged reads leave nothing to close, so a second sync runs on the same connection.
  {
    const workersBefore=workers.length, writesBefore=writes.length;
    assert.equal(service.isConnected(),true);
    assert.equal(service.idleForBackgroundSync(),true,'a connected, idle watch can be synced in the background over the same link');
    let release;
    const first=service.runLocalSync(async()=>{await service.readSyncFileBlock(14,0,0);await new Promise(resolve=>{release=resolve;});return 'first';});
    await assert.rejects(service.runLocalSync(async()=>'again'),/already running/,'one sync at a time');
    assert.equal(service.idleForBackgroundSync(),false,'not idle while a sync runs');
    await assert.rejects(service.connect(false,{backend:'system'}),/watch sync to finish/);
    while(!release)await new Promise(resolve=>setTimeout(resolve,5));
    release();
    assert.equal(await first,'first');
    const second=await service.runLocalSync(()=>service.readSyncFileBlock(14,0,0));
    assert.equal(second.remaining,100,'a second sync right after the first works without reconnecting');
    assert.equal(writes.slice(writesBefore).some(x=>x.operation==='disconnect'||x.operation==='connect'),false,'no disconnect or reconnect between syncs');
    assert.equal(workers.length,workersBefore,'the same helper carries both syncs');
    assert.equal((await service.status()).connected,true,'still connected afterwards');
    assert.equal(service.idleForBackgroundSync(),true);
  }
  // The clock keeps the watch's own 12/24-hour format: its switches are read first, also on a first connection.
  {
    const clockFormat=()=>{const sent=writes.filter(x=>x.opcode===0x8c).at(-1);return Buffer.from(sent.payload,'base64')[6];};
    const order=()=>{const tail=writes.slice(before);return [tail.findIndex(x=>x.opcode===0xa7),tail.findIndex(x=>x.opcode===0x8c)];};
    let before=writes.length;
    await service.disconnect();
    for(const [word,expected] of [[0x0e2d2085|1<<13,1],[0x0e2d2085&~(1<<13),0]]){
      before=writes.length;
      const count=workers.length;
      const next=service.connect(false,{backend:'system'});
      assert.equal(workers.length,count+1,'a new helper for the new connection');
      workers.at(-1).switchWord=word>>>0;
      await next;
      const [readAt,clockAt]=order();
      assert.ok(readAt>=0&&clockAt>readAt,'switches read before the clock is set');
      assert.equal(clockFormat(),expected,'the watch format is kept, not the computer\'s');
      await service.disconnect();
    }
    // A profile that doesn't decode still leaves the watch's format; with no switches to read, the clock isn't set at all.
    const computer=new Intl.DateTimeFormat(undefined,{hour:'numeric'}).resolvedOptions().hour12===true?1:0;
    service.setProfileSink(()=>{throw new Error("The watch's profile has an unexpected field.");});
    before=writes.length;
    let next=service.connect(false,{backend:'system'});
    workers.at(-1).switchWord=(computer?0x0e2d2085&~(1<<13):0x0e2d2085|1<<13)>>>0;
    await next;
    assert.equal(clockFormat(),computer?0:1,'a profile that fails to decode keeps the watch\'s format, not the computer\'s');
    assert.ok(diagnostics.some(entry=>entry.source==='corosBle:readProfile'));
    await service.disconnect();
    before=writes.length;const noticed=notices.length;
    next=service.connect(false,{backend:'system'});
    workers.at(-1).omitSwitches=true;
    assert.equal((await next).systemBind,'authenticated');
    assert.equal(writes.slice(before).some(x=>x.opcode===0x8c),false,'format unknown: the clock waits for a connection that reads it');
    assert.ok(writes.slice(before).filter(x=>x.opcode===0xa7).length>=2,'the switches are asked for again before giving up');
    assert.deepEqual(notices.slice(noticed).map(entry=>entry.source),['corosBle:setClock']);
    service.setProfileSink(()=>{});
    await service.disconnect();
    assert.equal((await service.connect(false,{backend:'system'})).systemBind,'authenticated');
  }
  // Disconnect waits for what is being written to the watch: a calendar mid-send, a settings write and its read-back.
  {
    const worker=workers.at(-1);
    worker.plans=[1n];worker.failPlanBlock=undefined;
    const plan=Buffer.alloc(3*4096+10,5);
    let before=writes.length;
    const sending=service.runLocalSync(()=>service.sendTrainingPlanInSync(plan,['1']));
    // The user clicks Disconnect once the old plan is gone and the first block is out.
    while(!writes.slice(before).some(x=>x.operation==='dataFileBlock'))await new Promise(resolve=>setTimeout(resolve,1));
    const closing=service.disconnect();
    await assert.rejects(service.writeWatchSwitches(Buffer.alloc(4)),/Wait for/,'nothing new starts while disconnecting');
    assert.equal((await sending).listed,true,'the calendar is sent whole');
    assert.equal((await closing).connected,false);
    const ops=writes.slice(before).map(x=>x.operation==='exchange'?`x${x.opcode.toString(16)}`:x.operation);
    assert.deepEqual(ops.filter(op=>op==='dataFileBlock').length,4);
    assert.ok(ops.lastIndexOf('dataFileBlock')<ops.indexOf('disconnect')&&ops.lastIndexOf('xaf')<ops.indexOf('disconnect'),ops.join(' '));
    assert.equal((await service.connect(false,{backend:'system'})).systemBind,'authenticated');
    before=writes.length;
    const word=Buffer.from([0x85,0x20,0x2d,0x0e]);
    const writing=service.writeWatchSwitches(word);
    const disconnecting=service.disconnect();
    assert.deepEqual((await writing).word,word,'reported saved');
    await disconnecting;
    const order=writes.slice(before).map(x=>x.opcode?x.opcode.toString(16):x.operation);
    assert.ok(order.indexOf('a6')<order.lastIndexOf('a7')&&order.lastIndexOf('a7')<order.indexOf('disconnect'),order.join(' '));
    // A write the watch applied but didn't answer is read back before anything is reported.
    assert.equal((await service.connect(false,{backend:'system'})).systemBind,'authenticated');
    workers.at(-1).loseSettingsReply=true;
    const other=Buffer.from([0x85,0x00,0x2d,0x0e]);
    const noticed=notices.length;
    assert.deepEqual((await service.writeWatchSwitches(other)).word,other,'what the watch holds decides');
    assert.deepEqual(notices.slice(noticed).map(entry=>entry.source),['corosBle:settingsWrite']);
    // Quitting: a sync's reads stop (its cancel), nothing new starts, and the wait is bounded.
    let cancelled=0;service.setLocalSyncCancel(()=>{cancelled+=1;});
    const quitter=new exports.CorosNativeBleService();
    assert.equal((await quitter.connect(false,{backend:'system'})).systemBind,'authenticated');
    quitter.setLocalSyncCancel(()=>{cancelled+=1;});
    let hold;const hanging=quitter.runLocalSync(()=>new Promise(resolve=>{hold=resolve;}));
    assert.equal(quitter.hasWatchWork(),true);
    const started=Date.now();
    await quitter.finishBeforeQuit(60);
    assert.ok(Date.now()-started<2000,'bounded');assert.equal(cancelled,1);
    await assert.rejects(quitter.readSyncFileBlock(14,0,0),/disconnect/,'the running sync reads nothing more');
    hold();await hanging;
    await assert.rejects(quitter.runLocalSync(async()=>1),/disconnect/,'nothing new starts');
    await quitter.stop();
    assert.equal(service.hasWatchWork(),false);
    service.setLocalSyncCancel(()=>{});
    // The tests below use the newest helper: the service's own again.
    await service.disconnect();
    assert.equal((await service.connect(false,{backend:'system'})).systemBind,'authenticated');
  }
  // One busy check for every task: nothing else touches the link while a sync or a push holds it.
  {
    const preview=await service.prepareWatchface(facePath);
    const refusals=async()=>{
      const writesBefore=writes.length;
      await assert.rejects(service.listMusic(),/current Bluetooth operation/,'no music read');
      await assert.rejects(service.syncWatchface(preview.id),/current Bluetooth transfer/,'no watch-face install');
      await assert.rejects(service.listWatchfaceSlots(),/current Bluetooth transfer/);
      await assert.rejects(service.syncRoute({id:'r',name:'r',points:[]}),/Wait for/);
      await assert.rejects(service.sendNotification({title:'x',body:'x'}),/current Bluetooth operation/);
      assert.throws(()=>service.downloadWifiMap('unused'),/Wait for/);
      await assert.rejects(service.writeWatchSwitches(Buffer.alloc(4)),/Wait for/);
      await service.status();
      assert.equal(writes.length,writesBefore,'nothing reaches the watch');
    };
    let release;
    const sync=service.runLocalSync(()=>new Promise(resolve=>{release=resolve;}));
    while(!release)await new Promise(resolve=>setTimeout(resolve,1));
    await refusals();
    release();await sync;
    release=undefined;
    const push=service.pushOperation(()=>new Promise(resolve=>{release=resolve;}));
    while(!release)await new Promise(resolve=>setTimeout(resolve,1));
    await refusals();
    await assert.rejects(service.runLocalSync(async()=>'x'),/transfer to the watch/,'no sync during a push');
    assert.equal(service.idleForBackgroundSync(),false);
    release();await push;
    assert.equal(service.idleForBackgroundSync(),true);
  }
  // The training calendar replaces only the plans it is told to; a transfer that fails partway resets the link.
  {
    const worker=workers.at(-1);
    worker.plans=[987654321n];
    const plan=Buffer.alloc(5000,3);
    assert.deepEqual(await service.runLocalSync(()=>service.listTrainingPlansInSync()),['987654321']);
    let before=writes.length;
    await assert.rejects(service.runLocalSync(()=>service.sendTrainingPlanInSync(plan,[])),/changed/);
    assert.equal(writes.slice(before).some(x=>x.operation==='dataFileBlock'||(x.opcode===0xaf&&Buffer.from(x.payload,'base64')[1]===1)),false,'a plan nobody named is never removed');
    assert.deepEqual(worker.plans,[987654321n]);
    assert.equal((await service.runLocalSync(()=>service.sendTrainingPlanInSync(plan,['987654321']))).listed,true);
    assert.deepEqual([worker.deletedPlans,worker.plans],[[987654321n],[1n]]);
    worker.failPlanBlock=1;before=writes.length;
    await assert.rejects(service.runLocalSync(()=>service.sendTrainingPlanInSync(plan,['1'])),/didn't finish sending/);
    assert.ok(writes.slice(before).some(x=>x.operation==='disconnect'),'a half-sent calendar resets the link');
    assert.equal(service.isConnected(),false);
    assert.equal((await service.connect(false,{backend:'system'})).systemBind,'authenticated');
  }
  // Satellite data follows what the watch reports (settings type 13), limited to formats checked in its firmware.
  // A PACE Pro (Synaptics) takes LTO in file 13 and RTO in file 70; ELPO is refused.
  const satelliteLink=()=>({model:()=>service.localSyncWatch()?.model,readAssistance:()=>service.readGpsAssistanceInSync(),
    sendFile:file=>service.sendSatelliteFileInSync(file)});
  {
    const worker=workers.at(-1);
    const today=watchHour(Date.now())-1;
    worker.fwInfo=REPORTS.lto(today-30,today-3).settings;
    const assist=await service.runLocalSync(()=>service.readGpsAssistanceInSync());
    assert.deepEqual([assist.format,assist.source,assist.startHour,assist.eph.startHour,assist.settingsRaw],['synaptics-lto','settings',today-30,today-3,worker.fwInfo.toString('hex')]);
    assert.equal(service.localSyncGpsAssistance().source,'settings','kept for the connection details');
    const before=writes.length;
    await assert.rejects(service.runLocalSync(()=>service.sendSatelliteFileInSync(parseCepFile(elpoFile(today),CEP_FILES[62]))),/Not available on this watch/);
    assert.equal(writes.slice(before).some(x=>x.operation==='dataFileBlock'),false,'no ELPO to a PACE Pro');
    const files={82:parseCepFile(synapticsFile(today*3600+5,168,2,9000),CEP_FILES[82]),81:parseCepFile(synapticsFile(today*3600+5,4,3,5000),CEP_FILES[81])};
    const sources={cepFile:async spec=>files[spec.serverType]};
    worker.satellite=[];
    const result=await service.runLocalSync(()=>pushSatelliteData(satelliteLink(),sources));
    assert.deepEqual([result.ok,result.files],[true,2]);
    // The RTO first in file 70, then LTO in file 13: each the whole file in an HF header, 4 KB blocks, the start hour in every block header.
    assert.deepEqual(worker.satellite.map(x=>[x.fileId,x.offset]),[[70,0],[70,4096],[13,0],[13,4096],[13,8192]]);
    for(const [id,file] of [[70,files[81]],[13,files[82]]]){
      const blocks=worker.satellite.filter(x=>x.fileId===id);
      const sent=Buffer.concat(blocks.map(x=>x.block));
      assert.deepEqual([sent.subarray(0,2).toString('latin1'),sent[3],sent.readUInt32LE(4),sent.length],['HF',id,file.startSeconds,file.data.length+16]);
      assert.deepEqual(sent.subarray(16),file.data);
      assert.ok(blocks.every(x=>x.extra.join()===[today&255,(today>>8)&255,today>>16].join()&&x.offset+x.remaining===sent.length));
    }
    assert.equal(JSON.stringify(service.localSyncGpsAssistance().sent),JSON.stringify({'synaptics-rto':today,'synaptics-lto':today}));
    // A second sync on the same connection sends nothing, even though the (fake) watch still reports its old data.
    const again=writes.length;
    assert.equal(await service.runLocalSync(()=>pushSatelliteData(satelliteLink(),sources)),undefined);
    assert.equal(writes.slice(again).some(x=>x.operation==='dataFileBlock'),false,'not resent on the same connection');
    // A transfer cut short resets the link (the watch's CRC check keeps it from using half a file).
    worker.satellite=[];const failing=writes.length;
    const realSend=worker.stdin.write;let count=0;
    worker.stdin.write=function(line,callback){const request=JSON.parse(line);
      if(request.operation==='dataFileBlock'&&++count===2){writes.push(request);setTimeout(()=>worker.stdout.emit('data',JSON.stringify({id:request.id,result:{phase:'connected',connected:true},error:'The watch did not accept the file data block.'})+'\n'),2);callback?.();return true;}
      return realSend.call(this,line,callback);};
    await assert.rejects(service.runLocalSync(()=>service.sendSatelliteFileInSync(files[82])),/didn't finish sending/);
    worker.stdin.write=realSend;
    assert.ok(writes.slice(failing).some(x=>x.operation==='disconnect'),'a half-sent satellite file resets the link');
    assert.ok(diagnostics.some(x=>x.source==='corosBle:satelliteData'));
    assert.equal((await service.connect(false,{backend:'system'})).systemBind,'authenticated');
    assert.equal(service.localSyncGpsAssistance().sent,undefined,'a new connection starts afresh');
    // The PACE 4 always reports its key's checksum: 0000 there means it holds no key, so nothing is signed
    // and the card shows the no-key message. (The PACE Pro above signs on 0000, as before.)
    connectModel='COROS W336';await service.disconnect();
    const unsigned=writes.length;
    const noKeyPace4=await service.connect(false,{backend:'system'});
    assert.deepEqual([noKeyPace4.watchModel,noKeyPace4.systemBind,noKeyPace4.authenticationError],['pace-4','failed',BIND_MESSAGES.keyUpdate]);
    assert.equal(writes.slice(unsigned).some(x=>x.opcode===0xa5&&Buffer.from(x.payload,'base64').length>17),false,'no signature for a PACE 4 reporting key 0000');
    assert.equal(diagnostics.at(-1).source,'corosBle:authenticate');assert.match(diagnostics.at(-1).message,/key 0000/);
    await service.disconnect();
    watchKeyCrc=provider.keyId;
    const pace4=await service.connect(false,{backend:'system'});
    assert.deepEqual([pace4.watchModel,pace4.systemBind],['pace-4','authenticated'],'its own key ID is signed');
  }
  // The user's PACE 4 reporting ELPO (hardware variant 1): today's 6-day file in file 13; the PACE 3's second file (68) is refused.
  {
    const worker=workers.at(-1);
    const today=watchHour(Date.now())-1;
    worker.fwInfo=REPORTS.elpo(today-24).settings;worker.satellite=[];
    const elpo=parseCepFile(elpoFile(today),CEP_FILES[62]);
    const result=await service.runLocalSync(()=>pushSatelliteData(satelliteLink(),{cepFile:async spec=>{assert.equal(spec.serverType,62);return elpo;}}));
    assert.deepEqual([result.ok,result.files,result.coveredUntil],[true,1,(1_388_534_400+(today+144)*3600)*1000]);
    assert.deepEqual([...new Set(worker.satellite.map(x=>x.fileId))],[13]);
    assert.equal(worker.satellite.length,Math.ceil((elpo.data.length+16)/4096));
    assert.deepEqual([service.localSyncGpsAssistance().startHour,service.localSyncGpsAssistance().validUntil],[today,(1_388_534_400+(today+144)*3600)*1000],'Connection details: valid until the file runs out');
    await assert.rejects(service.runLocalSync(()=>service.sendSatelliteFileInSync(parseCepFile(elpoFile(today+72,72),CEP_FILES[63]))),/Not available on this watch/);
    // Variant 0 (EPO_GR, no figures): nothing is sent, nothing downloaded.
    worker.fwInfo=REPORTS.epo().settings;
    await service.disconnect();await service.connect(false,{backend:'system'});
    assert.equal(await service.runLocalSync(()=>pushSatelliteData(satelliteLink(),{cepFile:async()=>{throw new Error('no download');}})),undefined);
    worker.fwInfo=undefined;
    connectModel='COROS W332';watchKeyCrc=0;await service.disconnect();
    assert.equal((await service.connect(false,{backend:'system'})).watchModel,'pace-pro');
  }
  // The APEX 4 and PACE 3 (memory-in-pixel, checked against their 3.2008.0 firmware) get the PACE 4's writes:
  // weather on connect, the clock with the watch's own 12/24-hour format, settings and profile. Satellite data
  // only in their own format: LTO (APEX 4) and ELPO (PACE 3), never the other one's files.
  for(const [number,id] of [['COROS W541','apex-4'],['COROS W331','pace-3']]){
    connectModel=number;await service.disconnect();
    const forecast=Buffer.alloc(3000,1);let asked=0;
    service.setConnectedPush(async()=>{asked+=1;return forecast;});
    const computer=new Intl.DateTimeFormat(undefined,{hour:'numeric'}).resolvedOptions().hour12===true?1:0;
    const before=writes.length;
    const next=service.connect(false,{backend:'system'});
    // The watch's bit 13 says the opposite of this computer: the watch's own format is kept.
    workers.at(-1).switchWord=(computer?0x0e2d2085&~(1<<13):0x0e2d2085|1<<13)>>>0;
    const linked=await next;
    assert.equal(linked.watchModel,id);
    assert.equal(asked,1,`${id}: forecast fetched`);
    assert.equal(writes.slice(before).filter(x=>x.operation==='dataFileBlock'&&x.fileId===80).length,1,`${id}: weather sent`);
    assert.equal(Buffer.from(writes.filter(x=>x.opcode===0x8c).at(-1).payload,'base64')[6],computer?0:1,`${id}: the clock keeps the watch's format`);
    const after=writes.length;
    const stored=await service.writeWatchSwitches(Buffer.from([0x85,0x20,0x2d,0x0e]));
    assert.equal(stored.model,id,'the switches come back with the model, for its own fields');
    assert.equal(writes.slice(after).filter(x=>x.opcode===0xa6).length,1,`${id}: settings written`);
    const beforeSatellite=writes.length;
    const today=watchHour(Date.now())-1;
    const foreign=id==='apex-4'?parseCepFile(elpoFile(today),CEP_FILES[62]):parseCepFile(synapticsFile(today*3600),CEP_FILES[82]);
    await assert.rejects(service.runLocalSync(()=>service.sendSatelliteFileInSync(foreign)),/Not available on this watch/);
    assert.equal(writes.slice(beforeSatellite).some(x=>x.operation==='dataFileBlock'),false,`${id}: no satellite data in another format`);
    const own=id==='apex-4'?parseCepFile(synapticsFile(today*3600),CEP_FILES[82]):parseCepFile(elpoFile(today+72,72),CEP_FILES[63]);
    await service.runLocalSync(()=>service.sendSatelliteFileInSync(own));
    assert.deepEqual([...new Set(writes.slice(beforeSatellite).filter(x=>x.operation==='dataFileBlock').map(x=>x.fileId))],[id==='apex-4'?13:68],`${id}: its own format`);
    service.setConnectedPush(async()=>undefined);
  }
  // A watch whose firmware CorosLink hasn't checked (here a NOMAD) keeps its settings, profile and workouts:
  // nothing is written, the clock gets this computer's 12/24-hour format, and no weather is sent.
  {
    connectModel='COROS W942';await service.disconnect();
    const forecast=Buffer.alloc(3000,1);let asked=0;
    service.setConnectedPush(async()=>{asked+=1;return forecast;});
    const computer=new Intl.DateTimeFormat(undefined,{hour:'numeric'}).resolvedOptions().hour12===true?1:0;
    const before=writes.length;
    const next=service.connect(false,{backend:'system'});
    // The watch's bit 13 says the opposite of this computer: a NOMAD's switch layout isn't known, so it isn't used.
    workers.at(-1).switchWord=(computer?0x0e2d2085&~(1<<13):0x0e2d2085|1<<13)>>>0;
    const linked=await next;
    assert.equal(linked.watchModel,'nomad');
    assert.equal(writes.slice(before).some(x=>x.operation==='dataFileBlock'),false,'no weather file');
    assert.equal(asked,0,'no forecast fetched');assert.equal(linked.weatherSentAt,undefined);
    assert.equal(Buffer.from(writes.filter(x=>x.opcode===0x8c).at(-1).payload,'base64')[6],computer,'the clock is set with this computer\'s format');
    const after=writes.length;
    await assert.rejects(service.writeWatchSwitches(Buffer.alloc(4)),/Not available on this watch/);
    await assert.rejects(service.writeWatchProfile(Buffer.from([0x48,0xc2,0x01])),/Not available on this watch/);
    await assert.rejects(service.sendWorkoutToWatch({id:'123',createTimestamp:0}),/Not available on this watch/);
    assert.equal(writes.slice(after).some(x=>x.opcode===0xa6||x.operation==='dataFileBlock'),false,'nothing reaches the watch');
    service.setConnectedPush(async()=>undefined);
    connectModel='COROS W332';await service.disconnect();
    assert.equal((await service.connect(false,{backend:'system'})).watchModel,'pace-pro');
  }
  // Faces and messages go over the computer's Bluetooth on macOS, Windows and Linux alike.
  {
    const preview=await service.prepareWatchface(facePath);
    assert.equal(JSON.stringify(preview).includes(facePath),false);
    const initialSlots=await service.listWatchfaceSlots();
    assert.equal(initialSlots.slots.length,10);assert.equal(initialSlots.slots[0].faceId,99);assert.equal(initialSlots.slots[1].faceId,null);
    assert.equal(initialSlots.prepared.id,preview.id);
    const syncing=service.syncWatchface(preview.id);
    await assert.rejects(service.syncWatchface(preview.id),/current Bluetooth transfer/);
    await assert.rejects(service.sendNotification({title:'CorosLink',body:'interleave'}),/current Bluetooth operation/);
    const during=await service.wifiMapStatus();assert.equal(during.tasks.length,0);
    assert.equal((await syncing).phase,'complete');assert.equal(service.watchfaceSyncStatus().watchSlot,1);
    assert.equal(writes.filter(x=>x.operation==='watchfaceBlock').length,3);
    workers.at(-1).fillFaceSlots();const beforeFull=writes.filter(x=>x.operation==='watchfaceBlock').length;
    await assert.rejects(service.syncWatchface(preview.id),/occupied/);
    assert.equal(writes.filter(x=>x.operation==='watchfaceBlock').length,beforeFull,'full inventory is never overwritten');
    const reading=service.listWatchfaceSlots();assert.equal(reading,service.listWatchfaceSlots(),'deduplicate inventory reads');
    await assert.rejects(service.syncWatchface(preview.id),/current Bluetooth/);
    const fullSlots=await reading;
    const target={inventoryId:fullSlots.id,slot:3,replaceExisting:true};
    const beforeInvalid=writes.length;
    await assert.rejects(service.syncWatchface(preview.id,{...target,inventoryId:'unknown'}),/Refresh/);
    const expiry=service.watchfaceInventory.expires;service.watchfaceInventory.expires=0;
    await assert.rejects(service.syncWatchface(preview.id,target),/Refresh/);
    service.watchfaceInventory.expires=expiry;
    const device=service.state.deviceId;service.state.deviceId='another-watch';
    await assert.rejects(service.syncWatchface(preview.id,target),/Refresh/);
    service.state.deviceId=device;
    assert.equal(writes.length,beforeInvalid,'unknown, expired or wrong-watch selections never issue a command');
    await assert.rejects(service.syncWatchface(preview.id,{...target,replaceExisting:false}),/replacement/);
    assert.equal(writes.filter(x=>x.operation==='watchfaceBlock').length,beforeFull,'replacement must be explicit');
    workers.at(-1).expectedFaceSlot=3;
    assert.equal((await service.syncWatchface(preview.id,target)).phase,'complete');
    assert.deepEqual(workers.at(-1).getFaceSlots(),Array.from({length:10},(_,i)=>i===3?preview.faceId:99),'only selected occupied slot changes');
    assert.equal(service.watchfaceSyncStatus().verification,'inventory-id');
    await assert.rejects(service.syncWatchface(preview.id,target),/Refresh/,'inventory token consumed by transfer');
    const afterReplacement=await service.listWatchfaceSlots();
    workers.at(-1).setFaceSlot(3,777);
    const beforeStale=writes.filter(x=>x.operation==='watchfaceBlock').length;
    await assert.rejects(service.syncWatchface(preview.id,{...target,inventoryId:afterReplacement.id}),/changed/);
    assert.equal(writes.filter(x=>x.operation==='watchfaceBlock').length,beforeStale,'changed slot is never overwritten');
    const sameIdInventory=await service.listWatchfaceSlots();workers.at(-1).setFaceSlot(3,preview.faceId);
    const sameIdFresh=await service.listWatchfaceSlots();
    const sameId=await service.syncWatchface(preview.id,{...target,inventoryId:sameIdFresh.id});
    assert.equal(sameId.verification,'transfer-acknowledged','same-ID replacement cannot prove new contents from inventory alone');
    await assert.rejects(service.syncWatchface(preview.id,{...target,inventoryId:sameIdInventory.id,slot:10}),/Refresh/);
    workers.at(-1).expectedFaceSlot=1;
    workers.at(-1).resetFaceSlots();const cancelled=service.syncWatchface(preview.id);service.cancelWatchfaceSync();
    assert.equal((await cancelled).phase,'cancelled');
    await assert.rejects(service.syncWatchface('arbitrary'),/Choose/);
    assert.ok(writes.some(x=>x.operation==='exchange'&&x.opcode===0x8c),'an authenticated connection sets the watch clock');
    const beforeMessage=writes.length;
    const sentMessage=await service.sendNotification({title:'CorosLink',body:'Test value: 123'});
    assert.equal(sentMessage.sent,true);
    assert.equal(sentMessage.fragments,4);
    assert.equal(writes.length,beforeMessage+1,'notification is send-only, with no ACK request');
    assert.equal(writes.at(-1).operation,'sendNotification');
    assert.equal(Buffer.from(writes.at(-1).frames[0],'base64').toString('hex'),'79038100116f72672e636f726f736c696e6b2e61');
    const pendingMessage=service.sendNotification({title:'CorosLink',body:'Another value'});
    await assert.rejects(service.sendNotification({title:'CorosLink',body:'Interleaved'}),/current Bluetooth operation/);
    await pendingMessage;
    const polling=service.status();
    const afterPoll=service.sendNotification({title:'CorosLink',body:'After status read'});
    await polling;
    assert.equal((await afterPoll).sent,true,'background status polling does not reject a user message');
    workers.at(-1).resetFaceSlots();workers.at(-1).rejectFaceBlocks=true;
    const beforeFailed=writes.length;
    // The error names the helper's failure site and the main-process caller, and carries the recent trail.
    await assert.rejects(service.syncWatchface(preview.id),error=>/rejected/.test(error.message)&&error.name==='CorosBleOperationError'&&
      /at \[bluetooth helper\] main\.swift:481 /.test(error.stack)&&/at .*syncWatchface|at .*corosNativeBleService/.test(error.stack)&&
      error.context.some(line=>/operation=watchfaceBlock .*backend=system/.test(line))&&
      error.context.some(line=>/helper: site=main\.swift:481 .*errorDomain=CBATTErrorDomain errorCode=14/.test(line))&&
      error.context.some(line=>/Z watchfaceBlock failed/.test(line)));
    assert.equal(service.watchfaceSyncStatus().phase,'failed');
    assert.equal(writes.slice(beforeFailed).filter(x=>x.operation==='watchfaceBlock').length,1,'failed block stops the transfer');
    assert.ok(writes.slice(beforeFailed).some(x=>x.operation==='disconnect'),'reset an interrupted file transfer');
    assert.equal((await service.connect(false,{backend:'system'})).systemBind,'authenticated');
  }
  const mapStatus=await service.wifiMapStatus();assert.equal(mapStatus.authenticated,true);assert.equal(mapStatus.supported,true);assert.equal(mapStatus.tasks.length,0);
  const route={id:'route-test',name:'Test trail',createdAt:'2026-10-08T12:00:00Z',distanceMeters:20000,
    points:Array.from({length:1000},(_,i)=>({lat:43+Math.sin(i/80)/200,lon:-79+i/10000}))};
  assert.equal((await service.syncRoute(route)).phase,'complete');
  assert.ok(writes.filter(x=>x.operation==='routeBlock').length>1,'route spans acknowledged blocks');
  const sent=writes.filter(x=>x.operation==='routeBlock').length;
  assert.equal((await service.syncRoute(route)).phase,'complete');
  assert.equal(writes.filter(x=>x.operation==='routeBlock').length,sent,'verified identical route is not uploaded twice');
  await assert.rejects(service.scan(),/Disconnect/);
  workers.at(-1).remoteDisconnect();assert.equal((await service.status()).connected,false);
  assert.equal((await service.connect()).systemBind,'authenticated','remote reconnect waits for old stdio to close');
  assert.equal((await service.refresh()).systemBind,'authenticated');
  // Quitting stops the helper while the window still polls: nothing is written to its closed
  // stdin, and the link the helper ends on its way out is not reported as a dropped watch.
  {
    const worker=workers.at(-1),before=writes.length,logged=diagnostics.length;
    const stopping=service.stop();
    worker.stdout.emit('data',JSON.stringify({event:'disconnected'})+'\n');
    await service.status();
    await stopping;
    assert.equal(writes.length,before,'no request reaches a helper that is shutting down');
    assert.deepEqual(diagnostics.slice(logged),[],'a deliberate stop records no error');
    assert.equal((await service.connect()).systemBind,'authenticated');
    workers.at(-1).stdout.emit('data',JSON.stringify({event:'disconnected',detail:{errorDomain:'CBErrorDomain',errorCode:6}})+'\n');
    assert.deepEqual(diagnostics.slice(logged).map(entry=>entry.source),['corosBle:link'],'a link the watch drops is still reported');
  }
  // Weather on connect: a forecast the watch doesn't take is logged and skipped; the link stays up.
  {
    await service.disconnect();
    const forecast=Buffer.alloc(3000,1);let asked=0;
    service.setConnectedPush(async()=>{asked+=1;return forecast;});
    weatherHeaderTimeout=true;
    const before=writes.length,logged=diagnostics.length;
    const linked=await service.connect(false,{backend:'system'});
    const tried=writes.slice(before);
    assert.equal(asked,1);
    assert.deepEqual(tried.filter(x=>x.operation==='dataFileBlock').map(x=>x.fileId),[80],'one try per connection');
    assert.equal(tried.some(x=>x.operation==='disconnect'),false,'a weather header the watch never answered does not drop the link');
    assert.equal(linked.connected,true);assert.equal(linked.systemBind,'authenticated');
    assert.equal(linked.weatherSentAt,undefined);assert.equal(typeof linked.weatherFailedAt,'number');
    assert.deepEqual(diagnostics.slice(logged).map(entry=>entry.source),['corosBle:weather']);
    assert.equal((await service.status()).connected,true);
    const message=await service.sendNotification({title:'CorosLink',body:'Still linked'});
    assert.equal(message.sent,true,'the watch is still usable');
    weatherHeaderTimeout=false;
    await service.disconnect();
    const resent=await service.connect(false,{backend:'system'});
    assert.equal(typeof resent.weatherSentAt,'number','sent on the next connection');assert.equal(resent.weatherFailedAt,undefined);
    service.setConnectedPush(async()=>undefined);
  }
  assert.equal((await service.disconnect()).connected,false);
  settings.delete('coros.ble.accountAuth');
  settings.set('coros.ble.loginAuth', Buffer.from('encrypted:'+JSON.stringify({version:1,
    accountUserId:'1',privateKeyDer:credential.privateKeyDer,unit:1,dataCollectSwitch:7})).toString('base64'));
  const loginConnected=await service.connect(false,{backend:'system',device:{deviceId:'os-id',deviceName:credential.deviceName}});
  assert.equal(loginConnected.systemBind,'authenticated','a normal login key authenticates without any imported profile or key');
  assert.equal(JSON.stringify(loginConnected).includes(credential.privateKeyDer),false);
  assert.equal(writes.filter(x=>x.opcode===0xa5).at(-2).payload.length>0,true);
  await service.disconnect();
  const offlineService=new exports.CorosNativeBleService();
  const offlineConnected=await offlineService.connect(false,{backend:'system'});
  assert.equal(offlineConnected.systemBind,'authenticated','a new app instance authenticates from the saved key without a cloud session or password');
  assert.deepEqual(credentialReads,[],'offline Bluetooth authentication does not use account login credentials');
  await offlineService.disconnect();
  noKeyReply=true;
  const refused=await offlineService.connect(false,{backend:'system'});
  assert.equal(refused.systemBind,'failed');assert.match(refused.authenticationError,/key update/);
  assert.equal(refused.authenticationError.includes('status'),false,'the card keeps the plain message');
  const logged=diagnostics.at(-1);assert.equal(logged.source,'corosBle:authenticate');
  assert.match(logged.message,/key update.*\[COROS W332 V 3\.2008\.0; watch reply status 5 \(0x35\), flags 0x04: no key, auth type 0, challenge, key 0000, reason 0\]/);
  assert.equal(logged.message.includes('live'),false,'error reports never carry the watch nonce');
  await offlineService.disconnect();noKeyReply=false;
  // The watch's key checksum is compared before anything is signed, and each outcome is
  // remembered by key ID for Connection details (no key material in the record).
  const keyId=formatCorosWatchKeyId(provider.keyId);
  const keyCheck=()=>JSON.parse(settings.get('coros.ble.watchKeyCheck'));
  watchKeyCrc=provider.keyId;
  assert.equal((await offlineService.connect(false,{backend:'system'})).systemBind,'authenticated','a matching key checksum signs');
  assert.equal(keyCheck().lastUsed.keyId,keyId);assert.equal(keyCheck().lastUsed.watch,credential.deviceName);
  assert.equal(keyCheck().problem,undefined);
  assert.equal(settings.get('coros.ble.watchKeyCheck').includes(credential.privateKeyDer),false);
  await offlineService.disconnect();
  watchKeyCrc=provider.keyId^0x55;
  const signedBefore=writes.filter(x=>x.opcode===0xa5&&Buffer.from(x.payload,'base64').length>17).length;
  const mismatched=await offlineService.connect(false,{backend:'system'});
  assert.equal(mismatched.systemBind,'failed');assert.equal(mismatched.authenticationError,BIND_MESSAGES.keyMismatch);
  assert.equal(writes.filter(x=>x.opcode===0xa5&&Buffer.from(x.payload,'base64').length>17).length,signedBefore,'a different key on the watch is never signed for');
  assert.equal(keyCheck().problem.result,'mismatch');assert.equal(keyCheck().problem.keyId,keyId);
  assert.equal(keyCheck().lastUsed.keyId,keyId,'the last success is kept');
  await offlineService.disconnect();
  watchKeyCrc=0;rejectSignature=true;
  const rejected=await offlineService.connect(false,{backend:'system'});
  assert.equal(rejected.systemBind,'failed');assert.equal(rejected.authenticationError,BIND_MESSAGES.keyRejected);
  assert.equal(keyCheck().problem.result,'rejected');
  assert.match(diagnostics.at(-1).message,/reason 4\]/);
  await offlineService.disconnect();rejectSignature=false;
  assert.equal((await offlineService.connect(false,{backend:'system'})).systemBind,'authenticated');
  assert.equal(keyCheck().problem,undefined,'a success clears the problem');
  await offlineService.disconnect();
  settings.delete('coros.ble.loginAuth');
  settings.set('coros.credentials','encrypted-saved-account');
  settings.set('trainingHub.credentials','encrypted-legacy-saved-account');
  credentialReads.length=0;
  const basic=await service.connect(false,{backend:'system',device:{deviceId:'os-id',deviceName:credential.deviceName}});
  assert.equal(basic.systemBind,'unavailable','new users can read device information before signing in');
  assert.match(basic.authenticationError,/Sign in/);
  assert.equal(settings.has('coros.ble.loginAuth'),false,'connecting does not recreate a cleared account key');
  assert.deepEqual(credentialReads,[],'connecting does not use remembered account credentials to log in');
  const beforeNotification=writes.length;
  const directPreview=await service.prepareWatchface(facePath);
  await assert.rejects(service.listWatchfaceSlots(),/authenticate/);
  await assert.rejects(service.syncWatchface(directPreview.id),/authenticate/);
  await assert.rejects(service.sendNotification({title:'CorosLink',body:'Test value: 123'}),/authenticate/);
  assert.equal(writes.length,beforeNotification,'no notification reaches an unauthenticated watch');
  const beforeMaps=writes.length;assert.equal((await service.wifiMapStatus()).authenticated,false);
  await assert.rejects(service.previewWifiMap([{x:64,y:64}]),/authenticate/);
  assert.equal(writes.length,beforeMaps,'no map commands reach an unauthenticated watch');
  const beforeRoute=writes.filter(x=>x.operation==='routeBlock'||x.operation==='exchange').length;
  await assert.rejects(service.syncRoute(route),/authenticate/);
  assert.equal(writes.filter(x=>x.operation==='routeBlock'||x.operation==='exchange').length,beforeRoute,'no route data reaches an unauthenticated watch');
  await service.disconnect();
  const stillBasic=await service.connect(false,{backend:'system'});
  assert.equal(stillBasic.systemBind,'unavailable','reconnecting also waits for explicit sign-in');
  assert.equal(settings.has('coros.ble.loginAuth'),false);
  assert.deepEqual(credentialReads,[],'reconnecting does not use remembered account credentials');
  await service.disconnect();
  assert.ok(writes.some(x=>x.operation==='exchange'));
  // The watch's Bluetooth identity: remembered on the first connection the user makes that the watch accepts,
  // and checked before the sign-in challenge is answered or anything else is sent.
  {
    const WATCH='5A1E3C2B-0D4F-4E6A-9B7C-1D2E3F405162',OTHER='9F8E7D6C-5B4A-4392-8170-6F5E4D3C2B1A';
    settings.set('coros.ble.accountAuth',Buffer.from('encrypted:'+JSON.stringify(credential)).toString('base64'));
    settings.delete('coros.ble.watchIdentity');
    const watch=new exports.CorosNativeBleService();
    let confirmed=0;watch.onWatchConfirmed(()=>{confirmed+=1;});
    const pin=()=>JSON.parse(settings.get('coros.ble.watchIdentity')??'{}').system;
    const since=at=>writes.slice(at);
    const signed=at=>since(at).some(x=>x.operation==='exchange');
    const leaks=list=>list.some(entry=>[WATCH,OTHER,WATCH.toLowerCase(),OTHER.toLowerCase()].some(id=>entry.message.includes(id)));
    // Nothing remembered: background sync neither connects nor authenticates.
    nearby=[WATCH];
    assert.equal(watch.watchIdentityForBackgroundSync(),'unpinned');
    let at=writes.length;
    await assert.rejects(watch.connectForBackgroundSync(),error=>error.watchIdentity==='unpinned');
    assert.equal(since(at).length,0,'no connection without a remembered identity');
    // A connection CorosLink makes for a task (a workout, a route) doesn't remember the watch; only the user's does.
    await watch.connect(false,{backend:'system'});
    assert.equal(pin(),undefined,'only a connection the user made remembers the watch');
    await watch.disconnect();
    // First manual connect that authenticates: pinned with the name, model and backend (an existing remembered watch included).
    settings.set('coros.ble.systemDevice',JSON.stringify({deviceName:credential.deviceName,deviceId:WATCH}));
    at=writes.length;let logged=notices.length;
    const first=await watch.userConnect(false,{backend:'system'});
    assert.equal(first.systemBind,'authenticated');
    assert.deepEqual([pin().deviceId,pin().deviceName,pin().modelNumber,pin().model],[WATCH,credential.deviceName,'COROS W332','pace-pro']);
    assert.equal(confirmed,1,'background sync resumes after a manual connection');
    assert.deepEqual(notices.slice(logged).map(entry=>[entry.source,entry.level]),[['corosBle:identity','info']]);
    assert.match(notices.at(-1).message,/system, id#[0-9a-f]{8}\)/);
    assert.equal(watch.watchIdentityForBackgroundSync(),'ok');
    await watch.disconnect();
    // Background sync to the remembered watch: the helper is told to connect to that identity only.
    at=writes.length;
    assert.equal((await watch.connectForBackgroundSync()).systemBind,'authenticated');
    assert.equal(since(at).find(x=>x.operation==='connect').pinnedId,WATCH);
    assert.equal(confirmed,1,'a background connection is not the user\'s');
    await watch.disconnect();
    // Only another device with the name nearby: a manual connect asks first; nothing is signed or sent.
    nearby=[OTHER];at=writes.length;logged=notices.length;
    const asked=await watch.userConnect(false,{backend:'system'});
    assert.deepEqual([asked.identityMismatch,asked.connected,asked.systemBind==='authenticated'],[true,false,false]);
    assert.deepEqual(since(at).map(x=>x.operation),['connect'],'nothing after the refused connect');
    assert.equal(since(at)[0].pinnedId,WATCH);
    assert.equal(pin().deviceId,WATCH,'not re-pinned without the user');
    assert.deepEqual(notices.slice(logged).map(entry=>[entry.source,entry.level]),[['corosBle:identity','warning']]);
    assert.match(notices.at(-1).message,/remembered id#[0-9a-f]{8}, found id#[0-9a-f]{8}/);
    assert.equal(diagnostics.some(entry=>entry.source==='corosBle:connect'),false,'not an error');
    // Cancel (the menu disconnects): the question goes away.
    assert.equal((await watch.disconnect()).identityMismatch,undefined);
    // A helper that connected by name anyway: CorosLink checks again before answering the challenge.
    ignorePin=true;at=writes.length;
    assert.equal((await watch.userConnect(false,{backend:'system'})).identityMismatch,true);
    assert.deepEqual(since(at).map(x=>x.operation),['connect'],'no challenge signed, no clock, weather or sync for the other device');
    ignorePin=false;
    // App-started and background connections fail instead of asking, and send nothing.
    at=writes.length;
    await assert.rejects(watch.connect(false,{backend:'system'}),error=>error.watchIdentity==='mismatch');
    await assert.rejects(watch.connectForBackgroundSync(),error=>error.watchIdentity==='mismatch');
    assert.equal(signed(at),false);
    // "Connect anyway": the new identity (a reset or replaced watch) is trusted, pinned, and connected.
    assert.equal((await watch.userConnect(false,{backend:'system'})).identityMismatch,true);
    at=writes.length;logged=notices.length;
    const anyway=await watch.userConnect(false,{backend:'system',confirmIdentity:true});
    assert.deepEqual([anyway.connected,anyway.systemBind,anyway.deviceId,anyway.identityMismatch],[true,'authenticated',OTHER,undefined]);
    assert.equal(since(at).find(x=>x.operation==='connect').pinnedId,OTHER,'to the device the user confirmed only');
    assert.equal(pin().deviceId,OTHER);
    assert.equal(confirmed,2);
    assert.deepEqual(notices.slice(logged).map(entry=>[entry.level,/changed .*id#[0-9a-f]{8} to id#[0-9a-f]{8}/.test(entry.message)]),[['warning',true]]);
    await watch.disconnect();
    // A "Connect anyway" with nothing refused just now is an ordinary connection.
    nearby=[WATCH];
    assert.equal((await watch.userConnect(false,{backend:'system',confirmIdentity:true})).identityMismatch,true,'the old identity is no longer trusted');
    await watch.disconnect();
    // Several devices share the name: the remembered one is marked and used; choosing another asks before connecting.
    nearby=[WATCH,OTHER];
    const scanned=await watch.scan();
    assert.deepEqual(Array.from(scanned.discoveredDevices,device=>[device.deviceId,device.remembered]),[[WATCH,false],[OTHER,true]]);
    at=writes.length;
    assert.equal((await watch.userConnect(false,{backend:'system',device:{deviceId:WATCH,deviceName:credential.deviceName}})).identityMismatch,true);
    assert.equal(since(at).some(x=>x.operation==='connect'),false,'a chosen device that isn\'t the remembered one is not connected to');
    at=writes.length;
    const chosen=await watch.userConnect(false,{backend:'system'});
    assert.deepEqual([chosen.deviceId,chosen.systemBind],[OTHER,'authenticated']);
    assert.equal(since(at).find(x=>x.operation==='connect').pinnedId,OTHER);
    await watch.disconnect();
    assert.equal(leaks(notices),false,'identity notices carry short tags, never the identifiers');
    assert.equal(leaks(diagnostics),false);
    settings.delete('coros.ble.accountAuth');nearby=['os-id'];
  }
  console.log(platform+': discovery, native transport selection, fresh authentication, key isolation, OS status, reconnect and the remembered watch identity passed.');
}
// Satellite files are independent: on an LTO watch (PACE 4), an RTO that can't be downloaded (offline,
// with the cached LTO still valid) or sent doesn't keep the LTO from the watch.
{
  const {applyFwInfoGpsAssistance,decodeBindGpsAssistance}=require('./corosWatchGpsAssist.js');
  const start=watchHour(Date.now())-10;
  const report=REPORTS.lto(start-40,start-6);
  const assist=applyFwInfoGpsAssistance(decodeBindGpsAssistance(report.bind),report.settings);
  const lto=parseCepFile(synapticsFile(start*3600,168,2,9000),CEP_FILES[82]),rto=parseCepFile(synapticsFile(Date.now()/1000|0,4,3,5000),CEP_FILES[81]);
  for(const [failing,expectSent] of [['download',[82]],['send',[82]]]){
    const sent=[];
    const link={model:()=>'pace-4',readAssistance:async()=>assist,sendFile:async file=>{if(failing==='send'&&file.serverType===81)throw new Error("The satellite data didn't finish sending. Sync again to send it.");sent.push(file.serverType);}};
    const result=await pushSatelliteData(link,{cepFile:async spec=>{if(spec.serverType===81&&failing==='download')throw new TypeError('fetch failed');return spec.serverType===81?rto:lto;}});
    assert.deepEqual(sent,expectSent,`${failing}: the LTO still goes`);
    assert.deepEqual([result.ok,result.files,typeof result.coveredUntil,result.error.length>0],[false,1,'number',true],`${failing}: reported as partial`);
  }
  const sent=[];
  const both=await pushSatelliteData({model:()=>'pace-4',readAssistance:async()=>assist,sendFile:async file=>{sent.push(file.serverType);}},{cepFile:async spec=>spec.serverType===81?rto:lto});
  assert.deepEqual([both.ok,both.files,both.error,sent],[true,2,undefined,[81,82]]);
}
// Plan-replacement consent can be turned off again (main window only); off, the next sync asks first.
{
  const file=path.resolve('dist-electron/privacy/localOnlyMain.js');
  const settings=new Map(),handlers=new Map(),calls=[];const exports={};
  const any=new Proxy(function(){},{get:(_,key)=>key==='then'?undefined:any,apply:()=>any,construct:()=>any});
  const window={isDestroyed:()=>false,webContents:{send:()=>{}}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,console,setTimeout,clearTimeout,require(id){
    if(id==='node:path')return path;
    if(id==='electron')return {app:{getPath:()=>'/tmp/coroslink-test',getVersion:()=>'0',once:()=>{}},dialog:any};
    if(id==='../database')return {getSetting:k=>settings.get(k),setSetting:(k,v)=>settings.set(k,v),deleteSettings:keys=>keys.forEach(k=>settings.delete(k)),requireDatabase:()=>any};
    if(id==='../diagnosticsService')return {diagnosticIpcMain:{handle:(channel,handler)=>handlers.set(channel,handler)},recordDiagnosticNotice:()=>{}};
    if(id==='../mainWindowGuard')return {requireMainWindowSender:(event,expected,message)=>{if(event.sender!==expected)throw new Error(message);return expected;}};
    if(id==='../localSync/syncCapture')return {syncCaptureEnabled:()=>false,SyncCaptureLog:any};
    if(id==='../corosNativeBleService')return {corosNativeBle:new Proxy({},{get:(_,key)=>(...args)=>{calls.push(String(key));return key==='resetLinkInSync'?Promise.resolve():undefined;}})};
    if(id==='../localSync/localDataService')return {LocalDataService:class{constructor(options){this.options=options;}cancelSync(){calls.push('cancelSync');}redecodeArchivedPayloads(){return Promise.resolve(0);}}};
    if(id==='../watchAutoSyncService')return {WatchAutoSync:class{start(){}resume(){}stop(){}},autoSyncState:any,setAutoSync:any};
    return any;
  }},{filename:file});
  const localData=exports.registerLocalOnlyMode({getWindow:()=>window});
  const main={sender:window},other={sender:{}};
  const invoke=(channel,event,...args)=>handlers.get(channel)(event,...args);
  assert.equal(invoke('localData:getWatchPlanReplacement',main),false,'asks by default');
  assert.equal(localData.options.watchCalendar.replaceForeignPlan(),false);
  await invoke('localData:allowWatchPlanReplacement',main);
  assert.equal(invoke('localData:getWatchPlanReplacement',main),true);
  assert.equal(localData.options.watchCalendar.replaceForeignPlan(),true,'the sync replaces a foreign plan once allowed');
  assert.equal(invoke('localData:setWatchPlanReplacement',main,false),false,'turned off again');
  assert.equal(settings.has('watch.planReplacement'),false);
  assert.equal(localData.options.watchCalendar.replaceForeignPlan(),false,'the next sync asks again');
  assert.equal(invoke('localData:setWatchPlanReplacement',main,true),true);
  for(const channel of ['localData:getWatchPlanReplacement','localData:setWatchPlanReplacement','localData:allowWatchPlanReplacement'])
    assert.throws(()=>invoke(channel,other,false),/only available in the CorosLink window/,channel);
  assert.equal(settings.get('watch.planReplacement'),'allowed','another window changes nothing');
  assert.throws(()=>invoke('localData:setWatchPlanReplacement',main,'no'),/Invalid/);
  // Inside a sync, a failed block resets the link without waiting for the sync; Disconnect and quit stop its reads.
  await localData.options.link.disconnect();
  assert.ok(calls.includes('resetLinkInSync')&&!calls.includes('disconnect'));
  assert.ok(calls.includes('setLocalSyncCancel'));
}
fs.rmSync(facePath);
