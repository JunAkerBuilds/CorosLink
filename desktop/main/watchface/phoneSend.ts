// Send to iPhone: serves one final watch-face archive on this computer's local network for the C-LINK iPhone app,
// and describes it in a link the phone scans as a QR code. The phone fetches the face, adds it to My Faces and
// installs it on the watch from there. Rewritten from CorosLink's watchfacePhoneSend.ts (docs/studio-port.md, phase 6).
//
// The link's query items match the iPhone app's FaceTransfer.swift, so they must not change:
//   a  comma-separated private IPv4 addresses, tried in order     h  SHA-256 of the archive, base64url
//   p  port                                                      s  archive size in bytes
//   k  token: 16 random bytes, base64url                         n  face name
//   w  the watch it was built for (a WATCHFACE_TARGETS model ID)
//
// The token keeps others on the network from fetching the face; the hash keeps them from swapping it, since the
// transfer is plain HTTP. One send at a time; the page polls `status()`.
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import os from "node:os";

export const PHONE_FACE_LINK_PREFIX = "coroslink://face/1";
/** How long a code stays live: long enough to find the phone, short enough not to leave a port open. */
export const PHONE_FACE_SEND_TTL_MS = 10 * 60_000;
/** The iPhone app refuses faces larger than this. */
export const PHONE_FACE_MAX_BYTES = 64 * 1024 * 1024;
const MAX_HOSTS = 4;
const MAX_NAME = 80;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

export interface PhoneFaceLinkFields {
  hosts: string[];
  port: number;
  token: string;
  sha256: Buffer;
  size: number;
  name?: string;
  model?: string;
}

export interface PhoneFaceSendInfo {
  /** `coroslink://face/1?…`, also drawn as the QR code. */
  link: string;
  qrDataUrl: string;
  name: string;
  size: number;
  hosts: string[];
  expiresAt: number;
}

export interface PhoneFaceSendStatus {
  active: boolean;
  /** A phone is downloading the face now. */
  sending: boolean;
  /** Finished downloads of the current code. */
  received: number;
  /** Which code this status is for. */
  expiresAt?: number;
}

/** Faces go only to private IPv4 addresses, the ones the iPhone app accepts. */
export const isPrivateIPv4 = (address: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(address);

/** This computer's private IPv4 addresses, Wi-Fi first. Virtual adapters (VMs, containers, VPNs) are left out: a phone can't reach them. */
export function phoneSendAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const found = Object.entries(interfaces).flatMap(([name, list]) => (list ?? [])
    .filter((entry) => !entry.internal && entry.family === "IPv4" && isPrivateIPv4(entry.address))
    .filter(() => !/docker|veth|vmnet|vbox|virbr|vethernet|utun|tun\d|tap\d|bridge|loopback/i.test(name))
    .map((entry) => ({ address: entry.address, rank: /^(en0|wi-?fi|wlan|wlp|wireless)/i.test(name) ? 0 : 1 })));
  found.sort((a, b) => a.rank - b.rank);
  return [...new Set(found.map((f) => f.address))].slice(0, MAX_HOSTS);
}

const cleanName = (name: string) => name.replace(CONTROL, "").trim().slice(0, MAX_NAME);

export function encodePhoneFaceLink(fields: PhoneFaceLinkFields): string {
  const name = fields.name ? cleanName(fields.name) : "";
  // encodeURIComponent, not URLSearchParams: "+" for a space would reach the phone as a plus.
  const items: [string, string][] = [
    ["a", fields.hosts.join(",")], ["p", String(fields.port)], ["k", fields.token],
    ["h", fields.sha256.toString("base64url")], ["s", String(fields.size)],
    ...(name ? [["n", name] as [string, string]] : []),
    ...(fields.model ? [["w", fields.model] as [string, string]] : []),
  ];
  return `${PHONE_FACE_LINK_PREFIX}?${items.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/** A QR code as a PNG data URL. The library loads on first use, off the app's start. */
export async function qrCodeDataUrl(text: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(text, { margin: 1, width: 360, errorCorrectionLevel: "M" });
}

export interface PhoneSendOptions {
  /** Where the phone may find this computer; this computer's own addresses by default. */
  hosts?: () => string[];
  ttlMs?: number;
  /** Called on every change, besides polling `status()`. */
  onStatus?: (status: PhoneFaceSendStatus) => void;
}

interface Active { server: http.Server; timer: NodeJS.Timeout; status: PhoneFaceSendStatus }

export class PhoneSend {
  private active: Active | null = null;
  private last: PhoneFaceSendStatus = { active: false, sending: false, received: 0 };

  constructor(private readonly options: PhoneSendOptions = {}) {}

  status(): PhoneFaceSendStatus {
    return { ...(this.active?.status ?? this.last) };
  }

  /** Serves `data` until it expires or `stop()`; a new send replaces the last. */
  async start(input: { data: Buffer; name: string; model?: string }): Promise<PhoneFaceSendInfo> {
    const { data } = input;
    if (!data.length) throw new Error("Build the watch face before sending it to your iPhone.");
    if (data.length > PHONE_FACE_MAX_BYTES) throw new Error("This watch face is larger than 64 MB, which C-LINK on iPhone can't receive.");
    const hosts = (this.options.hosts ?? phoneSendAddresses)();
    if (!hosts.length) throw new Error("This computer isn't on a local network. Join the same Wi-Fi as your iPhone, or your iPhone's Personal Hotspot, and try again.");
    this.stop();

    const token = randomBytes(16).toString("base64url");
    const sha256 = createHash("sha256").update(data).digest();
    const facePath = `/face/${token}`;
    const ttlMs = this.options.ttlMs ?? PHONE_FACE_SEND_TTL_MS;
    const expiresAt = Date.now() + ttlMs;
    const status: PhoneFaceSendStatus = { active: true, sending: false, received: 0, expiresAt };
    let downloading = 0;
    const changed = () => {
      status.sending = downloading > 0;
      if (this.active?.status === status) this.options.onStatus?.({ ...status });
    };

    const server = http.createServer((request, response) => {
      const method = request.method ?? "";
      if (request.url !== facePath || (method !== "GET" && method !== "HEAD")) {
        response.writeHead(404, { "Content-Type": "text/plain", Connection: "close" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": data.length, "Cache-Control": "no-store", Connection: "close" });
      if (method === "HEAD") { response.end(); return; }
      downloading++;
      changed();
      let finished = false;
      response.on("finish", () => { finished = true; });
      response.on("close", () => {
        downloading--;
        if (finished) status.received++;
        changed();
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
    const timer = setTimeout(() => this.stop(), ttlMs);
    // The send never keeps the app alive on quit.
    timer.unref();
    this.active = { server, timer, status };

    const name = cleanName(input.name) || "Custom watch face";
    const link = encodePhoneFaceLink({ hosts, port, token, sha256, size: data.length, name, model: input.model });
    return { link, qrDataUrl: await qrCodeDataUrl(link), name, size: data.length, hosts, expiresAt };
  }

  stop(): void {
    if (!this.active) return;
    const { server, timer, status } = this.active;
    this.active = null;
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
    this.last = { ...status, active: false, sending: false };
    this.options.onStatus?.({ ...this.last });
  }
}
