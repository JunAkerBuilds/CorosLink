// The watches C-LINK knows, what each reports over Bluetooth, and which features C-LINK reads or writes on each.
// A port of CorosKit's Compiler/WatchfaceTarget.swift, Bluetooth/WatchTransport.swift (WatchDeviceInfo, WatchName)
// and WatchData/WatchCommands.swift (WatchFeature). Keep in step with them.

export type Display = "amoled" | "mip";

export interface WatchTarget {
  /** CorosLink's model ID ("pace-pro"). */
  id: string;
  /** The catalog's model name ("PACE Pro"). */
  label: string;
  /** The model number the watch reports over Bluetooth ("W332"). */
  hardware: string;
  screen: number;
  display: Display;
}

const target = (id: string, label: string, hardware: string, screen: number, display: Display): WatchTarget => ({ id, label, hardware, screen, display });

export const PACE_PRO = target("pace-pro", "PACE Pro", "W332", 416, "amoled");

export const TARGETS: readonly WatchTarget[] = [
  PACE_PRO,
  target("pace-4-pro", "PACE 4 Pro", "W337", 466, "amoled"),
  target("pace-4", "PACE 4", "W336", 390, "amoled"),
  target("pace-3", "PACE 3", "W331", 240, "mip"),
  target("apex-4", "APEX 4", "W541", 260, "mip"),
  target("nomad", "NOMAD", "W942", 260, "mip"),
  target("vertix-2", "VERTIX 2", "B19", 280, "mip"),
  target("vertix-2s", "VERTIX 2S", "B19S", 280, "mip"),
  // COROS's catalog lists faces for "COROS B20" and "COROS B21"; an APEX 2 Pro's serial starts B20.
  target("apex-2-pro", "APEX 2 Pro", "B20", 260, "mip"),
  target("apex-2", "APEX 2", "B21", 240, "mip"),
  // Seen in Sentry as "COROS W542" from watches named "COROS APEX 4 42mm".
  target("apex-4-42mm", "APEX 4 42mm", "W542", 240, "mip"),
  // Seen in Sentry as "COROS B16" from watches named "COROS VERTIX".
  target("vertix", "VERTIX", "B16", 240, "mip"),
  target("apex-pro", "APEX Pro", "B17", 240, "mip"),
  target("pace-2", "PACE 2", "B18", 240, "mip"),
  // COROS's catalog lists faces for "COROS W706" (466 × 466 AMOLED, magic 664A, so PACE 4 Pro's BIN). Not yet seen
  // on a real watch.
  target("vertix-4", "VERTIX 4", "W706", 466, "amoled"),
];

/** The screen size reversed, then A (AMOLED) or R (memory-in-pixel): "614A", "062R". */
export const magic = (target: WatchTarget): string => String(target.screen).split("").reverse().join("") + (target.display === "mip" ? "R" : "A");

/** PACE 4s report "COROS R4" over Bluetooth but COROS lists their faces under "COROS W336". */
const REPORTED_MODELS: Record<string, string> = { R4: "pace-4" };

export const targetNamed = (id: string): WatchTarget | null => TARGETS.find((x) => x.id === id) ?? null;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The target for a reported model number ("W332", "W332-3.2008.0"); longer hardware IDs first so "B19S" isn't "B19". */
export function targetForModelNumber(value: string | null | undefined): WatchTarget | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  const reports = (word: string) => new RegExp(`\\b${escape(word)}\\b`).test(upper);
  const byHardware = [...TARGETS].sort((a, b) => b.hardware.length - a.hardware.length).find((x) => reports(x.hardware));
  if (byHardware) return byHardware;
  const reported = Object.entries(REPORTED_MODELS).find(([word]) => reports(word));
  return reported ? targetNamed(reported[1]) : null;
}

/** Watches advertise a unique suffix after the model ("COROS PACE Pro 2F1A6C"); people only need the model. */
export function displayName(name: string): string {
  const trimmed = name.replace(/\s+[0-9A-Fa-f]{4,8}$/, "");
  return trimmed || name;
}

/** The target for an advertised name ("COROS APEX 4 81D0"). */
export function targetForAdvertisedName(name: string | null | undefined): WatchTarget | null {
  if (!name) return null;
  const model = displayName(name).toLowerCase();
  return TARGETS.find((x) => `coros ${x.label}`.toLowerCase() === model) ?? null;
}

/** What a connected watch reported through the standard GATT services. */
export interface DeviceInfo {
  name: string;
  modelNumber?: string;
  firmwareRevision?: string;
  softwareRevision?: string;
  serialNumber?: string;
  batteryPercent?: number;
  maximumWriteBytes: number;
}

/** The face target for this watch: from its model number, else from its advertised name. */
export const targetOf = (info: DeviceInfo): WatchTarget | null => targetForModelNumber(info.modelNumber) ?? targetForAdvertisedName(info.name);

export function firmwareLabel(info: DeviceInfo): string | null {
  const raw = info.softwareRevision ?? info.firmwareRevision;
  return raw == null ? null : raw.replace(/^V\s*/i, "");
}

/** What C-LINK reads from and writes to each watch model (CorosKit's WatchFeature, in its order). */
export const FEATURES = ["healthSync", "settings", "profile", "clockFormat", "weather", "dailyGoal", "liveWorkout", "workouts", "alarms", "satelliteMode", "gearList"] as const;
export type Feature = (typeof FEATURES)[number];

const CHECKED_MODELS = new Set(["pace-4", "pace-4-pro", "pace-pro", "apex-4", "pace-3"]);

/** Satellite Systems choices per model (CorosKit's WatchSatelliteMode.choices(for:)); null where C-LINK can't set it. */
export function satelliteChoices(target: WatchTarget | null): string[] | null {
  switch (target?.id) {
    case "pace-pro": return ["allSystems", "dualFrequency"];
    case "pace-3": return ["standard", "allSystems", "dualFrequency"];
    default: return null;
  }
}

export const supports = (info: DeviceInfo, feature: Feature): boolean => supportsOn(targetOf(info), feature);

export function supportsOn(target: WatchTarget | null, feature: Feature): boolean {
  if (!target) return false;
  if (feature === "satelliteMode") return satelliteChoices(target) !== null;
  return CHECKED_MODELS.has(target.id);
}
