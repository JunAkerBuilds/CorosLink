import { PerceivedEffortPanel } from "../../src/training/components/TrainingZoneDistributionCharts";
import { createRoot } from 'react-dom/client';
import { HealthInsightsPanel } from '../../src/training/components/HealthInsightsPanel';
import { TrainingTrendCharts } from '../../src/training/components/TrainingTrendChart';
import { sampleHealthInsight } from '../../src/training/healthInsightsSample';
import type { CorosLinkApi } from '../../src/coroslink-api';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import '../../src/styles.css';
const standard = new URLSearchParams(location.search).has('standard');
const api = {
  async getTrainingHealthInsight(kind, days) {
    const result = sampleHealthInsight(kind, days);
    return { ...result, metrics: [...result.metrics.filter(metric => metric.key !== "average"), { key: "baseline", label: "Baseline", value: 60, unit: "ms" }], series: [...result.series, { ...result.series[0], key: 'overnight', label: 'Overnight HRV' }], report: 'Dates are wake-up days: each reading comes from the night ending that morning.' };
  }
} as CorosLinkApi;
createRoot(document.getElementById('root')!).render(<ThemeProvider><main style={{ display: 'grid', gap: 16, width: standard ? 760 : 320, padding: 12 }}>
  <HealthInsightsPanel api={api} kind="sleepHrv" size={standard ? "standard" : "mini"} />
  <PerceivedEffortPanel distribution={null} size={standard ? "standard" : "mini"} />
  <TrainingTrendCharts points={[]} metric="rpe" size="mini" />
  <TrainingTrendCharts points={[]} metric="sleep" size="mini" />
</main></ThemeProvider>);
