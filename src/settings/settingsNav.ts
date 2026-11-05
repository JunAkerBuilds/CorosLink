/** The Settings rail: which panes exist, how they group, and what search finds. No React, so tests can load it. */

export type SettingsPane =
  | "language" | "colors" | "sidebar"
  | "profile" | "watch" | "weather"
  | "accounts" | "ai"
  | "privacy" | "storage" | "logs"
  | "about";

/** Settings sections other screens link straight to. */
export type SettingsSection = "watch" | "weather" | "privacy" | "sidebar" | "media-tabs";

export interface SettingsPaneEntry {
  id: SettingsPane;
  label: string;
  /** English UI strings on that pane. Each is translated when searched, so people find what they can read. */
  keywords: readonly string[];
}

export interface SettingsPaneGroup {
  title: string;
  panes: readonly SettingsPaneEntry[];
}

export const SETTINGS_GROUPS: readonly SettingsPaneGroup[] = [
  {
    title: "General",
    panes: [
      { id: "language", label: "Language & units", keywords: ["App language", "Units", "Metric", "Imperial"] },
      { id: "colors", label: "Activity colors", keywords: ["Appearance", "Reset to defaults"] },
      { id: "sidebar", label: "Sidebar", keywords: ["Navigation", "Media services"] },
    ],
  },
  {
    title: "Watch",
    panes: [
      { id: "profile", label: "Training profile", keywords: ["Heart-rate zones", "Max heart rate (bpm)", "Resting heart rate (bpm)", "Threshold heart rate (bpm)"] },
      { id: "watch", label: "Watch settings", keywords: [] },
      { id: "weather", label: "Weather location", keywords: ["Weather", "Choose a place"] },
    ],
  },
  {
    title: "Connections",
    panes: [
      { id: "accounts", label: "Accounts & API", keywords: ["COROS", "Strava", "Hevy", "Spotify", "YouTube", "YouTube Music", "Apple Music", "OpenRouteService", "CARTO Basemaps", "intervals.icu", "OpenRouter", "MCP servers", "Google Calendar", "Apple Calendar"] },
      { id: "ai", label: "External AI", keywords: ["Watch faces", "Enable access"] },
    ],
  },
  {
    title: "Your data",
    panes: [
      { id: "privacy", label: "Privacy & local data", keywords: ["Data mode", "Connected Mode", "Local-Only Mode", "Backup", "Import FIT files"] },
      { id: "storage", label: "Storage", keywords: ["Music downloads", "Map downloads", "Activity FIT cache", "Saved routes", "Watchface projects", "Library database", "App data folder"] },
      { id: "logs", label: "Error logs", keywords: ["Copy error report"] },
    ],
  },
];

export const ABOUT_PANE: SettingsPaneEntry = {
  id: "about",
  label: "About CorosLink",
  keywords: ["App version", "Check for updates", "Report an issue", "Source on GitHub", "Support the project"],
};

/** The pane that holds a section another screen links to. */
export function paneForSection(section: SettingsSection): SettingsPane {
  return section === "media-tabs" ? "sidebar" : section;
}

/** The group a pane sits in, or undefined for About, which stands alone. */
export function groupTitleForPane(pane: SettingsPane): string | undefined {
  return SETTINGS_GROUPS.find((group) => group.panes.some((entry) => entry.id === pane))?.title;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Whether a pane matches the search, in the current language or in English. `extra` holds the words a
 * pane only knows at run time, such as the watch's setting names.
 */
export function paneMatches(
  entry: SettingsPaneEntry,
  query: string,
  translate: (text: string) => string,
  extra: readonly string[] = [],
): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const sources = [entry.label, ...entry.keywords, ...extra];
  const haystack = normalize([...sources, ...sources.map(translate)].join(" "));
  return words.every((word) => haystack.includes(word));
}
