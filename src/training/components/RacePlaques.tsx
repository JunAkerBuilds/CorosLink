import { t, useLanguage, getLocale } from "../../i18n/training";
import type { RaceDistanceKey, RaceEntry } from "../../../electron/raceTypes";
import { formatRaceDelta, formatRaceTime } from "../raceFormat";

export interface PlaqueGroup {
  key: string;
  /** "5K", "Half Marathon", or "All races". */
  label: string;
  distanceKey: RaceDistanceKey | "all";
  /** Oldest first. */
  races: RaceEntry[];
  /** Seconds each race counts as in this group: the finish time, or its 5K equivalent for "All". */
  valueOf: (race: RaceEntry) => number;
}

/** The engraved watermark, in the Records tab's own shorthand; none for "All", whose label says it. */
function plaqueMark(distanceKey: RaceDistanceKey | "all", label: string): string {
  if (distanceKey === "all") return "";
  if (distanceKey === "half") return "HM";
  if (distanceKey === "marathon") return "M";
  if (distanceKey === "1mi") return "MI";
  return label.replace(/\s+/g, "").toUpperCase();
}

function Sparkline({ values }: { values: number[] }) {
  useLanguage();
  if (values.length < 2) return <span className="race-plaque-spark is-empty" aria-hidden="true" />;
  const width = 64;
  const height = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  // Faster is higher, as on the progress chart.
  const points = values.map((value, index) => [
    2 + (index / (values.length - 1)) * (width - 4),
    3 + ((value - min) / span) * (height - 6)
  ]);
  const last = points[points.length - 1];
  return (
    <svg className="race-plaque-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points.map((point) => point.join(",")).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r={2.5} />
    </svg>
  );
}

function monthYear(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString(getLocale(), { month: "short", year: "numeric" });
}

/**
 * A distance's best result, built like a Records plaque: engraved distance
 * mark, hero time, and a foot with the trend. Plaques double as the
 * distance picker for the chart and timeline below.
 */
export function RacePlaque({
  group,
  active,
  onSelect
}: {
  group: PlaqueGroup;
  active: boolean;
  onSelect: () => void;
}) {
  useLanguage();
  const { races, valueOf } = group;
  const best = races.reduce((current, race) => (valueOf(race) < valueOf(current) ? race : current));
  const first = races[0];
  const improvement = valueOf(best) - valueOf(first);
  const all = group.distanceKey === "all";
  const count = races.length === 1 ? t("1 race") : t("{{count}} races", { count: races.length.toLocaleString(getLocale()) });
  // On a narrow plaque only the gap shows; the words drop out (see races.css).
  const trend =
    races.length === 1 ? (
      t("One so far")
    ) : best === first ? (
      t("First still fastest")
    ) : (
      <>
        {formatRaceDelta(improvement)}
        <span className="race-plaque-trend-words">{t("since first")}</span>
      </>
    );

  return (
    <button
      type="button"
      className={`race-plaque${active ? " is-active" : ""}`}
      data-distance={group.distanceKey}
      aria-pressed={active}
      aria-label={t("{{p0}}: best {{p1}}{{p2}}, {{p3}}", { p0: String(group.label), p1: String(formatRaceTime(valueOf(best))), p2: String(all ? t(" as a 5K") : ""), p3: String(count) })}
      onClick={onSelect}
    >
      {all ? null : (
        <span className="race-plaque-mark" aria-hidden="true">
          {plaqueMark(group.distanceKey, group.label)}
        </span>
      )}
      <span className="race-plaque-top">
        <span className="race-plaque-label">
          {/* "Half" fits beside the count; the HM mark and race name say the rest. */}
          <span>{group.distanceKey === "half" ? t("Half") : group.label}</span>
        </span>
        <span className="race-plaque-count">{count}</span>
      </span>
      <span className="race-plaque-hero">
        {formatRaceTime(valueOf(best))}
        {all ? <small className="race-plaque-unit">{t("as a 5K")}</small> : null}
      </span>
      <span className="race-plaque-meta">
        <span>{best.name}</span>
        <span>{monthYear(best.startTime)}</span>
      </span>
      <span className="race-plaque-foot">
        <Sparkline values={races.map(valueOf)} />
        <span className={improvement < 0 ? "is-faster" : undefined}>{trend}</span>
      </span>
    </button>
  );
}

/** A small plaque for head-to-head comparison. */
export function MiniPlaque({ race, label, value }: { race: RaceEntry; label: string; value: number }) {
  useLanguage();
  return (
    <div className="race-plaque is-mini" data-distance={race.distanceKey}>
      <span className="race-plaque-mark" aria-hidden="true">
        {plaqueMark(race.distanceKey, label)}
      </span>
      <span className="race-plaque-top">
        <span className="race-plaque-label">
          <span>{label}</span>
        </span>
      </span>
      <span className="race-plaque-hero">{formatRaceTime(value)}</span>
      <span className="race-plaque-meta">
        <span>{race.name}</span>
        <span>
          {new Date(race.startTime * 1000).toLocaleDateString(getLocale(), {
            month: "short",
            day: "numeric",
            year: "numeric"
          })}
        </span>
      </span>
    </div>
  );
}
