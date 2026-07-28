import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  CircleAlert,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X
} from "lucide-react";
import type { StrengthSession, UnitSystem } from "../../electron/types";
import { SelectDropdown } from "../components/SelectDropdown";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useTheme } from "../theme/ThemeProvider";
import {
  kilogramsToDisplayWeight,
  weightUnit
} from "../units/units";
import { MUSCLE_BY_ID } from "./muscles";
import type { ExerciseStat } from "./strengthAnalytics";
import {
  buildExerciseExplorer,
  type ExerciseSessionPr,
  type ExerciseSessionRecord,
  type ExplorerSet,
  type PlateauState
} from "./exerciseExplorerData";

interface ExerciseExplorerProps {
  exercise: ExerciseStat;
  exercises: ExerciseStat[];
  sessions: StrengthSession[];
  unitSystem: UnitSystem;
  onSelect: (name: string) => void;
  onClose: () => void;
}

const PR_LABELS: Record<ExerciseSessionPr, string> = {
  weight: "Weight PR",
  e1rm: "e1RM PR",
  volume: "Volume PR"
};

const PLATEAU_ICONS = {
  insufficient: Sparkles,
  progressing: TrendingUp,
  plateau: CircleAlert,
  declining: TrendingDown,
  steady: Minus
} satisfies Record<PlateauState, typeof Sparkles>;

/* The chart line follows the panel's ember rather than the app accent — see the
   palette note at the top of exerciseExplorer.css. Recharts needs literal
   colors, so the two theme values are mirrored here. */
const EMBER = { dark: "#e8813c", paper: "#cf6a2a" } as const;
const EMBER_FADE = { dark: "#d2542a", paper: "#b8461f" } as const;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

/** Where a set sits on the ramp, as a fraction of the lift's all-time best. */
type LoadBand = "warmup" | "work" | "heavy" | "top";

function loadBand(ratio: number): LoadBand {
  if (ratio >= 0.97) return "top";
  if (ratio >= 0.85) return "heavy";
  if (ratio >= 0.6) return "work";
  return "warmup";
}

function setLoadRatio(set: ExplorerSet, reference: number, loaded: boolean): number {
  if (reference <= 0) return 0;
  const value = loaded ? set.weightKg : set.reps;
  return Math.max(0, Math.min(1, value / reference));
}

/** Sets that carried the session's top weight, when that weight was a new PR. */
function recordSetNumbers(record: ExerciseSessionRecord): Set<number> {
  if (!record.prs.includes("weight") || record.topWeightKg <= 0) return new Set();
  return new Set(
    record.sets
      .filter((set) => Math.abs(set.weightKg - record.topWeightKg) < 0.01)
      .map((set) => set.setNumber)
  );
}

function formatDate(at?: number, includeYear = false): string {
  if (!at) return "Unknown date";
  return new Date(at * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {})
  });
}

function formatWeight(kg: number, unitSystem: UnitSystem, empty = "—"): string {
  if (kg <= 0) return empty;
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  const value = Number.isInteger(display)
    ? display.toLocaleString()
    : display.toFixed(1);
  return `${value} ${weightUnit(unitSystem)}`;
}

/** Split for the hero, where the unit is set as a separate small-caps suffix. */
function splitWeight(
  kg: number,
  unitSystem: UnitSystem
): { value: string; unit: string } {
  if (kg <= 0) return { value: "—", unit: "" };
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  return {
    value: Number.isInteger(display) ? display.toLocaleString() : display.toFixed(1),
    unit: weightUnit(unitSystem)
  };
}

function formatVolume(kg: number, unitSystem: UnitSystem, empty = "—"): string {
  if (kg <= 0) return empty;
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  if (unitSystem === "metric" && display >= 1000) {
    return `${(display / 1000).toFixed(display >= 10_000 ? 0 : 1)}t`;
  }
  return `${Math.round(display).toLocaleString()} ${weightUnit(unitSystem)}`;
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function comparisonTone(latest: number, previous: number): "up" | "down" | "flat" {
  const tolerance = Math.max(0.01, Math.abs(previous) * 0.005);
  if (latest > previous + tolerance) return "up";
  if (latest < previous - tolerance) return "down";
  return "flat";
}

function comparisonDelta(latest: number, previous: number): string {
  if (previous <= 0) return latest > 0 ? "New" : "Same";
  const percent = ((latest - previous) / previous) * 100;
  if (Math.abs(percent) < 0.5) return "Same";
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent).toFixed(Math.abs(percent) < 10 ? 1 : 0)}%`;
}

/**
 * The panel's signature: a session's sets as a ramp. Bar height and color both
 * track load against the lift's all-time best, so warm-up → top set → back-off
 * reads as a shape before any number is parsed. Redundant with the set table it
 * sits above, so it stays out of the accessibility tree.
 */
function SetSpine({
  sets,
  reference,
  loaded,
  records
}: {
  sets: ExplorerSet[];
  reference: number;
  loaded: boolean;
  records: Set<number>;
}) {
  return (
    <span className="exercise-set-spine" aria-hidden="true">
      {sets.map((set) => {
        const ratio = setLoadRatio(set, reference, loaded);
        return (
          <i
            key={set.setNumber}
            data-band={records.has(set.setNumber) ? "record" : loadBand(ratio)}
            style={{ height: `${Math.round(26 + ratio * 74)}%` }}
          />
        );
      })}
    </span>
  );
}

function ComparisonCard({
  latest,
  previous,
  unitSystem,
  loaded
}: {
  latest: ExerciseSessionRecord;
  previous: ExerciseSessionRecord;
  unitSystem: UnitSystem;
  loaded: boolean;
}) {
  const metrics = loaded
    ? [
        {
          label: "Top weight",
          latest: latest.topWeightKg,
          previous: previous.topWeightKg,
          format: (value: number) => formatWeight(value, unitSystem)
        },
        {
          label: "Best e1RM",
          latest: latest.bestE1rmKg,
          previous: previous.bestE1rmKg,
          format: (value: number) => formatWeight(value, unitSystem)
        },
        {
          label: "Volume",
          latest: latest.volumeKg,
          previous: previous.volumeKg,
          format: (value: number) => formatVolume(value, unitSystem)
        },
        {
          label: "Reps",
          latest: latest.totalReps,
          previous: previous.totalReps,
          format: (value: number) => Math.round(value).toLocaleString()
        }
      ]
    : [
        {
          label: "Sets",
          latest: latest.sets.length,
          previous: previous.sets.length,
          format: (value: number) => Math.round(value).toLocaleString()
        },
        {
          label: "Reps",
          latest: latest.totalReps,
          previous: previous.totalReps,
          format: (value: number) => Math.round(value).toLocaleString()
        },
        {
          label: "Work time",
          latest: latest.workSec,
          previous: previous.workSec,
          format: formatDuration
        }
      ];

  return (
    <section className="exercise-explorer-section exercise-explorer-comparison">
      <div className="exercise-explorer-section-head">
        <div>
          <p className="eyebrow">Last vs previous</p>
          <h3>
            {formatDate(latest.at)} <span>against {formatDate(previous.at)}</span>
          </h3>
        </div>
      </div>
      <div className="exercise-comparison-grid">
        {metrics.map((metric) => {
          const tone = comparisonTone(metric.latest, metric.previous);
          const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : Minus;
          return (
            <div key={metric.label} className="exercise-comparison-item">
              <span>{metric.label}</span>
              <strong>{metric.format(metric.latest)}</strong>
              <small data-tone={tone}>
                <Icon size={12} aria-hidden="true" />
                {comparisonDelta(metric.latest, metric.previous)}
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ExerciseExplorer({
  exercise,
  exercises,
  sessions,
  unitSystem,
  onSelect,
  onClose
}: ExerciseExplorerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { colors } = useChartColors();
  const { theme } = useTheme();
  const ember = EMBER[theme === "paper" ? "paper" : "dark"];
  const emberFade = EMBER_FADE[theme === "paper" ? "paper" : "dark"];
  const data = useMemo(
    () => buildExerciseExplorer(sessions, exercise.name),
    [exercise.name, sessions]
  );
  const loaded = data.totalVolumeKg > 0;

  const options = useMemo(
    () =>
      [...exercises]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((item) => ({ value: item.name, label: item.name })),
    [exercises]
  );

  const chartData = useMemo(
    () =>
      [...data.sessions]
        .reverse()
        .filter((record) => record.bestE1rmKg > 0)
        .map((record) => ({
          at: record.at ?? 0,
          label: formatDate(record.at),
          value: kilogramsToDisplayWeight(record.bestE1rmKg, unitSystem),
          kg: record.bestE1rmKg
        })),
    [data.sessions, unitSystem]
  );

  useEffect(() => {
    setExpanded(data.sessions[0] ? new Set([data.sessions[0].activityId]) : new Set());
  }, [data.name, data.sessions]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const openSelect = dialogRef.current?.querySelector(
          '[aria-haspopup="listbox"][aria-expanded="true"]'
        );
        if (!openSelect) onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  const toggleSession = (activityId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(activityId)) next.delete(activityId);
      else next.add(activityId);
      return next;
    });
  };

  const PlateauIcon = PLATEAU_ICONS[data.plateau.state];
  const bodyweightBest = Math.max(
    0,
    ...data.sessions.flatMap((record) => record.sets.map((set) => set.reps))
  );
  /* Everything on the ramp is measured against this: the heaviest set ever
     logged for the lift, or its best rep count when nothing was loaded. */
  const spineReference = loaded ? (data.heaviestSet?.weightKg ?? 0) : bodyweightBest;
  const hero = loaded
    ? splitWeight(data.bestE1rmSet?.e1rmKg ?? 0, unitSystem)
    : { value: bodyweightBest > 0 ? String(bodyweightBest) : "—", unit: "reps" };
  const heroNote = loaded
    ? data.bestE1rmSet
      ? `from ${formatWeight(data.bestE1rmSet.weightKg, unitSystem)} × ${data.bestE1rmSet.reps} · ${formatDate(data.bestE1rmSet.at, true)}`
      : "Needs a loaded set of 15 reps or fewer"
    : "Bodyweight — best single set";

  const rail = [
    { label: "Sessions", value: String(data.sessions.length) },
    { label: "Sets", value: String(data.totalSets) },
    { label: "Reps", value: data.totalReps.toLocaleString() },
    {
      label: "Volume",
      value: formatVolume(data.totalVolumeKg, unitSystem, "Bodyweight")
    },
    {
      label: "Heaviest",
      value:
        loaded && data.heaviestSet
          ? `${formatWeight(data.heaviestSet.weightKg, unitSystem)} × ${data.heaviestSet.reps}`
          : "—"
    }
  ];

  return createPortal(
    <div
      className="exercise-explorer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        className="exercise-explorer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exercise-explorer-title"
      >
        <header className="exercise-explorer-header">
          <div className="exercise-explorer-headline">
            <div className="exercise-explorer-heading">
              <p className="eyebrow">Exercise Explorer</p>
              <h2 id="exercise-explorer-title">{data.name}</h2>
              {exercise.muscles.length > 0 ? (
                <p className="exercise-explorer-muscles">
                  {exercise.muscles.map((muscle) => MUSCLE_BY_ID[muscle].label).join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="exercise-explorer-actions">
              <SelectDropdown
                className="exercise-explorer-select"
                value={exercise.name}
                options={options}
                onChange={onSelect}
                label="Choose an exercise"
              />
              <button
                ref={closeRef}
                type="button"
                className="exercise-explorer-close"
                aria-label="Close Exercise Explorer"
                onClick={onClose}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <p className="exercise-explorer-verdict" data-state={data.plateau.state}>
            <PlateauIcon size={13} aria-hidden="true" />
            <strong>{data.plateau.label}</strong>
            <span>{data.plateau.detail}</span>
          </p>
        </header>

        <div className="exercise-explorer-scroll">
          <section
            className="exercise-explorer-hero"
            aria-label={`${data.name} summary`}
            data-has-chart={chartData.length >= 2}
          >
            <div className="exercise-hero-figure">
              <p className="eyebrow">{loaded ? "Best estimated 1RM" : "Best set"}</p>
              <p className="exercise-hero-value">
                <strong>{hero.value}</strong>
                {hero.unit ? <small>{hero.unit}</small> : null}
              </p>
              <p className="exercise-hero-note">{heroNote}</p>
            </div>

            {chartData.length >= 2 ? (
              <div className="exercise-hero-chart">
                <p className="exercise-hero-chart-label">
                  e1RM in {weightUnit(unitSystem)} · {chartData.length} loaded sessions
                </p>
                <div className="exercise-progress-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="exerciseExplorerFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={ember} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={emberFade} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={colors.grid} vertical={false} />
                      <XAxis
                        dataKey="label"
                        stroke={colors.text}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                        fontSize={10}
                      />
                      <YAxis
                        stroke={colors.text}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        fontSize={10}
                        tickFormatter={(value: number) => `${Math.round(value)}`}
                      />
                      <Tooltip
                        content={(props: TooltipContentProps) => {
                          if (!props.active || !props.payload?.length) return null;
                          const point = props.payload[0].payload as (typeof chartData)[number];
                          return (
                            <div className="exercise-chart-tooltip">
                              <span>{point.label}</span>
                              <strong>{formatWeight(point.kg, unitSystem)}</strong>
                              <small>estimated one-rep max</small>
                            </div>
                          );
                        }}
                        contentStyle={trainingChartTooltipStyle}
                        cursor={{ stroke: colors.text, strokeOpacity: 0.3 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={ember}
                        strokeWidth={2}
                        fill="url(#exerciseExplorerFill)"
                        activeDot={{ r: 4, fill: ember, stroke: colors.dotStroke, strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}

            <dl className="exercise-stat-rail">
              {rail.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="exercise-explorer-insight-grid">
            {data.comparison ? (
              <ComparisonCard
                latest={data.comparison.latest}
                previous={data.comparison.previous}
                unitSystem={unitSystem}
                loaded={loaded}
              />
            ) : (
              <section className="exercise-explorer-section exercise-explorer-comparison is-empty">
                <p className="eyebrow">Last vs previous</p>
                <h3>One session logged</h3>
                <p>Log this lift again to unlock a side-by-side comparison.</p>
              </section>
            )}

            <section className="exercise-explorer-section">
              <div className="exercise-explorer-section-head">
                <div>
                  <p className="eyebrow">Personal records</p>
                  <h3>Best by rep range</h3>
                </div>
              </div>
              {data.repRangeRecords.length > 0 ? (
                <div className="exercise-rep-records">
                  {data.repRangeRecords.map((record) => (
                    <article
                      key={record.id}
                      data-anchor={
                        loaded &&
                        data.heaviestSet != null &&
                        Math.abs(record.weightKg - data.heaviestSet.weightKg) < 0.01
                      }
                    >
                      <span>{record.shortLabel}</span>
                      <small>
                        {record.weightKg > 0
                          ? `× ${record.reps} · ${formatDate(record.at)}`
                          : record.label}
                      </small>
                      <strong>{formatWeight(record.weightKg, unitSystem)}</strong>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="exercise-explorer-empty">
                  Rep-range records appear once you log a loaded set. Bodyweight work still
                  shows in the set log below.
                </p>
              )}
            </section>
          </div>

          <section className="exercise-explorer-section exercise-explorer-log">
            <div className="exercise-explorer-section-head">
              <div>
                <p className="eyebrow">Set log</p>
                <h3>Every session</h3>
              </div>
              <span className="exercise-spine-key">
                <i data-band="warmup" />
                <i data-band="work" />
                <i data-band="heavy" />
                <i data-band="top" />
                {loaded ? "light → heaviest" : "fewest → most reps"}
              </span>
            </div>
            <div className="exercise-session-history">
              {data.sessions.map((record) => {
                const isExpanded = expanded.has(record.activityId);
                const records = recordSetNumbers(record);
                return (
                  <article key={record.activityId} className="exercise-history-session">
                    <button
                      type="button"
                      className="exercise-history-trigger"
                      aria-expanded={isExpanded}
                      onClick={() => toggleSession(record.activityId)}
                    >
                      <span className="exercise-history-date">
                        <strong>{formatDate(record.at, true)}</strong>
                        <span>{record.sessionName}</span>
                      </span>
                      <SetSpine
                        sets={record.sets}
                        reference={spineReference}
                        loaded={loaded}
                        records={records}
                      />
                      <span className="exercise-history-prs">
                        {record.prs.map((pr) => (
                          <span key={pr}>{PR_LABELS[pr]}</span>
                        ))}
                      </span>
                      <span className="exercise-history-summary">
                        <span>{record.sets.length} sets</span>
                        <span>{record.totalReps} reps</span>
                        <strong>
                          {loaded
                            ? formatWeight(record.bestE1rmKg, unitSystem)
                            : `${Math.max(...record.sets.map((set) => set.reps))} best reps`}
                        </strong>
                      </span>
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                    {isExpanded ? (
                      <div className="exercise-set-table-shell">
                        <table className="exercise-set-table">
                          <thead>
                            <tr>
                              <th>Set</th>
                              <th>Weight</th>
                              <th>Reps</th>
                              <th>e1RM</th>
                              <th>Volume</th>
                              <th>Work / rest</th>
                            </tr>
                          </thead>
                          <tbody>
                            {record.sets.map((set) => {
                              const ratio = setLoadRatio(set, spineReference, loaded);
                              return (
                                <tr
                                  key={set.setNumber}
                                  data-band={
                                    records.has(set.setNumber) ? "record" : loadBand(ratio)
                                  }
                                  style={
                                    {
                                      "--set-load": `${(ratio * 100).toFixed(1)}%`
                                    } as CSSProperties
                                  }
                                >
                                  <td>{set.setNumber}</td>
                                  <td>{formatWeight(set.weightKg, unitSystem, "Bodyweight")}</td>
                                  <td>{set.reps}</td>
                                  <td>{formatWeight(set.e1rmKg, unitSystem)}</td>
                                  <td>{formatVolume(set.volumeKg, unitSystem)}</td>
                                  <td>{formatDuration(set.workSec)} / {formatDuration(set.restSec)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </aside>
    </div>,
    document.body
  );
}
