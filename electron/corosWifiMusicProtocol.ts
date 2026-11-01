import { decodeWifiMapTasks } from "./corosBleWifiProtocol";
import type { CorosWifiMusicOptions } from "./corosWifiMusicTypes";

const bad = (): never => { throw new Error("Choose a complete COROS download-settings backup for this watch."); };

export function parseDownloadSettings(payload: Buffer) {
  if (payload.length < 9 || payload.length > 512 || payload[0] !== 2) bad();
  let offset = 2;
  const field = (min: number, max: number): Buffer => {
    const size = payload[offset++];
    if (size === undefined || size < min || size > max || offset + size > payload.length) bad();
    const result = payload.subarray(offset, offset + size); offset += size; return result;
  };
  const token = field(8, 32), language = field(1, 16), mac = field(0, 6), hosts = field(1, 255), country = field(0, 2);
  if (offset !== payload.length || ![0, 6].includes(mac.length) || ![0, 2].includes(country.length)) bad();
  const entries = hosts.toString("ascii").split("&").map(value => {
    const match = /^([0-9])=([\x21-\x7e]{1,31})$/.exec(value);
    if (!match || match[2]!.includes("&")) return bad();
    return { type: Number(match[1]), prefix: match[2]! };
  });
  if (entries.length > 10 || new Set(entries.map(e => e.type)).size !== entries.length ||
      !entries.some(e => e.type === 1) || !entries.some(e => e.type === 3)) bad();
  return { serverType: payload[1]!, token, language, mac, hosts, country, entries };
}

export function validateNormalDownloadSettings(payload: Buffer): void {
  const settings = parseDownloadSettings(payload);
  // Normal prefixes resolve under coros.com. Local redirects are created only by this module.
  if (settings.entries.some(e => !/^[a-zA-Z0-9.-]{1,31}$/.test(e.prefix))) bad();
}

export function encodeLocalDownloadSettings(original: Buffer, prefix: string, destination: CorosWifiMusicOptions["destination"] = "podcasts", lookup?: { prefix: string; token: string }): Buffer {
  if (!/^[0-9.]+:[0-9]+\/[a-f0-9]{6}\/$/.test(prefix) || Buffer.byteLength(prefix) > 31) throw new Error("The local Wi-Fi address is unsupported.");
  validateNormalDownloadSettings(original);
  const s = parseDownloadSettings(original);
  if (destination !== "podcasts" && destination !== "netease") throw new Error("Choose an audio destination.");
  if (destination === "netease" && (!lookup || !/^relay\.coroslink\.com\/[A-Za-z0-9_-]{10}\/$/.test(lookup.prefix) || Buffer.byteLength(lookup.prefix) > 31 || !/^[a-f0-9]{32}$/.test(lookup.token))) {
    throw new Error("The secure NetEase lookup is unavailable.");
  }
  const entries = [...s.entries];
  // The watch hardcodes HTTPS for service 4. Only that lookup uses the relay.
  if (destination === "netease" && !entries.some(e => e.type === 4)) entries.push({ type: 4, prefix: lookup!.prefix });
  const hosts = Buffer.from(entries.map(e => `${e.type}=${e.type === 1 || e.type === 3 ? prefix : destination === "netease" && e.type === 4 ? lookup!.prefix : e.prefix}`).join("&"));
  if (hosts.length > 255) throw new Error("The watch's download host settings are too long.");
  const field = (b: Buffer) => Buffer.concat([Buffer.from([b.length]), b]);
  // Firmware sends accessToken to service 4; use an unrelated ephemeral value
  // so the watch's original COROS credential never leaves through the relay.
  return Buffer.concat([Buffer.from([2, s.serverType]), ...[destination === "netease" ? Buffer.from(lookup!.token) : s.token, s.language, s.mac, hosts, s.country].map(field)]);
}

export function encodePodcastStart(id: string, destination: CorosWifiMusicOptions["destination"] = "podcasts"): Buffer {
  if (!/^[A-F0-9]{8}$/.test(id)) throw new Error("Invalid audio download identifier.");
  if (destination !== "podcasts" && destination !== "netease") throw new Error("Choose an audio destination.");
  return Buffer.concat([Buffer.from([10]), Buffer.from(id), Buffer.from([2, destination === "netease" ? 1 : 0, 0])]);
}

export function encodePodcastPause(id: string): Buffer {
  if (!/^[A-F0-9]{8}$/.test(id)) throw new Error("Invalid audio download identifier.");
  return Buffer.concat([Buffer.from([4]), Buffer.from(id)]);
}

export function decodePodcastTask(payload: Buffer, id: string, totalBytes: number) {
  const task = decodeWifiMapTasks(payload).find(t => t.id === id);
  if (!task) return undefined;
  // Podcast completion is status 3. Map progress additionally assumes equal counters.
  return { ...task, complete: task.statusCode === 3 && task.errorCode === 0 && task.downloadedBytes === totalBytes };
}
