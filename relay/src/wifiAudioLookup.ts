import type { RelayContext } from "./allocations";
import { RelayError, asObject, json, readJsonBody } from "./http";

// The prefix, including hostname and two slashes, must fit the watch's 31-byte field.
const TOKEN = /^[A-Za-z0-9_-]{10}$/u;
const ID = /^[A-F0-9]{8}$/u;
const NONCE = /^[a-f0-9]{32}$/u;
const TTL_MS = 35 * 60_000;
const MAX_ACTIVE = 20_000;
const MAX_ACTIVE_PER_CLIENT = 10;
const RATE_HOURLY = 40;
/** Files in one watch download task; matches the desktop app's WIFI_MUSIC_BATCH_FILES. */
const MAX_FILES = 100;

/** IPv4 as is; IPv6 by /64, since one host can rotate addresses within its prefix. */
export function clientNetwork(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/u, "")).join(":")}::/64`;
}

function privateIPv4(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some(part => !/^(?:0|[1-9]\d{0,2})$/u.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b !== undefined && b >= 16 && b <= 31);
}
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
async function key(token: string, taskId: string): Promise<string> { return digest(`${token}:${taskId}`); }
function identifiers(o: Record<string, unknown>): { token: string; taskId: string } {
  if (typeof o.token !== "string" || !TOKEN.test(o.token) || typeof o.taskId !== "string" || !ID.test(o.taskId)) throw new RelayError("invalid_request", "Invalid lookup identifier.");
  return { token: o.token, taskId: o.taskId };
}

export async function registerWifiAudioLookup(request: Request, ctx: RelayContext): Promise<Response> {
  const value = asObject((await readJsonBody(request)).value);
  const { token, taskId } = identifiers(value);
  const { host, port, audioNonce, fileIds } = value;
  if (!privateIPv4(host) || !Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535 ||
      typeof audioNonce !== "string" || !NONCE.test(audioNonce) || !Array.isArray(fileIds) || fileIds.length < 1 || fileIds.length > MAX_FILES ||
      fileIds.some(id => typeof id !== "string" || !ID.test(id)) || new Set(fileIds).size !== fileIds.length) {
    throw new RelayError("invalid_request", "Invalid audio lookup.");
  }
  const client = request.headers.get("CF-Connecting-IP");
  if (!client || client.length > 64) throw new RelayError("invalid_request", "Missing client address.");
  const network = clientNetwork(client), now = ctx.deps.now(), bucket = Math.floor(now / 3_600_000);
  const clientHash = await digest(`${bucket}:${network}`), activeHash = await digest(`active:${network}`);
  await ctx.db.prepare("DELETE FROM wifi_audio_lookups WHERE expires_at <= ?").bind(now).run();
  const rate = await ctx.db.prepare(`INSERT INTO wifi_audio_lookup_rate (client_hash,bucket,count) VALUES (?,?,1)
    ON CONFLICT(client_hash,bucket) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count`)
    .bind(clientHash, bucket, RATE_HOURLY).first<{ count: number }>();
  if (!rate) throw new RelayError("rate_limited", "Too many audio lookups. Try again later.");
  // Expired rows were deleted above, so these counts are of active lookups.
  const result = await ctx.db.prepare(`INSERT OR IGNORE INTO wifi_audio_lookups (key_hash,lan_host,lan_port,audio_nonce,file_ids,expires_at,client_hash)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM wifi_audio_lookups WHERE client_hash = ?) < ?
      AND (SELECT COUNT(*) FROM wifi_audio_lookups) < ?`)
    .bind(await key(token, taskId), host, port, audioNonce, JSON.stringify(fileIds), now + TTL_MS, activeHash,
      activeHash, MAX_ACTIVE_PER_CLIENT, MAX_ACTIVE).run();
  if (!result.meta.changes) throw new RelayError("rate_limited", "Audio lookups are temporarily unavailable. Try again later.");
  return json({ ok: true, expiresInSeconds: TTL_MS / 1000 });
}

export async function revokeWifiAudioLookup(request: Request, ctx: RelayContext): Promise<Response> {
  const { token, taskId } = identifiers(asObject((await readJsonBody(request)).value));
  await ctx.db.prepare("DELETE FROM wifi_audio_lookups WHERE key_hash = ?").bind(await key(token, taskId)).run();
  return json({ ok: true });
}

export async function renewWifiAudioUrl(request: Request, ctx: RelayContext, token: string): Promise<Response> {
  if (!TOKEN.test(token)) throw new RelayError("not_found", "Not found.");
  const body = asObject((await readJsonBody(request)).value);
  const taskId = body.task_id, fileId = body.file_id;
  if (typeof taskId !== "string" || !ID.test(taskId) || typeof fileId !== "string" || !ID.test(fileId)) throw new RelayError("not_found", "Not found.");
  const row = await ctx.db.prepare("SELECT lan_host,lan_port,audio_nonce,file_ids FROM wifi_audio_lookups WHERE key_hash = ? AND expires_at > ?")
    .bind(await key(token, taskId), ctx.deps.now()).first<{ lan_host: string; lan_port: number; audio_nonce: string; file_ids: string }>();
  if (!row || !privateIPv4(row.lan_host) || !Number.isInteger(row.lan_port) || row.lan_port < 1 || row.lan_port > 65535 || !NONCE.test(row.audio_nonce)) throw new RelayError("not_found", "Not found.");
  let files: unknown;
  try { files = JSON.parse(row.file_ids); } catch { throw new RelayError("not_found", "Not found."); }
  if (!Array.isArray(files) || !files.includes(fileId)) throw new RelayError("not_found", "Not found.");
  return json({ code: 0, data: { sub_code: 200, url: `http://${row.lan_host}:${row.lan_port}/audio/${row.audio_nonce}/${fileId}/${fileId}.mp3` } });
}

export async function purgeWifiAudioLookups(ctx: RelayContext): Promise<void> {
  const now = ctx.deps.now();
  await ctx.db.prepare("DELETE FROM wifi_audio_lookups WHERE expires_at <= ?").bind(now).run();
  await ctx.db.prepare("DELETE FROM wifi_audio_lookup_rate WHERE bucket < ?").bind(Math.floor(now / 3_600_000)).run();
}
