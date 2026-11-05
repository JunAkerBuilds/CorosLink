import type { CorosWatchfaceDesignState } from "../../electron/types";

/**
 * Face colors: the colors the user has set on parts of this face, so the
 * "This face" panel can show them as one palette and recolor every part that
 * shares one. Template parts still drawn in their own PNG colors carry no
 * color value and are left alone.
 */
export interface WatchfaceFaceColor {
  /** Upper-case #RRGGBB. */
  color: string;
  /** How many parts use it. */
  uses: number;
}

const HEX = /^#[0-9a-f]{6}$/i;

function normalize(value: unknown): string | null {
  return typeof value === "string" && HEX.test(value) ? value.toUpperCase() : null;
}

type ColorRecord = Record<string, { color?: string } | undefined> | undefined;

function eachColor(design: CorosWatchfaceDesignState, visit: (color: string) => void) {
  for (const value of Object.values(design.layerColors ?? {})) {
    const color = normalize(value);
    if (color) visit(color);
  }
  for (const record of [design.metricStyles, design.timeStyles, design.dateStyles, design.nativeData] as ColorRecord[]) {
    for (const style of Object.values(record ?? {})) {
      const color = normalize(style?.color);
      if (color) visit(color);
    }
  }
  const selectable = normalize(design.selectableMetricStyle?.color);
  if (selectable) visit(selectable);
  for (const element of design.backgroundElements ?? []) {
    const color = normalize((element as { color?: string }).color);
    if (color) visit(color);
  }
}

/** The face's colors, most used first. */
export function collectWatchfaceFaceColors(design: CorosWatchfaceDesignState): WatchfaceFaceColor[] {
  const counts = new Map<string, number>();
  eachColor(design, (color) => counts.set(color, (counts.get(color) ?? 0) + 1));
  return [...counts]
    .map(([color, uses]) => ({ color, uses }))
    .sort((left, right) => right.uses - left.uses || left.color.localeCompare(right.color));
}

function swapRecord<T extends { color?: string }>(
  record: Record<string, T> | undefined,
  from: string,
  to: string
): Record<string, T> | undefined {
  if (!record) return record;
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, style] of Object.entries(record)) {
    if (style && normalize(style.color) === from) {
      next[key] = { ...style, color: to };
      changed = true;
    } else next[key] = style;
  }
  return changed ? next : record;
}

/** Every part colored `from` becomes `to`; everything else is untouched. */
export function recolorWatchfaceFace(
  design: CorosWatchfaceDesignState,
  fromColor: string,
  toColor: string
): CorosWatchfaceDesignState {
  const from = normalize(fromColor);
  const to = normalize(toColor);
  if (!from || !to || from === to) return design;
  const layerColors = design.layerColors
    ? Object.fromEntries(Object.entries(design.layerColors).map(([id, value]) => [id, normalize(value) === from ? to : value]))
    : design.layerColors;
  const selectable = design.selectableMetricStyle && normalize(design.selectableMetricStyle.color) === from
    ? { ...design.selectableMetricStyle, color: to }
    : design.selectableMetricStyle;
  const backgroundElements = design.backgroundElements?.map((element) =>
    normalize((element as { color?: string }).color) === from ? { ...element, color: to } : element
  );
  return {
    ...design,
    layerColors,
    metricStyles: swapRecord(design.metricStyles, from, to) ?? design.metricStyles,
    timeStyles: swapRecord(design.timeStyles, from, to) ?? design.timeStyles,
    dateStyles: swapRecord(design.dateStyles, from, to),
    nativeData: swapRecord(design.nativeData, from, to),
    selectableMetricStyle: selectable,
    backgroundElements
  };
}
