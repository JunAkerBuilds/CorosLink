// The main process's desktop settings (desktop/main/settings.ts), as the Settings page reads and changes them.
import { t } from "@/lib/i18n";

export type DataMode = "connected" | "localOnly";
export interface Blocked { at: number; method: string; target: string }
export interface About { version: string; platform: string; electron: string; chromium: string; node: string }
/** What phones have synced to this computer (null without a local store). */
export interface LocalData { activities: number; healthDays: number; lastPhoneSync: string | null; bytes: number }
/** `usage`: whether the daily anonymous check-in for usage counts is on (main/usage.ts). */
export interface SettingsState { dataMode: DataMode; blocked: Blocked[]; about: About; local: LocalData | null; privacy: "pending" | "seen"; usage: boolean; crashReports: boolean }
export interface Place { id: string; label: string; path: string; bytes: number | null }

export class SettingsProblem extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

async function call<T>(path: string, body?: object): Promise<T> {
  const answer = await fetch(`/api/desktop/settings${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { cache: "no-store" });
  const parsed = (await answer.json().catch(() => ({}))) as T & { error?: { code: string; message: string } };
  if (!answer.ok || parsed.error) throw new SettingsProblem(parsed.error?.message ?? t("That didn't work."), parsed.error?.code ?? "problem");
  return parsed;
}

// The mode as last read, for the sidebar's Local-Only chip; every read or change of the settings updates it.
let mode: DataMode | null = null;
const listeners = new Set<() => void>();
const noted = (state: SettingsState) => {
  if (state.dataMode !== mode) { mode = state.dataMode; for (const l of listeners) l(); }
  return state;
};
export const dataMode = {
  get: () => mode,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

export const readSettings = () => call<SettingsState>("").then(noted);
/** Tells the main process which language the page speaks, for the menu and the lines it sends back. */
export const tellLanguage = (language: string) => call<{ language: string }>("/language", { language }).catch(() => null);
export const setDataMode = (next: DataMode) => call<SettingsState>("", { dataMode: next }).then(noted);
export const setUsage = (on: boolean) => call<SettingsState>("", { usage: on }).then(noted);
export const clearBlocked = () => call<SettingsState>("/blocked/clear", {}).then(noted);
export const readStorage = () => call<{ folder: string; places: Place[] }>("/storage");
export const openPlace = (id: string) => call<{ opened: boolean }>("/storage/open", { id });
export const readLogs = (hours: number) => call<{ count: number; report: string }>(`/logs?hours=${hours}`);
export const setCrashReports = (on: boolean) => call<SettingsState>("", { crashReports: on }).then(noted);
/** Sends the error log of the last `hours` to the developer, with a note and an email for a reply. */
export const sendLogs = (input: { note: string; contact: string; hours: number }) => call<{ reference: string }>("/logs/send", input);
export const clearLogs = () => call<{ count: number }>("/logs/clear", {});
export const exportBackup = (passphrase: string) => call<{ cancelled?: true; saved?: string; items?: number; sealed?: boolean }>("/backup/export", { passphrase });
export const restoreBackup = (passphrase: string) => call<{ cancelled?: true; restored?: number }>("/backup/restore", { passphrase });
