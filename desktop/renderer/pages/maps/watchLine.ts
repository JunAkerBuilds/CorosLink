// How the watch is reached, in a few words, for the Maps pill and watch card.
import type { MapsWatch } from "../../../maps/types";

export function watchLine(watch: MapsWatch | null | undefined): string {
  if (!watch) return "Not connected";
  if (watch.usb && watch.linked) return "Bluetooth + USB";
  if (watch.usb) return "USB cable";
  // Say Bluetooth, not "Connected": maps over USB need the cable, and "Connected" read as "plugged in".
  if (watch.linked) return watch.connected ? "Bluetooth · no USB" : "Ready over Bluetooth";
  return "Not linked";
}
