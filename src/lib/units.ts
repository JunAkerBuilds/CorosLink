// Metric or imperial: picked in Settings and kept in this browser. Read once when the page starts; changing it starts
// the page over (like the language), so every number and every table built at load is drawn in the new units.
// Data stays metric everywhere (metres, seconds per km, kilograms): only what is shown and what is typed converts here.
import { createStore } from "@/data/local/store";
import { clock, thousands } from "./format";

export type Units = "metric" | "imperial";
export const isUnits = (v: unknown): v is Units => v === "metric" || v === "imperial";

export const unitsStore = createStore<Units>("units", "metric");

export const MILE_M = 1609.344;
export const FOOT_M = 0.3048;
export const YARD_M = 0.9144;
export const POUND_KG = 0.45359237;

let current: Units | null = null;
/** The units the page shows now. */
export const units = (): Units => (current ??= isUnits(unitsStore.get()) ? unitsStore.get() : "metric");
export const imperial = (): boolean => units() === "imperial";
/** Sets the page's units without saving them (tests, and the main process's own copy). */
export const useUnitsNow = (u: Units): void => { current = u; };

/** Saves the choice and starts the page over in it. */
export function chooseUnits(u: Units): void {
  unitsStore.set(u);
  if (typeof location !== "undefined") location.reload();
}

const round = (v: number, decimals: number) => {
  const s = 10 ** decimals;
  return Math.round(v * s) / s;
};

// ---------------------------------------------------------------- distance (km or mi)

/** "km" or "mi". */
export const distanceUnit = (): string => (imperial() ? "mi" : "km");
/** Metres in the shown unit (kilometres or miles). */
export const distanceIn = (metres: number): number => metres / (imperial() ? MILE_M : 1000);
/** A number typed in the shown unit, as metres. */
export const distanceFromInput = (value: number): number => value * (imperial() ? MILE_M : 1000);
/** Metres in one shown unit: 1000 or 1609.344. */
export const distanceStep = (): number => (imperial() ? MILE_M : 1000);

/** 8.02 km or 4.98 mi. Metric rounds on whole metres, so 24,650 m is 24.7 km (toFixed alone gives 24.6). */
export function distance(metres: number, decimals = 2): string {
  if (imperial()) return `${(metres / MILE_M).toFixed(decimals)} mi`;
  const step = 10 ** Math.max(0, 3 - decimals);
  return `${(decimals <= 3 ? (Math.round(metres / step) * step) / 1000 : metres / 1000).toFixed(decimals)} km`;
}
/** The number alone, without the unit: 8.02 or 4.98. */
export const distanceNumber = (metres: number, decimals = 2): string => distance(metres, decimals).replace(/ (km|mi)$/, "");

// ---------------------------------------------------------------- pace and speed

/** "/km" or "/mi". */
export const paceUnitLabel = (): string => (imperial() ? "/mi" : "/km");
/** Seconds per km as seconds per shown unit. */
export const paceIn = (secPerKm: number): number => (imperial() ? secPerKm * (MILE_M / 1000) : secPerKm);
/** Seconds per shown unit, as typed, back to seconds per km. */
export const paceFromInput = (secPerUnit: number): number => (imperial() ? secPerUnit / (MILE_M / 1000) : secPerUnit);
/** Seconds per km as 5:08 /km or 8:16 /mi. */
export const paceText = (secPerKm: number, decimals = 0): string => `${clock(paceIn(secPerKm), decimals)} ${paceUnitLabel()}`;
/** A pace difference in seconds per km, as whole seconds per shown unit: "11 s/km" or "18 s/mi". */
export const paceGap = (secPerKm: number): string => `${Math.round(paceIn(secPerKm))} s${paceUnitLabel()}`;

/** "km/h" or "mph". */
export const speedUnit = (): string => (imperial() ? "mph" : "km/h");
/** km/h in the shown unit. */
export const speedIn = (kmh: number): number => (imperial() ? kmh / (MILE_M / 1000) : kmh);
export const speedFromInput = (value: number): number => (imperial() ? value * (MILE_M / 1000) : value);
/** 25.4 km/h or 15.8 mph. */
export const speedText = (kmh: number, decimals = 1): string => `${speedIn(kmh).toFixed(decimals)} ${speedUnit()}`;

// ---------------------------------------------------------------- swim (m or yd)

/** "m" or "yd". */
export const swimUnit = (): string => (imperial() ? "yd" : "m");
export const swimIn = (metres: number): number => (imperial() ? metres / YARD_M : metres);
export const swimFromInput = (value: number): number => (imperial() ? value * YARD_M : value);
/** 1,500 m or 1,640 yd. */
export const swimDistance = (metres: number): string => `${thousands(swimIn(metres))} ${swimUnit()}`;
/** "/100 m" or "/100 yd". */
export const swimPaceUnitLabel = (): string => `/100 ${swimUnit()}`;
/** Seconds per 100 m as seconds per 100 of the shown unit. */
export const swimPaceIn = (secPer100m: number): number => (imperial() ? secPer100m * YARD_M : secPer100m);
export const swimPaceFromInput = (secPer100: number): number => (imperial() ? secPer100 / YARD_M : secPer100);
/** 2:05 /100 m or 1:54 /100 yd. */
export const swimPaceText = (secPer100m: number, decimals = 0): string => `${clock(swimPaceIn(secPer100m), decimals)} ${swimPaceUnitLabel()}`;

// ---------------------------------------------------------------- height and short lengths (m or ft)

/** "m" or "ft", for elevation, climbs and other heights. */
export const heightUnit = (): string => (imperial() ? "ft" : "m");
export const heightIn = (metres: number): number => (imperial() ? metres / FOOT_M : metres);
export const heightFromInput = (value: number): number => (imperial() ? value * FOOT_M : value);
/** 1,234 m or 4,049 ft, whole. */
export const height = (metres: number): string => `${thousands(heightIn(metres))} ${heightUnit()}`;

/** A short way along a route: 350 m or 1,148 ft, and in km or mi past a kilometre or a tenth of a mile. */
export function shortDistance(metres: number, decimals = 1): string {
  if (imperial()) return metres < MILE_M / 10 ? `${thousands(metres / FOOT_M)} ft` : `${(metres / MILE_M).toFixed(decimals)} mi`;
  return metres < 1000 ? `${thousands(metres)} m` : `${(metres / 1000).toFixed(decimals)} km`;
}

// ---------------------------------------------------------------- weight (kg or lb)

/** "kg" or "lb". */
export const weightUnit = (): string => (imperial() ? "lb" : "kg");
export const weightIn = (kg: number): number => (imperial() ? kg / POUND_KG : kg);
export const weightFromInput = (value: number): number => (imperial() ? value * POUND_KG : value);
/** 72.4 kg or 159.6 lb. */
export const weight = (kg: number, decimals = 1): string => `${round(weightIn(kg), decimals).toFixed(decimals)} ${weightUnit()}`;
/** Lifted weight: 12,340 kg or 27,205 lb, whole. */
export const weightTotal = (kg: number): string => `${thousands(weightIn(kg))} ${weightUnit()}`;

// ---------------------------------------------------------------- body height (cm or ft/in)

/** 180 cm or 5′ 11″. */
export function bodyHeight(cm: number): string {
  if (!imperial()) return `${Math.round(cm)} cm`;
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}′ ${inches % 12}″`;
}
/** "cm" or "in", for typing a body height. */
export const bodyHeightUnit = (): string => (imperial() ? "in" : "cm");
/** Centimetres in the typed unit (centimetres or inches). */
export const bodyHeightIn = (cm: number): number => (imperial() ? cm / 2.54 : cm);
/** A body height typed in the shown unit, as centimetres. */
export const bodyHeightFromInput = (value: number): number => (imperial() ? value * 2.54 : value);

/**
 * Runs `make` in the given units and puts the page's own back: for a server answering one athlete with the units
 * their request carries. `make` must be synchronous, so no other request's work runs in between. Undefined keeps
 * the units as they are.
 */
export function inUnits<T>(u: Units | undefined, make: () => T): T {
  if (!u) return make();
  const before = current;
  current = u;
  try { return make(); } finally { current = before; }
}
