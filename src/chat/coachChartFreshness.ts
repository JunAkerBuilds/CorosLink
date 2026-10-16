import { t } from "../i18n/toolsLocale";
import type { CoachChartFreshness, CoachChartPreview } from "../../electron/types";
import type { CoachPrefill } from "./chatTypes";

/** Pins match by title, so a re-rendered chart replaces its older pin. */
export function normalizeCoachChartTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Older previews predate the freshness field; fall back to the live flag. */
export function coachChartFreshness(preview: CoachChartPreview): CoachChartFreshness {
  return preview.freshness ?? (preview.live ? "partial" : "snapshot");
}

/** Short label for the freshness pill. */
export function freshnessLabel(freshness: CoachChartFreshness): string {
  switch (freshness) {
    case "live":
      return t("Live", undefined, "coachChart");
    case "partial":
      return t("Partly live");
    default:
      return t("Snapshot");
  }
}

/** What the pill means for a pinned copy, for its tooltip. */
export function freshnessHint(freshness: CoachChartFreshness): string {
  switch (freshness) {
    case "live":
      return t("Every series and tile is bound to your data, so the pinned copy refreshes itself.");
    case "partial":
      return t("Bound parts refresh on the Training Hub; inline values stay as drawn.");
    default:
      return t("Nothing here is bound to your data, so the pinned copy never changes.");
  }
}

/** "just now", "12 min ago", "3 h ago", "yesterday", else a short date. */
export function formatRelativeTime(iso: string, now: Date = new Date(), locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{{count}} min ago", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{{count}} h ago", { count: hours });
  if (hours < 48) return t("yesterday");
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/**
 * Prompt that asks Coach to rebuild a snapshot chart with bound metrics. The
 * athlete sees one sentence; the spec rides along as an attachment without
 * its inline numbers, which is what we want replaced.
 */
export function buildMakeLivePrompt(preview: CoachChartPreview): CoachPrefill {
  const spec = preview.spec;
  const outline = {
    title: spec.title,
    subtitle: spec.subtitle,
    days: spec.days,
    series: spec.series.map((entry) => ({
      label: entry.label,
      metric: entry.metric,
      kind: entry.kind,
      axis: entry.axis,
      ...(entry.values ? { values: `${entry.values.length} inline values` } : {})
    })),
    tiles: spec.tiles?.map((tile) => ({
      label: tile.label,
      metric: tile.metric,
      stat: tile.stat,
      ...(tile.metric ? {} : { value: tile.value })
    })),
    ranges: spec.ranges,
    note: spec.note
  };
  return {
    text: t("Make my pinned chart “{{title}}” update by itself.", { title: spec.title }),
    attachment: {
      kind: "chart",
      label: spec.title,
      content: [
        "Pinned chart to rebuild (current spec, inline numbers omitted):",
        "```json",
        JSON.stringify(outline, null, 2),
        "```",
        "Call render_chart again with the same title so the pin is replaced in place. Bind every series and tile to a metric (tiles also take a stat) instead of inline values, keep the layout, and tell the athlete which parts cannot be bound."
      ].join("\n")
    }
  };
}
