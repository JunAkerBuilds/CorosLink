import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { decodeWifiMapTasks, encodeWifiMapStart, requireWifiDownloadReady } = require('../dist-electron/corosBleWifiProtocol.js');
const { previewWifiMap, createWifiMapTask, normalizeWifiMapTiles, signMapRequest } = require('../dist-electron/corosWifiMapService.js');
const { corosMapTileAt, corosMapTileBounds, corosMapQuadkey } = require('../dist-electron/corosMapGrid.js');

assert.equal(encodeWifiMapStart('test-ID_').toString('hex'), '0a746573742d49445f00ffff');
assert.throws(() => encodeWifiMapStart('../bad'), /invalid/);
const payload = Buffer.alloc(41); payload[0] = 1; payload[1] = 1;
payload[2] = 3; Buffer.from('test-ID_').copy(payload, 3);
payload.writeBigUInt64LE(14099670n, 12); payload.writeBigUInt64LE(14099670n, 20);
payload.writeUInt16LE(0xffff, 33);
assert.deepEqual(decodeWifiMapTasks(payload)[0], { id: 'test-ID_', state: 'complete', statusCode: 3,
  downloadedBytes: 14099670, totalBytes: 14099670, errorCode: 0 });
assert.throws(() => decodeWifiMapTasks(payload.subarray(0, 40)), /unsupported/);
const overflow = Buffer.from(payload); overflow.writeBigUInt64LE(2n ** 63n, 12);
assert.throws(() => decodeWifiMapTasks(overflow), /sizes/);
const failed = Buffer.from(payload); failed[35] = 9;
assert.equal(decodeWifiMapTasks(failed)[0].state, 'failed');
requireWifiDownloadReady(Buffer.from([1, ...Array(16).fill(0)]));
assert.throws(() => requireWifiDownloadReady(Buffer.from([1, 8, 0, 0, 0])), /activity/);
assert.throws(() => requireWifiDownloadReady(Buffer.from([1])), /readiness/);
assert.throws(() => normalizeWifiMapTiles([{ x: -1, y: 90 }]), /invalid/);
assert.deepEqual(normalizeWifiMapTiles([{ x: 64, y: 64 }, { x: 64, y: 64 }]), [{ x: 64, y: 64 }]);
assert.deepEqual(corosMapTileAt(0, 0), { x: 64, y: 64 });
assert.equal(corosMapQuadkey({ x: 64, y: 64 }), '3000000');
assert.equal(corosMapTileBounds({ x: 64, y: 64 }).west, 0);
// Signature ignores array/object values, as the published COROS client does.
assert.equal(signMapRequest({ b: 2, a: 1, list: [{ x: 1 }] }, 'test'), signMapRequest({ list: [], a: 1, b: 2 }, 'test'));

const original = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url, init });
  if (url === 'https://mapstatic.coros.com/') return new Response('window.__assetsPath("public/main-fixture.js")');
  if (url.endsWith('main-fixture.js')) return new Response('public/index-fixture.js');
  if (url.endsWith('index-fixture.js')) return new Response('prod:{app_id:"1234567890123456789",app_secret:"0123456789abcdef0123456789abcdef"}');
  const data = JSON.parse(init.body);
  assert.equal(data.deviceModel, 'W332');
  assert.equal(data.list.length, 1);
  assert.equal(data.list[0].quadkey, '3000000');
  assert.equal(data.list[0].O, 0);
  assert.equal(data.list[0].C, 0);
  assert.equal(data.sign, signMapRequest(data, '0123456789abcdef0123456789abcdef'));
  return Response.json({ code: 200, data: { fileCount: 2, fileSize: 14099670, ...(data.action === 'download' ? { map_id: 'test-ID_' } : {}) } });
};
try {
  const preview = await previewWifiMap([{ x: 64, y: 64 }]);
  assert.equal(preview.sizeBytes, 14099670);
  assert.equal(JSON.stringify(preview).includes('app_secret'), false);
  assert.equal(requests.filter(r => r.init?.body && JSON.parse(r.init.body).action === 'download').length, 0, 'preview never creates a download task');
  await assert.rejects(createWifiMapTask('unreviewed-id'), /Check/);
  assert.equal(await createWifiMapTask(preview.id), 'test-ID_');
  await assert.rejects(createWifiMapTask(preview.id), /Check/, 'a preview can be consumed only once');
  assert.ok(requests.every(r => r.url.startsWith('https://mapstatic.coros.com/') || r.url.startsWith('https://map-oss-us.coros.com/coros-map/public/')));
} finally { globalThis.fetch = original; }
console.log('Wi-Fi map framing, task decoding, readiness, signed area requests, preview boundaries and identifier validation passed.');
