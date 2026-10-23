import { t, useLanguage, getLocale, formatNumber, formatDate } from "../../i18n/training";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Flag,
  GitCompareArrows,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  X
} from "lucide-react";
import type { RaceEntry, RaceSuggestion } from "../../../electron/raceTypes";
import {
  BUILD_UP_WEEKS,
  computeRaceProgress,
  RACE_DISTANCES,
  raceDistanceLabel,
  raceGroupKey,
  type RaceResultProgress
} from "../../../electron/raceModel";
import type { UnitSystem } from "../../../electron/types";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatDistanceValue, formatElevationValue, formatPaceValue } from "../../units/units";
import { formatRaceDate, formatRaceDelta, formatRaceDistance, formatRaceSuggestionReason, formatRaceTime } from "../raceFormat";
import type { RaceJournal } from "../useRaceJournal";
import { RacePlaque, type PlaqueGroup } from "./RacePlaques";
import { RaceComparison } from "./RaceComparison";
import { RaceEditorDialog, type RaceEditorTarget } from "./RaceEditorDialog";
import { RaceProgressChart, type RaceChartPoint } from "./RaceProgressChart";
import { RaceTargets } from "./RaceTargets";
import "../races.css";

const ALL = "all";

/** "First half" reads better in a chip than "First Half Marathon". */
function shortDistance(race: RaceEntry, label: string): string {
  if (race.distanceKey === "half") return t("Half");
  if (race.distanceKey === "marathon") return t("Marathon");
  if (race.distanceKey === "1mi") return t("mile");
  return race.distanceKey === "other" ? t("race") : label;
}

function paceOf(race: RaceEntry): number {
  return race.officialTime / (race.officialDistance / 1000);
}

function yearOf(epochSeconds: number): number {
  return new Date(epochSeconds * 1000).getFullYear();
}

export function RacesPanel({
  journal,
  onOpenActivities
}: {
  journal: RaceJournal;
  onOpenActivities: () => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const races = journal.overview?.races ?? [];
  const suggestions = journal.overview?.suggestions ?? [];
  const strava = journal.overview?.strava;
  const progress = useMemo(() => computeRaceProgress(races), [races]);
  const [filter, setFilter] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [editor, setEditor] = useState<RaceEditorTarget | null>(null);

  // An equivalent is an estimate: whole seconds, never the tenths a chip time may carry.
  const fiveK = useMemo(
    () => (race: RaceEntry) => Math.round(progress.get(race.raceId)?.fiveKEquivalent ?? race.officialTime),
    [progress]
  );

  const groups = useMemo<PlaqueGroup[]>(() => {
    const byKey = new Map<string, RaceEntry[]>();
    for (const race of [...races].sort((a, b) => a.startTime - b.startTime)) {
      const key = raceGroupKey(race);
      byKey.set(key, [...(byKey.get(key) ?? []), race]);
    }
    const order = (race: RaceEntry) => {
      const standard = RACE_DISTANCES.findIndex((distance) => distance.key === race.distanceKey);
      return standard >= 0 ? standard : RACE_DISTANCES.length + race.officialDistance / 1e6;
    };
    const distanceGroups = [...byKey.entries()]
      .map(([key, members]) => ({
        key,
        label: formatRaceDistance(members[0], unitSystem),
        distanceKey: members[0].distanceKey,
        races: members,
        valueOf: (race: RaceEntry) => race.officialTime
      }))
      .sort((a, b) => order(a.races[0]) - order(b.races[0]));
    if (distanceGroups.length < 2) return distanceGroups;
    return [
      {
        key: ALL,
        label: t("All races"),
        distanceKey: "all",
        races: [...races].sort((a, b) => a.startTime - b.startTime),
        valueOf: fiveK
      },
      ...distanceGroups
    ];
  }, [races, unitSystem, fiveK, getLocale()]);

  // Start on the one distance when there is only one; keep a choice that still exists.
  const activeKey = groups.some((group) => group.key === filter) ? filter : groups[0]?.key ?? ALL;
  const activeGroup = groups.find((group) => group.key === activeKey);
  useEffect(() => {
    setCompareIds((current) => current.filter((id) => races.some((race) => race.raceId === id)));
  }, [races]);

  const shown = activeKey === ALL ? races : races.filter((race) => progress.get(race.raceId)?.groupKey === activeKey);
  const raceById = useMemo(() => new Map(races.map((race) => [race.raceId, race])), [races]);
  const busy = journal.pending !== null;
  const maxBuildUp = useMemo(
    () => ({
      runs: Math.max(1, ...races.map((race) => race.buildUp?.runs ?? 0)),
      distance: Math.max(1, ...races.map((race) => race.buildUp?.distance ?? 0)),
      longestRun: Math.max(1, ...races.map((race) => race.buildUp?.longestRun ?? 0))
    }),
    [races]
  );

  const years = useMemo(() => {
    const byYear = new Map<number, RaceEntry[]>();
    for (const race of shown) byYear.set(yearOf(race.startTime), [...(byYear.get(yearOf(race.startTime)) ?? []), race]);
    return [...byYear.entries()].sort((a, b) => b[0] - a[0]);
  }, [shown]);

  const comparing =
    compareIds.length === 2
      ? compareIds
          .map((id) => raceById.get(id))
          .filter((race): race is RaceEntry => Boolean(race))
          .sort((a, b) => a.startTime - b.startTime)
      : [];
  const firstYear = races.length ? yearOf(races[races.length - 1].startTime) : undefined;

  return (
    <section className="panel training-races-panel" aria-labelledby="races-title">
      <header className="races-head">
        <div className="races-head-copy">
          <p className="race-eyebrow">{t("Race journal")}</p>
          <h2 className="races-title" id="races-title">{t("Races")}</h2>
          <p className="races-summary">
            {races.length === 0
              ? t("Every official result you run, kept in one place.")
              : t("{{p0}} {{p1}} since {{p2}}", { p0: String(races.length), p1: String(t(races.length === 1 ? "race" : "races")), p2: String(firstYear) })}
          </p>
        </div>
        <div className="races-head-actions">
          {strava?.connected ? (
            <button
              type="button"
              className="race-action"
              disabled={busy || journal.readOnly}
              onClick={() => void journal.importStrava()}
              title={
                strava.lastImportedAt
                  ? t("Last imported {{p0}}", { p0: String(new Date(strava.lastImportedAt).toLocaleString(getLocale())) })
                  : t("Bring in runs you marked Race on Strava")
              }
            >
              {journal.pending === "import" ? (
                <Loader2 className="spin" size={15} aria-hidden="true" />
              ) : (
                <RefreshCw size={15} aria-hidden="true" />
              )}
              {t("Import from Strava")}</button>
          ) : null}
          <button
            type="button"
            className="race-action is-primary"
            disabled={journal.readOnly}
            onClick={() => {
              journal.clearMessages();
              setEditor({ mode: "add" });
            }}
          >
            <Plus size={15} aria-hidden="true" />
            {t("Add race")}</button>
        </div>
      </header>

      {journal.readOnly ? (
        <p className="race-notice" role="status">
          <Info size={15} aria-hidden="true" />
          {t("Sample races. Leave the preview to see and edit your own.")}</p>
      ) : null}
      {journal.error && !editor ? (
        <p className="race-notice is-error" role="alert">
          {journal.error}
          <button type="button" className="race-icon-button" aria-label={t("Dismiss")} onClick={journal.clearMessages}>
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : null}
      {journal.notice ? (
        <p className="race-notice" role="status">
          <Check size={15} aria-hidden="true" />
          {journal.notice}
          <button type="button" className="race-icon-button" aria-label={t("Dismiss")} onClick={journal.clearMessages}>
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : null}
      {strava && strava.hiddenRaces > 0 ? (
        <p className="race-notice" role="status">
          <Info size={15} aria-hidden="true" />
          {strava.hiddenRaces === 1
            ? t("1 race from Strava is hidden while Strava is disconnected. Your notes and chip times are kept.")
            : t("{{count}} races from Strava are hidden while Strava is disconnected. Your notes and chip times are kept.", { count: formatNumber(strava.hiddenRaces) })}
        </p>
      ) : null}

      {journal.overview?.targets?.length ? (
        <RaceTargets targets={journal.overview.targets} journal={journal} unitSystem={unitSystem} />
      ) : null}

      {suggestions.length > 0 ? (
        <RaceSuggestions suggestions={suggestions} journal={journal} unitSystem={unitSystem} />
      ) : null}

      {journal.loading && !journal.overview ? (
        <p className="race-notice" role="status">
          <Loader2 className="spin" size={15} aria-hidden="true" />
          {t("Loading your races…")}</p>
      ) : races.length === 0 ? (
        <RacesEmpty
          hasSuggestions={suggestions.length > 0}
          readOnly={journal.readOnly}
          onAdd={() => setEditor({ mode: "add" })}
          onOpenActivities={onOpenActivities}
        />
      ) : (
        <>
          <div className="races-plaques" role="group" aria-label={t("Personal bests by distance")}>
            {groups.map((group) => (
              <RacePlaque
                key={group.key}
                group={group}
                active={group.key === activeKey}
                onSelect={() => setFilter(group.key)}
              />
            ))}
          </div>

          {activeGroup ? (
            <RaceProgress
              group={activeGroup}
              progress={progress}
              selectedId={expanded}
              onSelect={(raceId) => setExpanded(raceId)}
            />
          ) : null}

          {comparing.length === 2 ? (
            <RaceComparison
              older={comparing[0]}
              newer={comparing[1]}
              fiveK={fiveK}
              unitSystem={unitSystem}
              onClear={() => setCompareIds([])}
            />
          ) : null}

          {compareIds.length === 1 ? (
            <p className="races-compare-hint" role="status">
              <GitCompareArrows size={15} aria-hidden="true" />
              {t("Choose a second race to compare with")}{raceById.get(compareIds[0])?.name}.
              <button type="button" className="race-text-button" onClick={() => setCompareIds([])}>{t("Cancel")}</button>
            </p>
          ) : null}

          <div className="races-timeline" aria-label={activeKey === ALL ? t("Every race") : t("{{p0}} races", { p0: String(activeGroup?.label) })}>
            {years.map(([year, members]) => (
              <section className="races-year" key={year} aria-label={String(year)}>
                <div className="races-year-mark" aria-hidden="true">
                  <span>{year}</span>
                  <small>
                    {members.length} {members.length === 1 ? t("race") : t("races")}
                  </small>
                </div>
                <ol className="races-year-list">
                  {members.map((race) => (
                    <RaceRow
                      key={race.raceId}
                      race={race}
                      progress={progress.get(race.raceId)}
                      previous={raceById.get(progress.get(race.raceId)?.previousRaceId ?? "")}
                      maxBuildUp={maxBuildUp}
                      unitSystem={unitSystem}
                      expanded={expanded === race.raceId}
                      comparing={compareIds.includes(race.raceId)}
                      readOnly={journal.readOnly}
                      onToggle={() => setExpanded((current) => (current === race.raceId ? null : race.raceId))}
                      onEdit={() => {
                        journal.clearMessages();
                        setEditor({ mode: "edit", race });
                      }}
                      onCompare={() =>
                        setCompareIds((current) =>
                          current.includes(race.raceId)
                            ? current.filter((id) => id !== race.raceId)
                            : [...current, race.raceId].slice(-2)
                        )
                      }
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}

      {strava && !strava.connected && !journal.readOnly ? (
        <p className="races-foot-note">
          <Info size={14} aria-hidden="true" />
          {t("Mark a run as a race from its details in Activities. Strava subscribers can also connect Strava in Strength or Settings → Accounts & API to import runs marked Race there.")}</p>
      ) : null}

      <RaceEditorDialog
        target={editor}
        busy={busy}
        error={journal.error}
        onClose={() => setEditor(null)}
        onSave={journal.updateRace}
        onAdd={journal.addManualRace}
        onRemove={async (raceId) => {
          const removed = await journal.removeRace(raceId);
          if (removed) setExpanded(null);
          return removed;
        }}
      />
    </section>
  );
}

function RacesEmpty({
  hasSuggestions,
  readOnly,
  onAdd,
  onOpenActivities
}: {
  hasSuggestions: boolean;
  readOnly: boolean;
  onAdd: () => void;
  onOpenActivities: () => void;
}) {
  useLanguage();
  return (
    <div className="races-empty">
      <div className="race-plaque is-empty" aria-hidden="true">
        <span className="race-plaque-mark">5K</span>
        <span className="race-plaque-top">
          <span className="race-plaque-label">
            <span>{t("First race")}</span>
          </span>
        </span>
        <span className="race-plaque-hero is-empty">{t("Not yet set")}</span>
        <span className="race-plaque-foot">
          <span>{t("Your first result lands here")}</span>
        </span>
      </div>
      <div className="races-empty-copy">
        <h3>{hasSuggestions ? t("Confirm your first race") : t("Start your race journal")}</h3>
        <p>
          {hasSuggestions
            ? t("Confirm the runs above that were races. Each distance gets a card with your best time, and every race joins the timeline.")
            : t("Open a run in Activities and choose Mark as race, or add a race you ran before you had this watch.")}
        </p>
        <div className="races-empty-actions">
          <button type="button" className="race-action" onClick={onOpenActivities}>{t("Open Activities")}</button>
          <button type="button" className="race-action is-primary" disabled={readOnly} onClick={onAdd}>
            <Plus size={15} aria-hidden="true" />
            {t("Add a past race")}</button>
        </div>
      </div>
    </div>
  );
}

function RaceSuggestions({
  suggestions,
  journal,
  unitSystem
}: {
  suggestions: RaceSuggestion[];
  journal: RaceJournal;
  unitSystem: UnitSystem;
}) {
  useLanguage();
  return (
    <section className="races-suggestions" aria-labelledby="races-suggestions-title">
      <div className="races-suggestions-head">
        <h3 id="races-suggestions-title">{t("Were these races?")}</h3>
        <p>{t("These runs look like race efforts. Confirm the ones that were.")}</p>
      </div>
      <ul>
        {suggestions.map((suggestion) => {
          const { activity } = suggestion;
          const marking = journal.pending === `mark:${activity.activityId}`;
          const dismissing = journal.pending === `dismiss:${activity.activityId}`;
          const label = t(suggestion.distanceKey === "other" ? "Race" : raceDistanceLabel(suggestion.distanceKey));
          return (
            <li key={activity.activityId} className="race-suggestion">
              <span className="race-suggestion-chip" data-distance={suggestion.distanceKey} aria-hidden="true">
                {suggestion.distanceKey === "half" ? t("Half") : suggestion.distanceKey === "marathon" ? t("Mar", undefined, "raceDistance") : label}
              </span>
              <div className="race-suggestion-copy">
                <strong>{activity.name || t("Run")}</strong>
                <span>
                  {activity.startTime ? formatRaceDate(activity.startTime) : t("Undated")}, {formatDistanceValue(activity.distance, unitSystem)} {t("in")}{" "}
                  {formatRaceTime(activity.duration)}
                </span>
                <small>{suggestion.reasons.map(formatRaceSuggestionReason).join(". ")}.</small>
              </div>
              <div className="race-suggestion-actions">
                <button
                  type="button"
                  className="race-text-button"
                  disabled={journal.pending !== null || journal.readOnly}
                  onClick={() => void journal.dismissSuggestion(activity.activityId)}
                >
                  {dismissing ? <Loader2 className="spin" size={14} aria-hidden="true" /> : null}
                  {t("Not a race")}</button>
                <button
                  type="button"
                  className="race-action is-compact"
                  disabled={journal.pending !== null || journal.readOnly}
                  onClick={() => void journal.markActivity(activity)}
                >
                  {marking ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <Flag size={14} aria-hidden="true" />}
                  {suggestion.distanceKey === "other" ? t("It was a race") : t("It was a {{p0}}", { p0: String(label) })}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RaceProgress({
  group,
  progress,
  selectedId,
  onSelect
}: {
  group: PlaqueGroup;
  progress: Map<string, RaceResultProgress>;
  selectedId: string | null;
  onSelect: (raceId: string) => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const all = group.distanceKey === "all";
  const races = group.races;
  const best = races.reduce((current, race) => (group.valueOf(race) < group.valueOf(current) ? race : current));
  let fastest = Number.POSITIVE_INFINITY;
  const points: RaceChartPoint[] = races.map((race, index) => {
    const value = group.valueOf(race);
    // A best set on the day, as a 5K for "All"; the very first race sets nothing.
    const isPb = index > 0 && value < fastest;
    fastest = Math.min(fastest, value);
    return {
      raceId: race.raceId,
      startTime: race.startTime,
      value,
      name: race.name,
      detail: all
        ? t("{{p0}} in {{p1}}", { p0: String(formatRaceDistance(race, unitSystem)), p1: String(formatRaceTime(race.officialTime)) })
        : formatPaceValue(paceOf(race), unitSystem),
      isBest: race === best,
      isPb: all ? isPb : Boolean(progress.get(race.raceId)?.wasPersonalBest && index > 0)
    };
  });

  return (
    <div className="races-chart-frame" data-distance={group.distanceKey}>
      <div className="races-chart-head">
        <p className="races-chart-title">
          {all ? t("Every race as a 5K") : t("{{p0}} finish times", { p0: String(group.label) })}
          {all ? <>{" "}<span>{t("scaled with Riegel's formula, so distances share one line")}</span></> : null}
        </p>
        <ul className="races-chart-legend" aria-label={t("Legend")}>
          <li>
            <i className="is-race" aria-hidden="true" />
            {t("Race")}</li>
          <li>
            <i className="is-pb" aria-hidden="true" />
            {t("New best")}</li>
        </ul>
      </div>
      <RaceProgressChart
        points={points}
        valueLabel={all ? t("5K equivalent") : t("{{distance}} finish time", { distance: group.label })}
        selectedId={selectedId}
        onSelect={onSelect}
        color={all ? "var(--accent)" : `var(--race-dot-${group.distanceKey})`}
      />
    </div>
  );
}

function BuildUpMeter({
  label,
  value,
  max,
  text
}: {
  label: string;
  value: number;
  max: number;
  text: string;
}) {
  useLanguage();
  return (
    <div className="race-meter">
      <span>{label}</span>
      <span className="race-meter-track" aria-hidden="true">
        <span style={{ "--fill": `${Math.min(100, (value / max) * 100)}%` } as CSSProperties} />
      </span>
      <strong>{text}</strong>
    </div>
  );
}

function RaceRow({
  race,
  progress,
  previous,
  maxBuildUp,
  unitSystem,
  expanded,
  comparing,
  readOnly,
  onToggle,
  onEdit,
  onCompare
}: {
  race: RaceEntry;
  progress?: RaceResultProgress;
  previous?: RaceEntry;
  maxBuildUp: { runs: number; distance: number; longestRun: number };
  unitSystem: UnitSystem;
  expanded: boolean;
  comparing: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCompare: () => void;
}) {
  useLanguage();
  const date = new Date(race.startTime * 1000);
  const distance = formatRaceDistance(race, unitSystem);
  const isFirst = progress?.previousRaceId === undefined;
  const delta = progress?.deltaToPrevious;
  const isPb = !isFirst && Boolean(progress?.wasPersonalBest);
  const detailId = `race-detail-${race.raceId.replace(/[^a-z0-9]/gi, "-")}`;
  // COROS is the default source here, so only the others are named.
  const source = race.source === "manual" ? t("Added by hand") : race.stravaActivityId ? "Strava" : null;
  const buildUp = race.buildUp;
  const hasBuildUp = Boolean(buildUp && (buildUp.runs > 0 || buildUp.complete));

  return (
    <li
      className={`race-row${expanded ? " is-expanded" : ""}${comparing ? " is-comparing" : ""}${isPb ? " is-pb" : ""}`}
      data-distance={race.distanceKey}
    >
      <span className="race-node" aria-hidden="true" />
      <button type="button" className="race-row-main" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>
        <span className="race-row-date">{formatDate(date, { month: "short", day: "numeric" })}</span>
        <span className="race-row-title">
          <strong>{race.name}</strong>
          <span>
            <span className="race-chip">{distance}</span>
            {source ? <span>{source}</span> : null}
            {race.placing ? <span className="race-row-placing">{race.placing}</span> : null}
          </span>
        </span>
        <span className="race-row-result">
          <strong>{formatRaceTime(race.officialTime)}</strong>
          <small>{formatPaceValue(paceOf(race), unitSystem)}</small>
        </span>
        <span className="race-row-trend">
          {isFirst ? (
            <span className="race-trend is-first" title={t("Your first {{p0}} race", { p0: String(distance) })}>{t("First {{p0}}", { p0: String(shortDistance(race, distance)) })}</span>
          ) : isPb ? (
            <span className="race-trend is-pb" title={t("{{p0}} on {{p1}}", { p0: String(formatRaceDelta(delta)), p1: String(previous?.name ?? t("the previous race")) })}>
              {t("PB")}<em>{formatRaceDelta(delta)}</em>
            </span>
          ) : (
            <span
              className={`race-trend ${delta !== undefined && delta < 0 ? "is-faster" : "is-slower"}`}
              title={t("Versus {{p0}}", { p0: String(previous?.name ?? t("the previous race")) })}
            >
              {formatRaceDelta(delta)}
            </span>
          )}
        </span>
        <ChevronDown className="race-row-chevron" size={17} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="race-row-detail" id={detailId}>
          <div className="race-detail-grid">
            <dl className="race-facts">
              <div>
                <dt>{t("Official result")}</dt>
                <dd>
                  {formatRaceTime(race.officialTime)} {t("over")}{distance}
                  <small>{race.officialTimeIsManual ? t("Chip time you entered") : t("Watch time")}</small>
                </dd>
              </div>
              {race.recordedDistance ? (
                <div>
                  <dt>{t("Watch measured")}</dt>
                  <dd>
                    {formatDistanceValue(race.recordedDistance, unitSystem)}
                    {race.recordedTime ? <small>{t("in {{p0}}", { p0: String(formatRaceTime(race.recordedTime)) })}</small> : null}
                  </dd>
                </div>
              ) : null}
              {race.avgHr ? (
                <div>
                  <dt>{t("Avg heart rate")}</dt>
                  <dd>{Math.round(race.avgHr)} bpm</dd>
                </div>
              ) : null}
              {race.elevationGain !== undefined && race.source !== "manual" ? (
                <div>
                  <dt>{t("Elevation gain")}</dt>
                  <dd>{formatElevationValue(race.elevationGain, unitSystem)}</dd>
                </div>
              ) : null}
              {race.notes ? (
                <div className="is-wide">
                  <dt>{t("Notes")}</dt>
                  <dd className="race-notes">{race.notes}</dd>
                </div>
              ) : null}
            </dl>
            <div className="race-buildup">
              <p>{t("The {{p0}} weeks before", { p0: String(BUILD_UP_WEEKS) })}</p>
              {hasBuildUp && buildUp ? (
                <>
                  <BuildUpMeter label={t("Runs")} value={buildUp.runs} max={maxBuildUp.runs} text={String(buildUp.runs)} />
                  <BuildUpMeter
                    label={t("Distance")}
                    value={buildUp.distance}
                    max={maxBuildUp.distance}
                    text={formatDistanceValue(buildUp.distance, unitSystem, { digits: 0 })}
                  />
                  <BuildUpMeter
                    label={t("Longest run")}
                    value={buildUp.longestRun ?? 0}
                    max={maxBuildUp.longestRun}
                    text={buildUp.longestRun ? formatDistanceValue(buildUp.longestRun, unitSystem, { digits: 1 }) : "—"}
                  />
                  {!buildUp.complete ? <small>{t("Your synced history starts partway through these weeks.")}</small> : null}
                </>
              ) : (
                <small>{t("No synced training before this race.")}</small>
              )}
            </div>
          </div>
          <div className="race-row-actions">
            <button type="button" className="race-action is-compact" disabled={readOnly} onClick={onEdit}>
              <Pencil size={14} aria-hidden="true" />
              {t("Edit")}</button>
            <button
              type="button"
              className={`race-action is-compact${comparing ? " is-on" : ""}`}
              aria-pressed={comparing}
              onClick={onCompare}
            >
              <GitCompareArrows size={14} aria-hidden="true" />
              {comparing ? t("Comparing") : t("Compare")}
            </button>
            {race.stravaUrl ? (
              <a className="race-strava-link" href={race.stravaUrl} target="_blank" rel="noreferrer">
                {t("View on Strava")}<ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
