import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const locationUrl = pathToFileURL(
  path.join(repoRoot, "src", "maps", "routes", "currentLocation.ts")
);
const { requestDeviceRouteLocation } = await import(
  `${locationUrl.href}?cacheBust=${Date.now()}`
);

let receivedOptions;
const location = await requestDeviceRouteLocation({
  getCurrentPosition(success, _failure, options) {
    receivedOptions = options;
    success({
      coords: {
        latitude: 45.4215,
        longitude: -75.6972,
        accuracy: 12.4
      }
    });
  }
}, "metric");

assert.deepEqual(location, {
  label: "Current location (±12 m)",
  lat: 45.4215,
  lon: -75.6972
});
assert.deepEqual(receivedOptions, {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0
});

await assert.rejects(
  requestDeviceRouteLocation({
    getCurrentPosition(_success, failure) {
      failure({ code: 1 });
    }
  }, "metric"),
  /Location access was denied/
);

await assert.rejects(
  requestDeviceRouteLocation({
    getCurrentPosition(success) {
      success({
        coords: {
          latitude: 91,
          longitude: -75.6972,
          accuracy: 12
        }
      });
    }
  }, "metric"),
  /invalid coordinates/
);

const imperialLocation = await requestDeviceRouteLocation({
  getCurrentPosition(success) {
    success({
      coords: {
        latitude: 45.4215,
        longitude: -75.6972,
        accuracy: 100
      }
    });
  }
}, "imperial");
assert.equal(imperialLocation.label, "Current location (±328 ft)");

console.log("route location tests passed");
