// Developer → "Hide Buy me a coffee": takes the sidebar's coffee pill away for clean screenshots. Kept on this
// computer only, and cleared when developer mode is turned off so the pill always comes back.
import { useSyncExternalStore } from "react";

const KEY = "clink.dev.hideCoffee";
const listeners = new Set<() => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

let hidden = read();

export function setCoffeeHidden(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* this run only */ }
  hidden = on;
  listeners.forEach((l) => l());
}

export function useCoffeeHidden(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => hidden);
}
