import { Fragment, type ReactNode } from "react";
import { t } from "../../i18n/training";
import type { TrainingHubActivityLap, TrainingHubLapStep, UnitSystem } from "../../../electron/types";
import { formatSpeedValue } from "../../units/units";
import { formatDistanceMeters, formatDurationSeconds, formatPaceClock } from "../formatters";

/** What ends a workout step: a distance (a pool's in its own unit), a time, or a heart rate to rest down to. */
function stepTarget(target: TrainingHubLapStep["target"], units: UnitSystem, swim: boolean): string | undefined {
  if (!target) return undefined;
  const value = target.kind === "distance" ? formatDistanceMeters(target.value, units, swim)
    : target.kind === "time" ? formatDurationSeconds(target.value)
      : t("below {{bpm}} bpm", { bpm: Math.round(target.value) });
  return t("Target {{target}}", { target: value });
}

/** The range a step asks to stay in, in the app's units. */
function stepRange(range: TrainingHubLapStep["range"], units: UnitSystem): string | undefined {
  if (!range) return undefined;
  const whole = (value: number) => String(Math.round(value));
  switch (range.kind) {
    case "pace": {
      const unit = units === "imperial" ? "mi" : "km";
      return `${formatPaceClock(range.low, unit)}–${formatPaceClock(range.high, unit)} /${unit}`;
    }
    case "speed": {
      const [low] = formatSpeedValue(range.low * 3.6, units).split(" ");
      return `${low}–${formatSpeedValue(range.high * 3.6, units)}`;
    }
    case "heartRate": return `${whole(range.low)}–${whole(range.high)} bpm`;
    case "power": return `${whole(range.low)}–${whole(range.high)} W`;
    case "cadence": return `${whole(range.low)}–${whole(range.high)} spm`;
  }
}

/** The step's repeat and the lap's round in it: "Warm-up 2/4", or "2/4" for a repeat with no name. */
function stepRound(step: TrainingHubLapStep | undefined): string | undefined {
  const round = step?.round !== undefined && step.rounds !== undefined ? `${step.round}/${step.rounds}` : undefined;
  return [step?.group, round].filter(Boolean).join(" ") || undefined;
}

/**
 * A lap's workout step: its title (the step's name unless the table gives one) on top, then a quieter line with
 * what leads it (a swim's stroke), its repeat and round, what it asked for and, when asked, how far heart rate fell
 * over a rest. The line breaks only between those parts, and the separators are left out for screen readers.
 */
export function LapStepCell({ row, units, swim = false, hrDrop = false, badge, title, lead }: {
  row: TrainingHubActivityLap;
  units: UnitSystem;
  swim?: boolean;
  hrDrop?: boolean;
  /** Shown above the title: the kind of step, when the table has no column for it. */
  badge?: ReactNode;
  /** In place of the step's name. */
  title?: string;
  /** First on the quieter line. */
  lead?: string;
}) {
  const step = row.step;
  const heading = title ?? step?.name;
  const details = [
    lead,
    stepRound(step),
    stepTarget(step?.target, units, swim),
    stepRange(step?.range, units),
    hrDrop && row.hrDrop !== undefined ? t("HR drop {{bpm}} bpm", { bpm: row.hrDrop }) : undefined
  ].filter((part): part is string => Boolean(part));
  return (
    <td className="training-lap-step">
      {badge ? <div className="training-lap-step-badge"><span className="sr-only">{t("Type")}: </span>{badge}</div> : null}
      {heading ? <strong>{heading}</strong> : null}
      {details.length ? (
        <small>
          {details.map((part, index) => (
            <Fragment key={index}>
              {index ? " " : null}
              {/* No break inside a part: its spaces don't wrap. */}
              <span>{part.replace(/ /g, " ")}{index < details.length - 1 ? <span aria-hidden="true">{" ·"}</span> : null}</span>
            </Fragment>
          ))}
        </small>
      ) : null}
    </td>
  );
}
