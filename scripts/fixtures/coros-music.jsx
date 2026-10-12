import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WatchMusicSourcePanel} from '../../src/media/WatchMusicSourcePanel';
import {WatchLibraryPanel} from '../../src/media/LibraryPanels';
import '../../src/styles.css';
window.musicCalls=[];
window.musicResponse={id:'music-test',deviceName:'COROS PACE Pro TEST',checkedAt:Date.now(),tracks:[
 {name:'Café & trail.mp3',watchPath:'/emmc2:/Music/Café & trail.mp3',sizeBytes:123456,watchId:1},
 {name:'Episode.mp3',watchPath:'/emmc2:/Music/Episode.mp3',sizeBytes:654321,watchId:2}
]};
const api={
 connectCorosNativeBle:async input=>{window.musicCalls.push({operation:'connect',input});},
 getCorosMusicInventory:async()=>{
  window.musicCalls.push({operation:'read'});
  await new Promise(resolve=>{window.completeMusicRead=resolve;});
  if(window.musicError)throw Error(window.musicError);
  return window.musicResponse;
 },
 deleteCorosMusicTrack:async target=>{
  window.musicCalls.push({operation:'delete',target});
  await new Promise(resolve=>{window.completeMusicDelete=resolve;});
  if(window.musicDeleteError)throw Error(window.musicDeleteError);
  const deleted=window.musicDeleteConfirmed===true;
  if(deleted)window.musicResponse={...window.musicResponse,id:'after-delete',tracks:window.musicResponse.tracks.filter(t=>t.watchPath!==target.watchPath)};
  return {deleted,inventory:window.musicResponse};
 }
};
function Fixture(){
 const [connection,setConnection]=useState({connected:false});
 const [usbConnected,setUsbConnected]=useState(false);
 window.setMusicConnection=setConnection;
 window.setUsbConnected=setUsbConnected;
 const noop=()=>{};
 const usbPanel=<WatchLibraryPanel
  watchStatus={{connected:usbConnected,model:'pace-pro',tracks:usbConnected?[
   {name:'USB track.mp3',relativePath:'Music/USB track.mp3',absolutePath:'/test/Music/USB track.mp3',sizeBytes:1024,modifiedAt:'2026-10-10T12:00:00Z'}
  ]:[],candidates:[],checkedAt:'2026-10-10T12:00:00Z'}}
  watchConnected={usbConnected} busy={null} selectedPaths={new Set()}
  onToggleSelect={noop} onSelectTracks={noop} onClearSelection={noop}
  onDeleteWatchTrack={noop} onDeleteWatchTracks={noop}
 />;
 return <main style={{width:'min(100%, 440px)',padding:16}}><WatchMusicSourcePanel api={api} connection={connection} usbPanel={usbPanel}/></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
