import { formatNumber, t, useLanguage } from "../../i18n/training";
import type { CSSProperties } from "react";
import { useTheme } from "../../theme/ThemeProvider";
import { getActivityInsight, lastKnownZoneModel, useActivityInsights } from "../activityInsights";
import { getIntensityZoneColors } from "../chartConfig";
import { formatDurationSeconds } from "../formatters";
import {
  formatRepSize,
  trainingLabel,
  TRAINING_LABEL_NAMES,
  TRAINING_LABEL_ZONES,
  TRAINING_LABELS,
  type SessionShape,
  type TrainingLabelReading
} from "../trainingBenefit";
import "../trainingLabels.css";

const MEASURE_TEXT: Record<"both" | "hr" | "pace", string> = {
  both: "pace and heart rate",
  hr: "heart rate",
  pace: "pace"
};

export function sessionShapeText(shape: SessionShape): string {
  if (shape.kind === "long") return shape.ride ? t("Long ride") : t("Long run");
  const size = formatRepSize(shape.size, (value) => formatNumber(value, { maximumFractionDigits: 1 }));
  return shape.kind === "strides"
    ? t("Strides {{count}} × {{size}}", { count: shape.count, size })
    : t("Intervals {{count}} × {{size}}", { count: shape.count, size });
}

/** Which seconds the label was read from, in words. */
export function trainingLabelReason(reading: TrainingLabelReading): string {
  const { basis, label } = reading;
  const measure = t(MEASURE_TEXT[basis.measure]);
  if (basis.kind === "reps") {
    return t("{{count}} reps in the {{zone}} zone, read on {{measure}}", {
      count: basis.count,
      zone: t(TRAINING_LABEL_ZONES[label]),
      measure
    });
  }
  const percent = Math.round(basis.share * 100);
  if (label === "recovery") {
    return t("{{percent}}% at {{zone}} after the warm-up, read on {{measure}}", {
      percent,
      zone: t(TRAINING_LABEL_ZONES.recovery),
      measure
    });
  }
  if (label === "aerobic") {
    return t("{{percent}}% easier than {{zone}} after the warm-up, read on {{measure}}", {
      percent,
      zone: t(TRAINING_LABEL_ZONES.tempo),
      measure
    });
  }
  return t("{{time}} at {{zone}} or harder after the warm-up ({{percent}}%), read on {{measure}}", {
    time: formatDurationSeconds(basis.seconds),
    zone: t(TRAINING_LABEL_ZONES[label]),
    percent,
    measure
  });
}

/**
 * Label chip coloured by the zone of the same rank (Threshold is always the
 * Threshold colour, whatever the account's zone model), plus an outlined chip
 * for the session's shape.
 */
export function TrainingLabelChips({ reading }: { reading: TrainingLabelReading }) {
  useLanguage();
  const { theme } = useTheme();
  const colors = getIntensityZoneColors(theme);
  const name = t(TRAINING_LABEL_NAMES[reading.label]);
  return (
    <span className="training-label-chips">
      <span
        className="training-label-chip"
        style={{ "--label-color": colors[TRAINING_LABELS.indexOf(reading.label) % colors.length] } as CSSProperties}
        title={t("Trained: {{label}}", { label: name })}
      >
        {name}
      </span>
      {reading.shape ? (
        <span className="training-label-chip is-shape" title={t("Session shape")}>
          {sessionShapeText(reading.shape)}
        </span>
      ) : null}
    </span>
  );
}

/** "Threshold: 3 reps in the Threshold zone, read on pace". */
export function TrainingLabelReason({ reading }: { reading: TrainingLabelReading }) {
  useLanguage();
  return (
    <p className="training-label-reason">
      {t("{{label}}: {{reason}}", { label: t(TRAINING_LABEL_NAMES[reading.label]), reason: trainingLabelReason(reading) })}
    </p>
  );
}

/** A list row's label from the cached intensity, or nothing until the session's detail has been read once. */
export function ActivityLabelChips({ activityId, sportType }: { activityId: string; sportType: number }) {
  useActivityInsights();
  const insight = getActivityInsight(activityId);
  const reading = trainingLabel(sportType, insight?.intensity, lastKnownZoneModel());
  return reading ? <TrainingLabelChips reading={reading} /> : null;
}
