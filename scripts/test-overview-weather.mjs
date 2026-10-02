import assert from 'node:assert/strict';
import { loadOverviewWeather } from '../src/overview/overviewWeather.ts';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const requests = [];
let code = 1;
let failIp = false;

try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null, setItem: () => {} }
  } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    geolocation: { getCurrentPosition: (_success, failure) => failure({ code }) }
  } });
  globalThis.fetch = async (url) => {
    const host = new URL(url).hostname;
    requests.push(host);
    if (host === 'api.bigdatacloud.net') {
      if (failIp) throw new Error('IP lookup failed');
      return { ok: true, json: async () => ({ latitude: 43.65, longitude: -79.38, city: 'Test city' }) };
    }
    assert.equal(host, 'api.open-meteo.com');
    return { ok: true, json: async () => ({ current: { temperature_2m: 20, weather_code: 0 } }) };
  };
  const load = () => loadOverviewWeather(new AbortController().signal, { force: true });

  await assert.rejects(load(), /Allow CorosLink in System Settings/);
  assert.deepEqual(requests, [], 'Permission denial must not trigger IP lookup or weather requests');

  for (code of [2, 3]) {
    requests.length = 0;
    const weather = await load();
    assert.equal(weather.place, 'Test city');
    assert.deepEqual(requests, ['api.bigdatacloud.net', 'api.open-meteo.com']);
  }

  failIp = true;
  await assert.rejects(load(), /Location request timed out/, 'Keep the original device error if fallback fails');
  failIp = false;
  code = 99;
  requests.length = 0;
  await assert.rejects(load(), /Could not get your current location/);
  assert.deepEqual(requests, []);

  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  assert.equal((await load()).place, 'Test city', 'Missing device location services can use the IP fallback');
} finally {
  globalThis.fetch = originalFetch;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
}

console.log('overview weather tests passed (permission denial, unavailable, timeout, fallback failure)');
