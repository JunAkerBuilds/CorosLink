import type { CSSProperties } from "react";
import { t, useLanguage } from "../i18n/training";
import { PROFILE_ZONE_LABELS, type ProfileSegment, type SessionProfile } from "./sessionProfile";
import "./sessionProfile.css";

/*
 * A 20-second recovery between reps should never collapse to nothing, so
 * tiny bars are floored to a sliver of the longest one (the calendar's
 * structure bar uses the same rule).
 */
function grow(segments: ProfileSegment[]): number[] {
  const largest = Math.max(0, ...segments.map((segment) => segment.weight));
  if (largest <= 0) return segments.map(() => 1);
  const floor = largest * 0.035;
  return segments.map((segment) => Math.max(segment.weight, floor));
}

interface SessionProfileBarsProps {
  profile: SessionProfile;
  label: string;
  /** "tile" is the compact skyline on a card; "reader" is the tall chart. */
  size?: "tile" | "reader";
  /** Draws a slow playhead across the session (reader only, motion permitting). */
  playhead?: boolean;
}

/** The skyline: width = time, height = effort, colour = zone. */
export function SessionProfileBars({ profile, label, size = "tile", playhead }: SessionProfileBarsProps) {
  useLanguage();
  const widths = grow(profile.segments);
  return (
    <div
      className={`tl-skyline is-${size}`}
      data-dense={profile.segments.length > 30 ? "true" : undefined}
      role="img"
      aria-label={label}
    >
      {profile.segments.map((segment, index) => (
        <span
          key={index}
          className={`tl-skyline-bar is-${segment.zone}`}
          style={{ flexGrow: widths[index], "--tl-bar-height": `${Math.round(segment.height * 100)}%`, "--tl-bar-index": index } as CSSProperties}
          title={`${t(PROFILE_ZONE_LABELS[segment.zone])} · ${segment.label}`}
        />
      ))}
      {playhead ? <i className="tl-skyline-playhead" aria-hidden="true" /> : null}
    </div>
  );
}

/** "Warm-up 15 min · Threshold 20 min…" for screen readers and the legend. */
export function profileSummary(profile: SessionProfile, totalSeconds?: number): string {
  return profile.zones
    .map(({ zone, share }) => {
      const amount = totalSeconds ? `${Math.max(1, Math.round((share * totalSeconds) / 60))} min` : `${Math.round(share * 100)}%`;
      return `${t(PROFILE_ZONE_LABELS[zone])} ${amount}`;
    })
    .join(", ");
}
