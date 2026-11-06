import { WATCHFACE_FIXED_METRICS } from "./watchfaceStudio.ts";
import { parseSimulationDateTime, type WatchfacePreviewScenario } from "./watchfaceSimulation.ts";
import type { EditorLayer } from "./watchfaceEditorModel.ts";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * The value a layer row shows beside its name: what the preview draws for it,
 * so a row reads "Steps 8420" instead of only "Steps". Empty when the layer
 * has no single readable value (artwork, icons, charts).
 */
export function watchfaceLayerSampleValue(
  layer: Pick<EditorLayer, "kind" | "metricId" | "timePartId" | "id" | "layoutGroupId">,
  scenario: WatchfacePreviewScenario | undefined,
  now: Date
): string {
  const date = scenario?.dateTime ? parseSimulationDateTime(scenario.dateTime) : now;
  if (layer.timePartId === "hours") return String(date.getHours()).padStart(2, "0");
  if (layer.timePartId === "minutes") return String(date.getMinutes()).padStart(2, "0");
  if (layer.timePartId === "seconds" || layer.kind === "seconds") return String(date.getSeconds()).padStart(2, "0");
  if (layer.kind === "time") return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (layer.kind === "weekday") return WEEKDAYS[date.getDay()];
  // A template month may be a number or a word picture; don't guess which.
  if (layer.layoutGroupId === "dateMonth") return "";
  if (layer.kind === "date") return String(date.getDate());
  if (layer.metricId) {
    const override = scenario?.values?.[layer.metricId];
    if (override) return override;
    return WATCHFACE_FIXED_METRICS.find((metric) => metric.id === layer.metricId)?.sampleValue ?? "";
  }
  return "";
}
