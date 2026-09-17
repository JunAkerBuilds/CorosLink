import { createRoot } from "react-dom/client";
import { CalendarConnections } from "../../src/calendar/CalendarConnections";
import { defaultCalendarEventTiming, type CalendarConnectionStatus, type CalendarSyncSettings } from "../../electron/calendarSyncTypes";
import type { CorosLinkApi } from "../../src/coroslink-api";
import "../../src/styles.css";

const fixture = window as unknown as {
  settingsCalls: { provider: string; input: CalendarSyncSettings }[];
  syncCalls: string[];
  rejectSettings: boolean;
};
fixture.settingsCalls = [];
fixture.syncCalls = [];
const status = (): CalendarConnectionStatus => ({
  connected: true, accountEmail: "runner@example.com", autoSync: true,
  syncing: false, connecting: false, accountMatches: true,
  calendar: { id: "training", name: "Training", primary: false },
  eventTiming: { ...defaultCalendarEventTiming(), timeZone: "America/Toronto" },
});
const providers = { google: status(), apple: status() };
const settings = async (provider: keyof typeof providers, input: CalendarSyncSettings) => {
  fixture.settingsCalls.push({ provider, input });
  if (fixture.rejectSettings) throw new Error("Unable to save preferences. Try again.");
  Object.assign(providers[provider], input);
  return structuredClone(providers[provider]);
};
const sync = async (provider: keyof typeof providers) => {
  fixture.syncCalls.push(provider);
  return { created: 0, updated: 3, deleted: 0, unchanged: 2 };
};
const api = {
  getGoogleCalendarStatus: async () => ({ ...structuredClone(providers.google), configured: true }),
  getAppleCalendarStatus: async () => structuredClone(providers.apple),
  updateGoogleCalendarSettings: (input: CalendarSyncSettings) => settings("google", input),
  updateAppleCalendarSettings: (input: CalendarSyncSettings) => settings("apple", input),
  syncGoogleCalendar: () => sync("google"),
  syncAppleCalendar: () => sync("apple"),
} as unknown as CorosLinkApi;
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 24, maxWidth: 1000, margin: "auto" }}>
    <CalendarConnections api={api} />
  </main>,
);
