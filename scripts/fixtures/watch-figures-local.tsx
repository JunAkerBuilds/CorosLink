import { createRoot } from 'react-dom/client';
import { Vo2MaxWidget } from '../../src/training/components/Vo2MaxWidget';
import { RecoveryRing } from '../../src/training/components/RecoveryRing';
import { FitnessBalanceCard } from '../../src/training/components/FitnessBalanceCard';
import { TrainingSummaryTiles } from '../../src/training/components/TrainingSummaryTiles';
import type { TrainingHubSnapshot, TrainingSummaryMetrics } from '../../src/training/types';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { buildTrainingHubSnapshot } from '../../src/training/parsers';
import '../../src/styles.css';
// Local-Only Mode cards fed the way LocalTrainingMetrics and buildSummary feed them: the watch's own figures.
const withReadings = { dailyMetrics: { dayList: [
  { happenDay: '20261017', trainingLoad: 10 },
  { happenDay: '20261018', trainingLoad: 0 },
  { happenDay: '20261019', trainingLoad: 72, vo2max: 43 }
], weekList: [] }, analytics: null } as unknown as TrainingHubSnapshot;
const withoutReadings = { dailyMetrics: { dayList: [{ happenDay: '20261017', trainingLoad: 10 }], weekList: [] }, analytics: null } as unknown as TrainingHubSnapshot;
// The injected clock: starts at 2026-10-19 08:00 UTC; window.setWatchClock(ms) moves it.
const recoveredAt = Date.UTC(2026, 9, 19, 22, 0, 0) / 1000;
const balance: TrainingSummaryMetrics = { fitnessBalance: { happenDay: '20261019', baseFitness: 50, loadImpact: 72, fatigue: 144 } };
// As LocalTrainingMetrics reports days: the summary takes each figure from the latest day that has it.
const fromDays = buildTrainingHubSnapshot(null, null, { dayList: [
  { happenDay: '20261017', trainingLoad: 10, recoveredAt: recoveredAt - 86_400 * 2, baseFitness: 40, loadImpact: 30, fatigue: 75 },
  { happenDay: '20261018', trainingLoad: 72, recoveredAt, baseFitness: 41, loadImpact: 33, fatigue: 80 },
  { happenDay: '20261019', trainingLoad: 0 }
], weekList: [] }).summary;
// Resting HR as LocalTrainingMetrics reports it: CorosLink's figure per wake-up day.
const restingDays = (dayList: Array<{ happenDay: string; rhr?: number }>) => buildTrainingHubSnapshot(null, null, { dayList, weekList: [] });
const resting = restingDays([{ happenDay: '20261017', rhr: 62 }, { happenDay: '20261018', rhr: 60 }, { happenDay: '20261019', rhr: 59 }]);
const restingGap = restingDays([{ happenDay: '20261017', rhr: 62 }, { happenDay: '20261018', rhr: 60 }, { happenDay: '20261019' }]);
const restingNone = restingDays([{ happenDay: '20261019' }]);
const root = createRoot(document.getElementById('root')!);
function render(clockMs: number) {
  const now = () => clockMs;
  root.render(<ThemeProvider><main style={{ display: 'grid', gap: 16, width: 360, padding: 12 }}>
    <div id="with"><Vo2MaxWidget snapshot={withReadings} local /></div>
    <div id="without"><Vo2MaxWidget snapshot={withoutReadings} local /></div>
    <div id="cloud"><Vo2MaxWidget snapshot={withReadings} /></div>
    <div id="recovering"><RecoveryRing summary={{ recoveredAt }} local now={now} /></div>
    <div id="no-recovery"><RecoveryRing summary={{}} local now={now} /></div>
    <div id="cloud-recovery"><RecoveryRing summary={{ recoveryPct: 82, recoveredAt }} local now={now} /></div>
    <div id="balance"><FitnessBalanceCard summary={balance} /></div>
    <div id="no-balance"><FitnessBalanceCard summary={{}} /></div>
    <div id="days-recovery"><RecoveryRing summary={fromDays} local now={now} /></div>
    <div id="days-balance"><FitnessBalanceCard summary={fromDays} /></div>
    <div id="rhr"><TrainingSummaryTiles summary={resting.summary} trendPoints={resting.trendPoints} layout="stack" metrics={['heart']} local /></div>
    <div id="rhr-gap"><TrainingSummaryTiles summary={restingGap.summary} trendPoints={restingGap.trendPoints} layout="stack" metrics={['heart']} local /></div>
    <div id="rhr-none"><TrainingSummaryTiles summary={restingNone.summary} trendPoints={restingNone.trendPoints} layout="stack" metrics={['heart']} local /></div>
    <div id="rhr-cloud"><TrainingSummaryTiles summary={restingNone.summary} trendPoints={restingNone.trendPoints} layout="stack" metrics={['heart']} /></div>
  </main></ThemeProvider>);
}
(window as unknown as { setWatchClock: (ms: number) => void }).setWatchClock = render;
render(Date.UTC(2026, 9, 19, 8, 0, 0));
