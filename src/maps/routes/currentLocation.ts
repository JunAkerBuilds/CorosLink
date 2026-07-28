import type { UnitSystem } from "../../../electron/types";
import { elevationUnit, metersToElevation } from "../../units/units";

export interface DeviceRouteLocation {
  label: string;
  lat: number;
  lon: number;
}

type GeolocationSource = Pick<Geolocation, "getCurrentPosition">;

const HIGH_ACCURACY_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0
};

/**
 * Requests the device location only after the user explicitly chooses
 * "Use my location". This uses Core Location on macOS rather than an IP lookup.
 */
export function requestDeviceRouteLocation(
  source: GeolocationSource | undefined,
  unitSystem: UnitSystem
): Promise<DeviceRouteLocation> {
  const geolocation =
    source ??
    (typeof navigator === "undefined" ? undefined : navigator.geolocation);

  if (!geolocation) {
    return Promise.reject(
      new Error("Location services are not available in this app session.")
    );
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 ||
          Math.abs(longitude) > 180
        ) {
          reject(new Error("Location services returned invalid coordinates."));
          return;
        }

        const accuracyLabel =
          Number.isFinite(accuracy) && accuracy > 0
            ? ` (±${Math.max(
                1,
                Math.round(metersToElevation(accuracy, unitSystem))
              )} ${elevationUnit(unitSystem)})`
            : "";

        resolve({
          label: `Current location${accuracyLabel}`,
          lat: latitude,
          lon: longitude
        });
      },
      (error) => reject(new Error(describeLocationError(error))),
      HIGH_ACCURACY_OPTIONS
    );
  });
}

function describeLocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case 1:
      return (
        "Location access was denied. Allow CorosLink in System Settings > " +
        "Privacy & Security > Location Services, then try again."
      );
    case 2:
      return "Your device could not determine a location. Check that Location Services is enabled and try again.";
    case 3:
      return "Location request timed out. Move to an area with a better location signal and try again.";
    default:
      return "Could not get your current location. Try again.";
  }
}
