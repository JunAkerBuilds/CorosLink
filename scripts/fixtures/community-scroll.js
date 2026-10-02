import React from 'react';
import { createRoot } from 'react-dom/client';
import { CommunityWatchfaceBrowser } from '../../src/watchfaces/WatchfacesView';
import '../../src/styles.css';

window.requests = [];
const api = {
  listCommunityWatchfaces: query => new Promise((resolve, reject) => {
    window.requests.push({ query, resolve, reject });
  })
};
window.respond = (index, ids, total, pageCount) => {
  const request = window.requests[index];
  request.resolve({
    schemaVersion: 1,
    items: ids.map(id => ({
      id: String(id), slug: `face-${id}`, title: `Face ${id}`, description: '',
      creatorName: 'Test creator', models: ['PACE 3', 'PACE Pro'], tags: ['Minimal'],
      previewUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="95" fill="#333"/></svg>')
    })),
    pagination: { page: request.query.page, pageSize: 12, total, pageCount },
    facets: { models: ['PACE 3', 'PACE Pro'], styles: [{ value: 'minimal', label: 'Minimal' }] }
  });
};
createRoot(document.querySelector('#root')).render(
  React.createElement(CommunityWatchfaceBrowser, { api, disabled: false, progress: null, onOpen() {} })
);
