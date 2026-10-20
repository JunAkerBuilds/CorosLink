import { t, useLanguage } from "../i18n/watchfaces";
import type { EditorLayer } from "./watchfaceEditorModel";
import { nativeLayerChartPages, type NativeData } from "./nativeData";
import "./watchfaceMetricKinds.css";

/**
 * How the watch shows a metric layer. Studio used to list all three as plain
 * "Metrics", so a chart readout looked like a field that could be fixed.
 *  - fixed: one value, always in one spot (step_rect, stress, wind …)
 *  - selectable: the wearer picks what fills the slot in the face settings (rect_control1_pos)
 *  - pages: the native chart; Back on the watch cycles its pages
 *  - paged: a fixed field the watch hides on some chart pages (weather on the sun page)
 */
export type WatchfaceMetricKind = "fixed" | "selectable" | "pages" | "paged";

const tag = (kind: WatchfaceMetricKind) =>
  kind === "fixed" ? t("Fixed") : kind === "selectable" ? t("Selectable") : kind === "paged" ? t("Some pages") : t("Chart pages");
const note = (kind: WatchfaceMetricKind) =>
  kind === "fixed" ? t("Always shows this value in this spot.")
    : kind === "selectable" ? t("The wearer picks which value fills this slot in the watch face settings.")
      : kind === "paged" ? t("The watch hides this on some chart pages. The list below says where.")
        : t("The watch shows one chart page at a time. Back on the watch cycles the pages.");

export function watchfaceMetricKind(layer: Pick<EditorLayer, "kind" | "metricId" | "nativeDataId">, nativeData: NativeData = {}): WatchfaceMetricKind | null {
  if (layer.kind === "complication") return "selectable";
  // chart_sun_angle is a chart readout too: it shows only on the sun page.
  if (layer.nativeDataId?.startsWith("chart")) return "pages";
  // Weather the watch hides on some chart pages (nativeLayerChartPages).
  if (layer.nativeDataId && nativeLayerChartPages(layer.nativeDataId, nativeData)) return "paged";
  if (layer.nativeDataId === "date_year") return null;
  return layer.metricId || layer.nativeDataId ? "fixed" : null;
}

export function MetricKindTag({ kind }: { kind: WatchfaceMetricKind }) {
  useLanguage();
  return <span className={`wf-metric-kind wf-metric-kind--${kind}`} title={note(kind)}>{tag(kind)}</span>;
}

/** The inspector's first line for a metric layer: its kind and what that means on the watch. */
export function MetricKindNote({ kind }: { kind: WatchfaceMetricKind }) {
  useLanguage();
  return <p className="wf-metric-kind-note"><MetricKindTag kind={kind} /><span>{note(kind)}</span></p>;
}
