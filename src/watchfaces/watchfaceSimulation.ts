import type { WatchfaceStudioOptions } from "./watchfaceStudio";
import { NATIVE_DATA_FIELDS, NATIVE_CHART_SOURCES } from "../../electron/watchfaceNativeCatalog";

/** Preview state is intentionally separate from the saved/exported design. */
export interface WatchfacePreviewScenario {
  dateTime?: string;
  values?: Record<string, string>;
  weather?: { condition: number; night: boolean };
  chartHistory?: number[];
}

export interface WatchfaceSimulation extends WatchfacePreviewScenario {
  enabled: boolean;
  playing: boolean;
  speed: number;
  dateTime: string;
  values: Record<string, string>;
}

export const SIMULATION_SPEEDS = [1, 60, 3600, 86400] as const;
export const WATCHFACE_SIMULATION_CAPABILITIES = {
  editorOnly: true,
  speeds: SIMULATION_SPEEDS,
  dateTime: "ISO date-time, years 1900–9999. No offset means local time; time-zone offsets are converted to local time. Drives clock, AM/PM, weekday, month and day in existing layers.",
  values: ["battery", "steps", "heartRate", "calories", "exercise", "elevation", "temperature", "floors", "barometer", "sunrise", "sunset", "kcalProgress", "exerciseProgress", ...NATIVE_DATA_FIELDS.map(field => field.id), ...NATIVE_CHART_SOURCES.map(source => source.id)],
  valueFormat: "String samples. Use h:mm for time fields, numbers for other values, integer state indices for wind direction / HRV / moon phase. Battery and progress: 0–100. temperature is the watch sensor; weather_temp is weather temperature. They are independent. Values replace the current map. Unspecified fields use their design samples.",
  weather: { condition: "Asset index 0–40", night: "Boolean selecting day/night artwork" },
  chartHistory: "2–120 normalized numbers between 0 and 1; sample plot heights, not firmware-generated history.",
  limitations: "Preview simulation; not firmware emulation. Only supported fields present in the selected display mode render. Battery states approximate normal charge levels; special charging states are excluded. Year controls the calendar; a year label requires template support."
} as const;
const pad = (value: number, length = 2) => String(value).padStart(length, "0");
export function simulationDateTime(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function createWatchfaceSimulation(now = new Date()): WatchfaceSimulation {
  return { enabled: false, playing: false, speed: 1, dateTime: simulationDateTime(now), values: {} };
}

export function parseSimulationDateTime(value: string): Date {
  if (value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) {
    throw new Error("Use an ISO date-time, such as 2028-02-29T23:59:58.");
  }
  const [year, month, day, hour, minute, second = 0] = value.split(/\D/).slice(0, 6).map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = new Date(value);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59 || !Number.isFinite(date.getTime()) || date.getFullYear() < 1900 || date.getFullYear() > 9999) {
    throw new Error("Choose a valid date between 1900 and 9999 and a valid time.");
  }
  return date;
}

export function advanceSimulationDateTime(value: string, seconds: number): string {
  const date = parseSimulationDateTime(value);
  date.setTime(date.getTime() + seconds * 1000);
  // Stop at the supported calendar boundary rather than letting playback throw.
  if (date.getFullYear() > 9999) return "9999-12-31T23:59:59";
  if (date.getFullYear() < 1900) return "1900-01-01T00:00:00";
  return simulationDateTime(date);
}

export function parseWatchfacePreviewScenario(value: unknown): WatchfacePreviewScenario {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("scenario must be an object.");
  const raw = value as Record<string, unknown>;
  const result: WatchfacePreviewScenario = {};
  if (raw.dateTime !== undefined) {
    if (typeof raw.dateTime !== "string") throw new Error("scenario.dateTime must be an ISO date-time string.");
    result.dateTime = simulationDateTime(parseSimulationDateTime(raw.dateTime));
  }
  if (raw.values !== undefined) {
    if (!raw.values || typeof raw.values !== "object" || Array.isArray(raw.values)) throw new Error("scenario.values must be an object of strings.");
    const entries = Object.entries(raw.values);
    if (entries.length > 64 || entries.some(([key, entry]) => key.length > 80 || typeof entry !== "string" || entry.length > 160)) throw new Error("Use at most 64 values with string values up to 160 characters.");
    result.values = Object.fromEntries(entries) as Record<string, string>;
    for (const key of ["battery", "kcalProgress", "exerciseProgress"]) {
      if (result.values[key] !== undefined && (!result.values[key].trim() || !Number.isFinite(Number(result.values[key])) || Number(result.values[key]) < 0 || Number(result.values[key]) > 100)) throw new Error(`${key} must be between 0 and 100.`);
    }
  }
  if (raw.weather !== undefined) {
    const weather = raw.weather as Record<string, unknown> | null;
    if (!weather || !Number.isInteger(weather.condition) || Number(weather.condition) < 0 || Number(weather.condition) > 40 || typeof weather.night !== "boolean") throw new Error("weather requires condition (0–40) and night (boolean).");
    result.weather = { condition: Number(weather.condition), night: weather.night };
  }
  if (raw.chartHistory !== undefined) {
    if (!Array.isArray(raw.chartHistory) || raw.chartHistory.length < 2 || raw.chartHistory.length > 120 || raw.chartHistory.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) throw new Error("chartHistory needs 2–120 numbers between 0 and 1.");
    result.chartHistory = [...raw.chartHistory];
  }
  return result;
}

export function patchWatchfaceSimulation(current: WatchfaceSimulation, value: unknown): WatchfaceSimulation {
  const scenario = parseWatchfacePreviewScenario(value);
  const raw = value as Record<string, unknown>;
  for (const key of ["enabled", "playing"]) if (raw[key] !== undefined && typeof raw[key] !== "boolean") throw new Error(`${key} must be a boolean.`);
  if (raw.speed !== undefined && !SIMULATION_SPEEDS.includes(raw.speed as typeof SIMULATION_SPEEDS[number])) throw new Error("speed must be 1, 60, 3600 or 86400.");
  const next = { ...current, ...scenario, enabled: (raw.enabled ?? current.enabled) as boolean, playing: (raw.playing ?? current.playing) as boolean, speed: (raw.speed ?? current.speed) as number };
  if (!next.enabled) next.playing = false;
  return next;
}

export function activeSimulationScenario(state: WatchfaceSimulation): WatchfacePreviewScenario | undefined {
  if (!state.enabled) return undefined;
  return { dateTime: state.dateTime, values: state.values, weather: state.weather, chartHistory: state.chartHistory };
}

export function simulationStudioOptions(scenario?: WatchfacePreviewScenario): Partial<WatchfaceStudioOptions> {
  if (!scenario) return {};
  const values = scenario.values;
  return {
    ...(scenario.dateTime ? { previewDate: parseSimulationDateTime(scenario.dateTime) } : {}),
    ...(values ? { previewValues: values } : {}),
    ...(values?.kcalProgress !== undefined ? { kcalProgressPreviewPercent: Number(values.kcalProgress) } : {}),
    ...(values?.exerciseProgress !== undefined ? { exerciseProgressPreviewPercent: Number(values.exerciseProgress) } : {})
  };
}

export function simulationPreset(id: string, current: WatchfaceSimulation, now = new Date()): WatchfaceSimulation {
  const base = { ...current, enabled: true, playing: false };
  const year = now.getFullYear();
  if (id === "midnight") return { ...base, dateTime: `${simulationDateTime(now).slice(0, 10)}T23:59:58` };
  if (id === "yearEnd") return { ...base, dateTime: `${year}-12-31T23:59:58` };
  if (id === "leapDay") return { ...base, dateTime: "2028-02-28T23:59:58" };
  if (id === "lowBattery") return { ...base, values: { ...base.values, battery: "5" } };
  if (id === "fullBattery") return { ...base, values: { ...base.values, battery: "100" } };
  if (id === "wide") return { ...base, dateTime: `${year}-08-28T20:58:58`, values: { ...base.values, battery: "100", steps: "88888", calories: "8888", kcal: "8888", elevation: "8888", heartRate: "188", exercise: "88:58", weather_temp: "-18", temperature: "-18", week_tl: "8888" } };
  return { ...createWatchfaceSimulation(now), enabled: true };
}
