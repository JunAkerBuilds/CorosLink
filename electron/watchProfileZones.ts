/**
 * How the watch's zones follow new thresholds, keeping their proportions: % of
 * max HR, % of heart-rate reserve, % of threshold HR (and pace relative to
 * threshold pace). Shared by the profile write (corosWatchProfile.ts) and the
 * Settings preview, so the preview shows the zones the watch will get.
 */

/** Zones scaled from one reference value to another; unchanged when either is unknown or they're equal. */
export function scaleZones(zones: readonly number[], from: number, to: number): number[] {
  return from > 0 && to > 0 && from !== to ? zones.map(value => Math.round(value * to / from)) : [...zones];
}

export interface HeartRateThresholds { maxHr: number; restingHr: number; thresholdHr: number }
export interface HeartRateZones { maxHrZones: number[]; reserveHrZones: number[]; thresholdHrZones: number[] }

/** The three heart-rate zone sets moved from the profile's thresholds to `next`. */
export function moveHeartRateZones(profile: HeartRateThresholds & HeartRateZones, next: HeartRateThresholds): HeartRateZones {
  const reserve = profile.maxHr > profile.restingHr && next.maxHr > next.restingHr
    ? profile.reserveHrZones.map(value => Math.round(next.restingHr + (value - profile.restingHr) * (next.maxHr - next.restingHr) / (profile.maxHr - profile.restingHr)))
    : [...profile.reserveHrZones];
  return {
    maxHrZones: scaleZones(profile.maxHrZones, profile.maxHr, next.maxHr),
    reserveHrZones: reserve,
    thresholdHrZones: scaleZones(profile.thresholdHrZones, profile.thresholdHr, next.thresholdHr)
  };
}
