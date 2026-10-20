import { createRoot } from 'react-dom/client';
import { OverviewBriefing, useOverviewBriefing } from '../../src/overview/OverviewBriefing';
import type { TrainingHubSnapshot } from '../../src/training/types';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { UnitSystemProvider } from '../../src/units/UnitSystemProvider';
import { setLocalOnlyView } from '../../src/privacy/localOnlyView';
import '../../src/styles.css';
// The Overview's readiness card in Local-Only Mode: no watch data yet, the watch's recovery time running, and run out.
const snapshot = (recoveredAt?: number) => ({ summary: recoveredAt === undefined ? {} : { recoveredAt }, trendPoints: [], racePredictor: null, dashboard: null, analytics: null, dailyMetrics: null, sleep: null, dailyHealth: null }) as unknown as TrainingHubSnapshot;
const nowSeconds = Date.now() / 1000;
const cases = { empty: snapshot(), recovering: snapshot(nowSeconds + 14.2 * 3600), recovered: snapshot(nowSeconds - 3600) };
const calls = { sync: 0 };
(window as unknown as { overviewCalls: typeof calls }).overviewCalls = calls;
(window as unknown as { setLocalOnly: (value: boolean) => void }).setLocalOnly = setLocalOnlyView;
function Card({ snapshot }: { snapshot: TrainingHubSnapshot }) {
  const briefing = useOverviewBriefing(snapshot, [], []);
  return <OverviewBriefing api={undefined} connected loading={false} briefing={briefing} snapshot={snapshot} activities={[]} sportTypes={[]}
    onNavigate={() => undefined} onOpenActivity={() => undefined} onSyncWatch={() => { calls.sync += 1; }} />;
}
setLocalOnlyView(true);
createRoot(document.getElementById('root')!).render(<ThemeProvider><UnitSystemProvider><main style={{ display: 'grid', gap: 16, width: 900, padding: 12 }}>
  {Object.entries(cases).map(([id, value]) => <div id={id} key={id}><Card snapshot={value} /></div>)}
</main></UnitSystemProvider></ThemeProvider>);
