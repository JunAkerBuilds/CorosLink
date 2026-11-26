// Uploading an activity file (.fit or .tcx) to the signed-in COROS account, the way training.coros.com's own
// "Import" does it. Ported from the desktop app (CorosLink electron/trainingHubService.ts uploadActivityFitToCoros,
// corosUploadConfig.ts, awsSigV4.ts, zipStore.ts):
//   1. temporary storage credentials from COROS's own web proxy, 2. the file, zipped, PUT to COROS's bucket,
//   3. POST activity/fit/import on Training Hub to register it.
// Requests go only to COROS's web origin for the region, to its bucket on amazonaws.com, and to Training Hub.
// Never run against the real COROS from this app yet: only against a mocked fetch.
import { createHash, createHmac } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { assertHubURL, dataOf, type HubSession } from "./client";
import { HubExpired, HubInvalid, HubNotWired, HubProblem } from "./errors";
import { at, text, type Json } from "./json";
import { msg, t } from "@/lib/i18n";

export type Bytes = Uint8Array<ArrayBuffer>;
type Fetch = typeof fetch;

const TIMEOUT_MS = 60_000;
export const MAX_ACTIVITY_FILE = 16 << 20;

// MARK: Zip (method 0, stored)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function joined(parts: readonly Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** A ZIP archive of `entries`, stored without compression. */
export function createStoreZip(entries: readonly { name: string; data: Uint8Array }[]): Bytes {
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data), size = entry.data.length;

    const head = new Uint8Array(30), h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true); // local file header
    h.setUint16(4, 20, true); // version needed
    h.setUint16(6, 0x0800, true); // UTF-8 file name
    h.setUint32(14, crc, true);
    h.setUint32(18, size, true);
    h.setUint32(22, size, true);
    h.setUint16(26, name.length, true);
    local.push(head, name, entry.data);

    const dir = new Uint8Array(46), d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true); // central directory entry
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, size, true);
    d.setUint32(24, size, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    central.push(dir, name);

    offset += head.length + name.length + size;
  }
  const files = joined(local), directory = joined(central);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); // end of central directory
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, directory.length, true);
  e.setUint32(16, files.length, true);
  return joined([files, directory, end]);
}

// MARK: AWS Signature Version 4

export interface SigV4 {
  method: string;
  url: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Header values to sign, by name. `x-amz-date` is added from `amzDate`. */
  signedHeaders: Record<string, string>;
  /** Hex SHA-256 of the body. */
  payloadHash: string;
  /** 20150830T123600Z */
  amzDate: string;
}

export const sha256Hex = (body: Uint8Array | string): string => createHash("sha256").update(body).digest("hex");
const hmac = (key: string | Uint8Array, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest();

const encodePath = (pathname: string): string =>
  pathname.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("/");

/** The `Authorization` header for a request. */
export function signRequest(params: SigV4): string {
  const url = new URL(params.url);
  const day = params.amzDate.slice(0, 8);
  const query = [...url.searchParams.entries()].map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const headers = Object.entries({ ...params.signedHeaders, "x-amz-date": params.amzDate })
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const names = headers.map(([k]) => k).join(";");
  const canonical = [params.method.toUpperCase(), encodePath(url.pathname || "/"), query, headers.map(([k, v]) => `${k}:${v}\n`).join(""), names, params.payloadHash].join("\n");
  const scope = `${day}/${params.region}/${params.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", params.amzDate, scope, sha256Hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${params.secretAccessKey}`, day), params.region), params.service), "aws4_request");
  return `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${scope}, SignedHeaders=${names}, Signature=${hmac(key, toSign).toString("hex")}`;
}

// MARK: COROS's storage credentials

/** Where each Training Hub region's web app hands out upload credentials, and the bucket it names. */
const STS: Readonly<Record<string, { webOrigin: string; bucket: string }>> = {
  "https://teamapi.coros.com": { webOrigin: "https://t.coros.com", bucket: "coros-s3" },
  "https://teameuapi.coros.com": { webOrigin: "https://trainingeu.coros.com", bucket: "eu-coros" },
};
const SALT = "9y78gpoERW4lBNYL";

export interface StsCredentials { Region: string; Bucket: string; AccessKeyId: string; SecretAccessKey: string; SessionToken: string }

/** The credentials request for a session's region; null for a region whose upload path isn't known. */
export function stsRequestURL(baseURL: string): URL | null {
  const region = STS[baseURL];
  if (!region) return null;
  const url = new URL(region.webOrigin + "/api/proxy/oss/sts");
  url.search = new URLSearchParams({ bucket: region.bucket, service: "aws", v: "2" }).toString();
  return url;
}

/** COROS sends the credentials as base64 JSON with a fixed salt appended. */
export function decodeStsCredentials(raw: string): StsCredentials {
  const base64 = raw.endsWith(SALT) ? raw.slice(0, -SALT.length) : raw.replace(SALT, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    throw new HubProblem(t("COROS's upload answer couldn't be read."));
  }
  const bag = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const { Region, Bucket, AccessKeyId, SecretAccessKey, SessionToken } = bag;
  const filled = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= 4096 && !/[\s\u0000-\u001f]/.test(value);
  if (!filled(Region) || !filled(Bucket) || !filled(AccessKeyId) || !filled(SecretAccessKey) || !filled(SessionToken)) throw new HubProblem(t("COROS's upload answer was incomplete."));
  // The bucket and region become a host name: only what a bucket and a region can be.
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(Bucket) || !/^[a-z]{2}(-[a-z]+)+-\d{1,2}$/.test(Region)) throw new HubProblem(t("COROS's upload answer named a place this app doesn't know."));
  return { Region, Bucket, AccessKeyId, SecretAccessKey, SessionToken };
}

// MARK: The upload

export interface ActivityFile {
  /** The file's name as COROS will see it, ending .fit or .tcx. */
  name: string;
  bytes: Uint8Array;
}

export interface UploadOptions {
  /** The person's offset from UTC in quarter hours (UTC+2 is 8), as COROS's own importer sends it. */
  timezone: number;
  fetchImpl?: Fetch;
  now?: Date;
}

async function send(fetchImpl: Fetch, url: URL, init: RequestInit, who: "COROS" | "storage"): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const late = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (who === "storage") {
      throw new HubProblem(late ? t("COROS's storage didn't answer in time. Check your connection and try again.")
        : t("COROS's storage couldn't be reached. Check your connection and try again."), "unreachable");
    }
    throw new HubProblem(late ? t("COROS didn't answer in time. Check your connection and try again.")
      : t("COROS couldn't be reached. Check your connection and try again."), "unreachable");
  }
}

async function jsonOf(response: Response): Promise<Json> {
  try {
    return (await response.json()) as Json;
  } catch {
    return null;
  }
}

/**
 * What an activity file really is, from its bytes: FIT (".FIT" at byte 8) or TCX (XML naming
 * TrainingCenterDatabase), unzipped first when it came gzipped. Anything else (GPX, an error page) is refused
 * here, because COROS would take it and then drop it without saying so.
 */
export function activityFileOf(raw: Uint8Array<ArrayBuffer>): { ext: "fit" | "tcx"; bytes: Uint8Array<ArrayBuffer> } {
  let bytes = raw;
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      const unzipped = gunzipSync(bytes, { maxOutputLength: MAX_ACTIVITY_FILE + 1 });
      bytes = new Uint8Array(unzipped.buffer.slice(unzipped.byteOffset, unzipped.byteOffset + unzipped.byteLength)) as Uint8Array<ArrayBuffer>;
    } catch {
      throw new HubInvalid(t("That file couldn't be unpacked, or is too large to send to COROS."));
    }
  }
  if (bytes.length >= 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54) return { ext: "fit", bytes };
  const head = new TextDecoder().decode(bytes.subarray(0, 2048)).replace(/^\uFEFF/, "").trimStart();
  if (head.startsWith("<") && head.includes("TrainingCenterDatabase")) return { ext: "tcx", bytes };
  throw new HubInvalid(t("This activity's file isn't FIT or TCX, so COROS can't take it."));
}

/** When COROS may have the activity already: sending it again could add it twice. */
export const MAYBE_SENT = msg("COROS didn't confirm the upload, but it may have the activity already. Check your COROS activities in a few minutes before sending it again.");

/**
 * Sends one activity file to the session's COROS account. Resolves to COROS's import ID ("" when it names
 * none). COROS reads the file afterwards, so the activity shows up a little later.
 */
export async function uploadActivityFile(session: HubSession, file: ActivityFile, options: UploadOptions): Promise<{ importId: string }> {
  const fetchImpl: Fetch = options.fetchImpl ?? ((...args) => fetch(...args));
  if (!/^[A-Za-z0-9_-]{1,80}\.(fit|tcx)$/.test(file.name)) throw new HubInvalid(t("Only .fit and .tcx files can be sent to COROS."));
  if (file.bytes.length === 0) throw new HubInvalid(t("That file is empty."));
  if (file.bytes.length > MAX_ACTIVITY_FILE) throw new HubInvalid(t("That file is too large to send to COROS."));
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(session.userId)) throw new HubProblem(t("COROS's sign-in didn't name your account in a way this app can use."));
  const importURL = new URL(session.baseURL + "/activity/fit/import");
  assertHubURL(importURL);
  const stsURL = stsRequestURL(session.baseURL);
  if (!stsURL) throw new HubNotWired(t("Sending activities to COROS is connected for the Global and Europe regions only. Your COROS account is in another region."));

  // 1. Temporary credentials for COROS's bucket, from its web app's own proxy (it takes the session as a cookie).
  const stsResponse = await send(fetchImpl, stsURL, { headers: { Cookie: `CPL-coros-token=${session.accessToken}`, Accept: "application/json, text/plain, */*" } }, "COROS");
  const stsBody = await jsonOf(stsResponse);
  if (stsResponse.status === 401 || at(stsBody, "code") === 401) throw new HubExpired();
  if (!stsResponse.ok) throw new HubProblem(t("COROS couldn't start the upload (HTTP {status}). Try again later.", { status: stsResponse.status }));
  const sealed = at(at(stsBody, "data"), "credentials");
  if (typeof sealed !== "string" || sealed === "") throw new HubProblem(t("COROS's upload answer was incomplete."));
  const sts = decodeStsCredentials(sealed);

  // 2. The file, zipped as <md5>/<name>, into the bucket.
  const md5 = createHash("md5").update(file.bytes).digest("hex");
  const zip = createStoreZip([{ name: `${md5}/${file.name}`, data: file.bytes }]);
  const objectKey = `fit_zip/${session.userId}/${md5}.zip`;
  const host = `${sts.Bucket}.s3.${sts.Region}.amazonaws.com`;
  const putURL = new URL(`https://${host}/${objectKey}`);
  const payloadHash = sha256Hex(zip);
  const amzDate = (options.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const authorization = signRequest({
    method: "PUT", url: putURL.href, region: sts.Region, service: "s3", accessKeyId: sts.AccessKeyId, secretAccessKey: sts.SecretAccessKey, payloadHash, amzDate,
    signedHeaders: { host, "x-amz-content-sha256": payloadHash, "x-amz-security-token": sts.SessionToken },
  });
  const put = await send(fetchImpl, putURL, {
    method: "PUT", body: zip,
    headers: { "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, "x-amz-security-token": sts.SessionToken, Authorization: authorization, "Content-Type": "application/zip" },
  }, "storage");
  if (!put.ok) throw new HubProblem(t("COROS's storage didn't take the file (HTTP {status}). Try again later.", { status: put.status }));

  // 3. Tell COROS the file is there.
  const form = new FormData();
  form.append("jsonParameter", JSON.stringify({
    source: 1, timezone: options.timezone, bucket: sts.Bucket, md5, size: zip.byteLength, object: objectKey, serviceName: "aws", oriFileName: file.name,
  }));
  // The file is already in COROS's bucket here: if this last step goes unanswered, COROS may still have taken
  // it, and sending it again would add the activity twice. Say so instead of "try again".
  let imported: Response;
  try {
    imported = await send(fetchImpl, importURL, {
      method: "POST", body: form,
      headers: { accesstoken: session.accessToken, yfheader: JSON.stringify({ userId: session.userId }), Accept: "application/json, text/plain, */*" },
    }, "COROS");
  } catch (error) {
    if (error instanceof HubProblem && error.kind === "unreachable") throw new HubProblem(t(MAYBE_SENT), "unreachable");
    throw error;
  }
  if (!imported.ok) throw new HubProblem(t("COROS couldn't take the activity (HTTP {status}). Try again later.", { status: imported.status }));
  const body = await jsonOf(imported);
  if (body === null) throw new HubProblem(t(MAYBE_SENT));
  // Like the desktop app: an answer without a result code counts as taken; only a code other than 0000 is a refusal.
  const data = text(at(body, "result")) === undefined && text(at(body, "apiCode")) === undefined ? at(body, "data") : dataOf(body, true);
  return { importId: text(at(data ?? null, "importId")) ?? "" };
}

/** The quarter-hour offset the browser sends with an upload: a whole number from UTC−12 to UTC+14. */
export function timezoneQuarters(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -48 || value > 56) throw new HubInvalid(t("The time zone isn't valid."));
  return value;
}
