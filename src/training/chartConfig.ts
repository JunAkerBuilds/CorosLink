import type { Theme } from "../theme/theme";

export const TRAINING_HEATMAP_DAYS = 365;

export interface TrainingChartColors {
  accent: string;
  accentBright: string;
  accentGlow: string;
  accentSoft: string;
  gold: string;
  grid: string;
  text: string;
  cursor: string;
  dotStroke: string;
  tooltipBg: string;
  tooltipBorder: string;
}

const DARK_CHART_COLORS: TrainingChartColors = {
  accent: "#2d9a74",
  accentBright: "#74c08f",
  accentGlow: "#6ee7a8",
  accentSoft: "rgba(45, 154, 116, 0.25)",
  gold: "#d89b22",
  grid: "rgba(255, 255, 255, 0.05)",
  text: "#a1a1a6",
  cursor: "rgba(255, 255, 255, 0.1)",
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
  grid: "rgba(38, 34, 28, 0.08)",
  text: "#57544e",
  cursor: "rgba(38, 34, 28, 0.08)",
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

/** Back-compat static exports (dark palette) for any non-theme-aware callers. */
export const trainingChartColors = DARK_CHART_COLORS;
export const trainingChartFillStops = getTrainingChartFillStops("dark");
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
