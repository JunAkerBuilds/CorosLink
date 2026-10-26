import { createRoot } from 'react-dom/client';
import { UnitSystemProvider, useUnitSystem } from '../../src/units/UnitSystemProvider';
import { WatchProfileSettings } from '../../src/settings/WatchProfileSettings';
import { WeatherLocationSettings } from '../../src/settings/WeatherLocationSettings';
import { WatchSystemSettings } from '../../src/settings/WatchSystemSettings';
import { OverviewWeatherCard } from '../../src/overview/OverviewWeatherCard';
import { OVERVIEW_WEATHER_STORAGE_KEY } from '../../src/overview/overviewWeather';
import { decodeExtSwitches, decodeSwitches } from '../../electron/corosWatchSettings';
import '../../src/i18n/allCatalogs';
import { setLanguage } from '../../src/i18n';
import type { CorosLinkApi } from '../../src/coroslink-api';
import type { WatchModelId } from '../../electron/watchModels';
import '../../src/styles.css';
import '../../src/desktop.css';

// A PACE 4 as read on connecting: the real main word, an extended record with a few settings on.
// The query picks other states: profile=none, settings=none|noext, weather=chosen|auto|unknown,
// connected=0, failSave=1, lang=fr|zh-CN, model=<watch model the records were read from>,
// touch=<touchscreen value (ext bits 30-33)>, night=1 (ext bit 28, Night Mode on a memory-in-pixel watch).
const query = new URLSearchParams(location.search);
const state = window as unknown as { saved: Array<Record<string, number>>; profileSaved: Array<Record<string, number>>; connected: boolean; failSave: boolean;
  authenticatedAt?: number; read: boolean; connectWatch: () => void };
state.saved = []; state.profileSaved = []; state.connected = query.get('connected') !== '0'; state.failSave = query.get('failSave') === '1';
// profile=none / settings=none: nothing read yet. connectWatch() connects from the watch menu, and the read lands a moment later.
state.read = false;
state.connectWatch = () => { state.connected = true; state.authenticatedAt = Date.now(); setTimeout(() => { state.read = true; }, 4000); };
if (query.get('lang')) setLanguage(query.get('lang') as 'fr' | 'zh-CN');
const ext = new Uint8Array(8);
const touch = Number(query.get('touch') ?? 1);
new DataView(ext.buffer).setUint32(0, ((1 << 12) | ((touch & 3) << 30) | (query.get('night') === '1' ? 1 << 28 : 0)) >>> 0, true);
new DataView(ext.buffer).setUint32(4, (1 << 20) | (1 << 18) | (1 << 9) | (touch >> 2), true);
const extHex = Array.from(ext, byte => byte.toString(16).padStart(2, '0')).join('');
let raw = 0x0e2d2085;
const model = query.get('model') ? { model: query.get('model') as WatchModelId } : {};
const summary = () => ({
  readAt: '2026-10-19T09:00:00.000Z', raw, values: decodeSwitches(raw), ...model,
  ...(query.get('settings') === 'noext' ? {} : { extRaw: extHex, ext: decodeExtSwitches(Object.assign(ext, { readBigUInt64LE: (offset: number) => new DataView(ext.buffer).getBigUint64(offset, true) }) as unknown as Buffer, model.model) }),
  changes: [{ at: '2026-10-19T08:40:00.000Z', field: 'raiseToWake', extended: false, from: 0, to: 1 }, { at: '2026-10-19T08:41:00.000Z', field: 'bit3', extended: true, from: 0, to: 1 }]
});
let profile = { readAt: '2026-10-19T09:00:00.000Z', ...model, maxHr: 194, restingHr: 55, thresholdHr: 160, hrZoneType: 3, thresholdPaceSecondsPerKm: 285,
  maxHrZones: [97, 116, 136, 155, 175], reserveHrZones: [137, 158, 172, 177, 187], thresholdHrZones: [128, 144, 152, 163, 170] };
const weather = {
  chosen: { latitude: 21.03, longitude: 105.85, place: 'Hanoi', source: 'chosen' },
  auto: { latitude: 48.86, longitude: 2.35, place: 'Paris, Île-de-France', source: 'auto' },
  unknown: null
}[query.get('weather') ?? 'chosen'];
const places = [
  { name: 'Hanoi', detail: 'Hanoi, Vietnam', latitude: 21.03, longitude: 105.85 },
  { name: 'Hanover', detail: 'Lower Saxony, Germany', latitude: 52.37, longitude: 9.73 },
  { name: 'Hanau', detail: 'Hesse, Germany', latitude: 50.13, longitude: 8.92 },
  { name: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch', detail: 'Isle of Anglesey, Wales, United Kingdom', latitude: 53.22, longitude: -4.2 }
];
const api = {
  getWatchSettings: async () => query.get('settings') === 'none' && !state.read ? null : summary(),
  getCorosNativeBleStatus: async () => ({ connected: state.connected, systemBind: 'authenticated', authenticatedAt: state.authenticatedAt }),
  updateWatchSettings: async (edits: Record<string, number>) => {
    if (state.failSave) throw new Error("Error invoking remote method 'watch:updateSettings': Error: The watch didn't keep units, raiseToWake. Reconnect and try again.");
    state.saved.push(edits); if (edits.raiseToWake !== undefined) raw = (raw & ~0x600000 | edits.raiseToWake << 21) >>> 0; return summary();
  },
  getWatchProfile: async () => query.get('profile') === 'none' && !state.read ? undefined : profile,
  updateWatchProfile: async (edits: Record<string, number>) => {
    if (state.failSave) throw new Error("Error invoking remote method 'watch:updateProfile': Error: The watch didn't keep the new profile. Reconnect and try again.");
    state.profileSaved.push(edits);
    const scale = (zones: number[], from: number, to: number) => zones.map(value => Math.round(value * to / from));
    profile = { ...profile, ...edits, readAt: '2026-10-19T09:05:00.000Z', maxHrZones: scale(profile.maxHrZones, profile.maxHr, edits.maxHr), thresholdHrZones: scale(profile.thresholdHrZones, profile.thresholdHr, edits.thresholdHr) };
    return profile;
  },
  getWeatherLocation: async () => weather,
  chooseWeatherLocation: async (place: { latitude: number; longitude: number; place: string } | null) => place ? { ...place, source: 'chosen' } : { latitude: 48.86, longitude: 2.35, place: 'Paris, Île-de-France', source: 'auto' },
  searchWeatherPlaces: async (text: string) => /^z/i.test(text) ? [] : places.filter(place => place.name.toLowerCase().startsWith(text.toLowerCase().slice(0, 2)))
} as unknown as CorosLinkApi;
// ?card=weather: the Overview weather card from a fresh cached forecast, with its settings link.
if (query.get('card') === 'weather') {
  localStorage.setItem(OVERVIEW_WEATHER_STORAGE_KEY, JSON.stringify({ fetchedAt: Date.now(), lat: 21.03, lon: 105.85, place: 'Hanoi', temperatureC: 27, apparentTemperatureC: 30, highC: 31, lowC: 24, humidityPercent: 78, windKmh: 9, weatherCode: 2, isDay: true }));
}
(window as unknown as { openedSettings: string[] }).openedSettings = [];
// window.setUnits('imperial' | 'metric') changes the app's Units, as Settings does.
function UnitsHandle() {
  (window as unknown as { setUnits: (system: string) => void }).setUnits = useUnitSystem().setUnitSystem as (system: string) => void;
  return null;
}
createRoot(document.getElementById('root')!).render(
  <UnitSystemProvider>
    <UnitsHandle />
    <div className="app">
      <div className="app-body">
        <main className="content">
          {query.get('card') === 'weather' ? <header className="dashboard-welcome" style={{ display: 'flex', justifyContent: 'flex-end', padding: 24 }}>
            <OverviewWeatherCard onOpenSettings={() => (window as unknown as { openedSettings: string[] }).openedSettings.push('weather')} />
          </header> : null}
          <section className="settings-view">
            <WatchProfileSettings api={api} />
            <WeatherLocationSettings api={api} />
            <WatchSystemSettings api={api} />
          </section>
        </main>
      </div>
    </div>
  </UnitSystemProvider>
);
