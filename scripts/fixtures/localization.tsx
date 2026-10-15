import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSidebar } from '../../src/components/AppSidebar';
import { SelectDropdown } from '../../src/components/SelectDropdown';
import { ApiAccountSettings } from '../../src/settings/ApiAccountSettings';
import { LanguageSettings } from '../../src/settings/LanguageSettings';
import { TrainingHubHeader } from '../../src/training/components/TrainingHubHeader';
import { initializeLanguage, setLanguage, t, useLanguage, formatNumber, formatDate } from '../../src/i18n';
import type { CorosLinkApi } from '../../src/coroslink-api';
import '../../src/styles.css';
import '../../src/native-sidebar.css';
import '../../src/training/trainingHub.css';

const state = { mounts: 0, saves: [] as unknown[], dropdownChanges: [] as string[] };
Object.assign(window, { localizationTest: state, setTestLanguage: setLanguage });
const api = {
  getSpotifyConfig: async () => ({ clientId: 'saved-client', redirectUri: 'https://127.0.0.1:4567/callback' }),
  getSpotifyStatus: async () => ({ authenticated: false }),
  saveSpotifyConfig: async (value: unknown) => { state.saves.push(value); return { authenticated: false }; },
} as unknown as CorosLinkApi;
initializeLanguage();
function Fixture() {
  useLanguage();
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState('overview');
  const [freeform, setFreeform] = useState('back');
  useEffect(() => { state.mounts++; }, []);
  return <>
    <AppSidebar activeView="settings" onChange={() => {}} appLogo="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27/%3E" expanded={expanded} onExpandedChange={setExpanded} overlayOpen={false} onOverlayOpenChange={() => {}} />
    <main style={{ padding: 24, marginLeft: 232, maxWidth: 1050 }}>
      <LanguageSettings />
      <div id="fixture-values"><span>{formatNumber(1234.5)}</span><span>{formatDate(new Date(2026, 9, 15), { month: 'long' })}</span></div>
      <TrainingHubHeader connected={true} status={null} busy={null} sampleMode={false} activeTab="overview" tabIdPrefix="fixture" activityCount={5} onTabChange={() => {}} onRefresh={() => {}} onLogout={() => {}} />
      <SelectDropdown label="Startup view" value={selected} onChange={setSelected} options={[{ value: 'overview', label: 'Overview' }, { value: 'calendar', label: 'Calendar' }]} />
      <div id="fixture-freeform">
        <SelectDropdown label="Exercise" title="Select an activity" value={freeform}
          onChange={value => { state.dropdownChanges.push(value); setFreeform(value); }}
          options={[{ value: 'back', label: 'Back', translate: false }, { value: 'open', label: 'Open', translate: false }, { value: 'calendar', label: 'Calendar' }, { value: 'settings', label: 'Settings' }]} />
      </div>
      <ApiAccountSettings api={api} service="spotify" />
      <p id="fixture-fallback">{t('Untranslated custom data: Élodie')}</p>
    </main>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
