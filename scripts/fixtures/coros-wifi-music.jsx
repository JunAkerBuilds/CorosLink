import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WatchMusicSourcePanel} from '../../src/media/WatchMusicSourcePanel';
import {LocalLibraryPanel} from '../../src/media/LibraryPanels';
import {CorosWifiMusicPanel} from '../../src/media/CorosWifiMusicPanel';
import '../../src/styles.css';
window.wifiCalls=[];
window.wifiStatus={supported:true,ready:true,phase:'idle',completedFiles:0,totalFiles:0,downloadedBytes:0,totalBytes:0,restorePending:false,backupSavedAt:Date.now()};
const api={
 getCorosWifiMusicStatus:async()=>({...window.wifiStatus}),
 sendCorosMusicOverWifi:async()=>{
  window.wifiCalls.push('send');
  await new Promise(resolve=>{window.completeWifiSend=resolve;});
  if(window.wifiError)throw Error(window.wifiError);
  return {...window.wifiStatus};
 },
 sendCorosLibraryMusicOverWifi:async ids=>{
  window.wifiCalls.push({operation:'library',ids});
  await new Promise(resolve=>{window.completeWifiSend=resolve;});
  if(window.wifiError)throw Error(window.wifiError);
  return {...window.wifiStatus};
 },
 cancelCorosWifiMusicSync:async()=>{window.wifiCalls.push('cancel');},
 importCorosWifiMusicBackup:async()=>{window.wifiCalls.push('backup');return {...window.wifiStatus};},
 restoreCorosWifiMusicSettings:async()=>{window.wifiCalls.push('restore');return {...window.wifiStatus};},
 getCorosMusicInventory:async()=>{
  window.wifiCalls.push('read');await new Promise(resolve=>{window.completeMusicRead=resolve;});
  return {id:'inventory',checkedAt:Date.now(),tracks:[{name:'Existing.mp3',watchId:1,watchPath:'/emmc2:/Music/Existing.mp3',sizeBytes:10}]};
 },
 deleteCorosMusicTrack:async()=>{window.wifiCalls.push('delete');return {deleted:false,inventory:{id:'inventory',checkedAt:Date.now(),tracks:[]}};}
};
function Fixture(){
 const [connection,setConnection]=useState({connected:false});window.setMusicConnection=setConnection;
 return <main style={{width:'min(100%, 440px)',padding:16}}><WatchMusicSourcePanel api={api} connection={connection}
  usbPanel={<section className="library-panel library-panel--watch"><header className="library-panel-header"><h3>USB library</h3></header></section>}/></main>;
}
function LibraryFixture(){
 const [connection,setConnection]=useState({connected:false});window.setMusicConnection=setConnection;
 const [tracks,setTracks]=useState([
  {id:'library-one',title:'One',filePath:'/private/library/One.mp3',url:'test:one',sizeBytes:100,createdAt:'2026-10-10T12:00:00Z'},
  {id:'library-two',title:'Two',filePath:'/private/library/Two.mp3',url:'test:two',sizeBytes:200,createdAt:'2026-10-10T12:01:00Z'}
 ]);window.setLibraryTracks=setTracks;window.libraryTracks=tracks;
 const [selected,setSelected]=useState(new Set());
 const [wifiBusy,setWifiBusy]=useState(false),[bleBusy,setBleBusy]=useState(false);
 useEffect(()=>{setSelected(current=>new Set([...current].filter(id=>tracks.some(t=>t.id===id))));},[tracks]);
 const usbPanel=<section className="library-panel library-panel--watch"><header className="library-panel-header"><h3>USB library</h3></header></section>;
 const noop=()=>{};
 return <main style={{width:'min(100%, 440px)',padding:16}}>
  <LocalLibraryPanel downloads={tracks} watchTracks={[]} watchConnected={false} busy={wifiBusy?'transfer-wifi':null}
   transferProgress={null} selectedIds={selected} canTransferAll={false}
   onToggleSelect={id=>setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;})}
   onSelectTracks={(ids,value)=>setSelected(current=>{const next=new Set(current);for(const id of ids){if(value)next.add(id);else next.delete(id);}return next;})}
   onClearSelection={()=>setSelected(new Set())} onTransfer={()=>window.wifiCalls.push('usb')} onTransferAll={noop}
   onTransferDownloads={()=>window.wifiCalls.push('usb')} onDeleteDownload={()=>window.wifiCalls.push('delete-local')} onDeleteDownloads={noop}
   wifiSyncPanel={connection.connected?<CorosWifiMusicPanel key={connection.deviceId} api={api} otherBusy={bleBusy} onBusyChange={setWifiBusy}
    library={{allIds:tracks.map(t=>t.id),selectedIds:tracks.filter(t=>selected.has(t.id)).map(t=>t.id)}}/>:null}/>
  <WatchMusicSourcePanel api={api} connection={connection} showWifiMusic={false} wifiSyncBusy={wifiBusy}
   onBluetoothBusyChange={setBleBusy} usbPanel={usbPanel}/>
 </main>;
}
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('library')?<LibraryFixture/>:<Fixture/>);
