import { randomBytes } from "node:crypto";
import tls from "node:tls";
import { WATCH_RELAY_CA } from "./corosWifiWatchCa";

const RELAY_HOST = "relay.coroslink.com";
const RELAY = `https://${RELAY_HOST}`;
export interface WifiAudioLookupInput { host: string; port: number; audioNonce: string; fileIds: string[] }
export interface WifiAudioLookup { prefix: string; token: string; close(): Promise<void> }

/** Check the relay with the W332's trust root before changing watch settings. */
export function checkWatchRelayCertificate(): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: RELAY_HOST, port: 443, servername: RELAY_HOST, ca: WATCH_RELAY_CA,
      rejectUnauthorized: true, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" });
    const timer = setTimeout(() => socket.destroy(new Error("Secure lookup connection timed out.")), 8000);
    socket.once("secureConnect", () => { clearTimeout(timer); socket.end(); resolve(); });
    socket.once("error", error => { clearTimeout(timer); socket.destroy(); reject(error); });
  });
}

/** Only IDs and a temporary LAN URL capability reach the relay; no audio bytes. */
export async function openWifiAudioLookup(input: WifiAudioLookupInput, taskId: string): Promise<WifiAudioLookup> {
  if (!/^[A-F0-9]{8}$/.test(taskId)) throw new Error("Invalid audio task.");
  const capability = randomBytes(8).toString("base64url").slice(0, 10);
  const token = randomBytes(16).toString("hex");
  const prefix = `${RELAY_HOST}/${capability}/`;
  if (Buffer.byteLength(prefix) > 31) throw new Error("The secure lookup address is too long for this watch.");
  try {
    await checkWatchRelayCertificate();
    const response = await fetch(`${RELAY}/v1/wifi-audio/lookups`, {
      method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
      body: JSON.stringify({ ...input, token: capability, taskId }), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Secure lookup setup failed (${response.status}).`);
    const result = await response.json() as { ok?: unknown };
    if (result.ok !== true) throw new Error("Secure lookup setup was not confirmed.");
  } catch (cause) {
    throw new Error(`Could not prepare the secure NetEase lookup. ${cause instanceof Error ? cause.message : "Try again."}`);
  }
  return { prefix, token, close: async () => {
    // The relay expires the capability even if this best-effort revoke fails.
    await fetch(`${RELAY}/v1/wifi-audio/lookups/revoke`, {
      method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
      body: JSON.stringify({ token: capability, taskId }), signal: AbortSignal.timeout(3000),
    }).then(() => undefined).catch(() => undefined);
  } };
}
