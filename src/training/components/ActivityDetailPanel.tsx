import { formatNumber, getLocale, useLanguage, t } from "../../i18n/training";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Braces,
  Loader2,
  Maximize2,
  Mountain,
  Route,
  Timer
} from "lucide-react";
import { ActivityHeartRateRecovery } from "./ActivityHeartRateRecovery";
import { ActivityRunningDynamics, ActivityTrainingEffect } from "./ActivityTrainingEffect";
import { ActivitySwimSummary, formatSwimPace } from "./ActivitySwimSummary";
import { SwimLapTable } from "./SwimLapTable";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubActivityLapGroup,
  TrainingHubSportType,
  UnitSystem
} from "../../../electron/types";
import {
  activityMovingSeconds,
  activityPaceSecondsPerKm,
  activitySignificantElapsedSeconds,
  activitySpeedKmh
} from "../../../electron/activityTime";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatOptionalNumber,
  formatPaceSecondsPerKm,
  formatTrainingTimestamp
} from "../formatters";
import { isCyclingSportType, isSwimSportType, resolveSportName } from "../sportTypes";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatSpeedValue, poolUnitSystem } from "../../units/units";
import { lowerBound, parseActivityStreams, parseActivityZones, type StreamLapKind } from "../activityStreams";
import { routePaceColoring } from "../routePace";
import { deriveActivityInsight, lastKnownZoneModel, rememberActivityInsight, useActivityInsights } from "../activityInsights";
import { trainingLabel } from "../trainingBenefit";
import { createRouteCursor } from "../routeCursor";
import { ActivityChannels } from "./ActivityChannels";
import { ActivityElevationChart } from "./ActivityElevationChart";
import { ActivityRouteMap } from "./ActivityRouteMap";
import { trackRouteProbe } from "./ActivityRouteReadout";
import { ActivityTimeInZones } from "./ActivityTimeInZones";
import { RunEfficiencyPanel } from "./RunEfficiency";
import { StrengthDetailPanel } from "./StrengthDetailPanel";
import { TrainingLabelChips, TrainingLabelReason } from "./TrainingLabelChip";
import { ExportMenu } from "./TrainingActivityTable";
import "../activityLaps.css";

interface ActivityDetailPanelProps {
  detail: TrainingHubActivityDetail | null;
  listActivity: TrainingHubActivity | null;
  sportTypes: TrainingHubSportType[];
  busy?: string | null;
  embedded?: boolean;
  /**
   * "showcase" is the activities dialog layout: the host renders the heading,
   * metrics become icon tiles, the visuals get summary notes and a sticky
   * action footer appears. "compact" (default) is the dense pill layout used
   * by the calendar aside.
   */
  variant?: "compact" | "showcase";
  /** Showcase only: enables the Export action in the footer. */
  onExportFile?: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
  exportDisabled?: boolean;
}

interface DetailStatProps {
  label: string;
  value: string;
  /** Showcase: the tile's coloured dot. */
  tone?: string;
  /** Showcase: render the unit after the number in a lighter weight. */
  splitUnit?: boolean;
}

/** "2.61 km" → ["2.61", "km"]; "37:32" → ["37:32", ""]. */
function splitValueUnit(value: string): [string, string] {
  const space = value.indexOf(" ");
  return space === -1 ? [value, ""] : [value.slice(0, space), value.slice(space + 1)];
}

function DetailStat({ label, value, tone, splitUnit = false }: DetailStatProps) {
  useLanguage();
  const [number, unit] = splitUnit ? splitValueUnit(value) : [value, ""];
  return (
    <div
      className={`activity-detail-stat${tone ? " has-dot" : ""}`}
      style={tone ? ({ "--stat-color": tone } as CSSProperties) : undefined}
    >
      <span>
        {tone ? <i className="activity-detail-stat-dot" aria-hidden="true" /> : null}
        {t(label)}
      </span>
      <strong>
        {number}
        {unit ? <small>{unit}</small> : null}
      </strong>
    </div>
  );
}

function withUnit(value: number | undefined, unit: string): string {
  const formatted = formatOptionalNumber(value);
  return formatted === "-" ? formatted : `${formatted} ${unit}`;
}

function hasPopulatedLaps(detail: TrainingHubActivityDetail): boolean {
  return detail.laps.some(
    (lap) =>
      (lap.distance !== undefined && lap.distance > 0) ||
      (lap.duration !== undefined && lap.duration > 0)
  );
}

const METERS_PER_MILE = 1609.344;

function lapGroupKey(group: TrainingHubActivityLapGroup): string {
  return group.kind === "split" ? `split:${Math.round(group.splitDistance ?? 0)}` : group.kind;
}

/** COROS splits are whole kilometres (or miles), so name them by length. A pool swim's laps are its intervals. */
function lapGroupLabel(group: TrainingHubActivityLapGroup, unitSystem: UnitSystem, poolSwim: boolean): string {
  if (group.kind === "laps") {
    return poolSwim ? t("Intervals") : t("Laps");
  }
  if (group.kind === "whole") {
    return t("Whole activity");
  }
  if (group.kind === "lengths") {
    return t("Lengths");
  }
  const meters = group.splitDistance ?? 0;
  const km = meters / 1000;
  const miles = meters / METERS_PER_MILE;
  if (Math.abs(km - Math.round(km)) < 0.005) {
    return `${formatNumber(Math.round(km))} km`;
  }
  if (Math.abs(miles - Math.round(miles)) < 0.005) {
    return `${formatNumber(Math.round(miles))} mi`;
  }
  return formatDistanceMeters(meters, unitSystem);
}

/**
 * Open on the watch's own laps, like Training Hub. With none (a ride
 * recorded without auto-lap) take the finest split.
 */
function defaultLapGroup(groups: TrainingHubActivityLapGroup[]): TrainingHubActivityLapGroup | undefined {
  return groups.find((group) => group.kind === "laps") ?? groups.find((group) => group.kind === "split") ?? groups[0];
}

const LAP_KIND_LABELS: Record<StreamLapKind, string> = {
  lap: "Lap",
  warmup: "Warm-up",
  work: "Work",
  recovery: "Recovery",
  cooldown: "Cool-down"
};

interface LapSpan {
  /** Metres from the start, when every lap carries a distance. */
  meters: [number, number] | null;
  /** Sample range in the per-second streams, inclusive. */
  samples: [number, number] | null;
}

function elevationRange(
  detail: TrainingHubActivityDetail
): { min: number; max: number } | undefined {
  const values = (detail.track?.points ?? [])
    .map((point) => point.elevation)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return values.length > 1
    ? { min: Math.min(...values), max: Math.max(...values) }
    : undefined;
}

export function ActivityDetailPanel({
  detail,
  listActivity,
  sportTypes,
  busy = null,
  embedded = false,
  variant = "compact",
  onExportFile,
  exportDisabled = false
}: ActivityDetailPanelProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const [showRaw, setShowRaw] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  // Sticks across activities while this panel lives; an activity without
  // the picked grouping falls back to its default.
  const [lapGroupKeyPicked, setLapGroupKeyPicked] = useState<string | null>(null);
  // Lap highlight. With samples the channel chart owns the selection (and
  // mirrors it on the map); without, a picked lap is drawn from the track.
  const [chartSelection, setChartSelection] = useState<[number, number] | null>(null);
  const [selectRequest, setSelectRequest] = useState<{ range: [number, number] | null; nonce: number } | null>(null);
  const [trackLap, setTrackLap] = useState<number | null>(null);
  const showcase = variant === "showcase";
  const sportName = useMemo(() => {
    if (detail) {
      return resolveSportName(detail, sportTypes);
    }

    if (listActivity) {
      return resolveSportName(listActivity, sportTypes);
    }

    return undefined;
  }, [detail, listActivity, sportTypes, getLocale()]);
  const routeCursor = useMemo(() => createRouteCursor(), []);
  // Showcase only: the per-second channels and zone totals ride along in the raw detail payload.
  const streamSportType = detail?.sportType ?? listActivity?.sportType;
  const streamOptions = useMemo(
    () => ({ cycling: isCyclingSportType(streamSportType), swim: isSwimSportType(streamSportType) }),
    [streamSportType]
  );
  const streams = useMemo(
    () => (showcase && detail && !detail.strength ? parseActivityStreams(detail.raw, streamOptions) : null),
    [showcase, detail, streamOptions]
  );
  const routeProbe = useMemo(
    () => (streams?.hasGps ? streams : showcase ? trackRouteProbe(detail?.track) : null),
    [streams, showcase, detail]
  );
  const routePace = useMemo(() => routePaceColoring(streams), [streams]);
  const activityKey = detail?.activityId ?? listActivity?.activityId;
  useEffect(() => {
    setChartSelection(null);
    setSelectRequest(null);
    setTrackLap(null);
    routeCursor.set({ segment: null });
  }, [activityKey, routeCursor]);
  // Another grouping lists other rows: drop the picked lap (the chart's own
  // drag selection clears too, through a null request).
  const regroupedRef = useRef(lapGroupKeyPicked);
  useEffect(() => {
    if (regroupedRef.current === lapGroupKeyPicked) return;
    regroupedRef.current = lapGroupKeyPicked;
    setTrackLap((current) => {
      if (current !== null) routeCursor.set({ segment: null });
      return null;
    });
    setSelectRequest((current) => (current ? { range: null, nonce: current.nonce + 1 } : current));
  }, [lapGroupKeyPicked, routeCursor]);
  // COROS's own time-in-zone totals, on every layout. A strength session is
  // scored on heart rate alone.
  const zones = useMemo(() => {
    if (!detail) return {};
    const parsed = parseActivityZones(detail.raw, streamOptions);
    return detail.strength ? { hr: parsed.hr } : parsed;
  }, [detail, streamOptions]);
  // The session's training label, read once from its samples and kept so the
  // activity list can show it too.
  useActivityInsights();
  const insight = useMemo(() => (detail ? deriveActivityInsight(detail, listActivity) : null), [detail, listActivity]);
  useEffect(() => {
    if (detail) rememberActivityInsight(detail, listActivity);
  }, [detail, listActivity]);
  const labelReading = insight ? trainingLabel(insight.sportType, insight.intensity, lastKnownZoneModel()) : undefined;

  const isLoading =
    listActivity &&
    busy === `training-detail:${listActivity.activityId}` &&
    !detail;

  const panelClassName = embedded
    ? "training-activities-detail-inner"
    : "panel training-detail-panel";

  if (isLoading) {
    return (
      <div className={panelClassName}>
        {showcase ? null : (
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">{t("Activity Detail")}</p>
              <h2>{listActivity?.name ?? t("Selected activity")}</h2>
            </div>
          </div>
        )}
        <div className="training-detail-loading">
          <Loader2 className="spin" size={22} aria-hidden="true" />
          <p>{t("Loading activity…")}</p>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={panelClassName}>
        {showcase ? null : (
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">{t("Activity Detail")}</p>
              <h2>{t("Select an activity")}</h2>
            </div>
          </div>
        )}
        <div className="training-empty-state">
          <p>{t("Click a row to view route, elevation, and lap data.")}</p>
        </div>
      </div>
    );
  }

  const startTime = detail.startTime ?? listActivity?.startTime;
  const showLaps = hasPopulatedLaps(detail);
  const lapGroups = detail.lapGroups ?? [];
  const lapGroup =
    lapGroups.find((group) => lapGroupKey(group) === lapGroupKeyPicked) ?? defaultLapGroup(lapGroups);
  const lapRows = lapGroup?.laps ?? detail.laps;
  const fastestLaps = new Set(lapGroup?.fastestLaps ?? []);
  const swim = isSwimSportType(detail.sportType ?? listActivity?.sportType);
  const cycling =
    isCyclingSportType(detail.sportType ?? listActivity?.sportType) ||
    /bike|cycl|ride/i.test(sportName ?? "");
  // detail.duration is elapsed time including pauses. Like the COROS app,
  // headline moving time and derive pace/speed from it (laps are moving too).
  const times = {
    duration: detail.duration ?? listActivity?.duration,
    movingTime: detail.movingTime ?? listActivity?.movingTime,
    distance: detail.distance ?? listActivity?.distance
  };
  const moving = activityMovingSeconds(times);
  const elapsed = activitySignificantElapsedSeconds(times);
  const speed = cycling ? activitySpeedKmh(times) : undefined;
  const pace = !cycling && !swim ? activityPaceSecondsPerKm(times) : undefined;
  // A pool's distances and paces read in the pool's own unit, whatever the app's units.
  const swimUnits = poolUnitSystem(detail.swim?.poolLengthUnit, unitSystem);
  // The watch's swim pace leaves out rests; without it, moving time over distance.
  const swimPace = swim
    ? detail.swim?.avgPace ?? (moving && times.distance ? moving / (times.distance / 100) : undefined)
    : undefined;
  const performance = speed !== undefined
    ? formatSpeedValue(speed, unitSystem)
    : pace !== undefined
      ? formatPaceSecondsPerKm(pace, unitSystem)
      : swimPace !== undefined
        ? formatSwimPace(swimPace, swimUnits)
        : undefined;
  // Strokes, SWOLF and rests the watch recorded per lap (local watch swims).
  const swimLaps = swim && lapRows.some((lap) => lap.rest || lap.strokes !== undefined || lap.swolf !== undefined || lap.stroke !== undefined);
  const lapCount = swimLaps ? lapRows.filter((lap) => !lap.rest).length : lapRows.length;
  // A pool swim's laps are its intervals, as the watch calls them; its lengths view is titled so.
  const poolSwim = swim && detail.swim?.poolLength !== undefined;
  const lapsTitle = lapGroup?.kind === "lengths" ? t("Lengths") : poolSwim ? t("Intervals") : t("Laps");
  const paceLabel = cycling ? "Avg Speed" : "Avg Pace";
  const lapPerformance = (lap: TrainingHubActivityDetail["laps"][number]): string => {
    if (swim || !lap.distance || !lap.duration) {
      return "-";
    }
    return cycling
      ? formatSpeedValue((lap.distance / 1000) / (lap.duration / 3600), unitSystem)
      : formatPaceSecondsPerKm(lap.duration / (lap.distance / 1000), unitSystem);
  };
  const hasRoute = Boolean(
    detail.track?.points.some((point) => point.lat !== undefined && point.lon !== undefined)
  );
  const elevation = showcase ? elevationRange(detail) : undefined;
  // A pool swim has neither a route nor a climb: no empty map and profile above its numbers.
  const showVisuals = !swim || hasRoute;

  const stats: DetailStatProps[] = [
    { label: elapsed === undefined ? t("Duration") : t("Moving Time"), value: formatDurationSeconds(moving), tone: "#5ce5a2" },
    // The dialog header carries elapsed as a chip, like training load: an
    // eighth tile would wrap onto a row of its own.
    ...(elapsed === undefined || showcase ? [] : [{ label: t("Elapsed"), value: formatDurationSeconds(elapsed) }]),
    { label: t("Distance"), value: formatDistanceMeters(detail.distance, swim ? swimUnits : unitSystem, swim), tone: "#38bdf8" },
    ...(performance ? [{ label: paceLabel, value: performance, tone: "#2dd4bf" }] : []),
    // Moving time includes rests at the wall; the pace above is over the swimming alone.
    ...(detail.swim?.swimTime !== undefined ? [{ label: t("Swim time"), value: formatDurationSeconds(detail.swim.swimTime), tone: "#38bdf8" }] : []),
    { label: t("Avg HR"), value: showcase ? withUnit(detail.avgHr, "bpm") : formatOptionalNumber(detail.avgHr), tone: "#fb7185" },
    { label: t("Max HR"), value: showcase ? withUnit(detail.maxHr, "bpm") : formatOptionalNumber(detail.maxHr), tone: "#f472b6" },
    { label: t("Calories"), value: showcase ? withUnit(detail.calories, "kcal") : formatOptionalNumber(detail.calories), tone: "#fb923c" },
    ...(swim ? [] : [{ label: showcase ? t("Elevation Gain") : t("Elevation"), value: formatElevationMeters(detail.elevationGain, unitSystem), tone: "#a3e635" }]),
    // The dialog header already carries training load as a chip.
    ...(showcase ? [] : [{ label: t("Training Load"), value: formatOptionalNumber(detail.trainingLoad) }])
  ];

  // --- Laps: kind, pace bar and the stretch each one covers -----------------
  const streamLapsMatch = Boolean(streams && lapGroup?.kind === "laps" && streams.laps.length === lapRows.length);
  const lapKinds = streams?.structured && streamLapsMatch ? streams.laps.map((lap) => lap.kind) : null;
  const allDistances = lapRows.every((lap) => lap.distance !== undefined && lap.distance > 0);
  const allDurations = lapRows.every((lap) => lap.duration !== undefined && lap.duration > 0);
  const lapSpans: LapSpan[] = [];
  {
    let meters = 0;
    let seconds = 0;
    lapRows.forEach((lap, position) => {
      const startMeters = meters;
      const startSeconds = seconds;
      meters += lap.distance ?? 0;
      seconds += lap.duration ?? 0;
      let samples: [number, number] | null = null;
      if (streams) {
        if (streamLapsMatch) {
          samples = [streams.laps[position]!.from, streams.laps[position]!.to];
        } else if (streams.hasDistance && allDistances) {
          samples = [lowerBound(streams.d, startMeters), lowerBound(streams.d, meters)];
        } else if (allDurations && Number.isFinite(streams.t[0])) {
          samples = [lowerBound(streams.t, startSeconds), lowerBound(streams.t, seconds)];
        }
        if (samples && samples[1] <= samples[0]) samples = null;
      }
      lapSpans.push({ meters: allDistances ? [startMeters, meters] : null, samples });
    });
  }
  const trackHasDistance = Boolean(
    detail.track?.points.some((point) => point.lat !== undefined && point.lon !== undefined && (point.distance ?? 0) > 0)
  );
  // SwimLapTable has no lap picking: its rows mix rests with lengths, so summed spans wouldn't line up.
  const lapsSelectable =
    !swimLaps && showcase && lapRows.length > 1 && (streams ? lapSpans.some((span) => span.samples) : trackHasDistance && allDistances);
  const selectedLap = !lapsSelectable
    ? null
    : streams
      ? (() => {
          const found = chartSelection
            ? lapSpans.findIndex((span) => span.samples?.[0] === chartSelection[0] && span.samples?.[1] === chartSelection[1])
            : -1;
          return found === -1 ? null : found;
        })()
      : trackLap;
  const trackSegment = (from: number, to: number): [number, number][] =>
    (detail.track?.points ?? [])
      .filter((point) => point.lat !== undefined && point.lon !== undefined && point.distance !== undefined &&
        point.distance >= from && point.distance <= to)
      .map((point) => [point.lat!, point.lon!]);
  const pickLap = (position: number) => {
    const span = lapSpans[position];
    if (!span) return;
    const on = selectedLap === position;
    if (streams) {
      if (span.samples) setSelectRequest((current) => ({ range: on ? null : span.samples, nonce: (current?.nonce ?? 0) + 1 }));
      return;
    }
    if (!span.meters) return;
    setTrackLap(on ? null : position);
    const segment = on ? [] : trackSegment(span.meters[0], span.meters[1]);
    routeCursor.set({ segment: segment.length > 1 ? segment : null });
  };
  // The elevation profile shades the same stretch: the chart's selection, or the picked lap.
  const elevationHighlight: [number, number] | null = streams
    ? chartSelection && streams.hasDistance ? [streams.d[chartSelection[0]]!, streams.d[chartSelection[1]]!] : null
    : trackLap !== null ? lapSpans[trackLap]?.meters ?? null : null;
  const lapSpeeds = lapRows.map((lap) => (lap.distance && lap.duration ? lap.distance / lap.duration : undefined));
  const knownSpeeds = lapSpeeds.filter((speed): speed is number => speed !== undefined);
  const slowestLap = Math.min(...knownSpeeds);
  const fastestLap = Math.max(...knownSpeeds);
  const lapBarWidth = (speed: number | undefined): number | undefined => {
    if (speed === undefined || !knownSpeeds.length) return undefined;
    if (fastestLap - slowestLap < 1e-6) return 100;
    return 14 + 86 * ((speed - slowestLap) / (fastestLap - slowestLap));
  };

  return (
    <div className={panelClassName}>
      {showcase ? null : (
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">{t("Activity Detail")}</p>
            <h2>{detail.name ?? listActivity?.name ?? t("Selected activity")}</h2>
            {((sportName == null ? sportName : t(String(sportName))) || startTime) && (
              <div className="activity-detail-meta">
                {sportName ? (
                  <span className="activity-detail-sport">{t(sportName)}</span>
                ) : null}
                {startTime ? (
                  <span>{formatTrainingTimestamp(startTime)}</span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {detail.note ? (
        <figure className="activity-detail-note">
          <figcaption>{t("Your note")}</figcaption>
          <blockquote>{detail.note}</blockquote>
        </figure>
      ) : null}

      {detail.strength ? (
        <>
          <StrengthDetailPanel strength={detail.strength} />
          {zones.hr ? <ActivityTimeInZones zones={zones} /> : null}
        </>
      ) : (
        <>
          <div className="activity-detail-grid">
            {stats.map((stat) => (
              <DetailStat
                key={stat.label}
                label={t(stat.label)}
                value={stat.value}
                tone={showcase ? stat.tone : undefined}
                splitUnit={showcase}
              />
            ))}
          </div>

          {showVisuals ? (
          <div className="activity-detail-visuals">
            <section className="activity-detail-visual-panel">
              <div className="activity-detail-visual-heading">
                <h3>
                  {showcase ? <Route size={17} aria-hidden="true" /> : null}
                  {t("Route")} </h3>
                {routePace ? (
                  <span className="activity-detail-visual-note">
                    {routePace.speedKind === "speed" ? t("Coloured by speed") : t("Coloured by pace")}
                  </span>
                ) : null}
              </div>
              <ActivityRouteMap
                track={detail.track}
                expanded={showcase ? mapExpanded : undefined}
                onExpandedChange={showcase ? setMapExpanded : undefined}
                cursor={routeProbe || lapsSelectable ? routeCursor : undefined}
                probe={routeProbe ?? undefined}
                pace={routePace}
              />
            </section>

            <section className="activity-detail-visual-panel">
              <div className="activity-detail-visual-heading">
                <h3>
                  {showcase ? <Mountain size={17} aria-hidden="true" /> : null}
                  {t("Elevation")} </h3>
                {showcase && (elevation || detail.elevationGain !== undefined) ? (
                  <span className="activity-detail-visual-note">
                    {elevation ? (
                      <>
                        <span>{t("Min")} <strong>{formatElevationMeters(elevation.min, unitSystem)}</strong></span>
                        <span>{t("Max")} <strong>{formatElevationMeters(elevation.max, unitSystem)}</strong></span>
                      </>
                    ) : null}
                    {detail.elevationGain !== undefined ? (
                      <strong className="is-gain">+{formatElevationMeters(detail.elevationGain, unitSystem)}</strong>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <ActivityElevationChart track={detail.track} highlight={elevationHighlight} />
            </section>
          </div>
          ) : null}

          {labelReading ? (
            <div className="training-label-summary">
              <div className="training-label-summary-heading">
                <span className="activity-detail-visual-note">{t("Trained")}</span>
                <TrainingLabelChips reading={labelReading} />
              </div>
              <TrainingLabelReason reading={labelReading} />
            </div>
          ) : null}
          {/* What the session did to the body, side by side: zones, effect, swim totals, recovery. */}
          {zones.hr || zones.pace || zones.gap || detail.trainingEffect || detail.runningDynamics || detail.heartRateRecovery || detail.swim ? (
            <div className="activity-detail-insights activity-detail-effect-row">
              {zones.hr || zones.pace || zones.gap ? (
                <ActivityTimeInZones
                  key={`zones-${detail.activityId ?? "activity"}`}
                  zones={zones}
                  // On a trail the ground sets the pace; effort pace is the fair scale.
                  initialKind={streamSportType === 102 ? "gap" : undefined}
                />
              ) : null}
              {detail.trainingEffect ? <ActivityTrainingEffect effect={detail.trainingEffect} /> : null}
              {detail.swim ? <ActivitySwimSummary swim={detail.swim} /> : null}
              {detail.heartRateRecovery ? <ActivityHeartRateRecovery recovery={detail.heartRateRecovery} /> : null}
              {detail.runningDynamics ? <ActivityRunningDynamics dynamics={detail.runningDynamics} /> : null}
            </div>
          ) : null}
          {/* Running efficiency is still being tried out: development builds only. */}
          {import.meta.env.DEV ? <RunEfficiencyPanel detail={detail} listActivity={listActivity} /> : null}
          {streams ? (
            <ActivityChannels
              key={`channels-${detail.activityId ?? "activity"}`}
              streams={streams}
              cycling={cycling}
              elevationGain={detail.elevationGain}
              cursor={routeCursor}
              selectRequest={selectRequest}
              onSelectionChange={setChartSelection}
            />
          ) : null}

          {showLaps ? (
            <div className="training-laps-section">
              <div className="training-laps-heading">
                <h3>
                  {showcase ? <Timer size={17} aria-hidden="true" /> : null}
                  {lapsTitle} {showcase ? (
                    <span className="activity-detail-visual-note">{lapCount}</span>
                  ) : null}
                </h3>
                {lapsSelectable ? (
                  <span className="training-laps-hint">
                    {streams ? t("Click a lap to highlight it on the chart and map") : t("Click a lap to highlight it on the map")}
                  </span>
                ) : null}
                {lapGroup && lapGroups.length > 1 ? (
                  <div className="library-filter-group training-laps-groups" role="group" aria-label={t("Group laps by")}>
                    {lapGroups.map((group) => {
                      const key = lapGroupKey(group);
                      const active = group === lapGroup;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`library-filter-option${active ? " active" : ""}`}
                          aria-pressed={active}
                          onClick={() => setLapGroupKeyPicked(key)}
                        >
                          {lapGroupLabel(group, unitSystem, poolSwim)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="table-shell">
                {swimLaps ? (
                  <SwimLapTable rows={lapRows} compact={!showcase} units={swimUnits} fastest={fastestLaps} />
                ) : (
                <table className={showcase ? "training-laps-table" : undefined}>
                  <thead>
                    <tr>
                      <th>#</th>
                      {lapKinds ? <th>{t("Type")}</th> : null}
                      {showcase ? (
                        <>
                          <th>{t("Distance")}</th>
                          <th>{t("Duration")}</th>
                          {!swim ? <th>{paceLabel}</th> : null}
                        </>
                      ) : (
                        <>
                          <th>{t("Duration")}</th>
                          <th>{t("Distance")}</th>
                        </>
                      )}
                      <th>{t("Avg HR")}</th>
                      <th>{t("Max HR")}</th>
                      <th>{showcase ? t("Elevation") : t("Elev.")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lapRows.map((lap, position) => {
                      const fastest = fastestLaps.has(position) ? (
                        <span className="training-lap-fastest">{t("Fastest")}</span>
                      ) : null;
                      const kind = lapKinds?.[position];
                      const selected = selectedLap === position;
                      const barWidth = showcase && !swim ? lapBarWidth(lapSpeeds[position]) : undefined;
                      const rowClass = [fastest ? "is-fastest" : "", kind ? `is-${kind}` : "", selected ? "is-selected" : "", lapsSelectable ? "is-selectable" : ""]
                        .filter(Boolean).join(" ");
                      return (
                        <tr key={lap.index} className={rowClass || undefined} onClick={lapsSelectable ? () => pickLap(position) : undefined}>
                          <td>
                            {lapsSelectable ? (
                              <button
                                type="button"
                                className="training-lap-pick"
                                aria-pressed={selected}
                                aria-label={t("Highlight lap {{value1}}", { value1: String(lap.index) })}
                              >
                                {lap.index}
                              </button>
                            ) : lap.index}
                          </td>
                          {lapKinds ? (
                            <td><span className={`training-lap-kind is-${kind ?? "lap"}`}>{t(LAP_KIND_LABELS[kind ?? "lap"])}</span></td>
                          ) : null}
                          {showcase ? (
                            <>
                              <td>{formatDistanceMeters(lap.distance, unitSystem, swim)}</td>
                              <td>{formatDurationSeconds(lap.duration)}{swim ? fastest : null}</td>
                              {!swim ? (
                                <td className="training-lap-performance">
                                  <span className="training-lap-pace">
                                    <span>{lapPerformance(lap)}{fastest}</span>
                                    {barWidth !== undefined ? (
                                      <span className="training-lap-bar" aria-hidden="true">
                                        <i style={{ width: `${barWidth}%` }} />
                                      </span>
                                    ) : null}
                                  </span>
                                </td>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <td>{formatDurationSeconds(lap.duration)}{fastest}</td>
                              <td>{formatDistanceMeters(lap.distance, unitSystem, swim)}</td>
                            </>
                          )}
                          <td>{formatOptionalNumber(lap.avgHr)}</td>
                          <td>{formatOptionalNumber(lap.maxHr)}</td>
                          <td>{formatElevationMeters(lap.elevationGain, unitSystem)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}

      {showcase && showRaw ? (
        <pre className="training-raw-json">{JSON.stringify(detail.raw, null, 2)}</pre>
      ) : null}

      {showcase ? (
        <footer className="activity-detail-footer">
          {listActivity && onExportFile ? (
            <ExportMenu
              activity={listActivity}
              activityName={detail.name ?? listActivity.name ?? "activity"}
              busy={busy}
              disabled={exportDisabled}
              label={t("Export")}
              onExportFile={onExportFile}
            />
          ) : null}
          <span className="activity-detail-footer-spacer" />
          <button
            type="button"
            className="secondary-button activity-detail-raw-toggle"
            aria-pressed={showRaw}
            onClick={() => setShowRaw((current) => !current)}
          >
            <Braces size={15} aria-hidden="true" />
            {showRaw ? t("Hide raw JSON") : t("Raw JSON")}
          </button>
          {hasRoute && !detail.strength ? (
            <button
              type="button"
              className="primary-button activity-detail-view-map"
              onClick={() => setMapExpanded(true)}
            >
              {t("View on Map")} <Maximize2 size={15} aria-hidden="true" />
            </button>
          ) : null}
        </footer>
      ) : (
        <div className="training-raw-toggle">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowRaw((current) => !current)}
          >
            <Braces size={14} aria-hidden="true" />
            {showRaw ? t("Hide raw JSON") : t("Show raw JSON")}
          </button>
        </div>
      )}

      {!showcase && showRaw ? (
        <pre className="training-raw-json">{JSON.stringify(detail.raw, null, 2)}</pre>
      ) : null}
    </div>
  );
}
