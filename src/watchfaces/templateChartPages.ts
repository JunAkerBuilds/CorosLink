import type { CorosWatchfaceNativeDataStyle, CorosWatchfaceResolutionDetails } from "../../electron/types";
import { NATIVE_CHART_BAR_PAGES, NATIVE_CHART_PAGES, NATIVE_DATA_BY_ID, nativeChartSourceKeys, nativeFieldKeys } from "../../electron/watchfaceNativeCatalog";
import { COROS_CONFIG_DELETE_VALUE } from "./watchfaceStudio";

/**
 * What the design does with a watch page: "hidden" keeps the page with every
 * readout invisible (the watch still stops there, and min/max still draw on a
 * daily page); "removed" takes the page off the watch. Pages without a mode
 * follow the face.
 */
export type ChartPageMode = "hidden" | "removed";
export type ChartPageModes = Partial<Record<string, ChartPageMode>>;

export interface FaceChartPage {
  id: string;
  /** The watch shows this page (Back stops here). */
  on: boolean;
  /** On, but nothing on it is visible. */
  empty: boolean;
  /** Readouts the face declares for this page, and whether each draws anything. */
  readouts: { source: string; visible: boolean }[];
  mode?: ChartPageMode;
}

const isBarPage = (id: string) => (NATIVE_CHART_BAR_PAGES as readonly string[]).includes(id);
const fontKey = (source: string) => source === "chart_moon" ? "chart_moon_icon" : `${source}_font`;

/**
 * The chart pages a face without a Studio chart layer leaves on the watch.
 * Official faces such as SIMPLE declare daily and sun readouts with no graph
 * (no chart_rect), so Studio builds no chart layer, yet the watch still pages
 * through them (PACE Pro, 2026-11-01). Firmware rules as in NATIVE_CHART_PAGES:
 * barometer and tide while the bar width is above 0, the others only with all
 * their required readouts.
 */
export function templateChartPages(resolution: Pick<CorosWatchfaceResolutionDetails, "config" | "directory" | "icons" | "spriteFolders">,
  modes: ChartPageModes = {}): FaceChartPage[] {
  const { config } = resolution;
  const files = [...resolution.icons, ...resolution.spriteFolders.flatMap(folder => folder.files)];
  const set = (key: string) => Boolean(config[key]?.trim()) && config[key] !== COROS_CONFIG_DELETE_VALUE;
  const has = (source: string) => set(fontKey(source));
  // Studio's invisible readouts are 1x1 transparent frames.
  const blank = (key: string) => {
    const relative = config[key]?.replace(/\\/g, "/");
    if (!relative) return true;
    if (/^cl_nd_(chart_blank|blank_icon)/.test(relative)) return true;
    const path = `${resolution.directory}/${relative}`;
    const found = files.filter(file => file.path === path || file.path.startsWith(`${path}/`));
    return found.length > 0 && found.every(file => file.width <= 1 && file.height <= 1);
  };
  const barWidth = Number(config.chart_bar_width);
  return NATIVE_CHART_PAGES.flatMap(page => {
    const readouts = page.sources.filter(has).map(source => ({ source, visible: !blank(fontKey(source)) }));
    const bars = isBarPage(page.id);
    const declared = bars ? set("chart_bar_width") && Number.isFinite(barWidth) && barWidth > 0
      : page.required.length > 0 && page.required.every(has);
    const mode = bars ? undefined : modes[page.id];
    if (!declared && !readouts.length && !mode) return [];
    const on = mode === "removed" ? false : mode === "hidden" ? true : declared;
    const empty = on && (mode === "hidden" || !readouts.some(readout => readout.visible));
    return [{ id: page.id, on, empty, readouts, ...(mode ? { mode } : {}) }];
  });
}

/**
 * Keys a turned-off chart layer clears on export (composeNativeData): every
 * chart key, the template's own readouts included. Hiding the chart takes all
 * its pages off the watch, like hiding any other layer (2026-11-06); only
 * pages the design keeps on purpose (chartPageModes "hidden") stay.
 */
export function turnedOffChartKeys(chart: CorosWatchfaceNativeDataStyle | undefined): string[] {
  if (!chart || chart.enabled) return [];
  return nativeFieldKeys(NATIVE_DATA_BY_ID.get("chart")!);
}

/** A resolution config without the keys a turned-off chart clears. */
export function withoutTurnedOffChart<T extends { config: Record<string, string> }>(resolution: T, chart: CorosWatchfaceNativeDataStyle | undefined): T {
  const keys = turnedOffChartKeys(chart);
  if (!keys.length) return resolution;
  const config = { ...resolution.config };
  for (const key of keys) delete config[key];
  return { ...resolution, config };
}

/** Ids of the pages a face shows, in Back order. */
export function onChartPageIds(pages: FaceChartPage[]): string[] {
  return pages.filter(page => page.on).map(page => page.id);
}

/**
 * Config writes for the page modes of a face without a chart layer. A hidden
 * page keeps every readout it needs as 1x1 transparent frames at the
 * readout's own place (or the top-left corner for one the face never had).
 * A removed page loses its readouts; the daily divider goes with the last
 * daily page and turns invisible while every daily page is hidden.
 */
export function templateChartPageOverrides(config: Record<string, string>, modes: ChartPageModes,
  blank: { icon: () => string; frames: (folder: string, count: number) => string }): Record<string, string> {
  const values: Record<string, string> = {};
  const set = (key: string) => Boolean(config[key]?.trim()) && config[key] !== COROS_CONFIG_DELETE_VALUE;
  const tiny = "{0,0,8,4,left|vcenter}";
  for (const page of NATIVE_CHART_PAGES) {
    const mode = isBarPage(page.id) ? undefined : modes[page.id];
    if (mode === "removed") {
      for (const source of page.sources) for (const key of nativeChartSourceKeys(source)) if (set(key)) values[key] = COROS_CONFIG_DELETE_VALUE;
    } else if (mode === "hidden") {
      for (const source of page.sources) {
        if (!page.required.includes(source) && !set(source === "chart_moon" ? "chart_moon_icon" : `${source}_font`)) continue;
        if (source === "chart_moon") {
          values.chart_moon_icon = blank.frames("cl_nd_chart_blank_moon", 30);
          if (!set("chart_moon_icon_pos")) values.chart_moon_icon_pos = "{0,0}";
          continue;
        }
        values[`${source}_font`] = blank.frames("cl_nd_chart_blank_digits", 10);
        values[`${source}_icon`] = blank.icon();
        if (!set(`${source}_icon_pos`)) values[`${source}_icon_pos`] = "{0,0}";
        if (source === "chart_sunrise" || source === "chart_moonrise") {
          values[source === "chart_sunrise" ? "chart_sunset_icon" : "chart_moonset_icon"] = blank.icon();
          for (const key of [`${source}_hour_rect`, `${source}_minute_rect`]) if (!set(key)) values[key] = tiny;
        } else if (!set(`${source}_rect`)) values[`${source}_rect`] = tiny;
      }
    }
  }
  const daily = NATIVE_CHART_PAGES.filter(page => page.id.startsWith("daily-"));
  const dailyOn = daily.filter(page => modes[page.id] !== "removed" && (modes[page.id] === "hidden" || page.required.every(source => set(`${source}_font`))));
  if (set("chart_item3_bg")) {
    if (!dailyOn.length) { values.chart_item3_bg = COROS_CONFIG_DELETE_VALUE; values.chart_item3_bg_pos = COROS_CONFIG_DELETE_VALUE; }
    else if (dailyOn.every(page => modes[page.id] === "hidden")) values.chart_item3_bg = blank.icon();
  }
  return values;
}

/** Keys of the pages a chart-layer face removes: export deletes them after every write. */
export function removedChartPageKeys(modes: ChartPageModes | undefined): string[] {
  return NATIVE_CHART_PAGES.filter(page => !isBarPage(page.id) && modes?.[page.id] === "removed")
    .flatMap(page => page.sources.flatMap(nativeChartSourceKeys));
}
