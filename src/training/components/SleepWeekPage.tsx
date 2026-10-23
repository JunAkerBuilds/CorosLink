import { formatNumber, t, useLanguage } from "../../i18n/training";
import { Activity, ArrowDown, ArrowLeft, ArrowUp, HeartPulse, Moon, MoonStar, Sparkles, Sunrise } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { TrainingHubSleepRecord } from "../../../electron/types";
import type { TrainingTrendPoint } from "../types";
import {
  SLEEP_STAGES,
  buildSleepWeek,
  formatNoonClock,
  formatSleepDuration,
  formatSleepSpread,
  sleepClockVerdict,
  sleepScoreLabel,
  sleepScoreTone,
  type SleepStage,
  type SleepWeekClock,
  type SleepWeekNight,
  type SleepWeekSummary
} from "../sleepWeek";
import "../sleepWeek.css";

const STAGE_LABELS: Record<SleepStage, string> = { deep: "Deep", light: "Light", rem: "REM", awake: "Awake" };

interface SleepWeekPageProps {
  records: TrainingHubSleepRecord[];
  /** Training Hub days: COROS's overnight resting HR and HRV. */
  trendPoints?: TrainingTrendPoint[];
  /** Local-Only Mode: sleep comes from the watch, which the footnote says. */
  local?: boolean;
  /** Back to the Training Hub; the hub morphs the page into the sleep card. */
  onBack: () => void;
}

function percentOf(value: number, axis: SleepWeekSummary["axis"]): number {
  return Math.min(100, Math.max(0, (value - axis.start) / (axis.end - axis.start) * 100));
}

function signedDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${formatSleepDuration(Math.abs(rounded))}`;
}

function DeltaPill({ delta, kind }: { delta?: number; kind: "duration" | "score" }) {
  useLanguage();
  if (delta === undefined) return null;
  const rounded = Math.round(delta);
  if (rounded === 0) return <span className="sleep-week-delta">{t("Same as the week before")}</span>;
  const Icon = rounded > 0 ? ArrowUp : ArrowDown;
  const amount = kind === "duration" ? formatSleepDuration(Math.abs(rounded)) : String(Math.abs(rounded));
  const signed = kind === "duration" ? signedDuration(rounded) : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}`;
  // The arrow carries the sign on screen; assistive tech hears the signed value.
  return (
    <span className={`sleep-week-delta ${rounded > 0 ? "is-up" : "is-down"} is-${kind}`}
      aria-label={t("{{value1}} vs the week before", { value1: signed })} role="img">
      <Icon size={12} strokeWidth={2.6} aria-hidden="true" />
      {t("{{value1}} vs the week before", { value1: amount })}
    </span>
  );
}

function ScoreRing({ score, delta }: { score?: number; delta?: number }) {
  useLanguage();
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const filled = score === undefined ? 0 : Math.min(100, Math.max(0, score)) / 100;
  const tone = sleepScoreTone(score);
  return (
    <div className={`sleep-week-ring tone-${tone}`}>
      <svg viewBox="0 0 108 108" aria-hidden="true">
        <circle className="sleep-week-ring-track" cx="54" cy="54" r={radius} />
        <circle className="sleep-week-ring-arc" cx="54" cy="54" r={radius}
          strokeDasharray={`${circumference * filled} ${circumference}`} transform="rotate(-90 54 54)" />
      </svg>
      <div className="sleep-week-ring-copy">
        <strong>{score === undefined ? "–" : Math.round(score)}</strong>
        <span>{t("Avg score")}</span>
      </div>
      <p className="sleep-week-ring-label">
        {score === undefined ? t("No score yet") : sleepScoreLabel(score)}
        <DeltaPill delta={delta} kind="score" />
      </p>
    </div>
  );
}

function ClockTile({ label, icon, clock }: { label: string; icon: typeof Moon; clock?: SleepWeekClock }) {
  useLanguage();
  const Icon = icon;
  const verdict = sleepClockVerdict(clock?.spread);
  return (
    <div className="sleep-week-stat">
      <span className="sleep-week-stat-icon" aria-hidden="true"><Icon size={16} strokeWidth={2.2} /></span>
      <span className="sleep-week-stat-label">{label}</span>
      <strong className="sleep-week-stat-value">{clock ? formatNoonClock(clock.mean) : "–"}</strong>
      <span className="sleep-week-stat-foot">
        {clock?.spread !== undefined && verdict ? (
          <>
            <span className={`sleep-week-verdict is-${verdict.key}`}>{verdict.label}</span>
            {formatSleepSpread(clock.spread)}
          </>
        ) : clock ? t("Needs three timed nights") : t("No data")}
      </span>
    </div>
  );
}

function StatTile({ label, icon, value, foot }: { label: string; icon: typeof Moon; value: string; foot: string }) {
  const Icon = icon;
  return (
    <div className="sleep-week-stat">
      <span className="sleep-week-stat-icon" aria-hidden="true"><Icon size={16} strokeWidth={2.2} /></span>
      <span className="sleep-week-stat-label">{label}</span>
      <strong className="sleep-week-stat-value">{value}</strong>
      <span className="sleep-week-stat-foot">{foot}</span>
    </div>
  );
}

/** COROS's overnight resting HR (with HRV) when the hub has it, else the sleep source's own heart rate. */
function HeartTile({ week }: { week: SleepWeekSummary }) {
  useLanguage();
  if (week.restingHr === undefined && week.sleepHr !== undefined) {
    return <StatTile label={t("Sleeping HR")} icon={HeartPulse} value={`${Math.round(week.sleepHr)} bpm`} foot={t("Average while asleep")} />;
  }
  return (
    <StatTile
      label={t("Resting HR")}
      icon={HeartPulse}
      value={week.restingHr === undefined ? "–" : `${Math.round(week.restingHr)} bpm`}
      foot={week.hrv !== undefined
        ? t("HRV {{value1}} ms overnight", { value1: String(Math.round(week.hrv)) })
        : week.restingHr !== undefined ? t("Measured overnight") : t("No data")}
    />
  );
}

function nightLabel(night: SleepWeekNight): string {
  const record = night.record;
  const nap = night.napMinutes ? t("nap {{value1}}", { value1: formatSleepDuration(night.napMinutes) }) : undefined;
  if (!record) {
    return nap
      ? t("{{value1}}: no main sleep, {{value2}}", { value1: night.weekdayLong, value2: nap })
      : t("{{value1}}: no sleep recorded", { value1: night.weekdayLong });
  }
  const parts = [formatSleepDuration(record.totalMinutes)];
  if (record.score !== undefined) parts.push(t("score {{value1}}", { value1: String(Math.round(record.score)) }));
  if (night.window) parts.push(t("{{value1}} to {{value2}}", { value1: formatNoonClock(night.window.start), value2: formatNoonClock(night.window.end) }));
  if (nap) parts.push(nap);
  if (night.partial) parts.push(t("Partial"));
  return `${night.weekdayLong}: ${parts.join(", ")}`;
}

function NapMetric({ night }: { night: SleepWeekNight }) {
  useLanguage();
  return (
    <div>
      <dt>{t("Naps")}</dt>
      <dd>
        {night.napMinutes ? formatSleepDuration(night.napMinutes) : t("None", undefined, "naps")}
        {night.napMinutes && night.napWindow ? (
          <small className="sleep-week-nap-window">
            {formatNoonClock(night.napWindow.start)} – {formatNoonClock(night.napWindow.end)}
          </small>
        ) : null}
      </dd>
    </div>
  );
}

function RhythmChart({ week, selected, scored, onSelect }: {
  week: SleepWeekSummary; selected: string; scored: boolean; onSelect: (date: string) => void;
}) {
  useLanguage();
  const rows = useRef<HTMLDivElement>(null);
  const { axis } = week;
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const index = week.nights.findIndex((night) => night.date === selected);
    const next = week.nights[Math.min(week.nights.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    event.preventDefault();
    onSelect(next.date);
    rows.current?.querySelector<HTMLButtonElement>(`[data-night="${next.date}"]`)?.focus();
  };

  return (
    <div className="sleep-week-plot">
      <div className="sleep-week-axis" aria-hidden="true">
        <div className="sleep-week-axis-track">
          {axis.ticks.map((tick) => (
            <span key={tick} style={{ left: `${percentOf(tick, axis)}%` }}>{formatNoonClock(tick, { short: true })}</span>
          ))}
        </div>
      </div>
      <div className="sleep-week-rows" ref={rows} onKeyDown={move}>
        <div className="sleep-week-grid" aria-hidden="true">
          {axis.ticks.map((tick) => (
            <i key={tick} className={tick % 1440 === 720 ? "is-midnight" : undefined} style={{ left: `${percentOf(tick, axis)}%` }} />
          ))}
          {week.bedtime ? <b className="is-bedtime" style={{ left: `${percentOf(week.bedtime.mean, axis)}%` }} /> : null}
          {week.wake ? <b className="is-wake" style={{ left: `${percentOf(week.wake.mean, axis)}%` }} /> : null}
        </div>
        {week.nights.map((night) => {
          const record = night.record;
          const tone = sleepScoreTone(record?.score);
          const isSelected = night.date === selected;
          return (
            <button
              key={night.date}
              type="button"
              data-night={night.date}
              className={`sleep-week-row tone-${tone}${isSelected ? " is-selected" : ""}${record ? "" : " is-missing"}${night.partial ? " is-partial" : ""}${night.isToday ? " is-today" : ""}`}
              aria-pressed={isSelected}
              aria-label={nightLabel(night)}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(night.date)}
            >
              <span className="sleep-week-day">
                <strong>{night.weekday}</strong>
                <small>{night.dayOfMonth}</small>
              </span>
              <span className="sleep-week-track">
                {night.window ? (
                  <span
                    className="sleep-week-bar"
                    style={{
                      left: `${percentOf(night.window.start, axis)}%`,
                      width: `${percentOf(night.window.end, axis) - percentOf(night.window.start, axis)}%`
                    }}
                  />
                ) : record ? (
                  <span className="sleep-week-untimed"><span>{t("Time not recorded")}</span></span>
                ) : (
                  <span className="sleep-week-gap">
                    <span>
                      {night.napMinutes
                        ? t("Nap {{value1}}", { value1: formatSleepDuration(night.napMinutes) })
                        : night.isToday ? t("Not synced yet") : t("No data")}
                    </span>
                  </span>
                )}
              </span>
              <span className="sleep-week-value">
                <span className="sleep-week-hours">{record ? formatSleepDuration(record.totalMinutes) : "–"}</span>
                {scored ? (
                  <span className="sleep-week-score" aria-hidden={record?.score === undefined}>
                    {record?.score !== undefined ? Math.round(record.score) : ""}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="sleep-week-axis is-foot" aria-hidden="true">
        <div className="sleep-week-axis-track">
          {week.bedtime ? (
            <span className="is-bedtime" style={{ left: `${percentOf(week.bedtime.mean, axis)}%` }}>
              <Moon size={11} strokeWidth={2.4} />{t("Avg bedtime")} {formatNoonClock(week.bedtime.mean)}
            </span>
          ) : null}
          {week.wake ? (
            <span className="is-wake" style={{ left: `${percentOf(week.wake.mean, axis)}%` }}>
              <Sunrise size={11} strokeWidth={2.4} />{t("Avg wake-up")} {formatNoonClock(week.wake.mean)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NightDetail({ night, week }: { night: SleepWeekNight; week: SleepWeekSummary }) {
  useLanguage();
  const record = night.record;
  const stageTotal = SLEEP_STAGES.reduce((sum, stage) => sum + (night.stages[stage] ?? 0), 0);
  const tone = sleepScoreTone(record?.score);

  return (
    <section className={`sleep-week-card sleep-week-night tone-${tone}`} aria-live="polite">
      <header className="sleep-week-night-head">
        <p className="sleep-week-night-date">
          {night.weekdayLong}
          {night.isToday ? <span className="sleep-week-pill">{t("Last night")}</span> : null}
          {night.partial ? <span className="sleep-week-pill is-partial">{t("Partial")}</span> : null}
        </p>
        {record ? (
          <div className="sleep-week-night-hero">
            {record.score !== undefined ? (
              <div className="sleep-week-night-score">
                <strong>{Math.round(record.score)}</strong>
                <span>{sleepScoreLabel(record.score)}</span>
              </div>
            ) : null}
            <div className="sleep-week-night-duration">
              <span>{t("Main sleep")}</span>
              <strong>{formatSleepDuration(record.totalMinutes)}</strong>
            </div>
          </div>
        ) : null}
        {night.window ? (
          <p className="sleep-week-night-window">
            <span><Moon size={13} strokeWidth={2.2} aria-hidden="true" />{formatNoonClock(night.window.start)}</span>
            <span className="sleep-week-night-arrow" aria-hidden="true">→</span>
            <span><Sunrise size={13} strokeWidth={2.2} aria-hidden="true" />{formatNoonClock(night.window.end)}</span>
          </p>
        ) : null}
      </header>

      {!record ? (
        <>
          <div className="sleep-week-night-empty">
            <MoonStar size={22} aria-hidden="true" />
            <p>
              {night.napMinutes
                ? t("No main sleep was recorded this night.")
                : night.isToday ? t("Last night hasn't synced yet. Wear your watch to bed and sync in the morning.") : t("No sleep was recorded this night.")}
            </p>
          </div>
          {night.napMinutes ? (
            <dl className="sleep-week-night-metrics">
              <NapMetric night={night} />
            </dl>
          ) : null}
        </>
      ) : (
        <>
          {stageTotal > 0 ? (
            <ul className="sleep-week-stage-list" aria-label={t("Sleep stage breakdown")}>
              {SLEEP_STAGES.map((stage) => {
                const minutes = night.stages[stage];
                if (minutes === undefined) return null;
                const share = minutes / stageTotal * 100;
                return (
                  <li key={stage} className={`is-${stage}`}>
                    <span className="sleep-week-stage-name"><i aria-hidden="true" />{t(STAGE_LABELS[stage])}</span>
                    <span className="sleep-week-stage-meter" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
                    <span className="sleep-week-stage-time">{formatSleepDuration(minutes)}</span>
                    <span className="sleep-week-stage-share">{`${Math.round(share)}%`}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="sleep-week-muted">{t("Stage breakdown unavailable.")}</p>
          )}
          {night.partial ? (
            <p className="sleep-week-partial">{t("Partial data:")} {record.partialReason ?? t("COROS is still syncing this sleep.")}</p>
          ) : null}
          <dl className="sleep-week-night-metrics">
            <div><dt>{t("Awake")}</dt><dd>{record.awakeMinutes !== undefined ? formatSleepDuration(record.awakeMinutes) : t("No data")}</dd></div>
            <div><dt>{t("Wake-ups > 5m")}</dt><dd>{record.awakeCountOverFiveMinutes ?? t("No data")}</dd></div>
            <NapMetric night={night} />
            {week.restingHr !== undefined ? (
              <div><dt>{t("Resting HR")}</dt><dd>{night.restingHr !== undefined ? `${Math.round(night.restingHr)} bpm` : t("No data")}</dd></div>
            ) : null}
            {week.hrv !== undefined ? (
              <div><dt>{t("HRV")}</dt><dd>{night.hrv !== undefined ? `${Math.round(night.hrv)} ms` : t("No data")}</dd></div>
            ) : null}
            {record.avgHr ? <div><dt>{t("Sleeping HR")}</dt><dd>{`${Math.round(record.avgHr)} bpm`}</dd></div> : null}
          </dl>
        </>
      )}
    </section>
  );
}

function StageMix({ week, selected }: { week: SleepWeekSummary; selected: string }) {
  useLanguage();
  const total = SLEEP_STAGES.reduce((sum, stage) => sum + (week.stages[stage] ?? 0), 0);
  if (total <= 0) return null;
  return (
    <section className="sleep-week-card sleep-week-mix">
      <header className="sleep-week-card-head">
        <h3>{t("Stage averages")}</h3>
        <p>{t("Per night this week, with each night's share")}</p>
      </header>
      <div className="sleep-week-mix-grid">
        {SLEEP_STAGES.map((stage) => {
          const average = week.stages[stage];
          const peak = Math.max(1, ...week.nights.map((night) => night.stages[stage] ?? 0));
          return (
            <div key={stage} className={`sleep-week-mix-tile is-${stage}`}>
              <span className="sleep-week-mix-label"><i aria-hidden="true" />{t(STAGE_LABELS[stage])}</span>
              <strong>{average === undefined ? "–" : formatSleepDuration(average)}</strong>
              <span className="sleep-week-mix-share">
                {average === undefined ? t("No data") : t("{{value1}}% of the night", { value1: String(Math.round(average / total * 100)) })}
              </span>
              <span className="sleep-week-mix-bars" aria-hidden="true">
                {week.nights.map((night) => {
                  const minutes = night.stages[stage];
                  return (
                    <span key={night.date} className={night.date === selected ? "is-selected" : undefined}
                      style={{ "--bar": minutes === undefined ? 0 : minutes / peak } as CSSProperties}
                      data-empty={minutes === undefined || undefined} />
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The sleep card's page: Training Hub morphs the card into it (see
 * TrainingHubView and the morph rules at the end of sleepWeek.css).
 */
export function SleepWeekPage({ records, trendPoints, local = false, onBack }: SleepWeekPageProps) {
  const { language } = useLanguage();
  const back = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const week = useMemo(() => buildSleepWeek(records, undefined, trendPoints), [records, trendPoints, language]);
  const [selected, setSelected] = useState(week.defaultDate);

  // The card that opened this page is gone; start keyboard focus on the way back.
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);

  const night = week.nights.find((item) => item.date === selected) ?? week.nights.at(-1)!;
  const first = week.nights[0];
  const last = week.nights.at(-1)!;
  // Local-Only Mode never gets COROS's score, so scores show wherever a night has one.
  const scored = week.nights.some((item) => item.record?.score !== undefined);
  const showScore = week.score.value !== undefined;

  return (
    <section
      className="sleep-week-page"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onBack();
      }}
    >
      <div className="sleep-week-page-head">
        <button ref={back} type="button" className="sleep-week-back" onClick={onBack} aria-label={t("Back to Training Hub")}>
          <ArrowLeft size={16} strokeWidth={2.3} aria-hidden="true" />
          <span className="sleep-week-back-label">{t("Training Hub")}</span>
        </button>
      </div>
      <div className="sleep-week-surface">
        <header className="sleep-week-hero">
          <div className="sleep-week-topline">
            <span className="sleep-week-eyebrow">
              <span className="sleep-week-moon" aria-hidden="true"><MoonStar size={17} /></span>
              {t("Sleep")}
            </span>
          </div>
          <div className={`sleep-week-headline${showScore ? "" : " is-duration-only"}`}>
            <div className="sleep-week-headline-copy">
              <h2 id={headingId}>{t("Past 7 nights")}</h2>
              <p className="sleep-week-meta">
                <span>{first.shortDate} – {last.shortDate}</span>
                <span>{t("{{value1}} of {{value2}} nights tracked", { value1: String(week.tracked), value2: String(week.nights.length) })}</span>
                {week.best?.record?.score !== undefined ? (
                  <span className="sleep-week-best">
                    <Sparkles size={13} aria-hidden="true" />
                    {t("Best night {{value1}} · {{value2}}", { value1: week.best.weekday, value2: String(Math.round(week.best.record.score)) })}
                  </span>
                ) : null}
              </p>
              <div className="sleep-week-figure">
                <strong>{formatSleepDuration(week.duration.value)}</strong>
                <span>{t("Average night")}</span>
                <DeltaPill delta={week.duration.delta} kind="duration" />
              </div>
            </div>
            {showScore ? <ScoreRing score={week.score.value} delta={week.score.delta} /> : null}
          </div>
        </header>

        <div className="sleep-week-body">
          <div className="sleep-week-stats">
            <ClockTile label={t("Bedtime")} icon={Moon} clock={week.bedtime} />
            <ClockTile label={t("Wake-up")} icon={Sunrise} clock={week.wake} />
            <StatTile label={t("Awake per night")} icon={Activity}
              value={week.awake === undefined ? "–" : formatSleepDuration(week.awake)}
              foot={week.wakeUps === undefined ? t("No data") : t("{{value1}} wake-ups over 5 min", { value1: formatNumber(week.wakeUps, { maximumFractionDigits: 1 }) })} />
            <HeartTile week={week} />
          </div>

          <div className="sleep-week-main">
            <section className="sleep-week-card sleep-week-rhythm">
              <header className="sleep-week-card-head">
                <h3>{t("Nightly rhythm")}</h3>
                <p>{t("When you fell asleep and woke up. Select a night for details.")}</p>
              </header>
              <RhythmChart week={week} selected={night.date} scored={scored} onSelect={setSelected} />
            </section>
            <NightDetail night={night} week={week} />
          </div>

          <StageMix week={week} selected={night.date} />

          <p className="sleep-week-footnote">
            {local
              ? t("Sleep from your watch. Averages use complete main sleeps; naps are not counted.")
              : t("Scores and stages come from COROS. Averages use complete main sleeps; naps are not counted.")}
          </p>
        </div>
      </div>
    </section>
  );
}
