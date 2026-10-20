import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UnitSystemProvider } from '../../src/units/UnitSystemProvider';
import { WatchConnectionMenu } from '../../src/watch/WatchConnectionMenu';
import { setLanguage } from '../../src/i18n';
import { resetWatchSync } from '../../src/watch/watchSyncState';
import type { CorosLinkApi } from '../../src/coroslink-api';
import type { CorosNativeBleSnapshot } from '../../electron/corosNativeBleTypes';
import type { WatchSyncProgress } from '../../electron/localSync/localDataTypes';
import type { WatchAutoSyncState } from '../../electron/watchAutoSyncService';
import type { CorosWatchKeySummary, WatchStatus } from '../../electron/types';
import '../../src/styles.css';
import '../../src/desktop.css';
import '../../src/toolbar.css';

// A PACE 4 on the Mac's Bluetooth, as the watch menu sees it.
const hour = 3_600_000;
const now = Date.now();
const base: CorosNativeBleSnapshot = {
  phase: 'idle', available: true, connected: false, encrypted: false, systemBind: 'not_authenticated', channels: [],
  backends: [{ id: 'system', label: 'Bluetooth', available: true }], transport: 'corebluetooth', pairingManagedByOS: true
};
const pace4: CorosNativeBleSnapshot = {
  ...base, phase: 'connected', connected: true, encrypted: true, systemBind: 'authenticated', authenticatedAt: now - 60_000,
  deviceName: 'COROS PACE 4 2F1A6C', deviceId: 'pace4', batteryPercent: 78, modelNumber: 'W336', softwareRevision: 'V 4.10.8',
  watchModel: 'pace-4', watchModelSource: 'model-number', watchValidated: false, rssiDbm: -61, maximumWriteBytes: 244, controlWrites: 1832,
  clockSetAt: now - 60_000, weatherSentAt: now - 50_000,
  gpsAssistance: { format: 'elpo', chipType: 2, epoType: 1, bindVersion: 1, durationHours: 168, startHour: 0, validUntil: Math.ceil((now + 5 * 24 * hour) / hour) * hour, raw: '0102a8000000' },
  channels: [
    { name: 'control', serviceUuid: '6e40', subscribed: true, notifications: 412, receivedBytes: 18034 },
    { name: 'bulk', serviceUuid: '6e41', subscribed: true, notifications: 96, receivedBytes: 220_311 }
  ]
};
const scenarios: Record<string, { snapshot: CorosNativeBleSnapshot | null; usbWatch?: WatchStatus | null; localOnly?: boolean; watchKeySaved?: boolean; watchKey?: CorosWatchKeySummary; autoSync?: WatchAutoSyncState }> = {
  'never-paired': { snapshot: base, watchKeySaved: false, localOnly: true },
  offline: { snapshot: { ...base, phase: 'disconnected', gpsAssistance: pace4.gpsAssistance, deviceName: pace4.deviceName }, watchKeySaved: true, localOnly: true },
  // Connected Mode: the menu offers Connect; syncing is a Local-Only Mode task.
  'connected-mode-offline': { snapshot: { ...base, phase: 'disconnected', deviceName: pace4.deviceName }, watchKeySaved: true, localOnly: false },
  connecting: { snapshot: { ...base, phase: 'connecting' }, watchKeySaved: true, localOnly: true },
  failed: { snapshot: { ...base, phase: 'failed', error: 'The watch did not respond. Wake it, keep it within a metre of this computer and try again.' }, watchKeySaved: true, localOnly: true },
  connected: { snapshot: pace4, watchKeySaved: true, localOnly: true },
  // Linked and signed in, but CorosLink is still setting the clock and sending weather.
  'connected-setting-up': { snapshot: { ...pace4, phase: 'connecting' }, watchKeySaved: true, localOnly: true },
  'connected-no-satellite': { snapshot: { ...pace4, gpsAssistance: undefined, weatherSentAt: undefined }, watchKeySaved: true, localOnly: true },
  'connected-unknown-satellite': { snapshot: { ...pace4, gpsAssistance: { ...pace4.gpsAssistance!, format: 'unknown', validUntil: undefined, raw: '7f00ff13' } }, watchKeySaved: true, localOnly: true },
  'auto-on': { snapshot: pace4, watchKeySaved: true, localOnly: true, autoSync: { enabled: true, intervalHours: 3, lastAttemptAt: now - 2 * hour, lastSuccessAt: now - 2 * hour } },
  'auto-failed': { snapshot: pace4, watchKeySaved: true, localOnly: true, autoSync: { enabled: true, intervalHours: 6, lastAttemptAt: now - 20 * 60_000, lastSuccessAt: now - 7 * hour, lastError: 'No watch nearby' } },
  'sign-in': { snapshot: { ...pace4, systemBind: 'failed', authenticationError: 'The watch rejected the COROS account key. Sign in with the account this watch is paired to.' }, watchKeySaved: true, localOnly: true },
  usb: { snapshot: pace4, watchKeySaved: true, localOnly: false, usbWatch: { connected: true, name: 'PACE 4', rootPath: '/Volumes/COROS', freeBytes: 2_400_000_000 } as WatchStatus },
  // Another device answered with the watch's name: nothing was sent, the menu asks.
  'identity-mismatch': { snapshot: { ...base, phase: 'disconnected', identityMismatch: true }, watchKeySaved: true, localOnly: true },
  // Background sync waits for a connection from the menu.
  'auto-paused': { snapshot: { ...base, phase: 'disconnected' }, watchKeySaved: true, localOnly: true, autoSync: { enabled: true, intervalHours: 3, paused: 'unpinned', pausedAt: now - 60_000 } },
  'auto-paused-mismatch': { snapshot: { ...base, phase: 'disconnected' }, watchKeySaved: true, watchKey: { keyId: '7A3F', accountId: '•••• 5678', lastUsed: { at: now - 3 * hour, watch: pace4.deviceName! } }, localOnly: true, autoSync: { enabled: true, intervalHours: 3, paused: 'mismatch', pausedAt: now - 60_000 } },
  // Two devices with the watch's name; the second is the remembered one.
  'same-name': { snapshot: { ...base, discoveredDevices: [{ deviceId: 'other', deviceName: 'COROS PACE 4 2F1A6C' }, { deviceId: 'pace4', deviceName: 'COROS PACE 4 2F1A6C', remembered: true }] }, watchKeySaved: true, localOnly: true }
};

type Mock = {
  autoSync: WatchAutoSyncState; autoSyncListeners: Set<(state: WatchAutoSyncState) => void>; progressListeners: Set<(progress: WatchSyncProgress) => void>;
  finishSync: (result: Partial<WatchSyncProgress>) => void; failSync: (message: string) => void; progress: (progress: Partial<WatchSyncProgress>) => void;
  calls: string[]; snapshot: CorosNativeBleSnapshot | null; lastProgress?: WatchSyncProgress;
};
const mock: Mock = {
  autoSync: { enabled: false, intervalHours: 3 }, autoSyncListeners: new Set(), progressListeners: new Set(), calls: [], snapshot: null,
  finishSync: () => {}, failSync: () => {}, progress: progress => {
    mock.lastProgress = { state: 'reading', receivedBytes: 0, newActivities: 0, undecodedPayloads: 0, ...progress };
    mock.progressListeners.forEach(listener => listener(mock.lastProgress!));
  }
};
const idle = (): WatchSyncProgress => ({ state: 'idle', receivedBytes: 0, newActivities: 0, undecodedPayloads: 0 });
const api = {
  getCorosWatchfaceStatus: async () => ({ watchAuthenticationAvailable: fixtureState.watchKeySaved, watchKey: fixtureState.watchKey }),
  getCorosNativeBleStatus: async () => mock.snapshot,
  connectCorosNativeBle: async (input?: { confirmIdentity?: boolean }) => { mock.calls.push(input?.confirmIdentity ? 'connect:confirm' : 'connect'); return new Promise(() => {}); },
  scanCorosNativeBle: async () => { mock.calls.push('scan'); return mock.snapshot; },
  refreshCorosNativeBle: async () => mock.snapshot,
  disconnectCorosNativeBle: async () => { mock.calls.push('disconnect'); return { ...base, phase: 'disconnected' }; },
  syncWatchLocally: () => { mock.calls.push('sync'); return new Promise<WatchSyncProgress>((resolve, reject) => {
    mock.finishSync = result => { mock.lastProgress = undefined; resolve({ ...idle(), state: 'done', ...result }); };
    mock.failSync = message => { mock.lastProgress = undefined; reject(new Error(`Error invoking remote method 'localData:syncWatch': Error: ${message}`)); };
  }); },
  getWatchSyncProgress: async () => mock.lastProgress ?? idle(),
  allowWatchPlanReplacement: async () => { mock.calls.push('allowPlan'); },
  onWatchSyncProgress: (callback: (progress: WatchSyncProgress) => void) => { mock.progressListeners.add(callback); return () => mock.progressListeners.delete(callback); },
  getWatchAutoSync: async () => mock.autoSync,
  setWatchAutoSync: async (input: Partial<WatchAutoSyncState>) => { mock.calls.push(`autoSync:${JSON.stringify(input)}`); mock.autoSync = { ...mock.autoSync, ...input }; return mock.autoSync; },
  onWatchAutoSyncChange: (callback: (state: WatchAutoSyncState) => void) => { mock.autoSyncListeners.add(callback); return () => mock.autoSyncListeners.delete(callback); },
  sendCorosNotification: async () => ({ ok: true }),
  forgetCorosWatchKey: async () => ({ watchAuthenticationAvailable: false }),
  createCorosPhonePairingCode: async () => { throw new Error('not used'); }
} as unknown as CorosLinkApi;

const fixtureState: { watchKeySaved: boolean; watchKey?: CorosWatchKeySummary } = { watchKeySaved: false };
let show: (name: string) => void = () => {};
let requestSync: () => void = () => {};
function Fixture() {
  const [name, setName] = useState('never-paired');
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(0);
  const [snapshot, setSnapshot] = useState<CorosNativeBleSnapshot | null>(scenarios[name]!.snapshot);
  const [syncRequest, setSyncRequest] = useState<number | null>(null);
  requestSync = () => { setSyncRequest(Date.now()); setOpen(true); };
  show = next => {
    const scenario = scenarios[next]!;
    // Each scenario starts with no sync in the window's memory.
    resetWatchSync();
    mock.lastProgress = undefined;
    fixtureState.watchKeySaved = scenario.watchKeySaved ?? true;
    fixtureState.watchKey = scenario.watchKey;
    mock.autoSync = scenario.autoSync ?? { enabled: false, intervalHours: 3 };
    mock.snapshot = scenario.snapshot;
    setSnapshot(scenario.snapshot);
    setName(next);
    setShown(count => count + 1);
    setOpen(true);
  };
  const scenario = scenarios[name]!;
  return (
    <div className="app">
      <header className="app-header app-header--slim">
        <div className="app-header-context"><h1 style={{ margin: 0, fontSize: 18 }}>Overview</h1></div>
        <div className="app-header-end">
          <div className="app-toolbar-watch">
            <WatchConnectionMenu key={`${name}-${shown}`} api={api} snapshot={snapshot} onSnapshotChange={next => { mock.snapshot = next; setSnapshot(next); }}
              usbWatch={scenario.usbWatch ?? null} open={open} onOpenChange={setOpen}
              onOpenWatchFaces={() => mock.calls.push('watchFaces')} onSignIn={() => mock.calls.push('signIn')}
              onOpenSettings={section => mock.calls.push(`settings:${section}`)} localOnly={scenario.localOnly}
              syncRequest={syncRequest} onSyncRequestHandled={() => setSyncRequest(null)} />
          </div>
        </div>
      </header>
      <main className="app-content" style={{ minHeight: 900 }}><button id="outside" type="button">Outside</button></main>
    </div>
  );
}
Object.assign(window, { mock, setTestLanguage: setLanguage, showScenario: (name: string) => show(name), requestSync: () => requestSync(), scenarios: Object.keys(scenarios) });
createRoot(document.getElementById('root')!).render(<UnitSystemProvider><Fixture /></UnitSystemProvider>);
