import React from 'react';
import { createRoot } from 'react-dom/client';
import { WatchfaceAiPanel } from '../../src/watchfaces/WatchfaceAiPanel';
window.saves = []; window.requests = []; window.cancelled = [];
window.api = {
  listWatchfaceAiChats: async () => [],
  onWatchfaceAiEvent: listener => { window.emit = listener; return () => {}; },
  sendWatchfaceAi: async id => { requests.push(id); },
  cancelWatchfaceAi: async id => { cancelled.push(id); },
  saveWatchfaceAiChat: input => new Promise(resolve => saves.push({ input, resolve }))
};
window.panelRoot = createRoot(document.querySelector('#root'));
panelRoot.render(React.createElement(WatchfaceAiPanel, { api, projectKey: 'project:test', hidden: false }));
window.complete = () => emit({ requestId: requests.at(-1), type: 'done' });
window.release = index => saves[index].resolve({ id: saves[index].input.id || 'server-id-' + index, title: 'Saved' });
