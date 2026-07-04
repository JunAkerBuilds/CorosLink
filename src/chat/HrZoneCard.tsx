import { useMemo } from "react";
import { Heart } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { HrZonePreview, TrainingHubThresholdZone } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds
} from "../training/formatters";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { HEART_RATE_ZONE_COLORS } from "./charts/zoneChartConfig";

interface HrZoneCardProps {
  preview: HrZonePreview;
}

const METRIC_LABELS: Record<HrZonePreview["metric"], string> = {
  time: "Time in zones",
  distance: "Distance in zones",
  trainingLoad: "Training load in zones"
};

const METRIC_COLUMN_LABELS: Record<HrZonePreview["metric"], string> = {
  time: "Duration",
  distance: "Distance",
  trainingLoad: "Load"
};

interface ZoneRow {
  index: number;
  label: string;
  percent: number;
  value: number;
  detail: string;
  caption: string;
  hrRange: string;
  color: string;
}

function heartRateZoneCaption(zoneIndex: number): string {
  switch (zoneIndex) {
    case 0:
      return "Below aerobic threshold";
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

function formatHrZoneRange(
  zoneIndex: number,
  lthrZones: TrainingHubThresholdZone[]
): string {
  const sorted = [...lthrZones].sort((left, right) => left.index - right.index);
  if (sorted.length === 0) {
    return "—";
  }

  const zone =
    sorted.find((entry) => entry.index === zoneIndex) ??
    sorted[zoneIndex] ??
    sorted[sorted.length - 1];
  const zonePosition = sorted.findIndex((entry) => entry.index === zone.index);
  const previous = zonePosition > 0 ? sorted[zonePosition - 1] : undefined;

  if (zone.hr !== undefined && previous?.hr !== undefined) {
    return `${previous.hr + 1}–${zone.hr} bpm`;
  }

  if (zone.hr !== undefined) {
    return `≤ ${zone.hr} bpm`;
  }

  return "—";
}

function formatZoneMetricValue(
  value: number,
  metric: HrZonePreview["metric"]
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

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function ZoneTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const entry = payload[0]?.payload as ZoneRow | undefined;

  if (!entry) {
    return null;
  }

  return (
    <div className="training-zone-tooltip">
      <span>{entry.label}</span>
      <strong>{formatPercent(entry.percent)}</strong>
      <em>{entry.detail}</em>
    </div>
  );
}

export function HrZoneCard({ preview }: HrZoneCardProps) {
  const rows = useMemo((): ZoneRow[] => {
    return preview.zones.map((zone, index) => ({
      index: zone.index,
      label: zone.label,
      percent: zone.percent,
      value: zone.value,
      detail: formatZoneMetricValue(zone.value, preview.metric),
      caption: heartRateZoneCaption(zone.index),
      hrRange: formatHrZoneRange(zone.index, preview.lthrZones),
      color: HEART_RATE_ZONE_COLORS[index % HEART_RATE_ZONE_COLORS.length]
    }));
  }, [preview]);

  const chartData = rows.filter((row) => row.percent > 0);
  const topZone = useMemo(() => {
    if (rows.length === 0) {
      return null;
    }

    return [...rows].sort((left, right) => right.percent - left.percent)[0];
  }, [rows]);

  const activeZones = rows.filter((row) => row.percent > 0).length;

  return (
    <div className="chat-visual-card chat-zone-card">
      <div className="chat-visual-card-header">
        <div>
          <h4>Heart rate zones</h4>
          <span className="chat-visual-card-subtitle">
            {METRIC_LABELS[preview.metric]} · last 4 weeks
          </span>
        </div>
        {topZone ? (
          <div className="chat-visual-stats">
            <span className="chat-visual-stat">
              Primary <strong>{topZone.label}</strong>
            </span>
            <span className="chat-visual-stat">
              Active zones <strong>{activeZones}</strong>
            </span>
          </div>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="chat-zone-body">
          <div className="chat-zone-top">
            <div className="chat-zone-donut-wrap">
              <div className="chat-zone-donut" aria-hidden="true">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="percent"
                        nameKey="label"
                        innerRadius="58%"
                        outerRadius="88%"
                        paddingAngle={2}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {chartData.map((entry) => (
                          <Cell key={entry.index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={(props) => <ZoneTooltip {...props} />}
                        contentStyle={trainingChartTooltipStyle}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chat-zone-empty-ring" />
                )}
              </div>
              <span className="chat-zone-donut-icon">
                <Heart size={22} strokeWidth={2.2} aria-hidden="true" />
              </span>
            </div>

            {topZone ? (
              <div className="chat-zone-hero">
                <p className="chat-zone-hero-kicker">Primary zone</p>
                <h3>{topZone.label}</h3>
                <p className="chat-zone-hero-percent">
                  {formatPercent(topZone.percent)}
                </p>
                <p className="chat-zone-hero-detail">{topZone.detail}</p>
                <p className="chat-zone-hero-caption">{topZone.caption}</p>
                {topZone.hrRange !== "—" ? (
                  <p className="chat-zone-hero-range">{topZone.hrRange}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="chat-zone-table">
            <div className="chat-zone-table-head">
              <span>Zone</span>
              <span>HR range</span>
              <span aria-hidden="true" />
              <span>%</span>
              <span>{METRIC_COLUMN_LABELS[preview.metric]}</span>
            </div>
            <div className="chat-zone-list">
              {rows.map((row) => (
                <div className="chat-zone-row" key={row.index}>
                  <span className="chat-zone-name">{row.label}</span>
                  <span className="chat-zone-range">{row.hrRange}</span>
                  <span className="chat-zone-track" aria-hidden="true">
                    <span
                      className="chat-zone-fill"
                      style={{
                        width: `${Math.max(row.percent, row.percent > 0 ? 4 : 0)}%`,
                        backgroundColor: row.color
                      }}
                    />
                  </span>
                  <span className="chat-zone-percent">
                    {formatPercent(row.percent)}
                  </span>
                  <strong className="chat-zone-detail">{row.detail}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="chat-visual-empty">No zone distribution data available.</p>
      )}
    </div>
  );
}
