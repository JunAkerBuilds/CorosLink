import type { CorosWatchfaceDesignState, CorosWatchfaceModeDesignState } from "../../electron/types";
import { normalizeWatchfaceFontFamily } from "./watchfaceFontSnapshots.ts";

/**
 * Swaps one font family for another everywhere a design names it, the places
 * `collectWatchfaceFontUses` reads. Used to move a face off a single-weight
 * font such as "RobotoBold" onto Google's Roboto at 700: every weight the
 * design drew with is shifted by the same amount (400 on "RobotoBold" was the
 * font's own bold, so it becomes 700; a thinned 200 becomes 500).
 */
export interface WatchfaceFontRename {
  from: string;
  to: string;
  /** The weight the old family's regular (400) draws as in the new one. */
  weight: number;
}

type Typed = { fontFamily?: string; fontWeight?: number };

export function renameWatchfaceFontFamily(design: CorosWatchfaceDesignState, rename: WatchfaceFontRename): CorosWatchfaceDesignState {
  const next = renameInMode(design, undefined, rename) as CorosWatchfaceDesignState;
  const aod = design.modeDesigns?.aod;
  return aod ? { ...next, modeDesigns: { ...next.modeDesigns, aod: renameInMode(aod, design, rename) } } : next;
}

function renameInMode<T extends CorosWatchfaceModeDesignState>(mode: T, base: CorosWatchfaceDesignState | undefined, rename: WatchfaceFontRename): T {
  const from = normalizeWatchfaceFontFamily(rename.from).toLocaleLowerCase();
  const matches = (family: string | undefined) => Boolean(family) && normalizeWatchfaceFontFamily(family).toLocaleLowerCase() === from;
  const shift = (weight: number) => Math.min(900, Math.max(100, Math.round((rename.weight + weight - 400) / 100) * 100));
  /**
   * One styled object. `parentFamily`/`parentWeight` are what it inherits;
   * `inheritsWeight` false means an unset weight is `parentWeight` itself
   * (separators default to 700) rather than a value the parent rewrites.
   */
  function fix<S extends Typed>(item: S, parentFamily: string | undefined, parentWeight: number, inheritsWeight = true): S {
    const family = item.fontFamily || parentFamily;
    if (!matches(family)) return item;
    const out: S = { ...item };
    if (item.fontFamily) out.fontFamily = rename.to;
    if (item.fontWeight !== undefined) out.fontWeight = shift(item.fontWeight);
    // Its own old family with an inherited weight the parent does not shift.
    else if (!inheritsWeight || (item.fontFamily && !matches(parentFamily))) out.fontWeight = shift(parentWeight);
    return out;
  }
  const modeFamily = mode.fontFamily ?? base?.fontFamily;
  const modeWeight = mode.fontWeight ?? base?.fontWeight ?? 400;
  let out: T = { ...mode };
  if (mode.fontFamily !== undefined || mode.fontWeight !== undefined) {
    const own = fix({ fontFamily: mode.fontFamily, fontWeight: mode.fontWeight }, base?.fontFamily, base?.fontWeight ?? 400, Boolean(base));
    out = { ...out, ...(own.fontFamily !== undefined ? { fontFamily: own.fontFamily } : {}), ...(own.fontWeight !== undefined ? { fontWeight: own.fontWeight } : {}) };
  }
  const styles = <R extends Record<string, Typed | undefined> | undefined>(record: R): R => record
    ? Object.fromEntries(Object.entries(record).map(([id, item]) => [id, item ? fix(item, modeFamily, modeWeight) : item])) as R
    : record;
  if (mode.timeStyles) out = { ...out, timeStyles: styles(mode.timeStyles) };
  if (mode.metricStyles) out = { ...out, metricStyles: styles(mode.metricStyles) };
  if (mode.dateStyles) out = { ...out, dateStyles: styles(mode.dateStyles) };
  if (mode.selectableMetricStyle) out = { ...out, selectableMetricStyle: fix(mode.selectableMetricStyle, modeFamily, modeWeight) };
  if (mode.staticSeparators) {
    out = { ...out, staticSeparators: Object.fromEntries(Object.entries(mode.staticSeparators).map(([id, item]) =>
      [id, item ? fix(item, modeFamily, 700, false) : item])) as T["staticSeparators"] };
  }
  const exerciseFamily = (mode.metricStyles ?? base?.metricStyles)?.exercise?.fontFamily || modeFamily;
  if (mode.exerciseSeparator && !mode.exerciseSeparator.artwork && matches(exerciseFamily)) {
    out = { ...out, exerciseSeparator: { ...mode.exerciseSeparator, fontWeight: shift(mode.exerciseSeparator.fontWeight ?? 700) } };
  }
  if (mode.ampmIndicator) out = { ...out, ampmIndicator: fix(mode.ampmIndicator, undefined, 400, false) };
  if (mode.backgroundElements) {
    out = { ...out, backgroundElements: mode.backgroundElements.map(element => {
      if (element.kind !== "text" || !matches(element.fontFamily)) return element;
      return { ...element, fontFamily: rename.to, weight: shift(Number(element.weight ?? 400) || 400) };
    }) };
  }
  if (mode.nativeData) {
    out = { ...out, nativeData: Object.fromEntries(Object.entries(mode.nativeData).map(([id, native]) => {
      if (!native) return [id, native];
      const own = fix(native, undefined, 400, false);
      const parts = native.parts ? Object.fromEntries(Object.entries(native.parts).map(([part, style]) =>
        [part, style && (style.fontFamily || style.fontWeight !== undefined) ? fix(style, native.fontFamily, native.fontWeight ?? 400, true) : style])) : native.parts;
      return [id, { ...own, ...(parts ? { parts } : {}) }];
    })) as T["nativeData"] };
  }
  return out;
}
