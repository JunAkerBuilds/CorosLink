import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Flame,
  Footprints,
  Gauge,
  Hand,
  LockKeyhole,
  MapPin,
  Mountain,
  Route,
  RotateCcw,
  Timer,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
} from "../../electron/types";
import {
  aggregateActivityStats,
  bucketVisitsGeographically,
  extractTrackPoints,
  formatOverallDistance,
  formatOverallDuration,
  geoHeatBucketKey,
  getCachedRoutePolylines,
  getCachedVisitPoints,
  loadActivityVisitCentroids,
  rememberActivityGeo,
  sampleGlobePoints,
  type ActivityRoutePolyline,
  type ActivityVisitPoint,
  type GeoHeatBucket,
  type GlobePoint,
} from "./activityVisitHeatmap";
import {
  ActivityGlobeStreetMap,
  type StreetMapFocus,
} from "./ActivityGlobeStreetMap";
import {
  ActivityGlobeRenderer,
  type ActivityGlobeRendererHandle,
} from "./ActivityGlobeRenderer";
import "./activityGlobe.css";

interface ActivityGlobeCardProps {
  activities: TrainingHubActivity[];
  connected: boolean;
  detail: TrainingHubActivityDetail | null;
  loading: boolean;
  onOpenTraining: () => void;
  onSelectActivity: (activity: TrainingHubActivity) => void;
}

type ActivityPeriod = "all" | "year" | "90-days" | "custom";

interface PlaceLabel {
  city: string;
  country: string;
  full: string;
}

interface LocationSummary {
  key: string;
  bucket: GeoHeatBucket;
  activities: TrainingHubActivity[];
  activityIds: Set<string>;
  distanceMeters: number;
  durationSeconds: number;
  elevationMeters: number;
  lastVisited?: number;
  routeCount: number;
  trend: Array<{ order: number; elevation: number; distance: number }>;
}

const PLACE_LABEL_CACHE = new Map<string, PlaceLabel>();
const PLACE_LABEL_REQUESTS = new Map<string, Promise<PlaceLabel>>();

function activityTimestampMs(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return 0;
  }
  return value < 10_000_000_000 ? value * 1000 : value;
}

function formatVisitDate(value?: number): string {
  const timestamp = activityTimestampMs(value);
  if (!timestamp) {
    return "Date unavailable";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function coordinateLabel(point: GlobePoint): PlaceLabel {
  const lat = `${Math.abs(point.lat).toFixed(1)}° ${point.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(point.lon).toFixed(1)}° ${point.lon >= 0 ? "E" : "W"}`;
  return {
    city: `${lat}, ${lon}`,
    country: "Location",
    full: `${lat}, ${lon}`,
  };
}

function parsePlaceLabel(label: string, point: GlobePoint): PlaceLabel {
  const parts = label
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return coordinateLabel(point);
  }
  return {
    city: parts[0]!,
    country: parts.length > 1 ? parts[parts.length - 1]! : "Location",
    full: label,
  };
}

function loadPlaceLabel(summary: LocationSummary): Promise<PlaceLabel> {
  const cached = PLACE_LABEL_CACHE.get(summary.key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = PLACE_LABEL_REQUESTS.get(summary.key);
  if (pending) {
    return pending;
  }
  const api = window.corosLink;
  if (!api?.reverseGeocodeRouteLocation) {
    return Promise.resolve(coordinateLabel(summary.bucket));
  }
  const request = api
    .reverseGeocodeRouteLocation(summary.bucket.lat, summary.bucket.lon)
    .then((result) =>
      result.city
        ? {
            city: result.city,
            country: result.country ?? "Location",
            full: result.label,
          }
        : parsePlaceLabel(result.label, summary.bucket),
    )
    .catch(() => coordinateLabel(summary.bucket))
    .then((result) => {
      PLACE_LABEL_CACHE.set(summary.key, result);
      PLACE_LABEL_REQUESTS.delete(summary.key);
      return result;
    });
  PLACE_LABEL_REQUESTS.set(summary.key, request);
  return request;
}

function formatLocationDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes > 0 ? `${hours} h ${minutes} m` : `${hours} h`;
}

const MAX_RENDERED_POINTS = 900;

function samplePoints(points: GlobePoint[]): GlobePoint[] {
  return sampleGlobePoints(points, MAX_RENDERED_POINTS);
}

function mergeVisits(
  base: ActivityVisitPoint[],
  next: ActivityVisitPoint,
): ActivityVisitPoint[] {
  if (base.some((visit) => visit.activityId === next.activityId)) {
    return base;
  }
  return [...base, next];
}

function mergeRoutes(
  base: ActivityRoutePolyline[],
  next: ActivityRoutePolyline,
): ActivityRoutePolyline[] {
  if (next.points.length < 2) {
    return base;
  }
  const index = base.findIndex((route) => route.activityId === next.activityId);
  if (index < 0) {
    return [...base, next];
  }
  if (base[index]!.points.length >= next.points.length) {
    return base;
  }
  const updated = [...base];
  updated[index] = next;
  return updated;
}

interface GlobeProfile {
  label: string;
  unit: string;
  values: number[];
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function downsampleValues(values: number[], target: number): number[] {
  if (values.length <= target) {
    return values;
  }

  const step = values.length / target;
  return Array.from(
    { length: target },
    (_, index) => values[Math.floor(index * step)]!,
  );
}

function extractProfile(
  detail: TrainingHubActivityDetail | null,
): GlobeProfile | null {
  const heartRate = (detail?.series ?? [])
    .map((point) => point.hr)
    .filter(isFiniteNumber)
    .filter((value) => value > 0);
  if (heartRate.length >= 8) {
    return {
      label: "Heart rate",
      unit: "bpm",
      values: downsampleValues(heartRate, 72),
    };
  }

  const elevation = (detail?.track?.points ?? [])
    .map((point) => point.elevation)
    .filter(isFiniteNumber);
  if (elevation.length >= 8) {
    return {
      label: "Elevation",
      unit: "m",
      values: downsampleValues(elevation, 72),
    };
  }

  return null;
}

export function ActivityGlobeCard({
  activities,
  connected,
  detail,
  loading,
  onOpenTraining,
  onSelectActivity,
}: ActivityGlobeCardProps) {
  const globeRendererRef = useRef<ActivityGlobeRendererHandle>(null);
  const streetEnterTimerRef = useRef<number | null>(null);

  const [period, setPeriod] = useState<ActivityPeriod>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectedLocationKey, setSelectedLocationKey] = useState<string | null>(
    null,
  );
  const [recentStart, setRecentStart] = useState(0);
  const [placeLabels, setPlaceLabels] = useState<Record<string, PlaceLabel>>(
    () => Object.fromEntries(PLACE_LABEL_CACHE),
  );
  const [globeError, setGlobeError] = useState(false);

  const filteredActivities = useMemo(() => {
    if (period === "all") {
      return activities;
    }
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
    const ninetyDaysAgo = now.getTime() - 90 * 86_400_000;
    const customStartMs = customStart
      ? new Date(`${customStart}T00:00:00`).getTime()
      : Number.NEGATIVE_INFINITY;
    const customEndMs = customEnd
      ? new Date(`${customEnd}T23:59:59.999`).getTime()
      : Number.POSITIVE_INFINITY;

    return activities.filter((activity) => {
      const timestamp = activityTimestampMs(activity.startTime);
      if (!timestamp) {
        return false;
      }
      if (period === "year") {
        return timestamp >= yearStart;
      }
      if (period === "90-days") {
        return timestamp >= ninetyDaysAgo;
      }
      return timestamp >= customStartMs && timestamp <= customEndMs;
    });
  }, [activities, period, customStart, customEnd]);

  const activitiesRef = useRef(filteredActivities);
  activitiesRef.current = filteredActivities;

  const activityKey = useMemo(
    () =>
      filteredActivities
        .map((activity) => activity.activityId)
        .join("|"),
    [filteredActivities],
  );

  const [visits, setVisits] = useState<ActivityVisitPoint[]>(() =>
    getCachedVisitPoints(filteredActivities),
  );
  const [routes, setRoutes] = useState<ActivityRoutePolyline[]>(() =>
    getCachedRoutePolylines(filteredActivities),
  );
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [canResetView, setCanResetView] = useState(false);
  const [hoveringCluster, setHoveringCluster] = useState(false);
  const [streetFocus, setStreetFocus] = useState<StreetMapFocus | null>(null);
  const streetMode = streetFocus !== null;

  const routePoints = useMemo(() => {
    return samplePoints(extractTrackPoints(detail));
  }, [detail]);

  // Prefer cached visit routes + latest featured track for the street map.
  const streetRoutes = useMemo(() => {
    let merged = routes;
    if (detail?.activityId && routePoints.length >= 2) {
      merged = mergeRoutes(merged, {
        activityId: detail.activityId,
        points: routePoints,
      });
    }
    return merged;
  }, [routes, detail?.activityId, routePoints]);

  const heatBuckets = useMemo(
    () => bucketVisitsGeographically(visits),
    [visits],
  );

  const overall = useMemo(
    () => aggregateActivityStats(filteredActivities),
    [filteredActivities],
  );

  const locationSummaries = useMemo<LocationSummary[]>(() => {
    const activitiesById = new Map(
      filteredActivities.map((activity) => [activity.activityId, activity]),
    );
    const routesByActivityId = new Set(
      routes.map((route) => route.activityId),
    );
    return heatBuckets
      .map((bucket) => {
        const activityIds = new Set(
          visits
            .filter((visit) => geoHeatBucketKey(visit) === bucket.key)
            .map((visit) => visit.activityId),
        );
        const placeActivities = [...activityIds]
          .map((activityId) => activitiesById.get(activityId))
          .filter(
            (activity): activity is TrainingHubActivity => Boolean(activity),
          )
          .sort(
            (left, right) =>
              activityTimestampMs(right.startTime) -
              activityTimestampMs(left.startTime),
          );
        const distanceMeters = placeActivities.reduce(
          (sum, activity) => sum + (activity.distance ?? 0),
          0,
        );
        const durationSeconds = placeActivities.reduce(
          (sum, activity) => sum + (activity.duration ?? 0),
          0,
        );
        const elevationMeters = placeActivities.reduce(
          (sum, activity) => sum + (activity.elevationGain ?? 0),
          0,
        );
        const trend = [...placeActivities]
          .reverse()
          .map((activity, order) => ({
            order,
            elevation: Math.max(0, activity.elevationGain ?? 0),
            distance: Math.max(0, (activity.distance ?? 0) / 1000),
          }));
        return {
          key: bucket.key,
          bucket,
          activities: placeActivities,
          activityIds,
          distanceMeters,
          durationSeconds,
          elevationMeters,
          lastVisited: placeActivities[0]?.startTime,
          routeCount: [...activityIds].filter((activityId) =>
            routesByActivityId.has(activityId),
          ).length,
          trend,
        };
      })
      .filter((summary) => summary.activities.length > 0)
      .sort(
        (left, right) =>
          activityTimestampMs(right.lastVisited) -
          activityTimestampMs(left.lastVisited),
      );
  }, [filteredActivities, heatBuckets, routes, visits]);

  const selectedLocation = useMemo(
    () =>
      locationSummaries.find(
        (summary) => summary.key === selectedLocationKey,
      ) ?? null,
    [locationSummaries, selectedLocationKey],
  );
  const globeLocations = useMemo(
    () => locationSummaries.map((summary) => summary.bucket),
    [locationSummaries],
  );

  useEffect(() => {
    setRecentStart((current) =>
      Math.min(current, Math.max(0, locationSummaries.length - 5)),
    );
  }, [locationSummaries.length]);

  useEffect(() => {
    if (
      selectedLocationKey &&
      !locationSummaries.some((summary) => summary.key === selectedLocationKey)
    ) {
      setSelectedLocationKey(null);
    }
  }, [locationSummaries, selectedLocationKey]);

  useEffect(() => {
    let cancelled = false;
    const summaries = locationSummaries.slice(0, 8);
    if (
      selectedLocation &&
      !summaries.some((summary) => summary.key === selectedLocation.key)
    ) {
      summaries.push(selectedLocation);
    }
    for (const summary of summaries) {
      void loadPlaceLabel(summary).then((label) => {
        if (cancelled) {
          return;
        }
        setPlaceLabels((current) =>
          current[summary.key]?.full === label.full
            ? current
            : { ...current, [summary.key]: label },
        );
      });
    }
    return () => {
      cancelled = true;
    };
  }, [locationSummaries, selectedLocation]);

  useEffect(() => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
      streetEnterTimerRef.current = null;
    }
    setSelectedLocationKey(null);
    setStreetFocus(null);
    setCanResetView(false);
  }, [period, customStart, customEnd]);

  const enterStreetFocus = (focus: StreetMapFocus) => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
      streetEnterTimerRef.current = null;
    }
    setStreetFocus(focus);
    setCanResetView(true);
    setHoveringCluster(false);
  };

  const scheduleStreetFocus = (focus: StreetMapFocus, delayMs: number) => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
    }
    streetEnterTimerRef.current = window.setTimeout(() => {
      streetEnterTimerRef.current = null;
      enterStreetFocus(focus);
    }, delayMs);
  };

  const selectLocation = (
    bucket: GeoHeatBucket,
    options?: { openStreet?: boolean },
  ) => {
    const summary = locationSummaries.find(
      (candidate) => candidate.key === bucket.key,
    );
    setSelectedLocationKey(bucket.key);
    const latestActivity = summary?.activities[0];
    if (latestActivity) {
      onSelectActivity(latestActivity);
    }
    if (options?.openStreet) {
      scheduleStreetFocus({ lat: bucket.lat, lon: bucket.lon }, 620);
    }
    setCanResetView(true);
  };

  const restoreBaselineCamera = (duration = 900) => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
      streetEnterTimerRef.current = null;
    }
    globeRendererRef.current?.resetView(duration);
    setCanResetView(false);
  };

  const exitStreetMode = () => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
      streetEnterTimerRef.current = null;
    }
    setStreetFocus(null);
    restoreBaselineCamera(900);
  };

  useEffect(
    () => () => {
      if (streetEnterTimerRef.current !== null) {
        window.clearTimeout(streetEnterTimerRef.current);
      }
    },
    [],
  );

  // Seed / refresh latest activity geo into the visit + route caches.
  useEffect(() => {
    if (!detail?.activityId) {
      return;
    }

    const { centroid, route } = rememberActivityGeo(detail.activityId, detail);
    if (centroid) {
      setVisits((current) =>
        mergeVisits(current, {
          activityId: detail.activityId!,
          ...centroid,
        }),
      );
    }
    if (route && route.length >= 2) {
      setRoutes((current) =>
        mergeRoutes(current, {
          activityId: detail.activityId!,
          points: route,
        }),
      );
    }
  }, [detail]);

  // Background-load visit centroids + route polylines for recent activities.
  useEffect(() => {
    const api = window.corosLink;
    const list = activitiesRef.current;
    if (!api || !connected || list.length === 0) {
      setVisits(getCachedVisitPoints(list));
      setRoutes(getCachedRoutePolylines(list));
      return;
    }

    const controller = new AbortController();
    setVisits(getCachedVisitPoints(list));
    setRoutes(getCachedRoutePolylines(list));
    setVisitsLoading(true);

    void loadActivityVisitCentroids(
      list,
      (activityId, sportType, listActivity) =>
        api.getTrainingHubActivityDetail(activityId, sportType, listActivity),
      {
        limit: list.length,
        signal: controller.signal,
        onVisit: (visit) => {
          if (controller.signal.aborted) {
            return;
          }
          setVisits((current) => mergeVisits(current, visit));
        },
        onRoute: (route) => {
          if (controller.signal.aborted) {
            return;
          }
          setRoutes((current) => mergeRoutes(current, route));
        },
      },
    ).finally(() => {
      if (!controller.signal.aborted) {
        setVisitsLoading(false);
      }
    });

    return () => {
      controller.abort();
    };
  }, [activityKey, connected]);


  const handleResetView = () => {
    if (streetFocus) {
      exitStreetMode();
      return;
    }
    restoreBaselineCamera(900);
  };

  const mapDistance = formatOverallDistance(overall.totalDistanceMeters);
  const mapDuration = formatOverallDuration(overall.totalDurationSeconds);
  const mapHasRoute = routePoints.length > 0;
  const mapHasVisits = visits.length > 0;
  const mapPlaceCount = locationSummaries.length;
  const recentPlaces = locationSummaries.slice(recentStart, recentStart + 5);
  const mostVisited = [...locationSummaries].sort(
    (left, right) => right.activities.length - left.activities.length,
  )[0];
  const latestPlace = locationSummaries[0];
  const selectedPlaceLabel = selectedLocation
    ? (placeLabels[selectedLocation.key] ??
      coordinateLabel(selectedLocation.bucket))
    : null;
  const primaryStats = [
    {
      label: "Total distance",
      value: mapDistance.value,
      unit: mapDistance.unit,
      icon: Route,
    },
    {
      label: "Training time",
      value: mapDuration.value,
      unit: mapDuration.unit,
      icon: Timer,
    },
    {
      label: "Activities",
      value: overall.count.toLocaleString(),
      unit: overall.count === 1 ? "activity" : "activities",
      icon: Activity,
    },
    {
      label: "Places visited",
      value: mapPlaceCount.toLocaleString(),
      unit: mapPlaceCount === 1 ? "place" : "places",
      icon: MapPin,
    },
  ];
  const secondaryStats = [
    routes.length > 0
      ? {
          label: "GPS routes",
          value: routes.length.toLocaleString(),
          unit: "",
          icon: Route,
        }
      : null,
    overall.totalElevationMeters > 0
      ? {
          label: "Elevation gained",
          value: Math.round(overall.totalElevationMeters).toLocaleString(),
          unit: "m",
          icon: Mountain,
        }
      : null,
    overall.totalTrainingLoad > 0
      ? {
          label: "Training load",
          value: Math.round(overall.totalTrainingLoad).toLocaleString(),
          unit: "TL",
          icon: Gauge,
        }
      : null,
    overall.totalCalories > 0
      ? {
          label: "Calories",
          value: Math.round(overall.totalCalories).toLocaleString(),
          unit: "kcal",
          icon: Flame,
        }
      : null,
  ].filter(
    (
      stat,
    ): stat is {
      label: string;
      value: string;
      unit: string;
      icon: typeof Route;
    } => Boolean(stat),
  );

  return (
    <section className="training-map" aria-labelledby="training-map-title">
      <div className="training-map-main">
        <div className="training-map-information">
          <header className="training-map-header">
            <p className="training-map-eyebrow">Training map</p>
            <h2 id="training-map-title">Where you’ve been</h2>
            <p>Explore every place your training has taken you.</p>
          </header>

          <div className="training-map-period-wrap">
            <div
              className="training-map-periods"
              role="group"
              aria-label="Training period"
            >
              {([
                ["all", "All time"],
                ["year", "This year"],
                ["90-days", "Last 90 days"],
                ["custom", "Custom"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={period === value ? "is-selected" : undefined}
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                >
                  {label}
                  {value === "custom" ? (
                    <CalendarDays size={14} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
            {period === "custom" ? (
              <div className="training-map-date-range">
                <label>
                  <span>From</span>
                  <input
                    type="date"
                    value={customStart}
                    max={customEnd || undefined}
                    onChange={(event) => setCustomStart(event.target.value)}
                  />
                </label>
                <label>
                  <span>To</span>
                  <input
                    type="date"
                    value={customEnd}
                    min={customStart || undefined}
                    onChange={(event) => setCustomEnd(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <section className="training-map-stats" aria-label="Training summary">
            <dl className="training-map-primary-stats">
              {primaryStats.map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className="training-map-primary-stat"
                    style={{ "--stat-delay": `${index * 45}ms` } as CSSProperties}
                  >
                    <dt>
                      <Icon size={17} aria-hidden="true" />
                      <span>{stat.label}</span>
                    </dt>
                    <dd aria-label={`${stat.value} ${stat.unit}`}>
                      <strong>{stat.value}</strong>
                      <span>{stat.unit}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            {secondaryStats.length > 0 ? (
              <dl className="training-map-secondary-stats">
                {secondaryStats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label}>
                      <Icon size={16} aria-hidden="true" />
                      <span>
                        <dt>{stat.label}</dt>
                        <dd aria-label={`${stat.value} ${stat.unit}`}>
                          <strong>{stat.value}</strong>
                          {stat.unit ? <small>{stat.unit}</small> : null}
                        </dd>
                      </span>
                    </div>
                  );
                })}
              </dl>
            ) : null}
          </section>

          <section
            className="training-map-location"
            aria-label="Selected location"
            aria-live="polite"
          >
            {selectedLocation && selectedPlaceLabel ? (
              <div
                key={selectedLocation.key}
                className="training-map-location-content is-selected"
              >
                <header className="training-map-location-header">
                  <span className="training-map-location-icon" aria-hidden="true">
                    <MapPin size={19} />
                  </span>
                  <div>
                    <h3>{selectedPlaceLabel.city}</h3>
                    <p>{selectedPlaceLabel.country}</p>
                  </div>
                  <span className="training-map-selected-label">Selected</span>
                </header>

                <dl className="training-map-location-metrics">
                  <div>
                    <dt>Activities</dt>
                    <dd>{selectedLocation.activities.length.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Distance</dt>
                    <dd>
                      {(selectedLocation.distanceMeters / 1000).toLocaleString(
                        undefined,
                        { maximumFractionDigits: 1 },
                      )} <small>km</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{formatLocationDuration(selectedLocation.durationSeconds)}</dd>
                  </div>
                  <div>
                    <dt>Last visited</dt>
                    <dd>{formatVisitDate(selectedLocation.lastVisited)}</dd>
                  </div>
                </dl>

                <div className="training-map-location-trend">
                  <div>
                    <span>
                      {selectedLocation.elevationMeters > 0
                        ? "Elevation gained"
                        : "Distance trend"}
                    </span>
                    <strong>
                      {selectedLocation.elevationMeters > 0
                        ? `${Math.round(selectedLocation.elevationMeters).toLocaleString()} m`
                        : `${(selectedLocation.distanceMeters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`}
                    </strong>
                  </div>
                  {selectedLocation.trend.length > 1 ? (
                    <div className="training-map-location-chart" aria-hidden="true">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={selectedLocation.trend}>
                          <defs>
                            <linearGradient
                              id="trainingMapLocationFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="var(--map-accent)"
                                stopOpacity={0.3}
                              />
                              <stop
                                offset="100%"
                                stopColor="var(--map-accent)"
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <Area
                            type="monotone"
                            dataKey={
                              selectedLocation.elevationMeters > 0
                                ? "elevation"
                                : "distance"
                            }
                            stroke="var(--map-accent)"
                            strokeWidth={1.8}
                            fill="url(#trainingMapLocationFill)"
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="training-map-trend-empty">
                      More activities will build a location trend.
                    </p>
                  )}
                  <button
                    type="button"
                    className="training-map-view-action"
                    onClick={onOpenTraining}
                  >
                    {loading ? "Loading route" : "View activities"}
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="training-map-location-content training-map-overview">
                {visitsLoading && !mapHasVisits ? (
                  <div className="training-map-location-loading" aria-label="Mapping GPS activities">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : overall.count === 0 ? (
                  <div className="training-map-location-empty">
                    <MapPin size={22} aria-hidden="true" />
                    <h3>{connected ? "No activities in this period" : "Training Hub is offline"}</h3>
                    <p>
                      {connected
                        ? "Choose another period when more activity history is available."
                        : "Connect Training Hub to map your routes and training history."}
                    </p>
                  </div>
                ) : !mapHasVisits ? (
                  <div className="training-map-location-empty">
                    <Route size={22} aria-hidden="true" />
                    <h3>No GPS routes found</h3>
                    <p>Outdoor activities with location data will appear here.</p>
                  </div>
                ) : (
                  <>
                    <header>
                      <h3>Your training world</h3>
                      <p>Select a location on the globe to explore your training history.</p>
                    </header>
                    <dl className="training-map-overview-values">
                      {mostVisited ? (
                        <div>
                          <dt>Most visited</dt>
                          <dd>
                            {(placeLabels[mostVisited.key] ??
                              coordinateLabel(mostVisited.bucket)).city}
                          </dd>
                        </div>
                      ) : null}
                      {latestPlace ? (
                        <div>
                          <dt>Most recent</dt>
                          <dd>
                            {(placeLabels[latestPlace.key] ??
                              coordinateLabel(latestPlace.bucket)).city}
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Places explored</dt>
                        <dd>{mapPlaceCount.toLocaleString()}</dd>
                      </div>
                    </dl>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        <section
          className={`training-map-globe-panel${streetMode ? " is-street-mode" : ""}`}
          aria-label="Interactive training globe"
        >
          <div className="training-map-globe-helper">
            <Hand size={18} aria-hidden="true" />
            <span>Drag to explore · Scroll to zoom</span>
          </div>
          <button
            type="button"
            className="training-map-reset"
            onClick={handleResetView}
            disabled={!canResetView}
            aria-label={streetMode ? "Back to globe" : "Reset globe view"}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {streetMode ? "Back to globe" : "Reset view"}
          </button>

          <div
            className={`training-map-globe-stage${hoveringCluster ? " is-hovering-cluster" : ""}`}
            role="img"
            aria-label={
              streetMode
                ? "Street map heatmap near the selected location. Zoom out or reset to return to the globe."
                : mapHasVisits
                  ? `Interactive globe showing ${mapPlaceCount} training locations. Drag to rotate, scroll to zoom, and select a location for details.`
                  : mapHasRoute
                    ? "Interactive globe showing the latest GPS route."
                    : "Interactive globe waiting for GPS activity data."
            }
          >
            <ActivityGlobeRenderer
              ref={globeRendererRef}
              frameKey={activityKey}
              locations={globeLocations}
              routePoints={routePoints}
              selectedLocation={selectedLocation?.bucket ?? null}
              selectedLabel={selectedPlaceLabel?.city ?? ""}
              streetMode={streetMode}
              onError={setGlobeError}
              onHoverChange={setHoveringCluster}
              onRequestStreet={enterStreetFocus}
              onSelectLocation={(bucket) =>
                selectLocation(bucket, { openStreet: true })
              }
              onViewChange={setCanResetView}
            />
            {streetFocus ? (
              <ActivityGlobeStreetMap
                focus={streetFocus}
                visits={visits}
                routes={streetRoutes}
                onRequestExit={exitStreetMode}
              />
            ) : null}
            {globeError ? (
              <div className="training-map-globe-error" role="status">
                <CircleAlert size={20} aria-hidden="true" />
                <span>The globe could not be rendered on this device.</span>
              </div>
            ) : null}
          </div>

          <div className="training-map-globe-meta">
            <div>
              <Route size={14} aria-hidden="true" />
              <span>
                {visitsLoading
                  ? "Mapping GPS activity"
                  : `${routes.length.toLocaleString()} GPS ${routes.length === 1 ? "route" : "routes"}`}
              </span>
            </div>
            <div>
              <LockKeyhole size={14} aria-hidden="true" />
              <span>Rendered locally</span>
            </div>
          </div>

          {(mapHasVisits || mapHasRoute) ? (
            <div className="training-map-legend" aria-label="Activity intensity from low to high">
              <span>Low</span>
              <i className="is-low" aria-hidden="true" />
              <i className="is-medium" aria-hidden="true" />
              <i className="is-high" aria-hidden="true" />
              <span>High</span>
            </div>
          ) : null}
        </section>
      </div>

      {recentPlaces.length > 0 ? (
        <section className="training-map-recent" aria-labelledby="recent-places-title">
          <header>
            <h3 id="recent-places-title">Recent places</h3>
            {locationSummaries.length > 5 ? (
              <div className="training-map-recent-controls">
                <button
                  type="button"
                  aria-label="Previous recent places"
                  title="Previous places"
                  disabled={recentStart === 0}
                  onClick={() => setRecentStart((current) => Math.max(0, current - 1))}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Next recent places"
                  title="Next places"
                  disabled={recentStart + 5 >= locationSummaries.length}
                  onClick={() =>
                    setRecentStart((current) =>
                      Math.min(locationSummaries.length - 5, current + 1),
                    )
                  }
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </header>
          <div className="training-map-recent-list">
            {recentPlaces.map((summary) => {
              const label = placeLabels[summary.key] ?? coordinateLabel(summary.bucket);
              const selected = selectedLocationKey === summary.key;
              return (
                <button
                  key={summary.key}
                  type="button"
                  className={selected ? "is-selected" : undefined}
                  aria-pressed={selected}
                  onClick={() => selectLocation(summary.bucket)}
                >
                  <span className="training-map-recent-pin" aria-hidden="true">
                    <MapPin size={17} />
                  </span>
                  <span className="training-map-recent-place">
                    <strong>{label.city}</strong>
                    <small>{label.country}</small>
                  </span>
                  <span className="training-map-recent-value">
                    <strong>{summary.activities.length}</strong>
                    <small>{summary.activities.length === 1 ? "activity" : "activities"}</small>
                  </span>
                  <span className="training-map-recent-value">
                    <strong>
                      {(summary.distanceMeters / 1000).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })} <small>km</small>
                    </strong>
                    <small>{formatVisitDate(summary.lastVisited)}</small>
                  </span>
                  <ChevronRight className="training-map-recent-chevron" size={16} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </section>
  );

}
