import { t, useLanguage, getLocale } from "../../i18n/training";
import { useState, type CSSProperties } from "react";
import { HeartPulse } from "lucide-react";
import { useTheme } from "../../theme/ThemeProvider";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { distanceUnit, secondsPerKmToDisplayPace } from "../../units/units";
import type { ActivityStreams, StreamZone } from "../activityStreams";
import { getIntensityZoneColors } from "../chartConfig";
import "../activityChannels.css";

type ZoneKind = "hr" | "pace";

// COROS's lactate-threshold heart-rate model has six named zones.
const LTHR_ZONE_NAMES = [
  "Recovery",
  "Aerobic Endurance",
  "Aerobic Power",
  "Threshold",
  "Anaerobic Endurance",
  "Anaerobic Power"
];

function formatZoneDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

function clock(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

interface ActivityTimeInZonesProps {
  zones: ActivityStreams["zones"];
}

export function ActivityTimeInZones({ zones }: ActivityTimeInZonesProps) {
  useLanguage();
  const { theme } = useTheme();
  const { unitSystem } = useUnitSystem();
  const colors = getIntensityZoneColors(theme);
  const kinds = (["hr", "pace"] as const).filter((kind) => zones[kind]);
  const [picked, setPicked] = useState<ZoneKind>(kinds[0] ?? "hr");
  const [active, setActive] = useState<number | null>(null);
  const kind = zones[picked] ? picked : kinds[0];
  const distribution = kind ? zones[kind] : undefined;
  if (!kind || !distribution) return null;

  const list = distribution.zones;
  const named = kind === "hr" && list.length === LTHR_ZONE_NAMES.length;
  const paceUnit = `/${distanceUnit(unitSystem)}`;
  const pace = (value: number) => clock(secondsPerKmToDisplayPace(value, unitSystem));

  const range = (zone: StreamZone): string => {
    if (kind === "hr") {
      if (zone.start === undefined && zone.end !== undefined) return `< ${zone.end + 1} bpm`;
      if (zone.end === undefined && zone.start !== undefined) return `≥ ${zone.start} bpm`;
      return `${zone.start}–${zone.end} bpm`;
    }
    // Pace zones run slow → fast, so the first is "slower than" its bound.
    if (zone.start === undefined && zone.end !== undefined) return `> ${pace(zone.end)} ${paceUnit}`;
    if (zone.end === undefined && zone.start !== undefined) return `< ${pace(zone.start)} ${paceUnit}`;
    return `${pace(zone.start!)}–${pace(zone.end!)} ${paceUnit}`;
  };
  const dominant = list.reduce((best, zone) => (zone.seconds > best.seconds ? zone : best), list[0]!);
  const dominantPosition = list.indexOf(dominant);

  return (
    <section className="activity-detail-visual-panel activity-zones">
      <div className="activity-detail-visual-heading">
        <h3>
          <HeartPulse size={17} aria-hidden="true" />
          {t("Time in zones")}</h3>
        {kinds.length > 1 ? (
          <div className="library-filter-group" role="group" aria-label={t("Zone model")}>
            {kinds.map((option) => (
              <button
                key={option}
                type="button"
                className={`library-filter-option${kind === option ? " active" : ""}`}
                aria-pressed={kind === option}
                onClick={() => {
                  setPicked(option);
                  setActive(null);
                }}
              >
                {option === "hr" ? t("Heart rate") : t("Pace")}
              </button>
            ))}
          </div>
        ) : (
          <span className="activity-detail-visual-note">
            {t("Mostly")}<strong>Z{dominantPosition + 1}{named ? ` ${t(LTHR_ZONE_NAMES[dominantPosition])}` : ""}</strong>
          </span>
        )}
      </div>

      <div
        className={`activity-zones-bar${active !== null ? " has-active" : ""}`}
        role="img"
        aria-label={list
          .map((zone, position) => t("Zone {{zone}}: {{duration}}, {{percent}}%", { zone: position + 1, duration: formatZoneDuration(zone.seconds), percent: Math.round(zone.share * 100) }))
          .join("; ")}
      >
        {list.map((zone, position) =>
          zone.seconds > 0 ? (
            <span
              key={zone.index}
              className={active === position ? "is-active" : undefined}
              style={{ flexGrow: zone.seconds, "--zone-color": colors[position % colors.length] } as CSSProperties}
              title={`Z${position + 1} · ${formatZoneDuration(zone.seconds)} · ${Math.round(zone.share * 100)}%`}
              onPointerEnter={() => setActive(position)}
              onPointerLeave={() => setActive(null)}
            />
          ) : null
        )}
      </div>

      <ol className={`activity-zones-legend${active !== null ? " has-active" : ""}`} style={{ "--zone-count": list.length } as CSSProperties}>
        {list.map((zone, position) => (
          <li
            key={zone.index}
            className={`${zone.seconds === 0 ? "is-empty" : ""}${active === position ? " is-active" : ""}`}
            style={{ "--zone-color": colors[position % colors.length] } as CSSProperties}
            onPointerEnter={() => setActive(position)}
            onPointerLeave={() => setActive(null)}
          >
            <span className="activity-zones-name">
              <i aria-hidden="true" />
              <b>Z{position + 1}</b>
              {named ? <span>{t(LTHR_ZONE_NAMES[position])}</span> : null}
            </span>
            <span className="activity-zones-time">
              <strong>{formatZoneDuration(zone.seconds)}</strong>
              <small>{Math.round(zone.share * 100)}%</small>
            </span>
            <span className="activity-zones-range">{range(zone)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
