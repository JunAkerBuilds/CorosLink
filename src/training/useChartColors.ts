import { useMemo } from "react";
import { useTheme } from "../theme/ThemeProvider";
import {
  getTrainingChartActiveDot,
  getTrainingChartColors,
  getTrainingChartFillStops,
  getTrainingMetricPalettes
} from "./chartConfig";

/** Theme-aware chart palette derived from the active app theme. */
export function useChartColors() {
  const { theme } = useTheme();
  return useMemo(
    () => ({
      colors: getTrainingChartColors(theme),
      fillStops: getTrainingChartFillStops(theme),
      activeDot: getTrainingChartActiveDot(theme),
      metrics: getTrainingMetricPalettes(theme)
    }),
    [theme]
  );
}
