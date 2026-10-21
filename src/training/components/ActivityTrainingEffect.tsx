import type { CSSProperties } from "react";
import { Activity, Footprints } from "lucide-react";
import { formatNumber, t, useLanguage } from "../../i18n/training";
import type { TrainingHubRunningDynamics, TrainingHubTrainingEffect } from "../../../electron/types";
import { useTheme } from "../../theme/ThemeProvider";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { getActivityChannelColors, getIntensityZoneColors } from "../chartConfig";
import "../activityChannels.css";

// Labels as the COROS app shows them, easy to hard: each takes the matching
// step of the intensity ramp used by the time-in-zones bar. "Base" is scoped
// because the bare key is the "based on" sense in Chinese.
function focusLabel(focus: number): string | undefined {
  switch (focus) {
    case 1: return t("Easy");
    case 2: return t("Base", undefined, "trainingFocus");
    case 3: return t("Tempo");
    case 4: return t("Threshold");
    case 5: return t("VO2 Max");
    case 6: return t("Anaerobic");
    default: return undefined;
  }
}

/** The COROS 0–5 training-effect band, 0 (inefficient) to 5 (overreaching). */
function effectBand(effect: number): number {
  return Math.min(5, Math.max(0, Math.floor(effect)));
}

function effectLabel(effect: number): string {
  switch (effectBand(effect)) {
    case 0: return t("Inefficient");
    case 1: return t("Recovering");
    case 2: return t("Maintaining");
    case 3: return t("Improving");
    case 4: return t("Optimized");
    default: return t("Overreaching");
  }
}

interface Item {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  /** The item's rule colour; a toned item also colours its note. */
  tone?: string;
}

function Items({ items }: { items: Item[] }) {
  return (
    <dl className="activity-effect-items">
      {items.map((item) => (
        <div key={item.label} className={item.tone ? "has-tone" : undefined}
          style={item.tone ? ({ "--item-color": item.tone } as CSSProperties) : undefined}>
          <dt>{item.label}</dt>
          <dd>
            <strong>{item.value}</strong>
            {item.unit ? <small>{item.unit}</small> : null}
            {item.note ? <span>{item.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

/** The watch's own analysis of the workout: training effect, focus and load. */
export function ActivityTrainingEffect({ effect }: { effect: TrainingHubTrainingEffect }) {
  useLanguage();
  const { theme } = useTheme();
  const ramp = getIntensityZoneColors(theme);
  const items: Item[] = [];
  if (effect.aerobic !== undefined) {
    items.push({ label: t("Aerobic effect"), value: formatNumber(effect.aerobic, oneDecimal), note: effectLabel(effect.aerobic), tone: ramp[effectBand(effect.aerobic)] });
  }
  if (effect.anaerobic !== undefined) {
    items.push({ label: t("Anaerobic effect"), value: formatNumber(effect.anaerobic, oneDecimal), note: effectLabel(effect.anaerobic), tone: ramp[effectBand(effect.anaerobic)] });
  }
  const focus = effect.focus !== undefined ? focusLabel(effect.focus) : undefined;
  if (focus) items.push({ label: t("Training focus"), value: focus, tone: ramp[effect.focus! - 1] });
  if (effect.aerobicLoad !== undefined || effect.anaerobicLoad !== undefined) {
    items.push({ label: t("Aerobic / anaerobic load"), value: `${formatNumber(effect.aerobicLoad ?? 0)} / ${formatNumber(effect.anaerobicLoad ?? 0)}` });
  }
  if (effect.sevenDayLoad !== undefined) {
    // The word joiner keeps "300–520" on one line.
    items.push({
      label: t("7-day load"),
      value: formatNumber(effect.sevenDayLoad),
      note: effect.recommendedLoadMin !== undefined && effect.recommendedLoadMax !== undefined
        ? t("recommended {{value0}}–{{value1}}", { value0: formatNumber(effect.recommendedLoadMin), value1: `\u2060${formatNumber(effect.recommendedLoadMax)}` })
        : undefined
    });
  }
  if (!items.length) return null;
  return (
    <section className="activity-detail-visual-panel activity-effect">
      <div className="activity-detail-visual-heading">
        <h3>
          <Activity size={17} aria-hidden="true" />
          {t("Training effect")}</h3>
      </div>
      <Items items={items} />
    </section>
  );
}

/**
 * Running-dynamics averages measured by the watch. Names, units and colours
 * match the same channels in the chart below.
 */
export function ActivityRunningDynamics({ dynamics }: { dynamics: TrainingHubRunningDynamics }) {
  useLanguage();
  const { theme } = useTheme();
  const { unitSystem } = useUnitSystem();
  const imperial = unitSystem === "imperial";
  const colors = getActivityChannelColors(theme);
  const items: Item[] = [];
  if (dynamics.groundTimeMs !== undefined) {
    items.push({ label: t("Ground contact"), value: formatNumber(Math.round(dynamics.groundTimeMs)), unit: "ms", tone: colors.gct });
  }
  if (dynamics.verticalOscillationMm !== undefined) {
    const cm = dynamics.verticalOscillationMm / 10;
    items.push({ label: t("Vertical oscillation"), value: formatNumber(imperial ? cm / 2.54 : cm, oneDecimal), unit: imperial ? "in" : "cm", tone: colors.vo });
  }
  if (dynamics.verticalRatio !== undefined) {
    items.push({ label: t("Vertical ratio"), value: formatNumber(dynamics.verticalRatio, oneDecimal), unit: "%", tone: colors.vr });
  }
  if (dynamics.stepLengthMm !== undefined) {
    const meters = dynamics.stepLengthMm / 1000;
    items.push({ label: t("Stride length"), value: formatNumber(imperial ? meters * 3.28084 : meters, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), unit: imperial ? "ft" : "m", tone: colors.stride });
  }
  if (!items.length) return null;
  return (
    <section className="activity-detail-visual-panel activity-effect">
      <div className="activity-detail-visual-heading">
        <h3>
          <Footprints size={17} aria-hidden="true" />
          {t("Running dynamics")}</h3>
      </div>
      <Items items={items} />
    </section>
  );
}
