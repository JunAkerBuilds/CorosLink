import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { serveWifiMusic } = require("../dist-electron/corosWifiMusicServer.js");
const { validateWifiMusicOptions } = require("../dist-electron/corosWifiMusicTypes.js");
const { encodeLocalDownloadSettings, parseDownloadSettings } = require("../dist-electron/corosWifiMusicProtocol.js");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "coros-netease-"));
let server;
try {
  for (const input of [null, [], "netease", {}, { destination: "other" }, { destination: "netease" },
    { destination: "netease", playlistName: "  " }, { destination: "netease", playlistName: "x\0y" },
    { destination: "netease", playlistName: "界".repeat(22) }]) assert.throws(() => validateWifiMusicOptions(input));
  assert.deepEqual(validateWifiMusicOptions(), { destination: "podcasts" });
  const options = { destination: "netease", playlistName: "CorosLink test" };
  const field = b => Buffer.concat([Buffer.from([b.length]), b]);
  const original = Buffer.concat([Buffer.from([2, 4]), ...[Buffer.alloc(32, 116), Buffer.from("en-US"), Buffer.alloc(6),
    Buffer.from("1=api&2=epo&3=mapstatic"), Buffer.from("US")].map(field)]);
  const lookup = { prefix: "relay.coroslink.com/AbCdEf_123/", token: "0123456789abcdef0123456789abcdef" };
  const local = parseDownloadSettings(encodeLocalDownloadSettings(original, "127.0.0.1:12345/abcdef/", "netease", lookup));
  assert.equal(local.entries.find(e => e.type === 4).prefix, lookup.prefix);
  assert.equal(local.entries.find(e => e.type === 3).prefix, "127.0.0.1:12345/abcdef/");
  assert.equal(local.token.toString(), lookup.token, "the COROS credential is replaced during the relay-backed transfer");
  assert.throws(() => encodeLocalDownloadSettings(original, "127.0.0.1:12345/abcdef/", "netease"), /secure NetEase lookup/);
  assert.throws(() => encodeLocalDownloadSettings(original, "127.0.0.1:12345/abcdef/", "netease", { ...lookup, prefix: "evil.example/AbCdEf_123/" }), /secure NetEase lookup/);
  assert.equal(local.entries.find(e => e.type === 2).prefix, "epo");
  const bytes = Buffer.from("ID3 test fixture bytes"), filename = path.join(temp, "song.mp3");
  await fs.writeFile(filename, bytes);
  const task = "F1234567", id = "ABCDEF01";
  server = await serveWifiMusic([{ id, path: filename, name: "Own song.mp3", size: bytes.length }], task, "127.0.0.1", options);
  const base = `http://${server.prefix}.coros.com`;
  const overview = await (await fetch(`${base}/openapi/map/getMapDetail/${task}`)).json();
  const page = await (await fetch(`${base}/openapi/map/getMapDetail/${task}?page=1`)).json();
  const item = page.data.d_list[0];
  assert.equal(item.subtype, 1); assert.equal(item.vip_flag, false);
  assert.deepEqual(overview.data.playlist, { id: task, title: options.playlistName });
  assert.equal(overview.data.d_size, bytes.length); assert.equal(overview.data.files_size, 0);
  assert.ok(Buffer.byteLength(overview.data.info_prefix) <= 31);
  const metadataUrl = overview.data.host + overview.data.info_prefix + `/${id}.json`;
  const head = await fetch(metadataUrl, { method: "HEAD" });
  assert.equal(Number(head.headers.get("content-length")), item.info_size);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const metadataText = await (await fetch(metadataUrl)).text();
  assert.equal(Buffer.byteLength(metadataText), item.info_size);
  assert.deepEqual(JSON.parse(metadataText), { name: "Own song", artists: "CorosLink", album_name: options.playlistName });
  const endpoint = `${base}/openapi/music163/song/download/renew`;
  const renew = body => fetch(endpoint, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  const renewal = await (await renew({ task_id: task, file_id: id, device_id: "test", firmware_type: "COROS W332" })).json();
  assert.equal(renewal.data.sub_code, 200);
  assert.ok(renewal.data.url.startsWith(overview.data.host + "/audio/"));
  assert.deepEqual(Buffer.from(await (await fetch(renewal.data.url)).arrayBuffer()), bytes);
  const partial = await fetch(renewal.data.url, { headers: { Range: "bytes=2-8" } });
  assert.equal(partial.status, 206); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(2, 9));
  const nextTask = "F7654321";
  const next = await serveWifiMusic([{ id, path: filename, name: "Own song.mp3", size: bytes.length }], nextTask, "127.0.0.1", options, task);
  try {
    const nextBase = `http://${next.prefix}.coros.com`;
    const nextOverview = await (await fetch(`${nextBase}/openapi/map/getMapDetail/${nextTask}`)).json();
    assert.deepEqual(nextOverview.data.playlist, overview.data.playlist, "a later task appends to the same named playlist");
    const nextRenew = body => fetch(`${nextBase}/openapi/music163/song/download/renew`, { method: "POST", body: JSON.stringify(body) });
    assert.equal((await nextRenew({ task_id: task, file_id: id })).status, 404, "renewal still requires the current batch task, not the playlist ID");
    const nextRenewal = await (await nextRenew({ task_id: nextTask, file_id: id })).json();
    assert.equal((await fetch(nextRenewal.data.url)).status, 200);
    if (process.argv[2]) await fs.writeFile(process.argv[2] + ".next.json", JSON.stringify({ taskId: nextTask, overview: nextOverview, page, metadata: JSON.parse(metadataText), renewal: nextRenewal }, null, 2));
  } finally { await next.close(); }
  await assert.rejects(serveWifiMusic(Array.from({ length: 101 }, (_, i) => ({ id: i.toString(16).toUpperCase().padStart(8, "0"), path: filename, name: "song.mp3", size: bytes.length })), nextTask, "127.0.0.1", options), /Invalid audio transfer/, "HTTP manifests stay bounded to 100 files");
  for (const body of [{ task_id: "F7654321", file_id: id }, { task_id: task, file_id: "UNKNOWN1" }, [], null])
    assert.equal((await renew(body)).status, 404);
  assert.equal((await renew("{")).status, 400);
  assert.equal((await renew("x".repeat(4097))).status, 413);
  assert.equal((await fetch(endpoint)).status, 404);
  assert.equal((await fetch(metadataUrl.replace(id, "UNKNOWN1"))).status, 404);
  assert.equal((await fetch(base + "/audio/../../song.mp3")).status, 404);
  if (process.argv[2]) await fs.writeFile(process.argv[2], JSON.stringify({ overview, page, metadata: JSON.parse(metadataText), renewal }, null, 2));
  const prefix = server.prefix; await server.close(); server = undefined;
  await assert.rejects(fetch(`http://${prefix}.coros.com/openapi/map/getMapDetail/${task}`));
  console.log("NetEase local server: metadata, manifests, renewal isolation, ranges, input validation and shutdown passed.");
} finally { await server?.close(); await fs.rm(temp, { recursive: true, force: true }); }
