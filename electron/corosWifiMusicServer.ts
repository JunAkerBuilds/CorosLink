import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

export interface WifiMusicFile { id: string; path: string; name: string; size: number }

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
export async function serveWifiMusic(files: WifiMusicFile[], taskId: string, host = wifiMusicAddress()) {
  if (!files.length || files.length > 20 || !/^[A-F0-9]{8}$/.test(taskId)) throw new Error("Invalid audio transfer.");
  const nonce = randomBytes(3).toString("hex"), audioNonce = randomBytes(16).toString("hex");
  const root = `/${nonce}/.coros.com`, manifestPath = `${root}/openapi/map/getMapDetail/${taskId}`;
  const audio = new Map(files.map(file => [`/audio/${audioNonce}/${file.id}/${file.id}.mp3`, file]));
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
    if (url.pathname === `${root}/openapi/device/file/download/record` && request.method === "POST") {
      const length = Number(request.headers["content-length"]);
      if (!Number.isSafeInteger(length) || length < 0 || length > 4096 || request.headers["transfer-encoding"]) { json({ code: 413 }, 413); return; }
      let bytes = 0;
      request.on("data", (b: Buffer) => { bytes += b.length; if (bytes > 4096) request.destroy(); });
      request.on("end", () => json({ code: 0, data: {} }));
      return;
    }
    if (!["GET", "HEAD"].includes(request.method ?? "")) { json({ code: 404 }, 404); return; }
    if (url.pathname === manifestPath) {
      const page = url.searchParams.getAll("page");
      if (!page.length || (page.length === 1 && page[0] === "0")) {
        json({ code: 0, data: { host: `http://${host}:${port}`, count: 0, files_size: 0, page: 0, total_page: 0,
          d_count: files.length, d_size: total, d_total_page: 1 } }); return;
      }
      if (page.length === 1 && page[0] === "1") {
        json({ code: 0, data: { d_list: files.map(file => ({ type: 4, subtype: 0, id: file.id,
          name: `${file.id}.mp3`, url: `/audio/${audioNonce}/${file.id}`, size: file.size })) } }); return;
      }
      json({ code: 404 }, 404); return;
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
  return { prefix, totalBytes: total, close: async () => {
    for (const stream of streams) stream.destroy(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
