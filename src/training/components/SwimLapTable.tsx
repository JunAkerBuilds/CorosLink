import { t, useLanguage } from "../../i18n/training";
import type { TrainingHubActivityLap, UnitSystem } from "../../../electron/types";
import { formatDistanceMeters, formatDurationSeconds, formatOptionalNumber } from "../formatters";
import { formatSwimPace, swimStrokeLabel } from "./ActivitySwimSummary";

interface Column {
  key: string;
  label: string;
  /** Shown after the label as written (headings are upper-cased). */
  unit?: string;
  /** Hidden when the table's container is narrow, or (wide) not wide. */
  optional?: "narrow" | "wide";
  cell: (row: TrainingHubActivityLap) => string;
}

/**
 * A swim's intervals or lengths with the stroke figures the watch recorded.
 * Rests sit between them unnumbered; a column shows only when a row has a value.
 */
const optionalClass = (column: Column) => (column.optional ? `is-optional-${column.optional}` : undefined);

export function SwimLapTable({ rows, compact, units, fastest }: {
  rows: TrainingHubActivityLap[];
  compact: boolean;
  units: UnitSystem;
  /** Positions in `rows` swum at the best pace. */
  fastest: ReadonlySet<number>;
}) {
  useLanguage();
  const has = (pick: (row: TrainingHubActivityLap) => unknown) => rows.some((row) => !row.rest && pick(row) !== undefined);
  const swum = (format: (row: TrainingHubActivityLap) => string) => (row: TrainingHubActivityLap) => (row.rest ? "" : format(row));
  const distance: Column = { key: "distance", label: t("Distance"), cell: swum((row) => formatDistanceMeters(row.distance, units, true)) };
  const duration: Column = { key: "duration", label: t("Duration"), cell: (row) => formatDurationSeconds(row.duration) };
  // The unit once, in the heading: "2:40" per row reads faster than "2:40 /100m".
  const [, paceUnit] = formatSwimPace(100, units).split(" ");
  const pace: Column = { key: "pace", label: t("Pace"), unit: paceUnit, cell: swum((row) => formatSwimPace(row.swimPace, units).split(" ")[0]!) };
  const swolf: Column = { key: "swolf", label: t("SWOLF"), cell: swum((row) => formatOptionalNumber(row.swolf)) };
  const avgHr: Column = { key: "avgHr", label: t("Avg HR"), cell: (row) => formatOptionalNumber(row.avgHr) };
  const showSwolf = has((row) => row.swolf);
  const columns: Column[] = compact
    ? [duration, distance, showSwolf ? swolf : pace, avgHr]
    : [
        // A lap of several lengths says how many; the lengths view doesn't need it.
        ...(rows.some((row) => !row.rest && (row.lengths ?? 1) > 1) ? [{ key: "lengths", label: t("Lengths"), cell: swum((row) => formatOptionalNumber(row.lengths)) }] : []),
        distance, duration, pace,
        { key: "strokes", label: t("Strokes"), optional: "narrow", cell: swum((row) => formatOptionalNumber(row.strokes)) },
        ...(showSwolf ? [swolf] : []),
        { key: "strokeRate", label: t("Stroke rate"), optional: "narrow", cell: swum((row) => formatOptionalNumber(row.strokeRate)) },
        avgHr,
        { key: "maxHr", label: t("Max HR"), optional: "wide", cell: (row) => formatOptionalNumber(row.maxHr) }
      ];
  let number = 0;
  return (
    <div className="training-swim-laps-frame">
    <table className="training-swim-laps">
      <thead>
        <tr>
          <th>#</th>
          <th>{t("Stroke")}</th>
          {columns.map((column) => (
            <th key={column.key} className={optionalClass(column)}>
              {column.label}{column.unit ? <> <span className="training-swim-unit">{column.unit}</span></> : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, position) => {
          const isFastest = fastest.has(position);
          // The marker sits with the pace that earned it (the aside has no pace column, so with the time).
          const marked = compact ? "duration" : "pace";
          return (
            <tr key={row.index} className={row.rest ? "is-rest" : isFastest ? "is-fastest" : undefined}>
              <td>{row.rest ? "" : ++number}</td>
              <td>{row.rest ? t("Rest") : swimStrokeLabel(row.stroke)}</td>
              {columns.map((column) => {
                // A rest leaves out what it doesn't have rather than filling the row with dashes.
                const value = column.cell(row);
                return (
                  <td key={column.key} className={[optionalClass(column), column.key === marked ? "training-lap-performance" : undefined].filter(Boolean).join(" ") || undefined}>
                    {row.rest && value === "-" ? "" : value}
                    {isFastest && column.key === marked ? <span className="training-lap-fastest">{t("Fastest")}</span> : null}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
