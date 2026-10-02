import type { CorosWatchfaceDesignState } from "../../electron/types";

/**
 * Which watch system languages show the weekday as designed. The watch reads
 * a separate date table per language (germany_date_*, …); month and day
 * digits are always copied to every table at export, so this only decides
 * whether the designed weekday replaces the template's translated labels —
 * custom weekday sprites or, for a template weekday, the English set.
 */
export type WatchfaceWatchLanguages = "all" | "english" | string[];

export const WATCH_LANGUAGE_NAMES: Record<string, string> = {
  chinese: "Chinese (Simplified)",
  chinese_tw: "Chinese (Traditional)",
  germany: "German",
  spanish: "Spanish",
  french: "French",
  japanese: "Japanese",
  thai: "Thai",
  polish: "Polish",
  portugal: "Portuguese",
  italian: "Italian",
  korean: "Korean",
  russian: "Russian"
};

const PREFERENCE_KEY = "coroslink.watchface.watchLanguages";

function isWatchLanguages(value: unknown): value is WatchfaceWatchLanguages {
  return value === "all" || value === "english" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string" && /^[a-z_]+$/.test(item)));
}

/** The last choice made in the Export panel; new projects start from it. */
export function loadWatchLanguagesPreference(): WatchfaceWatchLanguages {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "null");
    if (isWatchLanguages(stored)) return stored;
  } catch {
    // Storage may be unavailable; fall through to the default.
  }
  return "all";
}

export function saveWatchLanguagesPreference(value: WatchfaceWatchLanguages): void {
  try {
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify(value));
  } catch {
    // Best effort: the project still records its own choice.
  }
}

/**
 * The project's choice, else a legacy per-weekday setting from older
 * projects, else the remembered preference. A template weekday is already
 * translated, so without a project choice it keeps every translation.
 */
export function effectiveWatchLanguages(
  design: CorosWatchfaceDesignState,
  preference: WatchfaceWatchLanguages
): WatchfaceWatchLanguages {
  if (isWatchLanguages(design.watchLanguages)) return design.watchLanguages;
  const weekday = design.dateStyles?.weekday;
  if (weekday?.overwriteAllLanguages) return "all";
  if (weekday?.overwriteLanguages) return weekday.overwriteLanguages;
  return weekday ? preference : "english";
}

/** Applies the language choice to the weekday style the compiler reads. */
export function withWatchLanguages(
  design: CorosWatchfaceDesignState,
  preference: WatchfaceWatchLanguages
): CorosWatchfaceDesignState {
  const weekday = design.dateStyles?.weekday;
  if (!weekday) return design;
  const languages = effectiveWatchLanguages(design, preference);
  return {
    ...design,
    dateStyles: {
      ...design.dateStyles,
      weekday: {
        ...weekday,
        overwriteAllLanguages: languages === "all",
        overwriteLanguages: Array.isArray(languages) ? languages : undefined
      }
    }
  };
}
