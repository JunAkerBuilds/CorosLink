export const TRAINING_HEATMAP_DAYS = 365;

export const trainingChartColors = {
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

export const trainingChartFillStops = {
  top: trainingChartColors.accentBright,
  mid: trainingChartColors.accent,
  bottom: trainingChartColors.accent
};

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

export const trainingChartActiveDot = {
  r: 4,
  fill: trainingChartColors.accentGlow,
  stroke: trainingChartColors.dotStroke,
  strokeWidth: 2
};
