import { decodeWifiMapTasks } from "./corosBleWifiProtocol";

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

export function encodeLocalDownloadSettings(original: Buffer, prefix: string): Buffer {
  if (!/^[0-9.]+:[0-9]+\/[a-f0-9]{6}\/$/.test(prefix) || Buffer.byteLength(prefix) > 31) throw new Error("The local Wi-Fi address is unsupported.");
  validateNormalDownloadSettings(original);
  const s = parseDownloadSettings(original);
  const hosts = Buffer.from(s.entries.map(e => `${e.type}=${[1, 3].includes(e.type) ? prefix : e.prefix}`).join("&"));
  const field = (b: Buffer) => Buffer.concat([Buffer.from([b.length]), b]);
  return Buffer.concat([Buffer.from([2, s.serverType]), ...[s.token, s.language, s.mac, hosts, s.country].map(field)]);
}

export function encodePodcastStart(id: string): Buffer {
  if (!/^[A-F0-9]{8}$/.test(id)) throw new Error("Invalid audio download identifier.");
  return Buffer.concat([Buffer.from([10]), Buffer.from(id), Buffer.from([2, 0, 0])]);
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
