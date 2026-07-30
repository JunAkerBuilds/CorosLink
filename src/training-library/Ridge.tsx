/**
 * The Training Library draws exactly one kind of picture: a ridge of weekly
 * training load. `Ridge` puts it on an index row so a plan can be recognised by
 * its silhouette; `BulletRidge` puts the same axis at reading size so planned
 * load can be compared against what was actually completed.
 *
 * Both keep to a single hue. Height carries the number; nothing else is encoded.
 */

/** Bars below this share of the peak still get a visible stub. */
const MINIMUM_SHARE = 0.09;
/** Only the leading bars stagger, so long plans still settle quickly. */
const STAGGER_LIMIT = 22;

interface RidgeProps {
  /** One value per week, in week order. */
  values: number[];
  /** 1-based peak week from the plan summary, marked at full strength. */
  peakWeek?: number;
  /** Names the quantity, e.g. "load" or "sessions". Used for the tooltip. */
  unit: string;
  /**
   * The accent hue is reserved for training load. A plan with no load data
   * falls back to session counts, which is drawn in grey so the column's
   * heading is never contradicted by a bar that looks like load.
   */
  variant: "load" | "count";
  /** Full sentence for assistive technology. */
  label: string;
}

export function Ridge({ values, peakWeek, unit, variant, label }: RidgeProps) {
  if (values.length === 0) {
    return <span className="tl-ridge is-blank" aria-label="No weeks">&mdash;</span>;
  }

  const peak = Math.max(...values);

  return (
    <span
      className={`tl-ridge${variant === "count" ? " is-count" : ""}`}
      role="img"
      aria-label={label}
    >
      {values.map((value, index) => {
        const share = peak > 0 ? value / peak : 0;
        const marked = peakWeek !== undefined && index === peakWeek - 1 && value > 0;
        return (
          <span
            key={index}
            className={`tl-ridge-bar${value > 0 ? "" : " is-empty"}${marked ? " is-peak" : ""}`}
            style={{
              "--tl-bar-height": value > 0 ? `${Math.max(share, MINIMUM_SHARE) * 100}%` : "2px",
              "--tl-bar-index": index < STAGGER_LIMIT ? index : STAGGER_LIMIT
            } as React.CSSProperties}
          >
            <span className="sr-only">
              Week {index + 1}: {Math.round(value)} {unit}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export interface BulletWeek {
  weekLabel: string;
  planned: number;
  completed: number;
}

interface BulletRidgeProps {
  weeks: BulletWeek[];
  label: string;
}

/**
 * Planned load is the pale full-width bar; completed load is the solid bar
 * inside it. A solid bar taller than its pale bar means the week ran over plan.
 */
export function BulletRidge({ weeks, label }: BulletRidgeProps) {
  const peak = Math.max(1, ...weeks.map((week) => Math.max(week.planned, week.completed)));

  return (
    <div className="tl-bullets" role="img" aria-label={label}>
      {weeks.map((week, index) => (
        <span
          className="tl-bullet"
          key={week.weekLabel}
          title={`${week.weekLabel} — planned ${Math.round(week.planned)}, done ${Math.round(week.completed)}`}
          style={{ "--tl-bar-index": index < STAGGER_LIMIT ? index : STAGGER_LIMIT } as React.CSSProperties}
        >
          <b style={{ "--tl-bar-height": `${(week.planned / peak) * 100}%` } as React.CSSProperties} />
          <i style={{ "--tl-bar-height": `${(week.completed / peak) * 100}%` } as React.CSSProperties} />
        </span>
      ))}
    </div>
  );
}
