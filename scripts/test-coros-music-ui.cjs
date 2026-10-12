const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs/promises');
const {app,BrowserWindow}=require('electron');
const temp=path.join(os.tmpdir(),`coros-music-ui-${process.pid}`);
app.setPath('userData',path.join(temp,'user-data'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const {createServer}=await import('vite');const react=(await import('@vitejs/plugin-react')).default;
 const vite=await createServer({root:path.resolve(__dirname,'..'),configFile:false,plugins:[react()],cacheDir:path.join(temp,'vite'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
 await vite.listen();const win=new BrowserWindow({show:false,width:500,height:620});const errors=[];
 win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
 const js=expression=>win.webContents.executeJavaScript(expression,true);
 async function until(expression){for(let i=0;i<100;i++){if(await js(`!!(${expression})`))return;await new Promise(r=>setTimeout(r,50));}throw Error(`Timed out: ${expression}`);}
 async function click(){await js("document.querySelector('.ble-music-toolbar button').click();void 0");await until('window.completeMusicRead');}
 async function complete(){await js('window.completeMusicRead();window.completeMusicRead=null;void 0');await until("!document.querySelector('.ble-music-toolbar button').disabled");}
 async function bluetooth(){await js("document.querySelector('[aria-label=\"Watch music connection\"] button:last-child').click();void 0");await until("document.querySelector('.ble-music-toolbar button')");}
 async function deleteClick(){await js("document.querySelector('.ble-music-delete').click();void 0");await until('window.completeMusicDelete');}
 async function completeDelete(){await js('window.completeMusicDelete();window.completeMusicDelete=null;void 0');await until("!document.querySelector('.ble-music-toolbar button').disabled");}
 const connected={connected:true,deviceId:'watch-one',deviceName:'COROS PACE Pro TEST'};
 async function setConnection(value){await js(`window.setMusicConnection(${JSON.stringify(value)});void 0`);}
 try {
  await win.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/coros-music.html`);
  await until("document.querySelector('.library-panel-header')");
  assert.equal(await js("document.querySelector('[aria-label=\"Watch music connection\"]')"),null,'disconnected BLE offers no alternate view');
  assert.equal(await js("document.querySelector('.ble-music-toolbar')"),null);
  assert.ok(await js("document.body.textContent.includes('Connect a COROS watch')"));
  await setConnection(connected);await until("document.querySelector('[aria-label=\"Watch music connection\"]')");
  assert.equal(await js("document.querySelector('[aria-label=\"Watch music connection\"] button:first-child').getAttribute('aria-pressed')"),'true','USB remains the default with BLE connected');
  assert.equal(await js("document.querySelector('.ble-music-toolbar')"),null);
  assert.deepEqual(await js('window.musicCalls'),[]);
  await bluetooth();assert.deepEqual(await js('window.musicCalls'),[],'selecting Bluetooth does not start a read or connection');
  await click();
  assert.equal(await js("document.querySelector('.ble-music-toolbar button').disabled"),true);
  await complete();assert.equal(await js("document.querySelectorAll('.ble-music-list li').length"),2);
  assert.equal(await js("document.querySelector('.library-panel-header em').textContent"),'2 tracks');
  assert.equal(await js("document.querySelectorAll('.ble-music-delete').length"),2,'connected optional view offers individual Bluetooth deletes');
  assert.equal(await js("document.querySelectorAll('input[type=checkbox]').length"),0);
  await deleteClick();
  assert.equal(await js("document.querySelector('.ble-music-toolbar button').disabled"),true);
  assert.ok(await js("[...document.querySelectorAll('.ble-music-delete')].every(b=>b.disabled)"),'serialize row actions while awaiting confirmation/deletion');
  await completeDelete();assert.equal(await js("document.querySelectorAll('.ble-music-list li').length"),2,'cancelled confirmation preserves rows');
  assert.equal(await js("document.querySelector('.ble-music-note[role=status]')"),null,'cancel never reports success');
  const deleteCall=(await js('window.musicCalls')).find(c=>c.operation==='delete');
  assert.deepEqual(deleteCall.target,{inventoryId:'music-test',watchId:1,watchPath:'/emmc2:/Music/Café & trail.mp3'});
  await js('window.musicDeleteError="Error invoking remote method \'corosBle:deleteMusic\': Error: Stop playing this track on the watch before deleting it.";void 0');
  await deleteClick();await completeDelete();
  assert.ok(await js("document.querySelector('[role=alert]').textContent.startsWith('Stop playing')"));
  assert.equal(await js("document.querySelectorAll('.ble-music-delete').length"),0,'failure requires refreshing inventory before another deletion');
  await js('window.musicDeleteError="";void 0');await click();await complete();
  await js('window.musicDeleteConfirmed=true;void 0');await deleteClick();await completeDelete();
  assert.equal(await js("document.querySelectorAll('.ble-music-list li').length"),1,'verified result updates rows');
  assert.ok(await js("document.querySelector('[role=status]').textContent.includes('Deleted “Café & trail.mp3”')"));
  await js("(()=>{const i=document.querySelector('[aria-label=\"Search watch music\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'episode');i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await until("document.querySelectorAll('.ble-music-list li').length===1");
  assert.ok(await js("document.querySelector('.ble-music-list li').textContent.includes('Episode.mp3')"));
  await js("window.musicError=\"Error invoking remote method 'corosBle:musicInventory': Error: Watch disconnected\";void 0");await click();await complete();
  assert.equal(await js("document.querySelector('[role=alert]').textContent"),'Watch disconnected');
  assert.equal(await js("document.querySelectorAll('.ble-music-list li').length"),0,'failed refresh does not retain stale tracks');
  await js("window.musicError='';window.musicResponse.tracks=[];void 0");await click();await complete();
  assert.ok(await js("document.body.textContent.includes('No MP3 files on the watch')"));
  await click();
  await setConnection({connected:false});await until("!document.querySelector('[aria-label=\"Watch music connection\"]')");
  assert.equal(await js("document.querySelector('.ble-music-toolbar')"),null,'disconnect removes Bluetooth view immediately');
  await js('window.completeMusicRead();window.completeMusicRead=null;void 0');
  await setConnection(connected);await until("document.querySelector('[aria-label=\"Watch music connection\"]')");
  assert.equal(await js("document.querySelector('.ble-music-toolbar')"),null,'reconnect requires opting in again, including after a pending read');
  await js("window.musicResponse={id:'pending-delete',checkedAt:Date.now(),tracks:[{name:'Pending.mp3',watchPath:'/emmc2:/Music/Pending.mp3',sizeBytes:1024,watchId:3}]};void 0");
  await bluetooth();await click();await complete();await deleteClick();
  await setConnection({connected:false});await until("!document.querySelector('[aria-label=\"Watch music connection\"]')");
  assert.equal(await js("document.querySelector('.ble-music-delete')"),null,'disconnect hides delete controls');
  await js('window.completeMusicDelete();window.completeMusicDelete=null;void 0');
  await setConnection(connected);await until("document.querySelector('[aria-label=\"Watch music connection\"]')");
  assert.equal(await js("document.querySelector('.ble-music-toolbar')"),null,'late delete result cannot opt back into Bluetooth');
  const readCount=(await js('window.musicCalls')).length;
  await js('window.setUsbConnected(true);void 0');await until("document.body.textContent.includes('USB track.mp3')");
  assert.ok(await js("document.querySelector('button[title*=Delete]')"),'USB actions remain available with both connections');
  await bluetooth();assert.equal(await js("document.querySelector('button[title*=Delete]')"),null,'Bluetooth cannot use USB row actions');
  await js("document.querySelector('[aria-label=\"Watch music connection\"] button:first-child').click();void 0");
  await until("document.body.textContent.includes('USB track.mp3')");
  assert.equal((await js('window.musicCalls')).length,readCount,'switching views never starts a read');
  await bluetooth();await setConnection({...connected,deviceId:'watch-two'});
  await until("!document.querySelector('.ble-music-toolbar')");
  assert.ok(await js("document.body.textContent.includes('USB track.mp3')"),'changing watch resets the optional view');
  await bluetooth();
  const calls=await js('window.musicCalls');assert.ok(calls.every(c=>['read','delete'].includes(c.operation)),'music panel never connects implicitly');
  await win.setSize(320,620);
  assert.ok(await js('document.documentElement.scrollWidth<=window.innerWidth'),'narrow layout');
  assert.deepEqual(errors,[]);console.log('Bluetooth music UI: optional connected-only delete controls, cancellation, refusal, verified rows, pending deletion/disconnect, USB default, read/refresh, search, errors and narrow layout passed.');
 }finally{win.destroy();await vite.close();await fs.rm(temp,{recursive:true,force:true});}
 app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
