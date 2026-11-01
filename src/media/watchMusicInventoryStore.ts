import { useSyncExternalStore } from "react";
import type { CorosBleMusicInventory } from "../../electron/corosBleMusicTypes";
import type { CorosNeteasePlaylistLabel } from "../../electron/corosWifiMusicTypes";

/**
 * The last Bluetooth read of the watch's audio, shared so the On-watch panel and the
 * NetEase playlists in the Wi-Fi panel show the same read. Cleared on disconnect.
 */
let current: CorosBleMusicInventory | null = null;
const listeners = new Set<() => void>();

export function publishWatchMusicInventory(inventory: CorosBleMusicInventory | null): void {
  if (inventory === current) return;
  current = inventory;
  for (const listener of listeners) listener();
}

export function useWatchMusicInventory(): CorosBleMusicInventory | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current);
}

/** Names CorosLink keeps for this watch's NetEase playlists (the watch stores only IDs), shared by both panels. */
let labels: CorosNeteasePlaylistLabel[] = [];
const labelListeners = new Set<() => void>();

export function updateNeteasePlaylistLabels(update: (current: CorosNeteasePlaylistLabel[]) => CorosNeteasePlaylistLabel[]): void {
  const next = update(labels);
  if (next === labels) return;
  labels = next;
  for (const listener of labelListeners) listener();
}

export function useNeteasePlaylistLabels(): CorosNeteasePlaylistLabel[] {
  return useSyncExternalStore(listener => { labelListeners.add(listener); return () => { labelListeners.delete(listener); }; }, () => labels);
}

/** Which playlist Wi-Fi sends add songs to: one with an ID, or the new (draft) one created on the first send. */
export type NeteasePlaylistSelection = { kind: "playlist"; id: string } | { kind: "draft" };

/**
 * The Wi-Fi destination and its NetEase target. The Wi-Fi panel sends; the On-watch panel picks
 * or creates the playlist, so both read this. Reset when the Wi-Fi panel unmounts (watch change).
 */
export interface NeteaseSendState {
  destination: "podcasts" | "netease";
  draft: string | null;
  selection: NeteasePlaylistSelection | null;
}

const initialSend: NeteaseSendState = { destination: "podcasts", draft: null, selection: null };
let send = initialSend;
const sendListeners = new Set<() => void>();

export function updateNeteaseSend(update: Partial<NeteaseSendState> | null): void {
  const next = update ? { ...send, ...update } : initialSend;
  if (next.destination === send.destination && next.draft === send.draft && next.selection === send.selection) return;
  send = next;
  for (const listener of sendListeners) listener();
}

export function useNeteaseSend(): NeteaseSendState {
  return useSyncExternalStore(listener => { sendListeners.add(listener); return () => { sendListeners.delete(listener); }; }, () => send);
}

/** Where the open NetEase playlist (On-watch panel) shows the Wi-Fi panel's add-songs controls, via a portal. */
let addSlot: HTMLElement | null = null;
const slotListeners = new Set<() => void>();

export function publishNeteaseAddSlot(element: HTMLElement | null): void {
  if (element === addSlot) return;
  addSlot = element;
  for (const listener of slotListeners) listener();
}

export function useNeteaseAddSlot(): HTMLElement | null {
  return useSyncExternalStore(listener => { slotListeners.add(listener); return () => { slotListeners.delete(listener); }; }, () => addSlot);
}
