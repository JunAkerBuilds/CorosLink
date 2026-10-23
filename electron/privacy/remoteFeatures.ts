import { LOCAL_ONLY_ERROR_PREFIX } from "./dataModeTypes";

/**
 * Every IPC channel the main process handles, classified for Local-Only Mode.
 *
 * - `local`: unaffected. Includes reading from COROS (activity lists,
 *   dashboards, MCP queries, maps, watch-face themes) and every other online
 *   service: Local-Only Mode stops data going *to* COROS; it is not offline.
 * - `upload`: sends the athlete's data to COROS (activities, workouts, plans,
 *   schedules, gear, watch faces); refused with a clear message.
 * - `routed`: the handler serves data held on this computer in Local-Only Mode.
 *
 * Classification is per channel prefix with explicit exceptions. A test fails
 * when a registered channel's prefix is missing here, so new features must be
 * classified before they ship. The HTTP guards remain the enforcement
 * backstop; this registry makes the refusal explicit and early.
 */

export type FeatureClass = "local" | "upload" | "routed";

interface PrefixRule {
  feature: string;
  default: FeatureClass;
  channels?: Record<string, FeatureClass>;
}

const LOCAL = (feature: string): PrefixRule => ({ feature, default: "local" });

export const REMOTE_FEATURE_RULES: Readonly<Record<string, PrefixRule>> = {
  app: LOCAL("App"),
  appleCalendar: LOCAL("Apple Calendar"),
  appleMusic: LOCAL("Apple Music"),
  applePodcasts: LOCAL("Apple Podcasts"),
  audiobooks: LOCAL("Audiobooks"),
  binaries: LOCAL("Media tools"),
  calendar: LOCAL("Calendar"),
  // Coach plans, workouts and deletes go to CorosLink's local library and calendar in Local-Only Mode.
  chat: { feature: "Saving Coach plans and workouts to COROS", default: "local", channels: {
    uploadPlanDraft: "routed", confirmCorosAction: "upload", confirmWorkoutDelete: "routed"
  } },
  chatMcp: LOCAL("COROS MCP"),
  // The handler refuses only the approvals that would write to COROS (COROS actions, strength edits).
  coach: { feature: "Saving Coach changes to COROS", default: "local", channels: { confirm: "routed" } },
  coachMemory: LOCAL("Coach memory"),
  coachCharts: LOCAL("Coach charts"),
  coros: { feature: "Adding activities to COROS", default: "upload" },
  corosBle: LOCAL("Watch over Bluetooth"),
  dataMode: LOCAL("Privacy"),
  diagnostics: LOCAL("Diagnostics"),
  downloads: LOCAL("Downloads"),
  fitIndex: LOCAL("FIT index"),
  freeAudiobooks: LOCAL("Free audiobooks"),
  gear: { feature: "Saving gear to COROS", default: "local", channels: { save: "upload" } },
  googleCalendar: LOCAL("Google Calendar"),
  hevy: LOCAL("Hevy"),
  intervals: { feature: "Importing intervals.icu activities into COROS", default: "local", channels: { import: "upload" } },
  localData: LOCAL("Local data"),
  maps: LOCAL("Maps"),
  mcp: LOCAL("MCP servers"),
  music: LOCAL("Music downloads"),
  races: LOCAL("Races"),
  remote: LOCAL("Remote access"),
  spotify: LOCAL("Spotify"),
  strava: LOCAL("Strava"),
  trainingHub: { feature: "Saving workouts and plans to COROS", default: "local", channels: {
    listActivities: "routed", getActivityDetail: "routed",
    exportActivityFile: "routed", exportLatestActivityFile: "routed",
    getDailyHealthData: "routed", getSleepData: "routed", getHealthInsight: "routed",
    getActivityPaceBaselines: "routed",
    // The workout library and training calendar live on this computer in Local-Only Mode (localSync/localTrainingBackend.ts).
    copyScheduledWorkout: "routed", createAndScheduleWorkout: "routed", createLibraryWorkout: "routed",
    duplicateLibraryWorkout: "routed", removeScheduledWorkout: "routed", rescheduleWorkout: "routed",
    saveWorkoutEdit: "routed", scheduleLibraryWorkout: "routed", uploadTrainingPlan: "routed"
  } },
  trainingLibrary: { feature: "Adding plans to the COROS calendar", default: "local", channels: {
    addPlanToCalendar: "routed", removePlanFromCalendar: "routed"
  } },
  watch: LOCAL("Watch over USB"),
  watchfaceAi: LOCAL("Watch face AI"),
  watchfaceAutomation: LOCAL("Watch face automation"),
  watchfaces: { feature: "Publishing watch faces to COROS", default: "local", channels: { publish: "upload", createShareLink: "upload" } },
  window: LOCAL("Window"),
  workoutAutomation: LOCAL("Workout automation"),
  workoutEdits: { feature: "Saving workout edits to COROS", default: "local", channels: { confirm: "upload" } },
  workoutJournal: LOCAL("Workout journal"),
  youtube: LOCAL("YouTube"),
  youtubeMusic: LOCAL("YouTube Music")
};

export interface ChannelClassification {
  known: boolean;
  feature: string;
  class: FeatureClass;
}

export function classifyChannel(channel: string): ChannelClassification {
  const separator = channel.indexOf(":");
  const prefix = separator > 0 ? channel.slice(0, separator) : channel;
  const name = separator > 0 ? channel.slice(separator + 1) : "";
  const rule = REMOTE_FEATURE_RULES[prefix];
  if (!rule) return { known: false, feature: prefix, class: "local" };
  return { known: true, feature: rule.feature, class: rule.channels?.[name] ?? rule.default };
}

export class LocalOnlyFeatureError extends Error {
  readonly code = "COROSLINK_LOCAL_ONLY_FEATURE";
  constructor(readonly feature: string) {
    super(`${LOCAL_ONLY_ERROR_PREFIX} ${feature} is turned off because it would send your data to COROS. Switch to Connected Mode in Settings → Privacy & local data to use it.`);
    this.name = "LocalOnlyFeatureError";
  }
}

export interface IpcGatePolicy {
  readonly enforcing: boolean;
}

/** Throws when Local-Only Mode refuses this channel. */
export function assertChannelAllowed(channel: string, policy: IpcGatePolicy): void {
  if (!policy.enforcing) return;
  const classification = classifyChannel(channel);
  if (classification.class === "upload") throw new LocalOnlyFeatureError(classification.feature);
}

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

interface IpcMainLike {
  handle(channel: string, listener: IpcHandler): void;
}

/**
 * Wraps `ipcMain.handle` so every handler registered afterwards (from any
 * module) is refused in Local-Only Mode when its channel would upload to COROS.
 */
export function installIpcPolicyGate(ipc: IpcMainLike, policy: IpcGatePolicy, onUnknown?: (channel: string) => void): void {
  const original = ipc.handle.bind(ipc);
  const gated = (channel: string, listener: IpcHandler) => {
    if (!classifyChannel(channel).known) onUnknown?.(channel);
    original(channel, (event: unknown, ...args: unknown[]) => {
      assertChannelAllowed(channel, policy);
      return listener(event, ...args);
    });
  };
  try {
    Object.defineProperty(ipc, "handle", { value: gated, configurable: true, writable: true });
  } catch {
    console.warn("[privacy] Could not gate ipcMain.handle; the network guards still refuse uploads to COROS.");
  }
}
