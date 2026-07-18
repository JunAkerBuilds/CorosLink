import {
  Activity,
  Clock,
  Download,
  Gauge,
  Loader2,
  Mountain,
  QrCode,
  Route as RouteIcon,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import { useMemo } from "react";
import type {
  ActivityPaceBaselines,
  RouteActivityType,
  TrainingHubTrackPoint
} from "../../../electron/types";
import {
  buildElevationProfile,
  climbRatePerKm,
  difficultyFromClimbRate,
  effectiveRouteDuration,
  formatDistance,
  formatDuration,
  formatMeters,
  formatPaceOrSpeed,
  isCyclingActivity
} from "./utils";

export interface RouteSummary {
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
  activityType: RouteActivityType;
  points: TrainingHubTrackPoint[];
}

/**
 * Bottom stats bar: distance / time / pace / ascent / terrain plus a live
 * elevation profile. Shared by Generate and Draw so both feel identical.
 */
export function RouteStatsBar({
  summary,
  paceBaselines,
  routeName,
  onExport,
  onShare,
  exporting,
  busy
}: {
  summary: RouteSummary | null;
  paceBaselines: ActivityPaceBaselines;
  /** Name of the previewed saved/generated route, shown on the left. */
  routeName?: string | null;
  /** Quick actions for the previewed route (Generate mode only). */
  onExport?: () => void;
  onShare?: () => void;
  exporting?: boolean;
  busy?: boolean;
}) {
  const profile = useMemo(
    () => (summary ? buildElevationProfile(summary.points) : null),
    [summary]
  );

  if (!summary) {
    return (
      <div className="route-statsbar is-empty">
        <RouteIcon size={16} aria-hidden="true" />
        <span>{busy ? "Building route…" : "Pick a start point or draw a route to see live stats"}</span>
      </div>
    );
  }

  const cycling = isCyclingActivity(summary.activityType);
  const baseline = paceBaselines[summary.activityType];
  const duration = effectiveRouteDuration(summary, baseline);
  const paceSpeed = formatPaceOrSpeed(summary, duration.seconds);
  const climb = climbRatePerKm(summary);

  return (
    <div className="route-statsbar">
      {routeName ? (
        <div className="route-statsbar-name" title={routeName}>
          {routeName}
        </div>
      ) : null}
      <div className="route-statsbar-metrics">
        <Metric
          icon={<RouteIcon size={15} aria-hidden="true" />}
          value={formatDistance(summary.distanceMeters)}
          unit="km"
          label="Distance"
        />
        <Metric
          icon={<Clock size={15} aria-hidden="true" />}
          value={formatDuration(duration.seconds)}
          label={duration.estimated ? "Est. time" : "Time"}
        />
        <Metric
          icon={<Gauge size={15} aria-hidden="true" />}
          value={paceSpeed ?? "—"}
          label={cycling ? "Speed" : "Pace"}
        />
        <Metric
          icon={<TrendingUp size={15} aria-hidden="true" />}
          value={formatMeters(summary.ascentMeters)}
          label="Ascent"
        />
        <Metric
          icon={<TrendingDown size={15} aria-hidden="true" />}
          value={formatMeters(summary.descentMeters)}
          label="Descent"
        />
        <Metric
          icon={<Mountain size={15} aria-hidden="true" />}
          value={climb !== undefined ? difficultyFromClimbRate(climb) : "—"}
          label="Terrain"
        />
      </div>

      {profile ? (
        <div className="route-statsbar-elevation">
          <div className="route-elevation-head">
            <Activity size={13} aria-hidden="true" />
            <span>
              {Math.round(profile.minEle)}–{Math.round(profile.maxEle)} m
            </span>
          </div>
          <svg
            className="route-elevation-chart"
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon className="route-elevation-fill" points={profile.areaPoints} />
            <polyline className="route-elevation-line" points={profile.linePoints} />
          </svg>
        </div>
      ) : null}

      {onExport || onShare ? (
        <div className="route-statsbar-actions">
          {onExport ? (
            <button
              type="button"
              className="button ghost"
              onClick={onExport}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : (
                <Download size={14} aria-hidden="true" />
              )}
              Export GPX
            </button>
          ) : null}
          {onShare ? (
            <button type="button" className="button ghost" onClick={onShare}>
              <QrCode size={14} aria-hidden="true" />
              Share
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  icon,
  value,
  unit,
  label
}: {
  icon: React.ReactNode;
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <div className="route-metric">
      <span className="route-metric-value">
        {icon}
        <strong>{value}</strong>
        {unit ? <em>{unit}</em> : null}
      </span>
      <span className="route-metric-label">{label}</span>
    </div>
  );
}
