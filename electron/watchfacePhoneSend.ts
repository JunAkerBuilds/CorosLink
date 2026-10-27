import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import os from "node:os";
import type { WatchfacePhoneSend, WatchfacePhoneSendStatus } from "./watchfacePhoneSendTypes";
import { qrCodeDataUrl } from "./qrCode";

/**
 * Send to iPhone: serves one final watch-face archive on this computer's local
 * network for C-LINK, the iPhone app, and describes it in a link the phone scans
 * as a QR code. C-LINK fetches the face, adds it to My Faces and installs it on the
 * watch from there. Query items, matching C-LINK's `CorosKit/…/Transfer/FaceTransfer.swift`:
 *
 *   a  comma-separated IPv4 addresses (private ranges), tried in order
 *   p  port
 *   k  token: 16 random bytes, base64url
 *   h  SHA-256 of the archive, base64url
 *   s  archive size in bytes
 *   n  face name
 *   w  the watch it was built for (`WATCHFACE_TARGETS` model ID)
 *
 * The token keeps others on the network from fetching the face; the hash keeps
 * them from swapping it, since the transfer is plain HTTP. Works the same on
 * macOS, Windows and Linux; the phone and computer only need one network.
 */
export const PHONE_FACE_LINK_PREFIX = "coroslink://face/1";
/** How long a code stays live. Long enough to find the phone, short enough not to leave a port open. */
export const PHONE_FACE_SEND_TTL_MS = 10 * 60_000;
/** C-LINK refuses faces larger than this. */
export const PHONE_FACE_MAX_BYTES = 64 * 1024 * 1024;
const MAX_HOSTS = 4;
const MAX_NAME_LENGTH = 80;

export interface PhoneFaceLinkFields {
  hosts: string[];
  port: number;
  token: string;
  sha256: Buffer;
  size: number;
  name?: string;
  model?: string;
}

/** Faces go only to private IPv4 addresses, like the ones C-LINK accepts. */
export function isPrivateIPv4(address: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(address);
}

/**
 * This computer's private IPv4 addresses, Wi-Fi first. Virtual adapters (VMs,
 * containers, VPN tunnels) are left out: a phone could never reach them.
 */
export function phoneSendAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const candidates = Object.entries(interfaces).flatMap(([name, list]) => (list ?? [])
    .filter(entry => !entry.internal && entry.family === "IPv4" && isPrivateIPv4(entry.address))
    .filter(() => !/docker|veth|vmnet|vbox|virbr|vethernet|utun|tun\d|tap\d|bridge|loopback/i.test(name))
    .map(entry => ({ address: entry.address, rank: /^(en0|wi-?fi|wlan|wlp|wireless)/i.test(name) ? 0 : 1 })));
  candidates.sort((a, b) => a.rank - b.rank);
  return [...new Set(candidates.map(candidate => candidate.address))].slice(0, MAX_HOSTS);
}

export function encodePhoneFaceLink(fields: PhoneFaceLinkFields): string {
  const name = fields.name?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
  // encodeURIComponent, not URLSearchParams: "+" for a space would reach the phone as a plus.
  const items: Array<[string, string]> = [
    ["a", fields.hosts.join(",")],
    ["p", String(fields.port)],
    ["k", fields.token],
    ["h", fields.sha256.toString("base64url")],
    ["s", String(fields.size)],
    ...(name ? [["n", name] as [string, string]] : []),
    ...(fields.model ? [["w", fields.model] as [string, string]] : [])
  ];
  return `${PHONE_FACE_LINK_PREFIX}?${items.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}

interface ActiveSend {
  server: http.Server;
  timer: NodeJS.Timeout;
  status: WatchfacePhoneSendStatus;
  onStatus: (status: WatchfacePhoneSendStatus) => void;
}

// One code at a time; a new send replaces the last.
let active: ActiveSend | null = null;

export async function startWatchfacePhoneSend(
  input: { data: Buffer; name: string; model?: string },
  onStatus: (status: WatchfacePhoneSendStatus) => void = () => {},
  options: { hosts?: string[]; ttlMs?: number } = {}
): Promise<WatchfacePhoneSend> {
  const { data } = input;
  if (!data.length) throw new Error("Build the watch face before sending it to your iPhone.");
  if (data.length > PHONE_FACE_MAX_BYTES) throw new Error("This watch face is larger than 64 MB, which C-LINK can't receive.");
  const hosts = options.hosts ?? phoneSendAddresses();
  if (!hosts.length) {
    throw new Error("This computer isn't on a local network. Join the same Wi-Fi as your iPhone, or your iPhone's Personal Hotspot, and try again.");
  }
  stopWatchfacePhoneSend();

  const token = randomBytes(16).toString("base64url");
  const sha256 = createHash("sha256").update(data).digest();
  const facePath = `/face/${token}`;
  const ttlMs = options.ttlMs ?? PHONE_FACE_SEND_TTL_MS;
  const expiresAt = Date.now() + ttlMs;
  const status: WatchfacePhoneSendStatus = { active: true, sending: false, received: 0, expiresAt };
  let downloading = 0;
  const update = () => {
    status.sending = downloading > 0;
    if (active?.status === status) active.onStatus({ ...status });
  };

  const server = http.createServer((request, response) => {
    const method = request.method ?? "";
    if (request.url !== facePath || (method !== "GET" && method !== "HEAD")) {
      response.writeHead(404, { "Content-Type": "text/plain", "Connection": "close" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": data.length,
      "Cache-Control": "no-store",
      "Connection": "close"
    });
    if (method === "HEAD") { response.end(); return; }
    downloading++;
    update();
    let finished = false;
    response.on("finish", () => { finished = true; });
    response.on("close", () => {
      downloading--;
      if (finished) status.received++;
      update();
    });
    response.end(data);
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 30;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Every interface: the phone picks whichever listed address it can reach.
    server.listen(0, "0.0.0.0", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const timer = setTimeout(() => stopWatchfacePhoneSend(), ttlMs);
  // Don't let the send keep the app alive on quit.
  timer.unref?.();
  active = { server, timer, status, onStatus };

  const name = input.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH) || "Custom watch face";
  const link = encodePhoneFaceLink({ hosts, port, token, sha256, size: data.length, name, model: input.model });
  const qrDataUrl = await qrCodeDataUrl(link, { margin: 1, width: 360, errorCorrectionLevel: "M" });
  return { link, qrDataUrl, name, size: data.length, hosts, expiresAt };
}

export function stopWatchfacePhoneSend(): void {
  if (!active) return;
  const { server, timer, status, onStatus } = active;
  active = null;
  clearTimeout(timer);
  server.close();
  server.closeAllConnections();
  onStatus({ ...status, active: false, sending: false });
}
