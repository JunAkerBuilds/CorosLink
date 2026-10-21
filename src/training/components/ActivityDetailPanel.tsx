import { formatNumber, getLocale, useLanguage, t } from "../../i18n/training";
import { useMemo, useState, type CSSProperties } from "react";
import {
  Braces,
  Flame,
  Gauge,
  Heart,
  HeartPulse,
  Loader2,
  MapPin,
  Maximize2,
  Mountain,
  Route,
  Timer,
  Zap,
  type LucideIcon
} from "lucide-react";
import { ActivityHeartRateRecovery } from "./ActivityHeartRateRecovery";
import { ActivityRunningDynamics, ActivityTrainingEffect } from "./ActivityTrainingEffect";
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
import { formatSpeedValue } from "../../units/units";
import { parseActivityStreams, parseActivityZones } from "../activityStreams";
import { createRouteCursor } from "../routeCursor";
import { ActivityChannels } from "./ActivityChannels";
import { ActivityElevationChart } from "./ActivityElevationChart";
import { ActivityRouteMap } from "./ActivityRouteMap";
import { ActivityTimeInZones } from "./ActivityTimeInZones";
import { StrengthDetailPanel } from "./StrengthDetailPanel";
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
  icon?: LucideIcon;
  tone?: string;
  /** Showcase: render the unit after the number in a lighter weight. */
  splitUnit?: boolean;
}

/** "2.61 km" → ["2.61", "km"]; "37:32" → ["37:32", ""]. */
function splitValueUnit(value: string): [string, string] {
  const space = value.indexOf(" ");
  return space === -1 ? [value, ""] : [value.slice(0, space), value.slice(space + 1)];
}

function DetailStat({ label, value, icon: Icon, tone, splitUnit = false }: DetailStatProps) {
  useLanguage();
  const [number, unit] = splitUnit ? splitValueUnit(value) : [value, ""];
  return (
    <div
      className="activity-detail-stat"
      style={tone ? ({ "--stat-color": tone } as CSSProperties) : undefined}
    >
      {Icon ? (
        <span className="activity-detail-stat-icon">
          <Icon size={15} aria-hidden="true" />
        </span>
      ) : null}
      <span>{t(label)}</span>
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

/** COROS splits are whole kilometres (or miles), so name them by length. */
function lapGroupLabel(group: TrainingHubActivityLapGroup, unitSystem: UnitSystem): string {
  if (group.kind === "laps") {
    return t("Laps");
  }
  if (group.kind === "whole") {
    return t("Whole activity");
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
  const zones = useMemo(
    () => (showcase && detail && !detail.strength ? parseActivityZones(detail.raw, streamOptions) : {}),
    [showcase, detail, streamOptions]
  );

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
  const performance = speed !== undefined
    ? formatSpeedValue(speed, unitSystem)
    : pace !== undefined
      ? formatPaceSecondsPerKm(pace, unitSystem)
      : undefined;
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

  const stats: DetailStatProps[] = [
    { label: elapsed === undefined ? t("Duration") : t("Moving Time"), value: formatDurationSeconds(moving), icon: Timer, tone: "#5ce5a2" },
    // The dialog header carries elapsed as a chip, like training load: an
    // eighth tile would wrap onto a row of its own.
    ...(elapsed === undefined || showcase ? [] : [{ label: t("Elapsed"), value: formatDurationSeconds(elapsed) }]),
    { label: t("Distance"), value: formatDistanceMeters(detail.distance, unitSystem, swim), icon: MapPin, tone: "#65dcec" },
    ...(performance ? [{ label: paceLabel, value: performance, icon: Gauge, tone: "#58ddd4" }] : []),
    { label: t("Avg HR"), value: showcase ? withUnit(detail.avgHr, "bpm") : formatOptionalNumber(detail.avgHr), icon: Heart, tone: "#ff7288" },
    { label: t("Max HR"), value: showcase ? withUnit(detail.maxHr, "bpm") : formatOptionalNumber(detail.maxHr), icon: HeartPulse, tone: "#c995f5" },
    { label: t("Calories"), value: showcase ? withUnit(detail.calories, "kcal") : formatOptionalNumber(detail.calories), icon: Flame, tone: "#ffb649" },
    { label: showcase ? t("Elevation Gain") : t("Elevation"), value: formatElevationMeters(detail.elevationGain, unitSystem), icon: Mountain, tone: "#5ce5a2" },
    // The dialog header already carries training load as a chip.
    ...(showcase ? [] : [{ label: t("Training Load"), value: formatOptionalNumber(detail.trainingLoad), icon: Zap }])
  ];

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

      {detail.strength ? (
        <StrengthDetailPanel strength={detail.strength} />
      ) : (
        <>
          <div className="activity-detail-grid">
            {stats.map((stat) => (
              <DetailStat
                key={stat.label}
                label={t(stat.label)}
                value={stat.value}
                icon={showcase ? stat.icon : undefined}
                tone={showcase ? stat.tone : undefined}
                splitUnit={showcase}
              />
            ))}
          </div>

          <div className="activity-detail-visuals">
            <section className="activity-detail-visual-panel">
              <div className="activity-detail-visual-heading">
                <h3>
                  {showcase ? <Route size={17} aria-hidden="true" /> : null}
                  {t("Route")} </h3>
              </div>
              <ActivityRouteMap
                track={detail.track}
                expanded={showcase ? mapExpanded : undefined}
                onExpandedChange={showcase ? setMapExpanded : undefined}
                cursor={streams?.hasGps ? routeCursor : undefined}
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
              <ActivityElevationChart track={detail.track} />
            </section>
          </div>

          {zones.hr || zones.pace ? <ActivityTimeInZones zones={zones} /> : null}
          {detail.trainingEffect || detail.runningDynamics || detail.heartRateRecovery ? (
            <div className="activity-detail-insights">
              {detail.trainingEffect ? <ActivityTrainingEffect effect={detail.trainingEffect} /> : null}
              {detail.runningDynamics ? <ActivityRunningDynamics dynamics={detail.runningDynamics} /> : null}
              {detail.heartRateRecovery ? <ActivityHeartRateRecovery recovery={detail.heartRateRecovery} /> : null}
            </div>
          ) : null}
          {streams ? (
            <ActivityChannels
              key={detail.activityId ?? "activity"}
              streams={streams}
              cycling={cycling}
              elevationGain={detail.elevationGain}
              cursor={routeCursor}
            />
          ) : null}

          {showLaps ? (
            <div className="training-laps-section">
              <div className="training-laps-heading">
                <h3>
                  {showcase ? <Timer size={17} aria-hidden="true" /> : null}
                  {t("Laps")} {showcase ? (
                    <span className="activity-detail-visual-note">{lapRows.length}</span>
                  ) : null}
                </h3>
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
                          {lapGroupLabel(group, unitSystem)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
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
                      return (
                        <tr key={lap.index} className={fastest ? "is-fastest" : undefined}>
                          <td>{lap.index}</td>
                          {showcase ? (
                            <>
                              <td>{formatDistanceMeters(lap.distance, unitSystem, swim)}</td>
                              <td>{formatDurationSeconds(lap.duration)}{swim ? fastest : null}</td>
                              {!swim ? <td className="training-lap-performance">{lapPerformance(lap)}{fastest}</td> : null}
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
