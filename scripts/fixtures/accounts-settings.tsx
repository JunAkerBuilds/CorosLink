import { createRoot } from "react-dom/client";
import { SettingsView } from "../../src/settings/SettingsView";
import { UnitSystemProvider } from "../../src/units/UnitSystemProvider";
import type { CorosLinkApi } from "../../src/coroslink-api";
import "../../src/styles.css";

const calendar = {
  connected: false,
  autoSync: false,
  syncing: false,
  connecting: false,
  accountMatches: true,
};
let routeConfig = { backend: "keyless", openRouteServiceApiKey: "" };
const fixture = window as unknown as {
  destination?: string;
  saves: number;
  appleCredentials?: unknown;
};
fixture.saves = 0;
const api = {
  getWatchfaceAutomationStatus: async () => ({
    enabled: false,
    running: false,
  }),
  getAppInfo: async () => ({
    version: "test",
    platform: "darwin",
    arch: "arm64",
    storageLocations: [],
  }),
  getTrainingHubStatus: async () => ({
    authenticated: true,
    email: "runner@example.com",
  }),
  getYouTubeMusicStatus: async () => ({ authenticated: false }),
  getSpotifyStatus: async () => ({
    authenticated: true,
    displayName: "Runner",
  }),
  getAppleMusicStatus: async () => {
    throw new Error("Offline");
  },
  getHevyStatus: async () => ({ connected: false }),
  getGoogleCalendarStatus: async () => ({ ...calendar, configured: true }),
  getAppleCalendarStatus: async () => calendar,
  getRouteBuilderConfig: async () => routeConfig,
  validateRouteApiKey: async (key: string) => ({
    status: key === "valid-key" ? "valid" : "invalid",
    message: "Invalid API key",
  }),
  saveRouteBuilderConfig: async (config: typeof routeConfig) => {
    fixture.saves++;
    routeConfig = config;
    return config;
  },
  connectAppleCalendar: async (credentials: unknown) => {
    fixture.appleCredentials = credentials;
    return { ...calendar, connected: true, accountEmail: "runner@example.com" };
  },
  listAppleCalendars: async () => [],
} as unknown as CorosLinkApi;
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 24, maxWidth: 1200, margin: "auto" }}>
    <UnitSystemProvider>
      <SettingsView
        updateSnapshot={{ status: "idle", currentVersion: "test" }}
        updateBusy={false}
        onCheckForUpdates={() => undefined}
        onError={console.error}
        api={api}
        onOpenAccount={(destination) => {
          fixture.destination = destination;
        }}
      />
    </UnitSystemProvider>
  </main>,
);
