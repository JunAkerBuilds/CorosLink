import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CorosWifiMapsPanel } from '../../src/maps/CorosWifiMapsPanel';
import '../../src/i18n/allCatalogs';
import { setLanguage } from '../../src/i18n';
import type { CorosLinkApi } from '../../src/coroslink-api';
import type { CorosMapAreaPreview, CorosWifiMapTask } from '../../electron/corosWifiMapTypes';
import type { CorosMapInstallProgress, WatchStatus } from '../../electron/types';
import '../../src/styles.css';
import '../../src/desktop.css';

// One area chosen (Ho Chi Minh City), and no watch on Bluetooth: only the USB cable is in play.
localStorage.setItem('coroslink.selection.v1.maps.wifiAreas', JSON.stringify({ tiles: [{ x: 101, y: 60 }], names: { '101,60': 'Ho Chi Minh City' } }));
localStorage.setItem('coroslink.selection.v1.maps.wifiView', JSON.stringify({ lat: 10.8, lon: 106.7, zoom: 6 }));
const calls: Array<{ operation: string; tiles?: unknown; label?: string; id?: string }> = [];
// Downloads waiting on the watch from an earlier Wi-Fi request; the watch is on Bluetooth only when there are some.
let wifiTasks: CorosWifiMapTask[] = [];
let removeError: string | undefined;
const wifiStatus = () => ({ supported: wifiTasks.length > 0, connected: wifiTasks.length > 0, authenticated: wifiTasks.length > 0, tasks: wifiTasks, updatedAt: Date.now() });
let preview: CorosMapAreaPreview = { fileCount: 2, sizeBytes: 21_286_347, neededBytes: 21_286_347, freeBytes: 2_500_000_000 };
let pushProgress: (progress: CorosMapInstallProgress | null) => void = () => {};
let finishCopy: (error?: string) => void = () => {};
// ?plugged starts with a PACE 4 on the USB cable; ?localOnly runs as in Local-Only Mode.
const params = new URLSearchParams(location.search);
const pace4: WatchStatus = { connected: true, rootPath: '/Volumes/PACE 4', model: 'pace-4', freeBytes: 2_500_000_000 } as WatchStatus;
let plugged: WatchStatus | null = params.has('plugged') ? pace4 : null;
const api = {
  localOnlyAtLaunch: params.has('localOnly'),
  getCorosWifiMapStatus: async () => wifiStatus(),
  removeCorosWifiMapDownload: async (id: string) => {
    calls.push({ operation: 'remove', id });
    await new Promise(resolve => setTimeout(resolve, 200));
    if (removeError) throw new Error(removeError);
    wifiTasks = wifiTasks.filter(task => task.id !== id);
    return wifiStatus();
  },
  previewCorosWifiMap: async () => { throw new Error('No Bluetooth watch in this fixture.'); },
  previewCorosMapAreas: async (tiles: unknown) => { calls.push({ operation: 'preview', tiles }); return preview; },
  installCorosMapAreas: (tiles: unknown, label: string) => {
    calls.push({ operation: 'install', tiles, label });
    return new Promise((resolve, reject) => {
      finishCopy = error => error ? reject(new Error(error)) : resolve({ watch: plugged });
    });
  },
  getCorosMapInstallProgress: async () => null,
  onCorosMapInstallProgressUpdate: (callback: (progress: CorosMapInstallProgress | null) => void) => { pushProgress = callback; return () => {}; },
  cancelCorosMapInstall: async () => { calls.push({ operation: 'cancel' }); return null; },
  reverseGeocodeRouteLocation: async () => ({ city: 'Ho Chi Minh City', label: 'Ho Chi Minh City, Vietnam' }),
  searchRouteLocations: async () => []
} as unknown as CorosLinkApi;

function Fixture() {
  const [watch, setWatch] = useState<WatchStatus | null>(plugged);
  Object.assign(window, { setWatch: (next: WatchStatus | null) => { plugged = next; setWatch(next); } });
  return <main style={{ padding: 24 }}><CorosWifiMapsPanel api={api} watchStatus={watch} onWatchStatusChange={setWatch} /></main>;
}

Object.assign(window, {
  calls, setTestLanguage: setLanguage,
  setPreview: (next: CorosMapAreaPreview) => { preview = next; },
  setWifiTasks: (next: CorosWifiMapTask[]) => { wifiTasks = next; },
  setRemoveError: (message?: string) => { removeError = message; },
  pushProgress: (progress: CorosMapInstallProgress | null) => pushProgress(progress),
  finishCopy: (error?: string) => finishCopy(error)
});
createRoot(document.getElementById('root')!).render(<Fixture />);
