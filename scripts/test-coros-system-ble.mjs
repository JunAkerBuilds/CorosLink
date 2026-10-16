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
const {CorosBleAccountAuth,crc32Mpeg2,describeBindReply}=require('./corosBleAuth.js');
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
  error.reply==='status 5 (0x35), flags 0x04: no key, auth type 0, challenge'&&!error.reply.includes('nonc'));
assert.equal(describeBindReply(Buffer.alloc(3)),'3-byte reply');

for(const platform of ['darwin','win32','linux']) {
  const settings=new Map([['coros.ble.accountAuth',Buffer.from('encrypted:'+JSON.stringify(credential)).toString('base64')]]);
  const workers=[],writes=[],credentialReads=[],diagnostics=[];const exports={};let noKeyReply=false;
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{exports,Buffer,Error,setTimeout,clearTimeout,
    process:{platform,arch:'x64',env:{BUMBLE_SNOOPER:'unsafe',BUMBLE_LOGLEVEL:'DEBUG'},resourcesPath:'/resources'},
    require(id){
      if(id==='electron')return {app:{isPackaged:false,getAppPath:()=>'/project'},safeStorage:{isEncryptionAvailable:()=>true,
        encryptString:t=>Buffer.from('encrypted:'+t),decryptString:b=>b.toString().slice(10)}};
      if(id==='./diagnosticsService')return {recordDiagnosticError:(source,error)=>diagnostics.push({source,message:error.message})};
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
        worker.stdin={write(line,callback){
          const request=JSON.parse(line);writes.push(request);
          assert.equal(line.includes(credential.privateKeyDer),false,'system workers never receive the account key');
          let payload, responseError;
          if(request.operation==='scan')state={...state,discoveredDevices:[{deviceId:'os-id',deviceName:credential.deviceName}]};
          if(request.operation==='connect')state={...state,phase:'connected',connected:true,deviceName:request.deviceName,deviceId:'os-id',modelNumber:'COROS W332',softwareRevision:'V 3.2008.0'};
          if(request.operation==='exchange') {
            const data=Buffer.from(request.payload,'base64');
            if(request.opcode===0xb2)payload=Buffer.from([1,0]);
            else if(request.opcode===0xb6){assert.equal(data.toString('hex'),'0bff');payload=Buffer.from([1,0]);}
            else if(request.opcode===0xaa) {
              assert.equal(data.toString('hex'),'00');
              payload=Buffer.alloc(storedRoute?19:6);Buffer.from([0,100,storedRoute?1:0,13,0,0]).copy(payload);
              if(storedRoute){payload[6]=storedRoute.slot;payload.writeBigUInt64LE(storedRoute.id,7);payload.writeUInt16LE(storedRoute.crc,15);}
            }
            else if(request.opcode===0x96) {assert.equal(data.toString('hex'),'00','inventory request must have a logical payload byte');payload=Buffer.alloc(40);faceIds.forEach((id,i)=>payload.writeUInt32LE(id,i*4));}
            else {
              payload=Buffer.alloc(17);
              if(data.length===17){payload[0]=0x35;payload[9]=noKeyReply?4:5;Buffer.from('live').copy(payload,11);}
              else {assert.equal(verify('sha256',Buffer.concat([Buffer.from('live'),data.subarray(281,289)]),publicKey,data.subarray(25,281)),true);payload[0]=0x31;}
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
            if(worker.rejectFaceBlocks) responseError='The watch rejected the file data block.';
            faceFile=Buffer.concat([faceFile,block]);
            if(header.readUInt32LE(9)===block.length) {faceIds[header[16]]=faceFile.readUInt32LE(20);faceFile=Buffer.alloc(0);}
          }
          if(request.operation==='disconnect')state={...state,phase:'disconnected',connected:false};
          setTimeout(()=>worker.stdout.emit('data',JSON.stringify({id:request.id,result:state,error:responseError,payload:payload?.toString('base64')})+'\n'),2);callback?.();
        },end(){worker.emit('exit',0);setTimeout(()=>worker.emit('close',0),5);}};
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
    await assert.rejects(service.syncWatchface(preview.id),/rejected/);
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
  assert.match(logged.message,/key update.*\[COROS W332 V 3\.2008\.0; watch reply status 5 \(0x35\), flags 0x04: no key, auth type 0, challenge\]/);
  assert.equal(logged.message.includes('live'),false,'error reports never carry the watch nonce');
  await offlineService.disconnect();noKeyReply=false;
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
  console.log(platform+': discovery, native transport selection, fresh authentication, key isolation, OS status, and reconnect passed.');
}
fs.rmSync(facePath);
