import type { Theme } from "../theme/theme";
import type { StreamChannelKey } from "./activityStreams";

export const TRAINING_HEATMAP_DAYS = 365;

export interface TrainingChartColors {
  accent: string;
  accentBright: string;
  accentGlow: string;
  accentSoft: string;
  gold: string;
  /** Distinct fourth hue for multi-series Coach charts. */
  blue: string;
  grid: string;
  text: string;
  cursor: string;
  cursorBand: string;
  dotStroke: string;
  tooltipBg: string;
  tooltipBorder: string;
}

export type TrainingMetricKey = "load" | "rpe" | "hrv" | "sleep";

export interface TrainingMetricPalette {
  /** Series stroke + resting dot color. */
  stroke: string;
  /** Translucent ring rendered behind the hover (active) dot. */
  halo: string;
  /** Soft tinted background for the header delta chip. */
  soft: string;
  /** Text/icon color rendered on top of `soft`. */
  chip: string;
  /** Vertical gradient stops for the area fill. */
  stops: { top: string; mid: string; bottom: string };
}

const DARK_CHART_COLORS: TrainingChartColors = {
  accent: "#2d9a74",
  accentBright: "#74c08f",
  accentGlow: "#6ee7a8",
  accentSoft: "rgba(45, 154, 116, 0.25)",
  gold: "#d89b22",
  blue: "#6aa6f5",
  grid: "rgba(255, 255, 255, 0.05)",
  text: "#a1a1a6",
  cursor: "rgba(255, 255, 255, 0.1)",
  cursorBand: "rgba(255, 255, 255, 0.05)",
  dotStroke: "rgba(12, 14, 13, 0.85)",
  tooltipBg: "rgba(18, 18, 20, 0.96)",
  tooltipBorder: "rgba(255, 255, 255, 0.12)"
};

const PAPER_CHART_COLORS: TrainingChartColors = {
  accent: "#12946e",
  accentBright: "#0f7f5f",
  accentGlow: "#0f7f5f",
  accentSoft: "rgba(18, 148, 110, 0.2)",
  gold: "#b9791a",
  blue: "#2f6fd6",
  grid: "rgba(38, 34, 28, 0.08)",
  text: "#57544e",
  cursor: "rgba(38, 34, 28, 0.08)",
  cursorBand: "rgba(38, 34, 28, 0.06)",
  dotStroke: "rgba(255, 255, 255, 0.9)",
  tooltipBg: "rgba(255, 255, 255, 0.98)",
  tooltipBorder: "rgba(38, 34, 28, 0.12)"
};

export function getTrainingChartColors(theme: Theme): TrainingChartColors {
  return theme === "paper" ? PAPER_CHART_COLORS : DARK_CHART_COLORS;
}

export function getTrainingChartFillStops(theme: Theme) {
  const colors = getTrainingChartColors(theme);
  return {
    top: colors.accentBright,
    mid: colors.accent,
    bottom: colors.accent
  };
}

export function getTrainingChartActiveDot(theme: Theme) {
  const colors = getTrainingChartColors(theme);
  return {
    r: 4,
    fill: colors.accentGlow,
    stroke: colors.dotStroke,
    strokeWidth: 2
  };
}

const DARK_METRIC_PALETTES: Record<TrainingMetricKey, TrainingMetricPalette> = {
  load: {
    stroke: "#4fd6a6",
    halo: "rgba(79, 214, 166, 0.3)",
    soft: "rgba(79, 214, 166, 0.14)",
    chip: "#8becc8",
    stops: { top: "#4fd6a6", mid: "#2d9a74", bottom: "#2d9a74" }
  },
  rpe: {
    stroke: "#b79bff",
    halo: "rgba(183, 155, 255, 0.3)",
    soft: "rgba(183, 155, 255, 0.15)",
    chip: "#d2c1ff",
    stops: { top: "#b79bff", mid: "#7b61c9", bottom: "#7b61c9" }
  },
  hrv: {
    stroke: "#74c08f",
    halo: "rgba(116, 192, 143, 0.3)",
    soft: "rgba(116, 192, 143, 0.14)",
    chip: "#a5ddb9",
    stops: { top: "#74c08f", mid: "#2d9a74", bottom: "#2d9a74" }
  },
  sleep: {
    stroke: "#a495ff",
    halo: "rgba(164, 149, 255, 0.3)",
    soft: "rgba(164, 149, 255, 0.1)",
    chip: "#c4baff",
    stops: { top: "#a495ff", mid: "#8575d8", bottom: "#66579d" }
  }
};

const PAPER_METRIC_PALETTES: Record<TrainingMetricKey, TrainingMetricPalette> = {
  load: {
    stroke: "#0f8a66",
    halo: "rgba(15, 138, 102, 0.24)",
    soft: "rgba(15, 138, 102, 0.12)",
    chip: "#0b6b4f",
    stops: { top: "#12946e", mid: "#0f7f5f", bottom: "#0f7f5f" }
  },
  rpe: {
    stroke: "#7c5cd6",
    halo: "rgba(124, 92, 214, 0.24)",
    soft: "rgba(124, 92, 214, 0.12)",
    chip: "#5f44ad",
    stops: { top: "#8b6ce0", mid: "#6d4fc4", bottom: "#6d4fc4" }
  },
  hrv: {
    stroke: "#0f7f5f",
    halo: "rgba(15, 127, 95, 0.24)",
    soft: "rgba(15, 127, 95, 0.12)",
    chip: "#0b6550",
    stops: { top: "#12946e", mid: "#0f7f5f", bottom: "#0f7f5f" }
  },
  sleep: {
    stroke: "#7860c7",
    halo: "rgba(120, 96, 199, 0.24)",
    soft: "rgba(120, 96, 199, 0.1)",
    chip: "#6145a9",
    stops: { top: "#9276df", mid: "#7860c7", bottom: "#7860c7" }
  }
};

/** Per-metric series palette — gives each trend chart its own color identity. */
export function getTrainingMetricPalettes(
  theme: Theme
): Record<TrainingMetricKey, TrainingMetricPalette> {
  return theme === "paper" ? PAPER_METRIC_PALETTES : DARK_METRIC_PALETTES;
}

/** The five readings a COROS Health Check takes in one sitting. */
export type HealthVitalKey = "heartRate" | "hrv" | "stress" | "respiratoryRate" | "spo2";

const DARK_VITAL_COLORS: Record<HealthVitalKey, string> = {
  heartRate: "#f47a86",
  hrv: "#53cba1",
  stress: "#e0a93a",
  respiratoryRate: "#7fb2f5",
  spo2: "#a495ff"
};

const PAPER_VITAL_COLORS: Record<HealthVitalKey, string> = {
  heartRate: "#c43d4d",
  hrv: "#147d5d",
  stress: "#a8721a",
  respiratoryRate: "#2f6fd6",
  spo2: "#6f56c9"
};

/** One hue per vital so a tile and its trend chart read as the same thing. */
export function getHealthVitalColors(theme: Theme): Record<HealthVitalKey, string> {
  return theme === "paper" ? PAPER_VITAL_COLORS : DARK_VITAL_COLORS;
}

const DARK_ACTIVITY_CHANNEL_COLORS: Record<StreamChannelKey, string> = {
  pace: "#5ce5a2",
  gap: "#4fd1c5",
  hr: "#ff6b81",
  cadence: "#a78bfa",
  power: "#f5c451",
  stride: "#6aa6f5",
  gct: "#f2994a",
  vo: "#f472b6",
  vr: "#a3e635",
  elevation: "#9a9aa2",
  grade: "#d6c29a",
  temperature: "#38bdf8"
};

const PAPER_ACTIVITY_CHANNEL_COLORS: Record<StreamChannelKey, string> = {
  pace: "#12855c",
  gap: "#0f7a80",
  hr: "#c8364f",
  cadence: "#6d4fc4",
  power: "#946600",
  stride: "#2f6fd6",
  gct: "#b45a12",
  vo: "#b8327a",
  vr: "#4d7c0f",
  elevation: "#8a857c",
  grade: "#7a6a4f",
  temperature: "#0369a1"
};

/** One hue per activity channel, shared by the picker, lanes and readout. */
export function getActivityChannelColors(theme: Theme): Record<StreamChannelKey, string> {
  return theme === "paper" ? PAPER_ACTIVITY_CHANNEL_COLORS : DARK_ACTIVITY_CHANNEL_COLORS;
}

/** Easy-to-hard ramp for time-in-zone bars and heart-rate lane bands (up to 7 zones). */
const DARK_INTENSITY_ZONE_COLORS = ["#8e9bb0", "#6aa6f5", "#4fd6a6", "#e9c95a", "#f2994a", "#f2667a", "#c084fc"];
const PAPER_INTENSITY_ZONE_COLORS = ["#66728a", "#2f6fd6", "#12855c", "#9a7300", "#c2570c", "#c8364f", "#8b3fd0"];

export function getIntensityZoneColors(theme: Theme): readonly string[] {
  return theme === "paper" ? PAPER_INTENSITY_ZONE_COLORS : DARK_INTENSITY_ZONE_COLORS;
}

/** Back-compat static exports (dark palette) for any non-theme-aware callers. */
export const trainingChartColors = DARK_CHART_COLORS;
export const trainingChartActiveDot = getTrainingChartActiveDot("dark");

export const trainingChartMargin = {
  top: 12,
  right: 12,
  left: -8,
  bottom: 4
};

export const trainingChartTooltipStyle = {
  backgroundColor: "transparent",
  border: "none",
  borderRadius: 0,
  boxShadow: "none",
  padding: 0
};
