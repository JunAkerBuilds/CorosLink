import { createRoot } from 'react-dom/client';
import { UnitSystemProvider } from '../../src/units/UnitSystemProvider';
import { PrivacySettings } from '../../src/settings/PrivacySettings';
import '../../src/i18n/allCatalogs';
import { setLanguage } from '../../src/i18n';
import type { CorosLinkApi } from '../../src/coroslink-api';
import type { WatchSyncProgress } from '../../electron/localSync/localDataTypes';
import '../../src/styles.css';
import '../../src/desktop.css';

// Settings → Privacy & local data. The query picks the state: mode=local|connected, state=empty|offline|degraded, lang=fr|pt|zh-CN.
const query = new URLSearchParams(location.search);
const local = query.get('mode') !== 'connected';
const state = query.get('state') ?? '';
if (query.get('lang')) setLanguage(query.get('lang') as 'fr' | 'pt' | 'zh-CN');
const status = {
  mode: local ? 'local_only' : 'connected', phase: state === 'degraded' ? 'degraded' : 'active', enforcing: local,
  failedServices: state === 'degraded' ? [{ id: 'credentials', label: 'Saved credentials', error: 'The keychain could not be opened.' }] : [], blockedAttempts: local ? 3 : 0
};
const empty = state === 'empty';
const overview = {
  activities: { total: empty ? 0 : 42, fromWatch: empty ? 0 : 38, imported: empty ? 0 : 4 }, devices: [], recentRuns: [],
  lastActivitySync: empty ? undefined : { id: 1, kind: 'activities', state: 'done', startedAt: '2026-10-20T07:27:00.000Z', finishedAt: '2026-10-20T07:28:00.000Z', receivedBytes: 0, newRecords: 0 },
  storageBytes: 18_400_000, watchKeySaved: true, watchConnected: state !== 'offline', watchName: 'COROS PACE 4',
  watchSyncSupport: state === 'offline' ? 'unsupported' : 'experimental', healthDays: empty ? 0 : 61, captureEnabled: false
};
const idle = (): WatchSyncProgress => ({ state: 'idle', receivedBytes: 0, newActivities: 0, undecodedPayloads: 0 });
const mock = {
  calls: [] as string[], planReplacement: false, progressListeners: new Set<(progress: WatchSyncProgress) => void>(),
  finishSync: (_result: Partial<WatchSyncProgress>) => {}, failSync: (_message: string) => {},
  progress: (progress: Partial<WatchSyncProgress>) => mock.progressListeners.forEach(listener => listener({ ...idle(), state: 'reading', ...progress }))
};
const api = {
  getDataModeStatus: async () => status,
  onDataModeChange: () => () => {},
  returnToConnectedMode: async () => { mock.calls.push('connected'); return status; },
  activateLocalOnlyMode: async (options: unknown) => { mock.calls.push(`local:${JSON.stringify(options)}`); return { ...status, mode: 'local_only', enforcing: true }; },
  getLocalDataOverview: async () => overview,
  getWatchSyncProgress: async () => idle(),
  onWatchSyncProgress: (callback: (progress: WatchSyncProgress) => void) => { mock.progressListeners.add(callback); return () => mock.progressListeners.delete(callback); },
  getWatchAutoSync: async () => ({ enabled: false, intervalHours: 3 }),
  onWatchAutoSyncChange: () => () => {},
  syncWatchLocally: () => { mock.calls.push('sync'); return new Promise<WatchSyncProgress>((resolve, reject) => {
    mock.finishSync = result => resolve({ ...idle(), state: 'done', ...result });
    mock.failSync = message => reject(new Error(`Error invoking remote method 'localData:syncWatch': Error: ${message}`));
  }); },
  cancelWatchSync: async () => idle(),
  allowWatchPlanReplacement: async () => { mock.calls.push('allowPlan'); mock.planReplacement = true; },
  getWatchPlanReplacement: async () => mock.planReplacement,
  setWatchPlanReplacement: async (allowed: boolean) => { mock.calls.push(`planReplacement:${allowed}`); mock.planReplacement = allowed; return allowed; },
  importLocalFitFiles: async () => { mock.calls.push('import'); return { imported: 4, duplicates: 2, failed: [], activityIds: [] }; },
  exportLocalBackup: async (passphrase?: string) => { mock.calls.push(`backup:${passphrase ?? ''}`); return { saved: true, activities: 42 }; },
  chooseLocalBackup: async () => ({ chosen: true, encrypted: false }),
  restoreLocalBackup: async () => ({ activitiesAdded: 1, activitiesSkipped: 0 }),
  getNetworkAccessReport: async () => ({ generatedAt: Date.now(), status, attempts: [
    { at: Date.now() - 60_000, destination: 'https://teameuapi.coros.com/activity/fit/import' },
    { at: Date.now() - 30_000, destination: 'https://teameuapi.coros.com/training/schedule/update' }] }),
  clearNetworkAccessReport: async () => ({ generatedAt: Date.now(), status, attempts: [] })
} as unknown as CorosLinkApi;
Object.assign(window, { mock });
createRoot(document.getElementById('root')!).render(
  <UnitSystemProvider>
    <div className="app"><div className="app-body"><main className="content">
      <section className="settings-view"><PrivacySettings api={api} /></section>
    </main></div></div>
  </UnitSystemProvider>
);
