import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check, ChevronDown, Footprints, Gauge, Heart } from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type {
  RpeDistribution,
  RpeDistributionBucket,
  TrainingHubAnalytics,
  TrainingHubActivity,
  TrainingHubThresholdZone,
  TrainingHubZoneDistributionEntry
} from "../../../electron/types";
import { formatDistanceMeters, formatDurationSeconds } from "../formatters";

interface TrainingZoneDistributionChartsProps {
  lthrZones: TrainingHubThresholdZone[];
  activities: TrainingHubActivity[];
  analytics: TrainingHubAnalytics | null;
}

interface ZoneDistributionPanelProps {
  title: string;
  subtitle: string;
  emptyMessage: string;
  variant: "heart" | "distance" | "rpe";
  heroKicker: string;
  metricColumnLabel: string;
  coverageNote?: string;
  data: ZoneDistributionDatum[];
  metricControl: ReactNode;
  getCaption: (datum: ZoneDistributionDatum) => string;
}

interface ZoneDistributionDatum {
  label: string;
  detail: string;
  percent: number;
  color: string;
  zoneIndex: number;
}

type ActivityMetric = "trainingLoad" | "distance" | "time";
type DistanceMetric = "frequency" | "trainingLoad" | "time";
type RpeMetric = "frequency" | "srpe" | "time";

interface MetricDropdownOption<TValue extends string> {
  value: TValue;
  label: string;
}

interface MetricDropdownProps<TValue extends string> {
  label: string;
  value: TValue;
  options: MetricDropdownOption<TValue>[];
  onChange: (value: TValue) => void;
}

interface DistanceBucket {
  label: string;
  minMeters: number;
  maxMeters?: number;
}

interface DistanceBucketTotal extends DistanceBucket {
  count: number;
  trainingLoad: number;
  duration: number;
}

const HEART_RATE_ZONE_COLORS = [
  "#ffd0d6",
  "#ff929f",
  "#ff6f80",
  "#ff5063",
  "#d14251",
  "#6f7487"
];

const DISTANCE_ZONE_COLORS = [
  "#8fd4ef",
  "#4fc3f3",
  "#2fb2e5",
  "#1f9cc9",
  "#1684ad",
  "#6f7487"
];

const DISTANCE_BUCKETS: DistanceBucket[] = [
  { label: "0–10 km", minMeters: 0, maxMeters: 10_000 },
  { label: "10–20 km", minMeters: 10_000, maxMeters: 20_000 },
  { label: "20–30 km", minMeters: 20_000, maxMeters: 30_000 },
  { label: "30–40 km", minMeters: 30_000, maxMeters: 40_000 },
  { label: "40–50 km", minMeters: 40_000, maxMeters: 50_000 },
  { label: "50+ km", minMeters: 50_000 }
];

const DISTANCE_METRIC_LABELS: Record<DistanceMetric, string> = {
  frequency: "Frequency",
  trainingLoad: "Training Load",
  time: "Time"
};

const HEART_RATE_METRIC_LABELS: Record<ActivityMetric, string> = {
  trainingLoad: "Training Load",
  distance: "Distance",
  time: "Time"
};

const HEART_RATE_METRIC_OPTIONS: MetricDropdownOption<ActivityMetric>[] = [
  { value: "trainingLoad", label: HEART_RATE_METRIC_LABELS.trainingLoad },
  { value: "distance", label: HEART_RATE_METRIC_LABELS.distance },
  { value: "time", label: HEART_RATE_METRIC_LABELS.time }
];

const DISTANCE_METRIC_OPTIONS: MetricDropdownOption<DistanceMetric>[] = [
  { value: "frequency", label: DISTANCE_METRIC_LABELS.frequency },
  { value: "trainingLoad", label: DISTANCE_METRIC_LABELS.trainingLoad },
  { value: "time", label: DISTANCE_METRIC_LABELS.time }
];

const RPE_ZONE_COLORS = ["#8fd48f", "#c9d879", "#f2c14e", "#f08a4b", "#e5563f"];

const RPE_LEVEL_LABELS: Record<number, string> = {
  1: "RPE 1 · Very light",
  2: "RPE 2 · Light",
  3: "RPE 3 · Moderate",
  4: "RPE 4 · Hard",
  5: "RPE 5 · Very hard"
};

const RPE_METRIC_LABELS: Record<RpeMetric, string> = {
  frequency: "Frequency",
  srpe: "sRPE",
  time: "Time"
};

const RPE_METRIC_OPTIONS: MetricDropdownOption<RpeMetric>[] = [
  { value: "frequency", label: RPE_METRIC_LABELS.frequency },
  { value: "srpe", label: RPE_METRIC_LABELS.srpe },
  { value: "time", label: RPE_METRIC_LABELS.time }
];

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);

    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function formatDisplayLabel(label: string): string {
  const bracketMatch = label.match(/^\[(\d+)-(\d+)km\)$/i);
  if (bracketMatch) {
    return `${bracketMatch[1]}–${bracketMatch[2]} km`;
  }

  const plusMatch = label.match(/^>=(\d+)km$/i);
  if (plusMatch) {
    return `${plusMatch[1]}+ km`;
  }

  return label.replace(/km/gi, " km").replace(/\s+/g, " ").trim();
}

function heartRateZoneCaption(zoneIndex: number): string {
  switch (zoneIndex) {
    case 1:
      return "Recovery & warm-up";
    case 2:
      return "Aerobic base building";
    case 3:
      return "Steady aerobic effort";
    case 4:
      return "Lactate threshold work";
    case 5:
      return "High aerobic / anaerobic load";
    case 6:
      return "Max effort intervals";
    default:
      return "Training intensity zone";
  }
}

function distanceZoneCaption(label: string): string {
  const normalized = formatDisplayLabel(label).toLowerCase();

  if (normalized.startsWith("0")) {
    return "Easy & recovery runs";
  }

  if (normalized.includes("10–20") || normalized.includes("10-20")) {
    return "Moderate distance sessions";
  }

  if (normalized.includes("20–30") || normalized.includes("20-30")) {
    return "Long run territory";
  }

  if (normalized.includes("30") || normalized.includes("40") || normalized.includes("50")) {
    return "Ultra & marathon prep";
  }

  return "Distance distribution bucket";
}

function finiteNumber(value: number | undefined): number {
  return Number.isFinite(value) ? value ?? 0 : 0;
}

function getHeartRateAreaList(
  analytics: TrainingHubAnalytics | null,
  metric: ActivityMetric
): TrainingHubZoneDistributionEntry[] {
  if (metric === "distance") {
    return analytics?.zoneDistributions.hrDistance ?? [];
  }

  if (metric === "time") {
    return analytics?.zoneDistributions.hrTime ?? [];
  }

  return analytics?.zoneDistributions.hrTrainingLoad ?? [];
}

function getDistanceAreaList(
  analytics: TrainingHubAnalytics | null,
  metric: DistanceMetric
): TrainingHubZoneDistributionEntry[] {
  if (metric === "trainingLoad") {
    return analytics?.zoneDistributions.distanceTrainingLoad ?? [];
  }

  if (metric === "time") {
    return analytics?.zoneDistributions.distanceTime ?? [];
  }

  return analytics?.zoneDistributions.distanceFrequency ?? [];
}

function buildAreaDistributionData(
  entries: TrainingHubZoneDistributionEntry[],
  labels: string[],
  colors: string[],
  formatValue: (value: number) => string
): ZoneDistributionDatum[] {
  const sortedEntries = [...entries].sort(
    (left, right) => left.index - right.index
  );
  const totalValue = sortedEntries.reduce(
    (sum, entry) => sum + finiteNumber(entry.value),
    0
  );
  const totalRatio = sortedEntries.reduce(
    (sum, entry) => sum + finiteNumber(entry.ratio),
    0
  );

  if (sortedEntries.length === 0 || (totalValue <= 0 && totalRatio <= 0)) {
    return [];
  }

  return sortedEntries.map((entry, index) => {
    const value = finiteNumber(entry.value);
    const percent =
      Number.isFinite(entry.ratio) && entry.ratio !== undefined
        ? entry.ratio
        : totalValue > 0
          ? (value / totalValue) * 100
          : 0;

    return {
      label: labels[index] ?? `Zone ${index + 1}`,
      detail: formatValue(value),
      percent,
      color: colors[index % colors.length],
      zoneIndex: index + 1
    };
  });
}

function buildHeartRateData(
  zones: TrainingHubThresholdZone[],
  activities: TrainingHubActivity[],
  metric: ActivityMetric,
  analytics: TrainingHubAnalytics | null
): ZoneDistributionDatum[] {
  const areaList = getHeartRateAreaList(analytics, metric);

  if (areaList.length > 0) {
    return buildAreaDistributionData(
      areaList,
      areaList.map((_entry, index) => `Zone ${index + 1}`),
      HEART_RATE_ZONE_COLORS,
      (value) => formatActivityMetricValue(value, metric)
    );
  }

  const sortedZones = [...zones].sort((left, right) => left.index - right.index);
  const totals = sortedZones.map((zone) => ({
    zone,
    value: 0
  }));

  if (totals.length === 0) {
    return [];
  }

  for (const activity of activities) {
    if (!isActivityInLastFourWeeks(activity)) {
      continue;
    }

    if (!Number.isFinite(activity.avgHr) || !activity.avgHr) {
      continue;
    }

    const zoneIndex = resolveHeartRateZoneIndex(sortedZones, activity.avgHr);
    totals[zoneIndex].value += activityMetricValue(activity, metric);
  }

  const total = totals.reduce((sum, item) => sum + item.value, 0);

  if (total <= 0) {
    return [];
  }

  return totals.map((item, index) => ({
    label: `Zone ${index + 1}`,
    detail: formatActivityMetricValue(item.value, metric),
    percent: (item.value / total) * 100,
    color: HEART_RATE_ZONE_COLORS[index % HEART_RATE_ZONE_COLORS.length],
    zoneIndex: index + 1
  }));
}

function resolveHeartRateZoneIndex(
  zones: TrainingHubThresholdZone[],
  avgHr: number
): number {
  const firstMatchingIndex = zones.findIndex(
    (zone) => zone.hr !== undefined && avgHr <= zone.hr
  );

  if (firstMatchingIndex >= 0) {
    return firstMatchingIndex;
  }

  return zones.length - 1;
}

function buildDistanceBucketTotals(
  activities: TrainingHubActivity[]
): DistanceBucketTotal[] {
  const buckets = DISTANCE_BUCKETS.map((bucket) => ({
    ...bucket,
    count: 0,
    trainingLoad: 0,
    duration: 0
  }));

  for (const activity of activities) {
    if (!isActivityInLastFourWeeks(activity)) {
      continue;
    }

    if (!Number.isFinite(activity.distance) || !activity.distance) {
      continue;
    }

    const bucket = buckets.find(
      (candidate) =>
        activity.distance !== undefined &&
        activity.distance >= candidate.minMeters &&
        (candidate.maxMeters === undefined ||
          activity.distance < candidate.maxMeters)
    );

    if (!bucket) {
      continue;
    }

    bucket.count += 1;
    bucket.trainingLoad += Number.isFinite(activity.trainingLoad)
      ? activity.trainingLoad ?? 0
      : 0;
    bucket.duration += Number.isFinite(activity.duration)
      ? activity.duration ?? 0
      : 0;
  }

  return buckets;
}

function activityStartTimeMs(activity: TrainingHubActivity): number | undefined {
  if (!Number.isFinite(activity.startTime) || !activity.startTime) {
    return undefined;
  }

  return activity.startTime < 10_000_000_000
    ? activity.startTime * 1000
    : activity.startTime;
}

function isActivityInLastFourWeeks(activity: TrainingHubActivity): boolean {
  const startTime = activityStartTimeMs(activity);

  if (startTime === undefined) {
    return true;
  }

  return Date.now() - startTime <= FOUR_WEEKS_MS;
}

function distanceMetricValue(
  bucket: DistanceBucketTotal,
  metric: DistanceMetric
): number {
  if (metric === "trainingLoad") {
    return bucket.trainingLoad;
  }

  if (metric === "time") {
    return bucket.duration;
  }

  return bucket.count;
}

function activityMetricValue(
  activity: TrainingHubActivity,
  metric: ActivityMetric
): number {
  if (metric === "distance") {
    return Number.isFinite(activity.distance) ? activity.distance ?? 0 : 0;
  }

  if (metric === "time") {
    return Number.isFinite(activity.duration) ? activity.duration ?? 0 : 0;
  }

  return Number.isFinite(activity.trainingLoad) ? activity.trainingLoad ?? 0 : 0;
}

function formatActivityMetricValue(
  value: number,
  metric: ActivityMetric
): string {
  if (metric === "distance") {
    return formatDistanceMeters(value);
  }

  if (metric === "time") {
    if (value >= 3600) {
      return formatDurationSeconds(value);
    }

    return `${Math.round(value / 60)} min`;
  }

  return String(Math.round(value));
}

function formatDistanceMetricValue(
  value: number,
  metric: DistanceMetric
): string {
  if (metric === "trainingLoad") {
    return String(Math.round(value));
  }

  if (metric === "time") {
    if (value >= 3600) {
      return formatDurationSeconds(value);
    }

    return `${Math.round(value / 60)} min`;
  }

  const count = Math.round(value);
  return count === 1 ? "1 run" : `${count} runs`;
}

function buildDistanceData(
  activities: TrainingHubActivity[],
  metric: DistanceMetric,
  analytics: TrainingHubAnalytics | null
): ZoneDistributionDatum[] {
  const areaList = getDistanceAreaList(analytics, metric);

  if (areaList.length > 0) {
    return buildAreaDistributionData(
      areaList,
      DISTANCE_BUCKETS.map((bucket) => bucket.label),
      DISTANCE_ZONE_COLORS,
      (value) => formatDistanceMetricValue(value, metric)
    );
  }

  const buckets = buildDistanceBucketTotals(activities);
  const values = buckets.map((bucket) => distanceMetricValue(bucket, metric));
  const total = values.reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return [];
  }

  return buckets.map((bucket, index) => {
    const value = values[index] ?? 0;

    return {
      label: bucket.label,
      detail: formatDistanceMetricValue(value, metric),
      percent: (value / total) * 100,
      color: DISTANCE_ZONE_COLORS[index % DISTANCE_ZONE_COLORS.length],
      zoneIndex: index + 1
    };
  });
}

function rpeMetricValue(
  bucket: RpeDistributionBucket,
  metric: RpeMetric
): number {
  if (metric === "srpe") {
    return bucket.srpe;
  }
  if (metric === "time") {
    return bucket.timeSeconds;
  }
  return bucket.frequency;
}

function formatRpeMetricValue(value: number, metric: RpeMetric): string {
  if (metric === "srpe") {
    return String(Math.round(value));
  }
  if (metric === "time") {
    if (value >= 3600) {
      return formatDurationSeconds(value);
    }
    return `${Math.round(value / 60)} min`;
  }
  const count = Math.round(value);
  return count === 1 ? "1 session" : `${count} sessions`;
}

function rpeLevelCaption(level: number): string {
  switch (level) {
    case 1:
      return "Recovery / very easy effort";
    case 2:
      return "Easy aerobic effort";
    case 3:
      return "Moderate, sustained effort";
    case 4:
      return "Hard, threshold effort";
    case 5:
      return "Maximal / very hard effort";
    default:
      return "Perceived effort level";
  }
}

function buildRpeData(
  distribution: RpeDistribution | null | undefined,
  metric: RpeMetric
): ZoneDistributionDatum[] {
  const buckets = distribution?.buckets ?? [];
  if (buckets.length === 0) {
    return [];
  }
  const values = buckets.map((bucket) => rpeMetricValue(bucket, metric));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return [];
  }
  return buckets.map((bucket, index) => {
    const value = values[index] ?? 0;
    return {
      label: RPE_LEVEL_LABELS[bucket.level] ?? `RPE ${bucket.level}`,
      detail: formatRpeMetricValue(value, metric),
      percent: (value / total) * 100,
      color: RPE_ZONE_COLORS[(bucket.level - 1) % RPE_ZONE_COLORS.length],
      zoneIndex: bucket.level
    };
  });
}

function ZoneDistributionTooltip({
  active,
  payload
}: TooltipContentProps) {
  if (!active || !payload.length) {
    return null;
  }

  const datum = payload[0]?.payload as ZoneDistributionDatum | undefined;

  if (!datum) {
    return null;
  }

  return (
    <div className="training-zone-tooltip">
      <span>{datum.label}</span>
      <strong>{formatPercent(datum.percent)}</strong>
      <em>{datum.detail}</em>
    </div>
  );
}

function ZoneDistributionPanel({
  title,
  subtitle,
  emptyMessage,
  variant,
  heroKicker,
  metricColumnLabel,
  coverageNote,
  data,
  metricControl,
  getCaption
}: ZoneDistributionPanelProps) {
  const reducedMotion = usePrefersReducedMotion();
  const chartData = data.filter((datum) => datum.percent > 0);
  const topZone = useMemo(() => {
    if (data.length === 0) {
      return null;
    }

    return [...data].sort((left, right) => right.percent - left.percent)[0];
  }, [data]);

  return (
    <section
      className={`panel training-zone-panel training-zone-panel-${variant}`}
    >
      <div className="training-zone-header">
        <div className="training-zone-heading">
          <p className="eyebrow">{title}</p>
          <h2>
            {subtitle} <span>(4 Weeks)</span>
          </h2>
          {coverageNote ? (
            <p className="training-zone-coverage">{coverageNote}</p>
          ) : null}
        </div>
        <div className="training-zone-header-actions">{metricControl}</div>
      </div>
      {data.length > 0 ? (
        <div className="training-zone-body">
          <div className="training-zone-donut-wrap">
            <div className="training-zone-donut" aria-hidden="true">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip
                      content={(props) => <ZoneDistributionTooltip {...props} />}
                    />
                    <Pie
                      data={chartData}
                      dataKey="percent"
                      nameKey="label"
                      innerRadius="58%"
                      outerRadius="88%"
                      paddingAngle={2}
                      stroke="transparent"
                      isAnimationActive={!reducedMotion}
                      animationDuration={900}
                    >
                      {chartData.map((datum) => (
                        <Cell key={datum.label} fill={datum.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="training-zone-empty-ring" />
              )}
            </div>
            <span className="training-zone-donut-icon">
              {variant === "heart" ? (
                <Heart size={22} strokeWidth={2.2} aria-hidden="true" />
              ) : variant === "rpe" ? (
                <Gauge size={22} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <Footprints size={22} strokeWidth={2.2} aria-hidden="true" />
              )}
            </span>
          </div>

          {topZone ? (
            <div className="training-zone-hero">
              <p className="training-zone-hero-kicker">{heroKicker}</p>
              <h3>{formatDisplayLabel(topZone.label)}</h3>
              <p className="training-zone-hero-percent">
                {formatPercent(topZone.percent)}
              </p>
              <p className="training-zone-hero-detail">{topZone.detail}</p>
              <p className="training-zone-hero-caption">
                {getCaption(topZone)}
              </p>
            </div>
          ) : null}

          <div className="training-zone-table">
            <div className="training-zone-table-head">
              <span>
                {variant === "heart"
                  ? "Zone"
                  : variant === "rpe"
                    ? "RPE"
                    : "Distance"}
              </span>
              <span aria-hidden="true" />
              <span>%</span>
              <span>{metricColumnLabel}</span>
            </div>
            <div className="training-zone-list">
              {data.map((datum, index) => (
                <div
                  className="training-zone-row"
                  key={datum.label}
                  style={
                    reducedMotion
                      ? undefined
                      : { animationDelay: `${index * 55}ms` }
                  }
                >
                  <span className="training-zone-name">
                    {formatDisplayLabel(datum.label)}
                  </span>
                  <span className="training-zone-track" aria-hidden="true">
                    <span
                      className="training-zone-fill"
                      style={{
                        width: `${Math.max(datum.percent, datum.percent > 0 ? 4 : 0)}%`,
                        backgroundColor: datum.color
                      }}
                    />
                  </span>
                  <span className="training-zone-percent">
                    {formatPercent(datum.percent)}
                  </span>
                  <strong className="training-zone-detail">{datum.detail}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="training-zone-body training-zone-body-empty">
          <p className="training-empty-chart">{emptyMessage}</p>
        </div>
      )}
    </section>
  );
}

function MetricDropdown<TValue extends string>({
  label,
  value,
  options,
  onChange
}: MetricDropdownProps<TValue>) {
  const dropdownId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedValue, setHighlightedValue] = useState<TValue>(value);
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? "Select metric";
  const labelId = `${dropdownId}-label`;
  const valueId = `${dropdownId}-value`;
  const menuId = `${dropdownId}-menu`;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setHighlightedValue(value);

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" || event.key === "Tab") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [isOpen, value]);

  function moveHighlight(direction: 1 | -1) {
    if (options.length === 0) {
      return;
    }

    const currentIndex = options.findIndex(
      (option) => option.value === highlightedValue
    );
    const fallbackIndex = options.findIndex((option) => option.value === value);
    const startIndex =
      currentIndex >= 0 ? currentIndex : Math.max(fallbackIndex, 0);
    const nextIndex = (startIndex + direction + options.length) % options.length;
    const nextOption = options[nextIndex];

    if (nextOption) {
      setHighlightedValue(nextOption.value);
    }
  }

  function selectOption(nextValue: TValue) {
    onChange(nextValue);
    setIsOpen(false);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!isOpen) {
        setIsOpen(true);
        setHighlightedValue(value);
        return;
      }

      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && isOpen) {
      event.preventDefault();
      selectOption(highlightedValue);
    }
  }

  return (
    <div className="training-zone-select" ref={rootRef}>
      <span className="sr-only" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        className="training-zone-select-trigger"
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="training-zone-select-value" id={valueId}>
          {selectedLabel}
        </span>
        <ChevronDown
          className="training-zone-select-icon"
          size={17}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div
          className="training-zone-select-menu"
          id={menuId}
          role="listbox"
          aria-label={label}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            const isActive = option.value === highlightedValue;

            return (
              <button
                type="button"
                className={[
                  "training-zone-select-option",
                  isSelected ? "is-selected" : "",
                  isActive ? "is-active" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={option.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => selectOption(option.value)}
                onMouseEnter={() => setHighlightedValue(option.value)}
              >
                <span>{option.label}</span>
                {isSelected ? (
                  <Check size={15} strokeWidth={2.6} aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function TrainingZoneDistributionCharts({
  lthrZones,
  activities,
  analytics
}: TrainingZoneDistributionChartsProps) {
  const [heartRateMetric, setHeartRateMetric] =
    useState<ActivityMetric>("trainingLoad");
  const [distanceMetric, setDistanceMetric] =
    useState<DistanceMetric>("frequency");
  const [rpeMetric, setRpeMetric] = useState<RpeMetric>("frequency");

  const rpeCoverage = analytics?.rpeDistribution?.coverage;
  const rpeCoverageNote =
    rpeCoverage && rpeCoverage.total > 0
      ? `${rpeCoverage.rated} rated / ${rpeCoverage.total} sessions`
      : undefined;

  return (
    <section className="training-load-profile">
      <div className="training-load-profile-header">
        <p className="eyebrow">Load Profile</p>
        <h2>
          Distribution <span>(4 Weeks)</span>
        </h2>
      </div>
      <div className="training-zone-grid">
        <ZoneDistributionPanel
          title="Threshold Heart Rate"
          subtitle="Training Load"
          emptyMessage="No threshold heart rate zone distribution data loaded."
          variant="heart"
          heroKicker="Primary zone"
          metricColumnLabel={HEART_RATE_METRIC_LABELS[heartRateMetric]}
          data={buildHeartRateData(
            lthrZones,
            activities,
            heartRateMetric,
            analytics
          )}
          getCaption={(datum) => heartRateZoneCaption(datum.zoneIndex)}
          metricControl={
            <MetricDropdown
              label="Heart rate distribution metric"
              value={heartRateMetric}
              options={HEART_RATE_METRIC_OPTIONS}
              onChange={setHeartRateMetric}
            />
          }
        />
        <ZoneDistributionPanel
          title="Distance Zones"
          subtitle="Distribution"
          emptyMessage="No distance zone distribution data loaded."
          variant="distance"
          heroKicker="Most runs"
          metricColumnLabel={
            distanceMetric === "frequency"
              ? "Runs"
              : DISTANCE_METRIC_LABELS[distanceMetric]
          }
          data={buildDistanceData(activities, distanceMetric, analytics)}
          getCaption={(datum) => distanceZoneCaption(datum.label)}
          metricControl={
            <MetricDropdown
              label="Distance distribution metric"
              value={distanceMetric}
              options={DISTANCE_METRIC_OPTIONS}
              onChange={setDistanceMetric}
            />
          }
        />
        <ZoneDistributionPanel
          title="Perceived Effort"
          subtitle="RPE"
          emptyMessage="No RPE-rated sessions in the last 4 weeks."
          variant="rpe"
          heroKicker="Most sessions"
          metricColumnLabel={
            rpeMetric === "frequency" ? "Sessions" : RPE_METRIC_LABELS[rpeMetric]
          }
          coverageNote={rpeCoverageNote}
          data={buildRpeData(analytics?.rpeDistribution, rpeMetric)}
          getCaption={(datum) => rpeLevelCaption(datum.zoneIndex)}
          metricControl={
            <MetricDropdown
              label="RPE distribution metric"
              value={rpeMetric}
              options={RPE_METRIC_OPTIONS}
              onChange={setRpeMetric}
            />
          }
        />
      </div>
    </section>
  );
}
