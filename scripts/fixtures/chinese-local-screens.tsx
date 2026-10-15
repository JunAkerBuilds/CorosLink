import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RaceEditorDialog } from '../../src/training/components/RaceEditorDialog';
import { OnboardingTour } from '../../src/onboarding/OnboardingTour';
import { RouteMakeup } from '../../src/maps/routes/RouteMakeup';
import { WatchfacePhoneSendCard } from '../../src/watchfaces/WatchfacePhoneSendCard';
import { UnitSystemProvider } from '../../src/units/UnitSystemProvider';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { setLanguage } from '../../src/i18n';
import type { CorosLinkApi } from '../../src/coroslink-api';
import type { CorosWatchfaceArchive } from '../../electron/types';
import '../../src/styles.css';
import '../../src/training/races.css';

const state = { saves: [] as unknown[], sends: [] as unknown[], stops: 0 };
const target = { mode: 'add' as const };
const insights = { wayTypes: { path: 800, busyRoad: 200 }, surfaces: { paved: 700, natural: 300 }, retracedMeters: 0, profile: 'brouter' as const };
const archive = { archiveId: 'literal-archive-id', firmwareType: 'COROS W332' } as CorosWatchfaceArchive;
const phoneApi = {
  platform: 'darwin',
  startCorosWatchfacePhoneSend: async (input: unknown) => {
    state.sends.push(input);
    return { link: 'coroslink://face/1?literal=Back', qrDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', name: 'Back 我的表盘', size: 42, hosts: ['127.0.0.1'], expiresAt: Date.now() + 600000 };
  },
  stopCorosWatchfacePhoneSend: async () => { state.stops++; },
} as unknown as CorosLinkApi;
setLanguage('en');
function Fixture() {
  const [screen, setScreen] = useState('race');
  Object.assign(window, { localScreenState: state, showLocalScreen: setScreen, switchLocalLanguage: setLanguage });
  return <ThemeProvider><UnitSystemProvider>
    {screen === 'race' ? <RaceEditorDialog target={target} busy={false} error={null} onClose={() => {}} onSave={async () => true} onAdd={async input => { state.saves.push(input); return true; }} onRemove={async () => true} /> : null}
    {screen === 'tour' ? <OnboardingTour trainingConnected={false} watchConnected={false} onClose={() => {}} /> : null}
    {screen === 'route' ? <RouteMakeup insights={insights} activityType="running" /> : null}
    {screen === 'phone' ? <WatchfacePhoneSendCard api={phoneApi} archive={archive} name="Back 我的表盘" disabled={false} /> : null}
  </UnitSystemProvider></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
