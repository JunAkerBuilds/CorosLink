import { useLanguage, getLocale, t } from "../../i18n/training";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Activity, Bike, CalendarDays, ChevronLeft, ChevronRight, Dumbbell, Flag, Flame,
  Footprints, Gauge, Heart, LayoutGrid, List, Loader2, MapPin, Mountain, Search, Sparkles, Timer, X } from "lucide-react";
import { PersonSimpleRun, PersonSimpleWalk, PersonSimpleSwim } from "@phosphor-icons/react";
import type { RouteGeocodeResult, TrainingHubActivity, TrainingHubActivityDetail, TrainingHubSportType } from "../../../electron/types";
import type { TrainingHubViewProps } from "../types";
import { activityCategory, activityTimeline, activityTimestamp, activityTotals, lapPacing, selectActivities,
  type ActivityCategory, type ActivitySort, type LapPacing } from "../activityCollection";
import { formatDistanceMeters, formatDurationSeconds, formatElevationMeters, formatPaceSecondsPerKm, formatTrainingLongTimestamp,
  formatTrainingTimestamp } from "../formatters";
import { resolveSportName } from "../sportTypes";
import { isRaceSportType } from "../../../electron/raceModel";
import { activityMovingSeconds, activityPaceSecondsPerKm, activitySignificantElapsedSeconds } from "../../../electron/activityTime";
import type { RaceJournal } from "../useRaceJournal";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatSpeedValue, metersToSwimDistance, swimDistanceUnit } from "../../units/units";
import { ActivityCardRoute, createActivityPreviewLoader, type ActivityPreviewLoader } from "./ActivityCardRoute";
import { ActivityDetailPanel } from "./ActivityDetailPanel";
import { ActivityTitleEditor } from "./ActivityTitleEditor";
import { ExportMenu, TrainingActivityTable } from "./TrainingActivityTable";
import { ActivityLabelChips } from "./TrainingLabelChip";
import "../trainingActivities.css";

const sports = [
  { id: "all", label: "All", icon: Footprints },
  { id: "run", label: "Run", icon: PersonSimpleRun },
  { id: "ride", label: "Ride", icon: Bike },
  { id: "swim", label: "Swim", icon: PersonSimpleSwim },
  { id: "walk", label: "Walk", icon: PersonSimpleWalk },
  { id: "strength", label: "Strength", icon: Dumbbell },
  { id: "other", label: "Other", icon: Activity }
] as const;
const views = [{ id: "grid", label: "Grid", icon: LayoutGrid }, { id: "list", label: "List", icon: List },
  { id: "calendar", label: "Calendar", icon: CalendarDays }] as const;
const encouragement = {
  run: ["Good run!", "Keep building consistency."], ride: ["Nice ride!", "Every ride adds up."],
  swim: ["Solid swim!", "One stroke at a time."], walk: ["Great walk!", "Every step counts."],
  strength: ["Strong session!", "Keep showing up."], other: ["Session complete!", "Keep moving forward."]
};

function MetricSpark({ values, bars = false }: { values: (number | undefined)[]; bars?: boolean }) {
  useLanguage();
  const data = values.map(value => value ?? 0);
  const max = Math.max(1, ...data);
  return <svg className="activities-stat-spark" viewBox="0 0 80 36" aria-hidden="true">
    {bars ? data.map((value, index) => <rect key={index} x={index * 8 + 1} y={34 - value / max * 30}
      width="4" height={Math.max(1, value / max * 30)} rx="0.6" fill="currentColor" opacity={0.35 + index * 0.065} />)
      : <polyline points={data.map((value, index) => `${index * 8 + 3},${33 - value / max * 29}`).join(" ")}
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>;
}

function ActivitySummary({ activities }: { activities: TrainingHubActivity[] }) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const totals = useMemo(() => activityTotals(activities), [activities, getLocale()]);
  const timeline = useMemo(() => activityTimeline(activities), [activities, getLocale()]);
  const metrics = [
    { key: "count", label: t("Total Activities"), value: totals.count.toLocaleString(getLocale()), icon: PersonSimpleRun, color: "#52dfab", bars: true, note: "In this selection" },
    { key: "distance", label: t("Total Distance"), value: totals.distance === undefined ? "—" : formatDistanceMeters(totals.distance, unitSystem), icon: MapPin, color: "#65dcec", bars: false, note: "Distance covered" },
    { key: "duration", label: t("Total Time"), value: totals.duration === undefined ? "—" : formatDurationSeconds(totals.duration), icon: Timer, color: "#c995f5", bars: true, note: "Time in motion" },
    { key: "pace", label: t("Avg Pace"), value: formatPaceSecondsPerKm(totals.pace, unitSystem), icon: Gauge, color: "#58ddd4", bars: false, note: "Running & walking" },
    { key: "calories", label: t("Calories"), value: totals.calories === undefined ? "—" : `${Math.round(totals.calories).toLocaleString(getLocale())} kcal`, icon: Flame, color: "#f7aa54", bars: true, note: "Energy burned" }
  ] as const;
  return <div className="activities-summary" aria-label={t("Activity totals")}>
    {metrics.map(({ key, label, value, icon: Icon, color, bars, note }) =>
      <div className="activities-stat" key={key} style={{ "--stat-color": color } as CSSProperties}>
        <span className="activities-stat-icon"><Icon size={23} aria-hidden="true" /></span>
        <div className="activities-stat-copy"><span>{t(label)}</span><strong>{value}</strong><small>{t(note)}</small></div>
        <MetricSpark values={timeline.map(bucket => bucket[key])} bars={bars} />
      </div>)}
  </div>;
}

type Props = Pick<TrainingHubViewProps, "activities" | "sportTypes" | "selectedActivity" | "activityDetail" | "busy" | "onLoadDetail" | "onExportFile" | "onRenameActivity"> & {
  loadPreview: ActivityPreviewLoader; sampleMode?: boolean;
  /** Reverse-geocodes a track's first point for the detail dialog's location chip. */
  resolveLocation?: (lat: number, lon: number) => Promise<RouteGeocodeResult>;
  /** Race tags: a badge on cards and a Mark as race toggle in the dialog. */
  raceTags?: Pick<RaceJournal, "raceActivityIds" | "pending" | "readOnly" | "toggleActivity">;
  /** Opens this activity's detail when another view links straight to it. */
  openRequest?: { activity: TrainingHubActivity; requestId: number } | null;
};

function ActivityCard({ activity, sportTypes, busy, sampleMode, onLoadDetail, onExportFile, loadPreview, isRace = false }: {
  activity: TrainingHubActivity; sportTypes: TrainingHubSportType[]; isRace?: boolean;
} & Pick<Props, "busy" | "sampleMode" | "onLoadDetail" | "onExportFile" | "loadPreview">) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const category = activityCategory(activity.sportType);
  const sport = sports.find(item => item.id === category)!;
  const Icon = sport.icon;
  const name = activity.name || resolveSportName(activity, sportTypes) || "Activity";
  // Moving time, as COROS shows it; elapsed would count pauses into pace.
  const moving = activityMovingSeconds(activity);
  const pace = activityPaceSecondsPerKm(activity);
  const paceValue = category === "ride"
    ? formatSpeedValue(pace ? 3600 / pace : undefined, unitSystem)
    : category === "swim"
      ? activity.distance && moving
        ? `${formatDurationSeconds(moving / (metersToSwimDistance(activity.distance, unitSystem) / 100))} /100${swimDistanceUnit(unitSystem)}` : "—"
      : formatPaceSecondsPerKm(pace, unitSystem);
  const indoor = [101, 201, 300, 400, 402, 701, 800, 801].includes(activity.sportType);
  return <article className={`activity-card activity-sport-${category}`}>
    <header className="activity-card-heading">
      <span className="activity-card-sport-icon"><Icon size={29} aria-hidden="true" /></span>
      <div className="activity-card-title"><h3><button type="button" onClick={() => onLoadDetail(activity)} title={name}>{name}</button></h3>
        <time dateTime={activityTimestamp(activity.startTime) ? new Date(activityTimestamp(activity.startTime)).toISOString() : undefined}>{formatTrainingTimestamp(activity.startTime)}</time>
        <span className="activity-card-label"><ActivityLabelChips activityId={activity.activityId} sportType={activity.sportType} /></span></div>
      {isRace ? <span className="activity-card-race" title={t("Marked as a race")}><Flag size={12} aria-hidden="true" />{t("Race")}</span> : null}
      <span className="activity-card-badge">{t(sport.label)}</span>
      <ExportMenu activity={activity} activityName={name} busy={busy} disabled={sampleMode} compact onExportFile={onExportFile} />
    </header>
    <button type="button" className="activity-card-body" aria-label={t("View details for {{value1}}", { value1: String(name) })} onClick={() => onLoadDetail(activity)}>
      <ActivityCardRoute activity={activity} load={loadPreview} indoor={indoor} />
      <span className="activity-card-primary">
        <span><strong>{activity.distance === undefined ? "—" : formatDistanceMeters(activity.distance, unitSystem, category === "swim")}</strong><small>{t("Distance")}</small></span>
        <span><strong>{moving === undefined ? "—" : formatDurationSeconds(moving)}</strong><small>{t("Time")}</small></span>
        <span><strong>{paceValue}</strong><small>{category === "ride" ? t("Avg Speed") : t("Avg Pace")}</small></span>
      </span>
      <span className="activity-card-secondary">
        <span><Heart size={18} className="activity-metric-heart" /><span><strong>{activity.avgHr === undefined ? "—" : t("{{p0}} bpm", { p0: String(Math.round(activity.avgHr)) })}</strong><small>{t("Avg HR")}</small></span></span>
        <span><Flame size={18} className="activity-metric-calories" /><span><strong>{activity.calories === undefined ? "—" : t("{{p0}} kcal", { p0: String(Math.round(activity.calories)) })}</strong><small>{t("Calories")}</small></span></span>
        <span><Mountain size={18} className="activity-metric-elevation" /><span><strong>{formatElevationMeters(activity.elevationGain, unitSystem)}</strong><small>{t("Elev Gain")}</small></span></span>
      </span>
    </button>
  </article>;
}

function ActivityCalendar({ activities, onOpen }: { activities: TrainingHubActivity[]; onOpen: (activity: TrainingHubActivity) => void }) {
  useLanguage();
  const [month, setMonth] = useState(() => {
    const latest = Math.max(0, ...activities.map(activity => activityTimestamp(activity.startTime)));
    const date = latest ? new Date(latest) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const offset = (month.getDay() + 6) % 7;
  const cells = Math.ceil((offset + dayCount) / 7) * 7;
  return <section className="activities-calendar" aria-label={t("Activity calendar")}>
    <header><h2>{month.toLocaleDateString(getLocale(), { month: "long", year: "numeric" })}</h2><div>
      <button type="button" aria-label={t("Previous month")} onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}><ChevronLeft size={17} /></button>
      <button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); }}>{t("Today")}</button>
      <button type="button" aria-label={t("Next month")} onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}><ChevronRight size={17} /></button>
    </div></header>
    <div className="activities-calendar-grid">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <div className="activities-calendar-weekday" key={day}>{t(day)}</div>)}
      {Array.from({ length: cells }, (_, index) => {
        const day = index - offset + 1;
        const inMonth = day > 0 && day <= dayCount;
        const matches = inMonth ? activities.filter(activity => {
          const timestamp = activityTimestamp(activity.startTime);
          if (!timestamp) return false;
          const date = new Date(timestamp);
          return date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day;
        }) : [];
        return <div className={`activities-calendar-day${inMonth ? "" : " is-outside"}`} key={index}>
          {inMonth ? <><span>{day}</span>{matches.map(activity => <button type="button" key={activity.activityId}
            className={`activity-sport-${activityCategory(activity.sportType)}`} onClick={() => onOpen(activity)}
            title={`${activity.name || resolveSportName(activity)} · ${formatTrainingTimestamp(activity.startTime)}`}>
              <i aria-hidden="true" />{activity.name || resolveSportName(activity) || t("Activity")}</button>)}</> : null}
        </div>;
      })}
    </div>
  </section>;
}

export function TrainingActivities({ activities, sportTypes, selectedActivity, activityDetail, busy,
  onLoadDetail, onExportFile, onRenameActivity, loadPreview, resolveLocation, raceTags, openRequest, sampleMode = false }: Props) {
  useLanguage();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ActivityCategory>("all");
  const [sort, setSort] = useState<ActivitySort>("newest");
  const [view, setView] = useState<"grid" | "list" | "calendar">("grid");
  const [limit, setLimit] = useState(24);
  const [opened, setOpened] = useState<TrainingHubActivity | null>(null);
  const loader = useMemo(() => createActivityPreviewLoader(loadPreview), [loadPreview, getLocale()]);
  const names = useMemo(() => new Map(sportTypes.map(sport => [sport.sportType, sport.sportName])), [sportTypes, getLocale()]);
  const filtered = useMemo(() => selectActivities(activities, category, query, sort, names), [activities, category, query, sort, names, getLocale()]);
  useEffect(() => { setLimit(24); }, [category, query, sort]);
  function openActivity(activity: TrainingHubActivity) { setOpened(activity); onLoadDetail(activity); }
  // The open dialog holds its own copy of the activity, so it takes the new name too.
  const renameActivity = onRenameActivity && !sampleMode ? async (activity: TrainingHubActivity, name: string) => {
    const saved = await onRenameActivity(activity, name);
    setOpened(current => current?.activityId === activity.activityId ? { ...current, name: saved } : current);
  } : undefined;
  const handledOpenRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest || handledOpenRequest.current === openRequest.requestId) return;
    handledOpenRequest.current = openRequest.requestId;
    openActivity(openRequest.activity);
  }, [openRequest]);
  return <div className="activities-browser">
    <div className="activities-toolbar">
      <label className="activities-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label={t("Search activities")}
        placeholder={t("Search activities…")} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="activities-sport-filters" role="group" aria-label={t("Filter by sport")}>
        {sports.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={category === id}
          className={`activity-sport-${id}`} onClick={() => setCategory(id)}><Icon size={17} aria-hidden="true" />{t(label)}</button>)}
      </div>
      <div className="activities-display-controls"><select aria-label={t("Sort activities")} value={sort} onChange={event => setSort(event.target.value as ActivitySort)}>
        <option value="newest">{t("Newest first")}</option><option value="oldest">{t("Oldest first")}</option><option value="distance">{t("Longest distance")}</option><option value="duration">{t("Longest time")}</option>
      </select><div className="activities-view-toggle" role="group" aria-label={t("Activity view")}>
        {views.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-label={t("{{value1}} view", { value1: String(label) })} title={t("{{value1}} view", { value1: String(label) })}
          aria-pressed={view === id} onClick={() => { setView(id); if (id === "list") setOpened(selectedActivity); else setOpened(null); }}><Icon size={17} aria-hidden="true" /></button>)}
      </div></div>
    </div>
    <ActivitySummary activities={filtered} />
    <div className={`activities-results${view === "list" && opened ? " has-detail" : ""}`}>
      <div className="activities-results-content">
      <p className="sr-only" role="status">{filtered.length} {filtered.length === 1 ? t("activity") : t("activities")} {t("found")}</p>
      {filtered.length === 0 ? <div className="activities-empty"><Search size={29} aria-hidden="true" /><h2>{activities.length ? t("No matching activities") : t("Your next chapter starts here")}</h2>
        <p>{activities.length ? t("Try another sport or search term.") : t("Refresh Training Hub to load your recorded activities.")}</p>
        {activities.length ? <button type="button" onClick={() => { setQuery(""); setCategory("all"); }}>{t("Clear filters")}</button> : null}</div>
        : view === "calendar" ? <ActivityCalendar activities={filtered} onOpen={openActivity} />
        : view === "list" ? <div className="activities-list-view"><TrainingActivityTable activities={filtered.slice(0, limit)} sportTypes={sportTypes}
          selectedActivityId={opened?.activityId ?? null} busy={busy} exportDisabled={sampleMode} onLoadDetail={openActivity} onExportFile={onExportFile} /></div>
        : <div className="activities-card-grid">{filtered.slice(0, limit).map(activity => <ActivityCard key={activity.activityId}
          activity={activity} sportTypes={sportTypes} busy={busy} sampleMode={sampleMode} onLoadDetail={openActivity} onExportFile={onExportFile} loadPreview={loader}
          isRace={raceTags?.raceActivityIds.has(activity.activityId)} />)}</div>}
      <div className="activities-browser-footer"><span>{view === "calendar" ? t("Activities by month") : t("Showing {{value1}} of {{value2}} activities", { value1: String(Math.min(limit, filtered.length)), value2: String(filtered.length) })}</span>
        {view !== "calendar" && filtered.length > limit ? <button type="button" onClick={() => setLimit(current => current + 24)}>{t("Show more activities")}</button> : null}
        {view === "grid" ? <span className="activities-map-attribution">{t("Maps ©")} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{t("OpenStreetMap contributors")}</a></span> : null}
      </div>
      </div>
      {view === "list" && opened ? <ActivityDetailDialog inline opened={opened} sportTypes={sportTypes} activityDetail={activityDetail} busy={busy} sampleMode={sampleMode}
        resolveLocation={resolveLocation} raceTags={raceTags} onLoadDetail={onLoadDetail} onExportFile={onExportFile} onRename={renameActivity} onClose={() => setOpened(null)} /> : null}
    </div>
    <ActivityDetailDialog opened={view === "list" ? null : opened} sportTypes={sportTypes} activityDetail={activityDetail} busy={busy} sampleMode={sampleMode} raceTags={raceTags}
      resolveLocation={resolveLocation} onLoadDetail={onLoadDetail} onExportFile={onExportFile} onRename={renameActivity} onClose={() => setOpened(null)} />
  </div>;
}

function RaceToggle({ activity, raceTags }: { activity: TrainingHubActivity; raceTags: NonNullable<Props["raceTags"]> }) {
  useLanguage();
  const isRace = raceTags.raceActivityIds.has(activity.activityId);
  const pending = raceTags.pending === `mark:${activity.activityId}`;
  return <button type="button" className={`activity-dialog-race-toggle${isRace ? " is-race" : ""}`} aria-pressed={isRace}
    disabled={raceTags.readOnly || raceTags.pending !== null} title={isRace ? t("In your races. Click to remove it.") : t("Add this run to your races")}
    onClick={() => void raceTags.toggleActivity(activity)}>
    {pending ? <Loader2 className="spin" size={13} aria-hidden="true" /> : <Flag size={13} aria-hidden="true" />}
    {isRace ? t("Race") : t("Mark as race")}
  </button>;
}

// One reverse-geocode per activity; results are stable, so keep them for the session.
const activityLocations = new Map<string, string>();

const pacingCopy: Record<LapPacing, string> = {
  consistent: "You kept a consistent pace throughout.",
  "negative-split": "You finished faster than you started — a negative split.",
  "positive-split": "You went out fast and eased off in the back half."
};

function ActivityDetailDialog({ inline = false, opened, sportTypes, activityDetail, busy, sampleMode, resolveLocation, raceTags, onLoadDetail, onExportFile, onRename, onClose }: {
  inline?: boolean; opened: TrainingHubActivity | null; onClose: () => void;
  onRename?: (activity: TrainingHubActivity, name: string) => Promise<void>;
} & Pick<Props, "sportTypes" | "activityDetail" | "busy" | "sampleMode" | "resolveLocation" | "raceTags" | "onLoadDetail" | "onExportFile">) {
  useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [location, setLocation] = useState<string | null>(null);
  const resolveLocationRef = useRef(resolveLocation);
  resolveLocationRef.current = resolveLocation;
  useEffect(() => {
    // A rename hands over a new copy of the open activity; the dialog is already up.
    if (opened) { if (!dialog.current?.open) dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [opened]);
  const detail = opened && activityDetail?.activityId === opened.activityId ? activityDetail : null;
  const origin = detail?.track?.points.find(point => point.lat !== undefined && point.lon !== undefined);
  useEffect(() => {
    const id = opened?.activityId;
    const resolve = resolveLocationRef.current;
    if (!id || !origin || !resolve) { setLocation(null); return; }
    const cached = activityLocations.get(id);
    if (cached !== undefined) { setLocation(cached); return; }
    let cancelled = false;
    setLocation(null);
    resolve(origin.lat!, origin.lon!).then(result => {
      const label = [result.city, result.country].filter(Boolean).join(", ");
      activityLocations.set(id, label);
      if (!cancelled) setLocation(label);
    }).catch(() => { if (!cancelled) setLocation(null); });
    return () => { cancelled = true; };
  }, [opened?.activityId, origin]);
  const category = opened ? activityCategory(opened.sportType) : "other";
  const sport = sports.find(item => item.id === category)!;
  const Icon = sport.icon;
  const sportName = opened ? resolveSportName(opened, sportTypes) : undefined;
  const failed = opened !== null && !detail && busy !== `training-detail:${opened.activityId}`;
  const timestamp = opened ? activityTimestamp(opened.startTime) : 0;
  const trainingLoad = detail?.trainingLoad ?? opened?.trainingLoad;
  // The panel headlines moving time; elapsed rides here once pauses reach a minute.
  const elapsed = activitySignificantElapsedSeconds({
    duration: detail?.duration ?? opened?.duration, movingTime: detail?.movingTime ?? opened?.movingTime
  });
  const pacing = detail && !detail.strength ? lapPacing(detail.laps) : undefined;
  const [praise, encouragementNote] = encouragement[category];
  const content = opened ? <div className="activity-dialog-surface">
      <header className="activity-dialog-header">
        <div className="activity-dialog-topline"><span>{t("Activity Details")}</span>
          <button type="button" className="activity-dialog-close" aria-label={t("Close activity details")} onClick={onClose}><X size={19} aria-hidden="true" /></button></div>
        <div className="activity-dialog-hero">
          <span className="activity-dialog-sport"><Icon size={34} aria-hidden="true" /></span>
          <div className="activity-dialog-title">
            <ActivityTitleEditor key={opened.activityId} id={headingId} name={opened.name}
              title={opened.name || (sportName == null ? sportName : t(String(sportName))) || t("Activity")}
              onRename={onRename ? name => onRename(opened, name) : undefined} />
            <p className="activity-dialog-meta"><Icon size={15} aria-hidden="true" />
              <time dateTime={timestamp ? new Date(timestamp).toISOString() : undefined}>{formatTrainingLongTimestamp(opened.startTime)}</time>
              {location ? <><i aria-hidden="true" /><MapPin size={14} aria-hidden="true" /><span>{location}</span></> : null}</p>
            <div className="activity-dialog-chips"><span className="activity-dialog-badge">{t(sport.label)}</span>
              {sportName && sportName.toLowerCase() !== sport.label.toLowerCase() ? <span className="activity-dialog-chip">{t(sportName)}</span> : null}
              {elapsed !== undefined ? <span className="activity-dialog-chip">{t("Elapsed")} <strong>{formatDurationSeconds(elapsed)}</strong></span> : null}
              {trainingLoad !== undefined ? <span className="activity-dialog-chip">{t("Training Load")} <strong>{Math.round(trainingLoad)}</strong></span> : null}
              {raceTags && isRaceSportType(opened.sportType) ? <RaceToggle activity={opened} raceTags={raceTags} /> : null}</div>
          </div>
          {detail && !inline ? <aside className="activity-dialog-insight"><span><Sparkles size={18} aria-hidden="true" /></span>
            <p><strong>{t(praise)} {pacing ? t(pacingCopy[pacing]) : ""}</strong><small>{t(encouragementNote)}</small></p></aside> : null}
        </div>
      </header>
      <div className="activity-dialog-body">
        {failed
          ? <div className="activities-empty"><p>{t("Activity details could not be loaded.")}</p><button type="button" onClick={() => onLoadDetail(opened)}>{t("Try again")}</button></div>
          : <ActivityDetailPanel detail={detail} listActivity={opened} sportTypes={sportTypes} busy={busy} embedded variant="showcase"
            onExportFile={onExportFile} exportDisabled={sampleMode} />}
      </div>
    </div> : null;
  if (inline) return <aside className={`activities-detail-dialog activities-detail-sidebar activity-sport-${category}`} aria-labelledby={headingId}>{content}</aside>;
  // Keep the dialog shell unfiltered so fixed map and export portals stay viewport-relative.
  return <dialog ref={dialog} className={`activities-detail-dialog activity-sport-${category}`} aria-labelledby={headingId} onCancel={onClose} onClose={() => { if (opened) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    {content}
  </dialog>;
}
