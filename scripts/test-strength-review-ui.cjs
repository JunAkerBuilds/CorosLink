const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const root=path.resolve(__dirname,'..');
const temporaryRoot=path.join(os.tmpdir(),`coroslink-strength-review-${process.pid}`);
app.setPath('userData',path.join(temporaryRoot,'user-data'));
app.on('window-all-closed',()=>{});
async function until(read,accept,label){const deadline=Date.now()+15000;while(Date.now()<deadline){const v=await read();if(accept(v))return v;await new Promise(r=>setTimeout(r,30));}throw new Error(`Timed out: ${label}`);}
async function main(){
 await app.whenReady();
 const {createServer}=await import('vite'); const react=(await import('@vitejs/plugin-react')).default;
 const {program}=await import('./fixtures/strength-workout.mjs');
 const {WorkoutEditService}=require('../dist-electron/workoutEditService.js');
 const database=require('../dist-electron/database.js');
 const history=require('../dist-electron/chatHistoryStore.js');
 const db=database.initializeDatabase(app.getPath('userData'));
 const sources=new Map(['1','2'].map(id=>[id,{ref:{kind:'library',programId:id},program:{...program(id),name:`Kettlebell ${id}`}}]));
 const calls=[];let release;const gate=new Promise(r=>release=r);
 const adapter={account:()=> 'test',today:()=> '20260921',read:async ref=>structuredClone(sources.get(ref.programId)),find:async()=>({refs:[],exclusions:[]}),preview:async(_s,p)=>p,write:async(s,p)=>{calls.push(s.ref.programId);await gate;sources.set(s.ref.programId,{...s,program:p});},load:()=>database.getSetting('strength-test'),persist:v=>database.setSetting('strength-test',v),wait:async()=>{}};
 let service=new WorkoutEditService(adapter);
 const docs=await Promise.all(['1','2'].map(programId=>service.tool('read_workout_for_edit',{ref:{kind:'library',programId}})));
 const p=await service.tool('prepare_exercise_load_update',{documents:docs.map(d=>({documentId:d.documentId,revision:d.revision})),exerciseIds:['kb-swing'],oldLoad:{value:26,unit:'lb'},newLoad:{value:36,unit:'lb'}});
 const session=history.createChatSession('chatgpt');history.saveChatSession(session.id,[{kind:'workoutEdit',preview:p}]);assert.equal(history.getChatSession(session.id)[0].preview.proposalId,p.proposalId,'card survives chat persistence');
 ipcMain.handle('workoutEdits:list',()=>service.list());ipcMain.handle('workoutEdits:status',(_e,id)=>service.status(id));ipcMain.handle('workoutEdits:confirm',(_e,input)=>service.confirm(input.proposalId,input.reviewHash,input.selectedIds));ipcMain.handle('workoutEdits:cancel',(_e,proposalId)=>service.tool('cancel_workout_edit',{proposalId}));
 let window,vite;const errors=[];const watchdog=setTimeout(()=>app.exit(1),90000);
 try {
  vite=await createServer({root,configFile:false,plugins:[react()],cacheDir:path.join(temporaryRoot,'vite-cache'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await vite.listen();
  window=new BrowserWindow({show:false,width:900,height:1000,webPreferences:{preload:path.join(root,'dist-electron/preload.js'),sandbox:false,contextIsolation:true}});
  window.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  const url=`http://127.0.0.1:${vite.httpServer.address().port}/scripts/fixtures/strength-review.html`;
  await window.loadURL(url);
  const text=()=>window.webContents.executeJavaScript('document.body.innerText');
  await until(text,t=>t.includes('Save 2 to COROS'),'review loaded');assert.equal(calls.length,0);
  await until(()=>window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Save 2")&&!b.disabled)'),Boolean,'review revalidated');
  assert.match(await text(),/36 lb/);
  await window.webContents.executeJavaScript('document.querySelectorAll("input[type=checkbox]")[1].click()');await until(text,t=>t.includes('Save 1 to COROS'),'selection updates');
  await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Save 1")).click()');
  await until(()=>Promise.resolve(calls.length),n=>n===1,'write started');
  assert.equal(await window.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Saving")).disabled'),true);
  release();await until(text,t=>t.includes('1 of 1 selected workouts verified'),'verified result');assert.deepEqual(calls,['1']);
  const screenshot=path.join(temporaryRoot,'strength-review.png');await fs.writeFile(screenshot,(await window.webContents.capturePage()).toPNG());
  service=new WorkoutEditService(adapter);await window.reload();await until(text,t=>t.includes('1 of 1 selected workouts verified'),'restored result');assert.equal(calls.length,1);
  assert.equal(errors.filter(e=>!e.includes('Electron Security Warning')).length,0,errors.join('\n'));
  console.log(`Strength review UI passed: real React/preload/service/SQLite, selection, single-save, read-back, history and reload. Screenshot: ${screenshot}`);
 } finally {clearTimeout(watchdog);window?.destroy();await vite?.close();db.close();}
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
