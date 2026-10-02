import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Activity, Bike, CalendarDays, ChevronLeft, ChevronRight, Dumbbell, Flame,
  Footprints, Gauge, Heart, LayoutGrid, List, MapPin, Mountain, Search, Sparkles, Timer, X } from "lucide-react";
import { PersonSimpleRun, PersonSimpleWalk, PersonSimpleSwim } from "@phosphor-icons/react";
import type { RouteGeocodeResult, TrainingHubActivity, TrainingHubActivityDetail, TrainingHubSportType } from "../../../electron/types";
import type { TrainingHubViewProps } from "../types";
import { activityCategory, activityTimeline, activityTimestamp, activityTotals, lapPacing, selectActivities,
  type ActivityCategory, type ActivitySort, type LapPacing } from "../activityCollection";
import { formatDistanceMeters, formatDurationSeconds, formatElevationMeters, formatPaceSecondsPerKm, formatTrainingLongTimestamp,
  formatTrainingTimestamp } from "../formatters";
import { resolveSportName } from "../sportTypes";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatSpeedValue, metersToSwimDistance, swimDistanceUnit } from "../../units/units";
import { ActivityCardRoute, createActivityPreviewLoader, type ActivityPreviewLoader } from "./ActivityCardRoute";
import { ActivityDetailPanel } from "./ActivityDetailPanel";
import { ExportMenu, TrainingActivityTable } from "./TrainingActivityTable";
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
  const { unitSystem } = useUnitSystem();
  const totals = useMemo(() => activityTotals(activities), [activities]);
  const timeline = useMemo(() => activityTimeline(activities), [activities]);
  const metrics = [
    { key: "count", label: "Total Activities", value: totals.count.toLocaleString(), icon: PersonSimpleRun, color: "#52dfab", bars: true, note: "In this selection" },
    { key: "distance", label: "Total Distance", value: totals.distance === undefined ? "—" : formatDistanceMeters(totals.distance, unitSystem), icon: MapPin, color: "#65dcec", bars: false, note: "Distance covered" },
    { key: "duration", label: "Total Time", value: totals.duration === undefined ? "—" : formatDurationSeconds(totals.duration), icon: Timer, color: "#c995f5", bars: true, note: "Time in motion" },
    { key: "pace", label: "Avg Pace", value: formatPaceSecondsPerKm(totals.pace, unitSystem), icon: Gauge, color: "#58ddd4", bars: false, note: "Running & walking" },
    { key: "calories", label: "Calories", value: totals.calories === undefined ? "—" : `${Math.round(totals.calories).toLocaleString()} kcal`, icon: Flame, color: "#f7aa54", bars: true, note: "Energy burned" }
  ] as const;
  return <div className="activities-summary" aria-label="Activity totals">
    {metrics.map(({ key, label, value, icon: Icon, color, bars, note }) =>
      <div className="activities-stat" key={key} style={{ "--stat-color": color } as CSSProperties}>
        <span className="activities-stat-icon"><Icon size={23} aria-hidden="true" /></span>
        <div className="activities-stat-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
        <MetricSpark values={timeline.map(bucket => bucket[key])} bars={bars} />
      </div>)}
  </div>;
}

type Props = Pick<TrainingHubViewProps, "activities" | "sportTypes" | "selectedActivity" | "activityDetail" | "busy" | "onLoadDetail" | "onExportFile"> & {
  loadPreview: ActivityPreviewLoader; sampleMode?: boolean;
  /** Reverse-geocodes a track's first point for the detail dialog's location chip. */
  resolveLocation?: (lat: number, lon: number) => Promise<RouteGeocodeResult>;
};

function ActivityCard({ activity, sportTypes, busy, sampleMode, onLoadDetail, onExportFile, loadPreview }: {
  activity: TrainingHubActivity; sportTypes: TrainingHubSportType[];
} & Pick<Props, "busy" | "sampleMode" | "onLoadDetail" | "onExportFile" | "loadPreview">) {
  const { unitSystem } = useUnitSystem();
  const category = activityCategory(activity.sportType);
  const sport = sports.find(item => item.id === category)!;
  const Icon = sport.icon;
  const name = activity.name || resolveSportName(activity, sportTypes) || "Activity";
  const pace = activity.distance && activity.duration ? activity.duration / (activity.distance / 1000) : undefined;
  const paceValue = category === "ride"
    ? formatSpeedValue(pace ? 3600 / pace : undefined, unitSystem)
    : category === "swim"
      ? activity.distance && activity.duration
        ? `${formatDurationSeconds(activity.duration / (metersToSwimDistance(activity.distance, unitSystem) / 100))} /100${swimDistanceUnit(unitSystem)}` : "—"
      : formatPaceSecondsPerKm(pace, unitSystem);
  const indoor = [101, 201, 300, 400, 402, 701, 800, 801].includes(activity.sportType);
  return <article className={`activity-card activity-sport-${category}`}>
    <header className="activity-card-heading">
      <span className="activity-card-sport-icon"><Icon size={29} aria-hidden="true" /></span>
      <div className="activity-card-title"><h3><button type="button" onClick={() => onLoadDetail(activity)} title={name}>{name}</button></h3>
        <time dateTime={activityTimestamp(activity.startTime) ? new Date(activityTimestamp(activity.startTime)).toISOString() : undefined}>{formatTrainingTimestamp(activity.startTime)}</time></div>
      <span className="activity-card-badge">{sport.label}</span>
      <ExportMenu activity={activity} activityName={name} busy={busy} disabled={sampleMode} compact onExportFile={onExportFile} />
    </header>
    <button type="button" className="activity-card-body" aria-label={`View details for ${name}`} onClick={() => onLoadDetail(activity)}>
      <ActivityCardRoute activity={activity} load={loadPreview} indoor={indoor} />
      <span className="activity-card-primary">
        <span><strong>{activity.distance === undefined ? "—" : formatDistanceMeters(activity.distance, unitSystem, category === "swim")}</strong><small>Distance</small></span>
        <span><strong>{activity.duration === undefined ? "—" : formatDurationSeconds(activity.duration)}</strong><small>Time</small></span>
        <span><strong>{paceValue}</strong><small>{category === "ride" ? "Avg Speed" : "Avg Pace"}</small></span>
      </span>
      <span className="activity-card-secondary">
        <span><Heart size={18} className="activity-metric-heart" /><span><strong>{activity.avgHr === undefined ? "—" : `${Math.round(activity.avgHr)} bpm`}</strong><small>Avg HR</small></span></span>
        <span><Flame size={18} className="activity-metric-calories" /><span><strong>{activity.calories === undefined ? "—" : `${Math.round(activity.calories)} kcal`}</strong><small>Calories</small></span></span>
        <span><Mountain size={18} className="activity-metric-elevation" /><span><strong>{formatElevationMeters(activity.elevationGain, unitSystem)}</strong><small>Elev Gain</small></span></span>
      </span>
    </button>
  </article>;
}

function ActivityCalendar({ activities, onOpen }: { activities: TrainingHubActivity[]; onOpen: (activity: TrainingHubActivity) => void }) {
  const [month, setMonth] = useState(() => {
    const latest = Math.max(0, ...activities.map(activity => activityTimestamp(activity.startTime)));
    const date = latest ? new Date(latest) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const offset = (month.getDay() + 6) % 7;
  const cells = Math.ceil((offset + dayCount) / 7) * 7;
  return <section className="activities-calendar" aria-label="Activity calendar">
    <header><h2>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><div>
      <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}><ChevronLeft size={17} /></button>
      <button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); }}>Today</button>
      <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}><ChevronRight size={17} /></button>
    </div></header>
    <div className="activities-calendar-grid">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <div className="activities-calendar-weekday" key={day}>{day}</div>)}
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
              <i aria-hidden="true" />{activity.name || resolveSportName(activity) || "Activity"}</button>)}</> : null}
        </div>;
      })}
    </div>
  </section>;
}

export function TrainingActivities({ activities, sportTypes, selectedActivity, activityDetail, busy,
  onLoadDetail, onExportFile, loadPreview, resolveLocation, sampleMode = false }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ActivityCategory>("all");
  const [sort, setSort] = useState<ActivitySort>("newest");
  const [view, setView] = useState<"grid" | "list" | "calendar">("grid");
  const [limit, setLimit] = useState(24);
  const [opened, setOpened] = useState<TrainingHubActivity | null>(null);
  const loader = useMemo(() => createActivityPreviewLoader(loadPreview), [loadPreview]);
  const names = useMemo(() => new Map(sportTypes.map(sport => [sport.sportType, sport.sportName])), [sportTypes]);
  const filtered = useMemo(() => selectActivities(activities, category, query, sort, names), [activities, category, query, sort, names]);
  useEffect(() => { setLimit(24); }, [category, query, sort]);
  function openActivity(activity: TrainingHubActivity) { setOpened(activity); onLoadDetail(activity); }
  return <div className="activities-browser">
    <div className="activities-toolbar">
      <label className="activities-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search activities"
        placeholder="Search activities…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="activities-sport-filters" role="group" aria-label="Filter by sport">
        {sports.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={category === id}
          className={`activity-sport-${id}`} onClick={() => setCategory(id)}><Icon size={17} aria-hidden="true" />{label}</button>)}
      </div>
      <div className="activities-display-controls"><select aria-label="Sort activities" value={sort} onChange={event => setSort(event.target.value as ActivitySort)}>
        <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="distance">Longest distance</option><option value="duration">Longest time</option>
      </select><div className="activities-view-toggle" role="group" aria-label="Activity view">
        {views.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-label={`${label} view`} title={`${label} view`}
          aria-pressed={view === id} onClick={() => { setView(id); if (id === "list") setOpened(selectedActivity); else setOpened(null); }}><Icon size={17} aria-hidden="true" /></button>)}
      </div></div>
    </div>
    <ActivitySummary activities={filtered} />
    <div className={`activities-results${view === "list" && opened ? " has-detail" : ""}`}>
      <div className="activities-results-content">
      <p className="sr-only" role="status">{filtered.length} {filtered.length === 1 ? "activity" : "activities"} found</p>
      {filtered.length === 0 ? <div className="activities-empty"><Search size={29} aria-hidden="true" /><h2>{activities.length ? "No matching activities" : "Your next chapter starts here"}</h2>
        <p>{activities.length ? "Try another sport or search term." : "Refresh Training Hub to load your recorded activities."}</p>
        {activities.length ? <button type="button" onClick={() => { setQuery(""); setCategory("all"); }}>Clear filters</button> : null}</div>
        : view === "calendar" ? <ActivityCalendar activities={filtered} onOpen={openActivity} />
        : view === "list" ? <div className="activities-list-view"><TrainingActivityTable activities={filtered.slice(0, limit)} sportTypes={sportTypes}
          selectedActivityId={opened?.activityId ?? null} busy={busy} exportDisabled={sampleMode} onLoadDetail={openActivity} onExportFile={onExportFile} /></div>
        : <div className="activities-card-grid">{filtered.slice(0, limit).map(activity => <ActivityCard key={activity.activityId}
          activity={activity} sportTypes={sportTypes} busy={busy} sampleMode={sampleMode} onLoadDetail={openActivity} onExportFile={onExportFile} loadPreview={loader} />)}</div>}
      <div className="activities-browser-footer"><span>{view === "calendar" ? "Activities by month" : `Showing ${Math.min(limit, filtered.length)} of ${filtered.length} activities`}</span>
        {view !== "calendar" && filtered.length > limit ? <button type="button" onClick={() => setLimit(current => current + 24)}>Show more activities</button> : null}
        {view === "grid" ? <span className="activities-map-attribution">Maps © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></span> : null}
      </div>
      </div>
      {view === "list" && opened ? <ActivityDetailDialog inline opened={opened} sportTypes={sportTypes} activityDetail={activityDetail} busy={busy} sampleMode={sampleMode}
        resolveLocation={resolveLocation} onLoadDetail={onLoadDetail} onExportFile={onExportFile} onClose={() => setOpened(null)} /> : null}
    </div>
    <ActivityDetailDialog opened={view === "list" ? null : opened} sportTypes={sportTypes} activityDetail={activityDetail} busy={busy} sampleMode={sampleMode}
      resolveLocation={resolveLocation} onLoadDetail={onLoadDetail} onExportFile={onExportFile} onClose={() => setOpened(null)} />
  </div>;
}

// One reverse-geocode per activity; results are stable, so keep them for the session.
const activityLocations = new Map<string, string>();

const pacingCopy: Record<LapPacing, string> = {
  consistent: "You kept a consistent pace throughout.",
  "negative-split": "You finished faster than you started — a negative split.",
  "positive-split": "You went out fast and eased off in the back half."
};

function ActivityDetailDialog({ inline = false, opened, sportTypes, activityDetail, busy, sampleMode, resolveLocation, onLoadDetail, onExportFile, onClose }: {
  inline?: boolean; opened: TrainingHubActivity | null; onClose: () => void;
} & Pick<Props, "sportTypes" | "activityDetail" | "busy" | "sampleMode" | "resolveLocation" | "onLoadDetail" | "onExportFile">) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [location, setLocation] = useState<string | null>(null);
  const resolveLocationRef = useRef(resolveLocation);
  resolveLocationRef.current = resolveLocation;
  useEffect(() => {
    if (opened) dialog.current?.showModal();
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
  const pacing = detail && !detail.strength ? lapPacing(detail.laps) : undefined;
  const [praise, encouragementNote] = encouragement[category];
  const content = opened ? <div className="activity-dialog-surface">
      <header className="activity-dialog-header">
        <div className="activity-dialog-topline"><span>Activity Details</span>
          <button type="button" className="activity-dialog-close" aria-label="Close activity details" onClick={onClose}><X size={19} aria-hidden="true" /></button></div>
        <div className="activity-dialog-hero">
          <span className="activity-dialog-sport"><Icon size={34} aria-hidden="true" /></span>
          <div className="activity-dialog-title">
            <h2 id={headingId}>{opened.name || sportName || "Activity"}</h2>
            <p className="activity-dialog-meta"><Icon size={15} aria-hidden="true" />
              <time dateTime={timestamp ? new Date(timestamp).toISOString() : undefined}>{formatTrainingLongTimestamp(opened.startTime)}</time>
              {location ? <><i aria-hidden="true" /><MapPin size={14} aria-hidden="true" /><span>{location}</span></> : null}</p>
            <div className="activity-dialog-chips"><span className="activity-dialog-badge">{sport.label}</span>
              {sportName && sportName.toLowerCase() !== sport.label.toLowerCase() ? <span className="activity-dialog-chip">{sportName}</span> : null}
              {trainingLoad !== undefined ? <span className="activity-dialog-chip">Training Load <strong>{Math.round(trainingLoad)}</strong></span> : null}</div>
          </div>
          {detail && !inline ? <aside className="activity-dialog-insight"><span><Sparkles size={18} aria-hidden="true" /></span>
            <p><strong>{praise} {pacing ? pacingCopy[pacing] : ""}</strong><small>{encouragementNote}</small></p></aside> : null}
        </div>
      </header>
      <div className="activity-dialog-body">
        {failed
          ? <div className="activities-empty"><p>Activity details could not be loaded.</p><button type="button" onClick={() => onLoadDetail(opened)}>Try again</button></div>
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
