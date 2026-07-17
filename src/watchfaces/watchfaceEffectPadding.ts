import type {
  CorosWatchfaceConfigOverride,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import type { WatchfaceEffectPadding } from "./watchfaceEditorEffects.ts";

function expandConfigRect(
  value: string | undefined,
  padding: WatchfaceEffectPadding
): string | null {
  const match = value?.match(
    /^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*((?:,[^}]*)?)\}$/
  );
  if (!match) return null;
  return `{${Number(match[1]) - padding.left},${Number(match[2]) - padding.top},${Number(match[3]) + padding.right},${Number(match[4]) + padding.bottom}${match[5]}}`;
}

function shiftConfigPos(
  value: string | undefined,
  padding: WatchfaceEffectPadding
): string | null {
  const match = value?.match(/^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}$/);
  return match
    ? `{${Number(match[1]) - padding.left},${Number(match[2]) - padding.top}}`
    : null;
}

/** Expands Studio-owned sprite slots while preserving their visible anchor. */
export function buildWatchfaceEffectPaddingOverrides(
  details: CorosWatchfaceTemplateDetails,
  paddingByResolution: Map<string, Map<string, WatchfaceEffectPadding>>
): CorosWatchfaceConfigOverride[] {
  return details.resolutions.flatMap((resolution) => {
    const padding = paddingByResolution.get(resolution.directory);
    if (!padding) return [];
    const values: Record<string, string> = {};
    const rectKeys: Record<string, string[]> = {
      battery: ["battery_level_rect"],
      heartRate: ["heart_rate_rect"],
      steps: ["steps_rect"],
      calories: ["calories_rect"],
      elevation: ["elevation_rect"],
      temperature: ["temperature_rect"],
      weekday: ["english_date_week_rect"],
      dateMonth: ["english_date_month_rect"],
      dateDay: ["english_date_day_rect"]
    };
    for (const [layerId, keys] of Object.entries(rectKeys)) {
      const layerPadding = padding.get(layerId);
      if (!layerPadding) continue;
      for (const key of keys) {
        const rect = expandConfigRect(resolution.config[key], layerPadding);
        if (rect) values[key] = rect;
      }
    }
    for (const [layerId, prefix] of [
      ["hours", "time_hour"],
      ["minutes", "time_minute"],
      ["seconds", "time_second"]
    ] as const) {
      const layerPadding = padding.get(layerId);
      if (!layerPadding) continue;
      for (const suffix of ["high", "low"] as const) {
        const key = `${prefix}_${suffix}_pos`;
        const pos = shiftConfigPos(resolution.config[key], layerPadding);
        if (pos) values[key] = pos;
      }
    }
    const autoPadding = padding.get("autoTime");
    if (autoPadding) {
      const rect = expandConfigRect(resolution.config.autoalign_time_rect, autoPadding);
      if (rect) values.autoalign_time_rect = rect;
    }
    const batteryIconPadding = padding.get("batteryIcon");
    if (batteryIconPadding) {
      const pos = shiftConfigPos(resolution.config.battery_icon_pos, batteryIconPadding);
      if (pos) values.battery_icon_pos = pos;
    }
    const complicationPadding = padding.get("complication");
    if (complicationPadding) {
      for (const key of Object.keys(resolution.config)) {
        if (!/^control_.+_rect$/.test(key)) continue;
        const rect = expandConfigRect(resolution.config[key], complicationPadding);
        if (rect) values[key] = rect;
      }
    }
    return Object.keys(values).length > 0
      ? [{ path: `${resolution.directory}/config.txt`, values }]
      : [];
  });
}
