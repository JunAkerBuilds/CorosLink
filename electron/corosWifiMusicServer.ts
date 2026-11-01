import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { validateWifiMusicOptions, WIFI_MUSIC_BATCH_FILES, type CorosWifiMusicOptions } from "./corosWifiMusicTypes";

export interface WifiMusicFile { id: string; path: string; name: string; size: number }

/** The firmware stores each getMapDetail page and parses at most its first 4096 bytes; stay clear of that. */
export const WIFI_MUSIC_PAGE_BYTES = 3584;

/** Split d_list entries into pages whose whole response body stays within WIFI_MUSIC_PAGE_BYTES. */
export function paginateWifiMusicList<T>(entries: T[], limit = WIFI_MUSIC_PAGE_BYTES): T[][] {
  const body = (list: T[]) => Buffer.byteLength(JSON.stringify({ code: 0, data: { d_list: list } }));
  const pages: T[][] = [];
  let page: T[] = [];
  for (const entry of entries) {
    if (page.length && body([...page, entry]) > limit) { pages.push(page); page = []; }
    if (body([entry]) > limit) throw new Error("Invalid audio files.");
    page.push(entry);
  }
  if (page.length) pages.push(page);
  return pages;
}

export function wifiMusicAddress(): string {
  const candidates = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list ?? [])
    .filter(a => !a.internal && a.family === "IPv4" && /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(a.address))
    .filter(() => !/docker|veth|vmnet|vbox|utun|bridge|loopback/i.test(name))
    .map(a => ({ address: a.address, rank: /^(en0|wi-?fi|wlan|wlp|wireless)/i.test(name) ? 0 : 1 })));
  candidates.sort((a, b) => a.rank - b.rank);
  if (!candidates[0]) throw new Error("Connect this computer and your watch to the same Wi-Fi network.");
  return candidates[0].address;
}

/** Only explicitly staged MP3s are served, behind per-transfer and per-file random paths. */
export async function serveWifiMusic(files: WifiMusicFile[], taskId: string, host = wifiMusicAddress(), input?: CorosWifiMusicOptions, playlistId = taskId) {
  const options = validateWifiMusicOptions(input);
  if (!files.length || files.length > WIFI_MUSIC_BATCH_FILES || !/^[A-F0-9]{8}$/.test(taskId) || !/^[A-F0-9]{8}$/.test(playlistId)) throw new Error("Invalid audio transfer.");
  if (files.some(f => !/^[A-F0-9]{8}$/.test(f.id) || !Number.isSafeInteger(f.size) || f.size <= 0) || new Set(files.map(f => f.id)).size !== files.length)
    throw new Error("Invalid audio files.");
  const nonce = randomBytes(3).toString("hex"), audioNonce = randomBytes(16).toString("hex");
  const root = `/${nonce}/.coros.com`, manifestPath = `${root}/openapi/map/getMapDetail/${taskId}`;
  const audio = new Map(files.map(file => [`/audio/${audioNonce}/${file.id}/${file.id}.mp3`, file]));
  const audioUrls = new Map(files.map(file => [file.id, `/audio/${audioNonce}/${file.id}/${file.id}.mp3`]));
  // Firmware's info_prefix buffer is 32 bytes. The existing per-transfer nonce bounds access.
  const infoPrefix = `${root}/info`;
  const metadata = new Map<string, Buffer>(files.map(file => {
    let title = file.name.replace(/\.mp3$/i, "").replace(/[\x00-\x1f\x7f]/g, " ");
    while (Buffer.byteLength(title) > 240) title = title.slice(0, -1);
    return [`${infoPrefix}/${file.id}.json`, Buffer.from(JSON.stringify({ name: title || file.id, artists: "CorosLink", album_name: options.playlistName ?? "CorosLink" }))] as const;
  }));
  const entries = files.map(file => options.destination === "netease"
    ? { type: 4, subtype: 1, id: file.id, name: `${file.id}.fm`, size: file.size, vip_flag: false,
      info_size: metadata.get(`${infoPrefix}/${file.id}.json`)!.length }
    : { type: 4, subtype: 0, id: file.id, name: `${file.id}.mp3`, url: `/audio/${audioNonce}/${file.id}`, size: file.size });
  // The firmware fetches d_total_page pages (1..N) and accumulates them into one d_count-sized list.
  const pages = paginateWifiMusicList<object>(entries);
  const streams = new Set<fs.ReadStream>();
  const total = files.reduce((sum, f) => sum + f.size, 0);
  let port = 0;
  const server = http.createServer((request, response) => {
    const json = (value: unknown, status = 200) => {
      const data = Buffer.from(JSON.stringify(value));
      response.writeHead(status, { "Content-Type": "application/json", "Content-Length": data.length, "Connection": "close" });
      response.end(request.method === "HEAD" ? undefined : data);
    };
    let url: URL;
    try { url = new URL(request.url ?? "", "http://localhost"); } catch { json({ code: 404 }, 404); return; }
    const record = url.pathname === `${root}/openapi/device/file/download/record`;
    const renew = options.destination === "netease" && url.pathname === `${root}/openapi/music163/song/download/renew`;
    if ((record || renew) && request.method === "POST") {
      const length = Number(request.headers["content-length"]);
      if (!Number.isSafeInteger(length) || length < 0 || length > 4096 || request.headers["transfer-encoding"]) { json({ code: 413 }, 413); return; }
      let bytes = 0;
      const chunks: Buffer[] = [];
      request.on("data", (b: Buffer) => { bytes += b.length; if (bytes > 4096) request.destroy(); else if (renew) chunks.push(b); });
      request.on("end", () => {
        if (bytes > 4096) return;
        if (record) { json({ code: 0, data: {} }); return; }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { json({ code: 400 }, 400); return; }
        const fields = body && typeof body === "object" ? body as Record<string, unknown> : {};
        const audioPath = typeof fields.file_id === "string" ? audioUrls.get(fields.file_id) : undefined;
        if (fields.task_id !== taskId || !audioPath) { json({ code: 404 }, 404); return; }
        json({ code: 0, data: { sub_code: 200, url: `http://${host}:${port}${audioPath}` } });
      });
      return;
    }
    if (!["GET", "HEAD"].includes(request.method ?? "")) { json({ code: 404 }, 404); return; }
    if (url.pathname === manifestPath) {
      const page = url.searchParams.getAll("page");
      if (!page.length || (page.length === 1 && page[0] === "0")) {
        json({ code: 0, data: { host: `http://${host}:${port}`, count: 0, files_size: 0, page: 0, total_page: 0,
          d_count: files.length, d_size: total, d_total_page: pages.length,
          ...(options.destination === "netease" ? { info_prefix: infoPrefix, playlist: { id: playlistId, title: options.playlistName } } : {}) } }); return;
      }
      const index = page.length === 1 && /^[1-9][0-9]{0,2}$/.test(page[0]!) ? Number(page[0]) : 0;
      if (index >= 1 && index <= pages.length) { json({ code: 0, data: { d_list: pages[index - 1] } }); return; }
      json({ code: 404 }, 404); return;
    }
    const info = options.destination === "netease" ? metadata.get(url.pathname) : undefined;
    if (info) {
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": info.length, "Connection": "close" });
      response.end(request.method === "HEAD" ? undefined : info); return;
    }
    const file = audio.get(url.pathname);
    let unchanged = false;
    try { unchanged = Boolean(file && fs.statSync(file.path).size === file.size); } catch { /* A closed/removed staging file is unavailable. */ }
    if (!file || !unchanged) { json({ code: 404 }, 404); return; }
    let start = 0, end = file.size - 1, status = 200;
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=([0-9]+)-([0-9]*)$/.exec(range);
      start = Number(match?.[1]); end = match?.[2] ? Math.min(end, Number(match[2])) : end;
      if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end >= file.size) {
        response.writeHead(416, { "Content-Range": `bytes */${file.size}`, "Content-Length": 0, "Connection": "close" }); response.end(); return;
      }
      status = 206;
    }
    response.writeHead(status, { "Content-Type": "audio/mpeg", "Content-Length": end - start + 1, "Accept-Ranges": "bytes",
      "Connection": "close", ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}) });
    if (request.method === "HEAD") { response.end(); return; }
    const stream = fs.createReadStream(file.path, { start, end }); streams.add(stream);
    stream.on("error", () => response.destroy());
    stream.on("close", () => streams.delete(stream));
    response.on("close", () => stream.destroy()); stream.pipe(response);
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.maxHeadersCount = 30;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, host, () => { server.removeListener("error", reject); resolve(); }); });
  port = (server.address() as AddressInfo).port;
  const prefix = `${host}:${port}/${nonce}/`;
  if (Buffer.byteLength(prefix) > 31) { server.close(); throw new Error("The local Wi-Fi address is too long."); }
  return { prefix, totalBytes: total, lookup: { host, port, audioNonce, fileIds: files.map(file => file.id) }, close: async () => {
    for (const stream of streams) stream.destroy(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
