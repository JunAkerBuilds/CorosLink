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
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubSportType
} from "../../../electron/types";
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
import { ActivityElevationChart } from "./ActivityElevationChart";
import { ActivityRouteMap } from "./ActivityRouteMap";
import { StrengthDetailPanel } from "./StrengthDetailPanel";
import { ExportMenu } from "./TrainingActivityTable";

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
      <span>{label}</span>
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
  const { unitSystem } = useUnitSystem();
  const [showRaw, setShowRaw] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const showcase = variant === "showcase";
  const sportName = useMemo(() => {
    if (detail) {
      return resolveSportName(detail, sportTypes);
    }

    if (listActivity) {
      return resolveSportName(listActivity, sportTypes);
    }

    return undefined;
  }, [detail, listActivity, sportTypes]);

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
              <p className="eyebrow">Activity Detail</p>
              <h2>{listActivity?.name ?? "Selected activity"}</h2>
            </div>
          </div>
        )}
        <div className="training-detail-loading">
          <Loader2 className="spin" size={22} aria-hidden="true" />
          <p>Loading activity…</p>
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
              <p className="eyebrow">Activity Detail</p>
              <h2>Select an activity</h2>
            </div>
          </div>
        )}
        <div className="training-empty-state">
          <p>Click a row to view route, elevation, and lap data.</p>
        </div>
      </div>
    );
  }

  const startTime = detail.startTime ?? listActivity?.startTime;
  const showLaps = hasPopulatedLaps(detail);
  const swim = isSwimSportType(detail.sportType ?? listActivity?.sportType);
  const cycling =
    isCyclingSportType(detail.sportType ?? listActivity?.sportType) ||
    /bike|cycl|ride/i.test(sportName ?? "");
  const distance = detail.distance ?? listActivity?.distance;
  const duration = detail.duration ?? listActivity?.duration;
  const performance = distance && duration
    ? cycling
      ? formatSpeedValue((distance / 1000) / (duration / 3600), unitSystem)
      : !swim
        ? formatPaceSecondsPerKm(duration / (distance / 1000), unitSystem)
        : undefined
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
    { label: "Duration", value: formatDurationSeconds(detail.duration), icon: Timer, tone: "#5ce5a2" },
    { label: "Distance", value: formatDistanceMeters(detail.distance, unitSystem, swim), icon: MapPin, tone: "#65dcec" },
    ...(performance ? [{ label: paceLabel, value: performance, icon: Gauge, tone: "#58ddd4" }] : []),
    { label: "Avg HR", value: showcase ? withUnit(detail.avgHr, "bpm") : formatOptionalNumber(detail.avgHr), icon: Heart, tone: "#ff7288" },
    { label: "Max HR", value: showcase ? withUnit(detail.maxHr, "bpm") : formatOptionalNumber(detail.maxHr), icon: HeartPulse, tone: "#c995f5" },
    { label: "Calories", value: showcase ? withUnit(detail.calories, "kcal") : formatOptionalNumber(detail.calories), icon: Flame, tone: "#ffb649" },
    { label: showcase ? "Elevation Gain" : "Elevation", value: formatElevationMeters(detail.elevationGain, unitSystem), icon: Mountain, tone: "#5ce5a2" },
    // The dialog header already carries training load as a chip.
    ...(showcase ? [] : [{ label: "Training Load", value: formatOptionalNumber(detail.trainingLoad), icon: Zap }])
  ];

  return (
    <div className={panelClassName}>
      {showcase ? null : (
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Activity Detail</p>
            <h2>{detail.name ?? listActivity?.name ?? "Selected activity"}</h2>
            {(sportName || startTime) && (
              <div className="activity-detail-meta">
                {sportName ? (
                  <span className="activity-detail-sport">{sportName}</span>
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
                label={stat.label}
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
                  Route
                </h3>
              </div>
              <ActivityRouteMap
                track={detail.track}
                expanded={showcase ? mapExpanded : undefined}
                onExpandedChange={showcase ? setMapExpanded : undefined}
              />
            </section>

            <section className="activity-detail-visual-panel">
              <div className="activity-detail-visual-heading">
                <h3>
                  {showcase ? <Mountain size={17} aria-hidden="true" /> : null}
                  Elevation
                </h3>
                {showcase && (elevation || detail.elevationGain !== undefined) ? (
                  <span className="activity-detail-visual-note">
                    {elevation ? (
                      <>
                        <span>Min <strong>{formatElevationMeters(elevation.min, unitSystem)}</strong></span>
                        <span>Max <strong>{formatElevationMeters(elevation.max, unitSystem)}</strong></span>
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

          {showLaps ? (
            <div className="training-laps-section">
              <h3>
                {showcase ? <Timer size={17} aria-hidden="true" /> : null}
                Laps
                {showcase ? (
                  <span className="activity-detail-visual-note">{detail.laps.length}</span>
                ) : null}
              </h3>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      {showcase ? (
                        <>
                          <th>Distance</th>
                          <th>Duration</th>
                          {!swim ? <th>{paceLabel}</th> : null}
                        </>
                      ) : (
                        <>
                          <th>Duration</th>
                          <th>Distance</th>
                        </>
                      )}
                      <th>Avg HR</th>
                      <th>Max HR</th>
                      <th>{showcase ? "Elevation" : "Elev."}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.laps.map((lap) => (
                      <tr key={lap.index}>
                        <td>{lap.index}</td>
                        {showcase ? (
                          <>
                            <td>{formatDistanceMeters(lap.distance, unitSystem, swim)}</td>
                            <td>{formatDurationSeconds(lap.duration)}</td>
                            {!swim ? <td>{lapPerformance(lap)}</td> : null}
                          </>
                        ) : (
                          <>
                            <td>{formatDurationSeconds(lap.duration)}</td>
                            <td>{formatDistanceMeters(lap.distance, unitSystem, swim)}</td>
                          </>
                        )}
                        <td>{formatOptionalNumber(lap.avgHr)}</td>
                        <td>{formatOptionalNumber(lap.maxHr)}</td>
                        <td>{formatElevationMeters(lap.elevationGain, unitSystem)}</td>
                      </tr>
                    ))}
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
              label="Export"
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
            {showRaw ? "Hide raw JSON" : "Raw JSON"}
          </button>
          {hasRoute && !detail.strength ? (
            <button
              type="button"
              className="primary-button activity-detail-view-map"
              onClick={() => setMapExpanded(true)}
            >
              View on Map
              <Maximize2 size={15} aria-hidden="true" />
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
            {showRaw ? "Hide raw JSON" : "Show raw JSON"}
          </button>
        </div>
      )}

      {!showcase && showRaw ? (
        <pre className="training-raw-json">{JSON.stringify(detail.raw, null, 2)}</pre>
      ) : null}
    </div>
  );
}
