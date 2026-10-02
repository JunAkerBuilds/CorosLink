import { createRoot } from 'react-dom/client';
import { AccountsSettings } from '../../src/settings/AccountsSettings';
import type { CorosLinkApi } from '../../src/coroslink-api';
import '../../src/styles.css';
const state = window as unknown as { calls: unknown[]; failSave: boolean; ignoreCartoSave?: boolean; oldCartoBackend?: boolean; chat: any; routes: string[] };
let routeConfig = { backend: 'keyless', openRouteServiceApiKey: 'existing-ors-key', cartoApiKey: '' };
state.calls = []; state.routes = []; state.failSave = false;
state.chat = { provider: 'chatgpt', chatgpt: {}, claudeCode: {}, customInstructions: 'Keep my preferences',
  openRouter: { model: 'openrouter/auto', hasApiKey: true },
  local: { model: 'test-model', baseUrl: 'http://localhost:11434/v1', hasApiKey: false, toolsEnabled: true } };
const api = {
  getTrainingHubStatus: async () => ({ authenticated: false }),
  getYouTubeMusicStatus: async () => ({ authenticated: false }),
  getSpotifyStatus: async () => ({ authenticated: false }),
  getSpotifyConfig: async () => ({ clientId: 'saved-id', clientSecret: 'saved-secret', redirectUri: 'http://127.0.0.1:8888/callback' }),
  saveSpotifyConfig: async (config: unknown) => { state.calls.push({ service: 'spotify', config }); return { authenticated: false }; },
  getAppleMusicStatus: async () => ({ authenticated: false }),
  getHevyStatus: async () => ({ connected: false }),
  connectHevy: async (key: string) => { state.calls.push({ service: 'strength', key }); return { connected: true }; },
  getIntervalsStatus: async () => ({ connected: false }),
  connectIntervals: async (key: string, athleteId: string) => { state.calls.push({ service: 'intervals', key, athleteId }); return { connected: true }; },
  getGoogleCalendarStatus: async () => ({ connected: false }),
  getAppleCalendarStatus: async () => ({ connected: false }),
  getRouteBuilderConfig: async () => ({ ...routeConfig, ...(state.oldCartoBackend ? { cartoApiKey: undefined } : {}) }),
  saveRouteBuilderConfig: async (config: typeof routeConfig) => { state.calls.push({ service: 'maps', config }); if (!state.ignoreCartoSave) routeConfig = config; return { ...config }; },
  getChatSettings: async () => structuredClone(state.chat),
  saveChatSettings: async (config: any) => {
    if (state.failSave) throw new Error('Save failed');
    state.calls.push({ service: 'chat', config });
    for (const provider of ['openRouter', 'local']) {
      const value = config[provider];
      value.hasApiKey = value.clearApiKey ? false : Boolean(value.apiKey || value.hasApiKey);
      delete value.apiKey; delete value.clearApiKey;
    }
    state.chat = config; return structuredClone(config);
  },
  testLocalChatConnection: async () => ({ ok: true, message: 'Local connection works' }),
  testOpenRouterConnection: async () => ({ ok: false, message: 'Invalid test key', models: [] }),
} as unknown as CorosLinkApi;
createRoot(document.getElementById('root')!).render(<main style={{ padding: 20 }}><AccountsSettings api={api} onBack={() => {}} onOpenAccount={destination => state.routes.push(destination)} /></main>);
