import { t, useLanguage, getLocale } from "../../i18n/training";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
import type { RaceEntry } from "../../../electron/raceTypes";
import { BUILD_UP_WEEKS, raceGroupKey } from "../../../electron/raceModel";
import type { UnitSystem } from "../../../electron/types";
import { formatDistanceValue, formatPaceValue } from "../../units/units";
import { formatRaceDelta, formatRaceDistance } from "../raceFormat";
import { MiniPlaque } from "./RacePlaques";

interface Row {
  label: string;
  a?: number;
  b?: number;
  format: (value: number) => string;
  delta: (difference: number) => string;
  /** Times and paces: lower is better. Training volume has no better direction. */
  lowerIsBetter?: boolean;
  /** Draw mirrored bars: only for amounts, where length means "more". */
  bars?: boolean;
}

function buildUpValue(race: RaceEntry, pick: (buildUp: NonNullable<RaceEntry["buildUp"]>) => number | undefined) {
  const buildUp = race.buildUp;
  return buildUp && (buildUp.complete || buildUp.runs > 0) ? pick(buildUp) : undefined;
}

/** Two races face to face: the gap in the middle, then what led into each. */
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
  const value = (race: RaceEntry) => (sameDistance ? race.officialTime : fiveK(race));
  const gap = value(newer) - value(older);
  const signed = (difference: number, text: string) => `${difference < 0 ? "−" : "+"}${text}`;
  const pace = (race: RaceEntry) => race.officialTime / (race.officialDistance / 1000);

  const rows: Row[] = [
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
      delta: (difference) => signed(difference, `${Math.abs(Math.round(difference))} bpm`)
    },
    {
      label: t("Runs in the {{p0}} weeks before", { p0: String(BUILD_UP_WEEKS) }),
      a: buildUpValue(older, (buildUp) => buildUp.runs),
      b: buildUpValue(newer, (buildUp) => buildUp.runs),
      format: String,
      delta: (difference) => signed(difference, String(Math.abs(difference))),
      bars: true
    },
    {
      label: t("Distance in the {{p0}} weeks before", { p0: String(BUILD_UP_WEEKS) }),
      a: buildUpValue(older, (buildUp) => buildUp.distance),
      b: buildUpValue(newer, (buildUp) => buildUp.distance),
      format: (meters) => formatDistanceValue(meters, unitSystem, { digits: 0 }),
      delta: (difference) => signed(difference, formatDistanceValue(Math.abs(difference), unitSystem, { digits: 0 })),
      bars: true
    },
    {
      label: t("Longest run before"),
      a: buildUpValue(older, (buildUp) => buildUp.longestRun),
      b: buildUpValue(newer, (buildUp) => buildUp.longestRun),
      format: (meters) => formatDistanceValue(meters, unitSystem, { digits: 1 }),
      delta: (difference) => signed(difference, formatDistanceValue(Math.abs(difference), unitSystem, { digits: 1 })),
      bars: true
    }
  ];

  return (
    <section className="races-duel" aria-label={t("Comparing {{p0}} with {{p1}}", { p0: String(older.name), p1: String(newer.name) })}>
      <button type="button" className="race-icon-button races-duel-close" aria-label={t("Stop comparing")} onClick={onClear}>
        <X size={16} aria-hidden="true" />
      </button>
      <div className="races-duel-head">
        <MiniPlaque race={older} label={formatRaceDistance(older, unitSystem)} value={value(older)} />
        <div className={`races-duel-gap${gap < 0 ? " is-faster" : gap > 0 ? " is-slower" : ""}`}>
          <strong>{Math.abs(gap) < 0.5 ? t("Same") : formatRaceDelta(gap)}</strong>
          <span>
            {Math.abs(gap) < 0.5
              ? sameDistance ? t("time") : t("as a 5K")
              : `${t(gap < 0 ? "faster" : "slower")}${sameDistance ? "" : t(" as a 5K")}`}
          </span>
        </div>
        <MiniPlaque race={newer} label={formatRaceDistance(newer, unitSystem)} value={value(newer)} />
      </div>

      <table className="races-duel-table">
        <caption className="sr-only">{t("{{p0}} compared with {{p1}}", { p0: String(older.name), p1: String(newer.name) })}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">{older.name}</th>
            <th scope="col">{t("Measure")}</th>
            <th scope="col">{newer.name}</th>
            <th scope="col">{t("Change", undefined, "delta")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const difference = row.a !== undefined && row.b !== undefined ? row.b - row.a : undefined;
            const better =
              difference === undefined || row.lowerIsBetter === undefined || Math.abs(difference) < 0.5
                ? undefined
                : row.lowerIsBetter === difference < 0;
            const max = Math.max(row.a ?? 0, row.b ?? 0, 1);
            const bar = (amount: number | undefined) =>
              row.bars && amount !== undefined ? (
                <span className="races-duel-bar" style={{ "--bar": `${(amount / max) * 100}%` } as CSSProperties} />
              ) : null;
            return (
              <tr key={row.label}>
                <td className="is-left">
                  <div className="races-duel-cell">
                    <span>{row.a !== undefined ? row.format(row.a) : "—"}</span>
                    {bar(row.a)}
                  </div>
                </td>
                <th scope="row">{row.label}</th>
                <td className="is-right">
                  <div className="races-duel-cell">
                    {bar(row.b)}
                    <span>{row.b !== undefined ? row.format(row.b) : "—"}</span>
                  </div>
                </td>
                <td className={`races-duel-change${better === undefined ? "" : better ? " is-faster" : " is-slower"}`}>
                  {difference === undefined ? "—" : Math.abs(difference) < 0.5 ? t("Same") : row.delta(difference)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!sameDistance ? (
        <p className="races-duel-note">{t("Different distances meet as 5K equivalents, scaled with Riegel's formula.")}</p>
      ) : null}
    </section>
  );
}
