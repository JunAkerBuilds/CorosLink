import { t, useLanguage } from "../i18n/tools";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { ActivityVisualPreview } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatOptionalNumber,
  formatPaceSecondsPerKm
} from "../training/formatters";
import {
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { elevationUnit, speedUnit } from "../units/units";
import { isCyclingSportType } from "../training/sportTypes";
import {
  buildDistanceSeriesData,
  buildElevationSeriesData,
  ChatMiniAreaChart
} from "./charts/ChatMiniAreaChart";

interface ActivityVisualCardProps {
  preview: ActivityVisualPreview;
}

function formatPaceValue(
  paceSecondsPerKm: number,
  unitSystem: "metric" | "imperial"
): string {
  return formatPaceSecondsPerKm(paceSecondsPerKm, unitSystem);
}

function HrTooltip({ active, payload, label }: TooltipContentProps) {
  useLanguage();
  if (!active || !payload?.length) {
    return null;
  }

  const hr = payload[0]?.value;

  return (
    <div className="training-chart-tooltip">
      <span>{label}</span>
      <strong>{typeof hr === "number" ? t("{{p0}} bpm", { p0: Math.round(hr) }) : "-"}</strong>
    </div>
  );
}

function buildHrBarData(preview: ActivityVisualPreview) {
  return (preview.sections.hr?.laps ?? [])
    .filter((lap) => lap.avgHr !== undefined && Number.isFinite(lap.avgHr))
    .map((lap) => ({
      label: t("Lap {{p0}}", { p0: lap.index }),
      hr: lap.avgHr!
    }));
}

export function ActivityVisualCard({ preview }: ActivityVisualCardProps) {
  const { language } = useLanguage();
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const swim = preview.sportType === 300 || preview.sportType === 301;
  const cycling = isCyclingSportType(preview.sportType);
  const hrSeriesData = useMemo(
    () =>
      preview.sections.hr?.chartKind === "series" && preview.sections.hr.series
        ? buildDistanceSeriesData(preview.sections.hr.series, "hr", unitSystem, swim)
        : [],
    [preview, swim, unitSystem, language]
  );
  const hrBarData = useMemo(() => buildHrBarData(preview), [preview, language]);
  const paceData = useMemo(
    () =>
      preview.sections.pace?.series
        ? buildDistanceSeriesData(
            preview.sections.pace.series,
            "pace",
            unitSystem,
            swim,
            cycling
          )
        : [],
    [cycling, preview, swim, unitSystem, language]
  );
  const powerData = useMemo(
    () =>
      preview.sections.power?.series
        ? buildDistanceSeriesData(preview.sections.power.series, "power", unitSystem, swim)
        : [],
    [preview, swim, unitSystem, language]
  );
  const elevationData = useMemo(
    () =>
      preview.sections.elevation?.points
        ? buildElevationSeriesData(preview.sections.elevation.points, unitSystem)
        : [],
    [preview, unitSystem, language]
  );

  const title = preview.name ?? t("Activity");
  const subtitle = preview.startTime ?? undefined;
  const laps = preview.sections.laps ?? [];

  return (
    <div className="chat-visual-card">
      <div className="chat-visual-card-header">
        <div>
          <h4>{title}</h4>
          {subtitle ? (
            <span className="chat-visual-card-subtitle">{subtitle}</span>
          ) : null}
        </div>
        <div className="chat-visual-stats">
          {preview.avgHr != null ? (
            <span className="chat-visual-stat">
              {t("Avg HR")} <strong>{Math.round(preview.avgHr)}</strong>
            </span>
          ) : null}
          {preview.maxHr != null ? (
            <span className="chat-visual-stat">
              {t("Max HR")} <strong>{Math.round(preview.maxHr)}</strong>
            </span>
          ) : null}
        </div>
      </div>

      {preview.sections.hr ? (
        <section className="chat-visual-section">
          <h5>{t("Heart rate")}</h5>
          {preview.sections.hr.chartKind === "series" && hrSeriesData.length >= 2 ? (
            <ChatMiniAreaChart
              data={hrSeriesData}
              gradientId={`chatHrFill-${preview.previewId}`}
              name={t("Heart rate")}
              formatValue={(value) => t("{{p0}} bpm", { p0: Math.round(value) })}
            />
          ) : hrBarData.length >= 2 ? (
            <div className="chat-visual-chart-shell">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hrBarData} margin={trainingChartMargin}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: colors.text, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={16}
                  />
                  <YAxis
                    tick={{ fill: colors.text, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    content={(props) => <HrTooltip {...props} />}
                    cursor={{ fill: colors.cursor }}
                    contentStyle={trainingChartTooltipStyle}
                  />
                  <Bar
                    dataKey="hr"
                    name={t("Avg HR")}
                    fill={colors.accentBright}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="chat-visual-empty">
              {t("Heart rate samples are not available for this activity.")}</p>
          )}
        </section>
      ) : null}

      {preview.sections.pace ? (
        <section className="chat-visual-section">
          <h5>{cycling ? t("Speed") : t("Pace")}</h5>
          {paceData.length >= 2 ? (
            <ChatMiniAreaChart
              data={paceData}
              gradientId={`chatPaceFill-${preview.previewId}`}
              name={cycling ? t("Speed") : t("Pace")}
              formatValue={(value) =>
                cycling
                  ? `${value.toFixed(1)} ${speedUnit(unitSystem)}`
                  : formatPaceValue(value, unitSystem)
              }
              yAxisFormatter={(value) =>
                cycling
                  ? value.toFixed(1)
                  : formatPaceValue(value, unitSystem).replace(/\/(?:km|mi)$/, "")
              }
            />
          ) : (
            <p className="chat-visual-empty">
              {cycling ? t("Speed") : t("Pace")}  {t("samples are not available.")}</p>
          )}
        </section>
      ) : null}

      {preview.sections.power ? (
        <section className="chat-visual-section">
          <h5>{t("Power")}</h5>
          {powerData.length >= 2 ? (
            <ChatMiniAreaChart
              data={powerData}
              gradientId={`chatPowerFill-${preview.previewId}`}
              name={t("Power")}
              formatValue={(value) => `${Math.round(value)} W`}
            />
          ) : (
            <p className="chat-visual-empty">{t("Power samples are not available.")}</p>
          )}
        </section>
      ) : null}

      {preview.sections.elevation ? (
        <section className="chat-visual-section">
          <h5>{t("Elevation")}</h5>
          {elevationData.length >= 2 ? (
            <ChatMiniAreaChart
              data={elevationData}
              gradientId={`chatElevFill-${preview.previewId}`}
              name={t("Elevation")}
              formatValue={(value) => `${Math.round(value)} ${elevationUnit(unitSystem)}`}
            />
          ) : (
            <p className="chat-visual-empty">{t("Elevation profile is not available.")}</p>
          )}
        </section>
      ) : null}

      {laps.length > 0 ? (
        <section className="chat-visual-section">
          <h5>{t("Laps")}</h5>
          <div className="chat-plan-table-wrap">
            <table className="chat-plan-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("Distance")}</th>
                  <th>{t("Duration")}</th>
                  <th>{t("Avg HR")}</th>
                  <th>{t("Max HR")}</th>
                  <th>{cycling ? t("Speed") : t("Pace")}</th>
                </tr>
              </thead>
              <tbody>
                {laps.map((lap) => (
                  <tr key={lap.index}>
                    <td>{lap.index}</td>
                    <td>{formatDistanceMeters(lap.distance, unitSystem, swim)}</td>
                    <td>{formatDurationSeconds(lap.duration)}</td>
                    <td>{formatOptionalNumber(lap.avgHr)}</td>
                    <td>{formatOptionalNumber(lap.maxHr)}</td>
                    <td>
                      {cycling && lap.distance && lap.duration
                        ? `${((lap.distance / 1000) / (lap.duration / 3600) / (unitSystem === "imperial" ? 1.609344 : 1)).toFixed(1)} ${speedUnit(unitSystem)}`
                        : lap.pace != null
                          ? formatPaceValue(lap.pace, unitSystem)
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
