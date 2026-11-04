import { t, useLanguage, formatDate } from "../../i18n/training";
import { X } from "lucide-react";
import type { RaceEntry } from "../../../electron/raceTypes";
import { BUILD_UP_WEEKS, raceGroupKey } from "../../../electron/raceModel";
import type { UnitSystem } from "../../../electron/types";
import { formatDistanceValue, formatElevationValue, formatPaceValue } from "../../units/units";
import { formatRaceDistance, formatRaceTime } from "../raceFormat";

interface Row {
  label: string;
  a?: number;
  b?: number;
  format: (value: number) => string;
  delta?: (difference: number) => string;
  /** Times and paces: lower is better. Training volume and heart rate have no better direction. */
  lowerIsBetter?: boolean;
}

interface TextRow {
  label: string;
  a?: string;
  b?: string;
}

function buildUpValue(race: RaceEntry, pick: (buildUp: NonNullable<RaceEntry["buildUp"]>) => number | undefined) {
  const buildUp = race.buildUp;
  return buildUp && (buildUp.complete || buildUp.runs > 0) ? pick(buildUp) : undefined;
}

function Head({ race, side, unitSystem }: { race: RaceEntry; side: "A" | "B"; unitSystem: UnitSystem }) {
  useLanguage();
  return (
    <th scope="col" className={`races-duel-side is-${side.toLowerCase()}`} data-distance={race.distanceKey}>
      <span className="races-duel-letter" aria-hidden="true">{side}</span>
      <strong>{race.name}</strong>
      <span>
        {formatRaceDistance(race, unitSystem)} · {formatDate(new Date(race.startTime * 1000), { month: "short", day: "numeric", year: "numeric" })}
      </span>
    </th>
  );
}

/** Two races side by side, A the earlier, B the later; B's cell carries the change. */
export function RaceComparison({
  older,
  newer,
  fiveK,
  unitSystem,
  onClear
}: {
  older: RaceEntry;
  newer: RaceEntry;
  /** Rounded 5K equivalents, for races over different distances. */
  fiveK: (race: RaceEntry) => number;
  unitSystem: UnitSystem;
  onClear: () => void;
}) {
  useLanguage();
  const sameDistance = raceGroupKey(older) === raceGroupKey(newer);
  const signed = (difference: number, text: string) => `${difference < 0 ? "−" : "+"}${text}`;
  const pace = (race: RaceEntry) => race.officialTime / (race.officialDistance / 1000);
  const time = (difference: number) => signed(difference, formatRaceTime(Math.round(Math.abs(difference))));
  const recorded = (race: RaceEntry) => (race.source === "manual" ? undefined : race.elevationGain);

  const allRows: Row[] = [
    {
      label: t("Finish time"),
      a: older.officialTime,
      b: newer.officialTime,
      format: formatRaceTime,
      delta: sameDistance ? time : undefined,
      lowerIsBetter: true
    },
    ...(sameDistance
      ? []
      : [{ label: t("As a 5K"), a: fiveK(older), b: fiveK(newer), format: formatRaceTime, delta: time, lowerIsBetter: true } as Row]),
    {
      label: t("Pace"),
      a: pace(older),
      b: pace(newer),
      format: (seconds) => formatPaceValue(seconds, unitSystem),
      delta: (difference) => signed(difference, formatPaceValue(Math.abs(difference), unitSystem)),
      lowerIsBetter: true
    },
    {
      label: t("Avg heart rate"),
      a: older.avgHr,
      b: newer.avgHr,
      format: (bpm) => `${Math.round(bpm)} bpm`,
      delta: (difference) => signed(difference, `${Math.abs(Math.round(difference))}`)
    },
    {
      label: t("Elevation gain"),
      a: recorded(older),
      b: recorded(newer),
      format: (meters) => formatElevationValue(meters, unitSystem)
    },
    {
      label: t("Runs in the {{p0}} weeks before", { p0: String(BUILD_UP_WEEKS) }),
      a: buildUpValue(older, (buildUp) => buildUp.runs),
      b: buildUpValue(newer, (buildUp) => buildUp.runs),
      format: String,
      delta: (difference) => signed(difference, String(Math.abs(difference)))
    },
    {
      label: t("Distance in the {{p0}} weeks before", { p0: String(BUILD_UP_WEEKS) }),
      a: buildUpValue(older, (buildUp) => buildUp.distance),
      b: buildUpValue(newer, (buildUp) => buildUp.distance),
      format: (meters) => formatDistanceValue(meters, unitSystem, { digits: 0 }),
      delta: (difference) => signed(difference, formatDistanceValue(Math.abs(difference), unitSystem, { digits: 0 }))
    },
    {
      label: t("Longest run before"),
      a: buildUpValue(older, (buildUp) => buildUp.longestRun),
      b: buildUpValue(newer, (buildUp) => buildUp.longestRun),
      format: (meters) => formatDistanceValue(meters, unitSystem, { digits: 1 }),
      delta: (difference) => signed(difference, formatDistanceValue(Math.abs(difference), unitSystem, { digits: 1 }))
    }
  ];
  const rows = allRows.filter((row) => row.a !== undefined || row.b !== undefined);
  const textRows: TextRow[] = older.placing || newer.placing ? [{ label: t("Placing"), a: older.placing, b: newer.placing }] : [];

  return (
    <div className="races-duel" aria-label={t("Comparing {{p0}} with {{p1}}", { p0: String(older.name), p1: String(newer.name) })} role="group">
      <button type="button" className="race-icon-button races-duel-close" aria-label={t("Stop comparing")} onClick={onClear}>
        <X size={16} aria-hidden="true" />
      </button>
      <table className="races-duel-table">
        <caption className="sr-only">{t("{{p0}} compared with {{p1}}", { p0: String(older.name), p1: String(newer.name) })}</caption>
        <thead>
          <tr>
            <td className="races-duel-corner" />
            <Head race={older} side="A" unitSystem={unitSystem} />
            <Head race={newer} side="B" unitSystem={unitSystem} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const difference = row.a !== undefined && row.b !== undefined ? row.b - row.a : undefined;
            const same = difference !== undefined && Math.abs(difference) < 0.5;
            const better =
              difference === undefined || row.lowerIsBetter === undefined || same ? undefined : row.lowerIsBetter === difference < 0;
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.a !== undefined ? row.format(row.a) : "—"}</td>
                <td>
                  <span className="races-duel-b">
                    <span>{row.b !== undefined ? row.format(row.b) : "—"}</span>
                    {row.delta && difference !== undefined ? (
                      <span className={`races-duel-delta${better === undefined ? "" : better ? " is-faster" : " is-slower"}`}>
                        {same ? t("Same") : row.delta(difference)}
                      </span>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
          {textRows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className="is-text">{row.a ?? "—"}</td>
              <td className="is-text">{row.b ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!sameDistance ? (
        <p className="races-duel-note">{t("Different distances meet as 5K equivalents, scaled with Riegel's formula.")}</p>
      ) : null}
    </div>
  );
}
