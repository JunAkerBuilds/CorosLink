// The COROS mobile API as the official app speaks it, for Studio's sign-in and face catalogs. Pure pieces only (no
// state, no Electron), moved from CorosLink's electron/corosWatchfaceService.ts with its tests.
import { createCipheriv, createHash } from "node:crypto";
import type { CorosWatchfaceTheme } from "../../watchface/types";

export type CorosRegion = "eu" | "us" | "cn" | "sg";
export const COROS_REGIONS: readonly CorosRegion[] = ["us", "eu", "sg", "cn"];

// COROS accounts are region-bound: a mobile session is valid only on the host its account was registered on, and
// the wrong host answers "Account is not registered".
const MOBILE_API: Record<CorosRegion, string> = {
  eu: "https://apieu.coros.com/coros",
  us: "https://api.coros.com/coros",
  cn: "https://apicn.coros.com/coros",
  sg: "https://apisg.coros.com/coros",
};
export const MOBILE_HOSTS = Object.values(MOBILE_API).map((u) => new URL(u).hostname);

export const regionOf = (value: unknown): CorosRegion => (value === "eu" || value === "us" || value === "cn" || value === "sg" ? value : "us");
export const mobileBase = (region: CorosRegion) => MOBILE_API[region];

const APP_KEY = "3475792298363620";
const LOGIN_IV = "weloop3_2015_03#";
const VERSION_CODE = "407081000";
const APP_VERSION = 1125929972137984;
const USER_SETTING_SCOPE = "CAEQARgBIAEoATABOAFAAQ==";
export const API_SUCCESS = "0000";

const ASIA_PACIFIC = new Set(["IN", "BD", "LK", "NP", "PK", "SG", "MY", "TH", "ID", "PH", "VN", "KH", "MM", "LA", "BN"]);

/** The region the sign-in form starts on, from this computer's locale. */
export function suggestRegion(locale = Intl.DateTimeFormat().resolvedOptions().locale): CorosRegion {
  const country = locale.match(/[-_]([A-Z]{2})\b/)?.[1] ?? "";
  if (["CN", "HK", "MO", "TW"].includes(country)) return "cn";
  if (ASIA_PACIFIC.has(country)) return "sg";
  if (country && !["US", "CA", "MX"].includes(country)) return "eu";
  return "us";
}

/** The password as COROS keeps it: an MD5 digest. Only the digest is ever saved. */
export const hashCorosPassword = (password: string) => createHash("md5").update(password, "utf8").digest("hex");

/** The Android client obfuscates each login field before sending it: a compatibility detail of its client, not security. */
export function encryptMobileLoginField(value: string): string {
  const key = Buffer.from(APP_KEY, "utf8");
  const bytes = Buffer.from(value, "utf8");
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.from(LOGIN_IV, "utf8"));
  return Buffer.concat([cipher.update(bytes), cipher.final()]).toString("base64");
}

const MCC: Record<string, string> = { AU: "505", CA: "302", CN: "460", DE: "262", ES: "214", FR: "208", GB: "234", IT: "222", JP: "440", KR: "450", NZ: "530", US: "310" };

/** Android sends a serialised DomainRegion rather than a country code; same shape, from this computer's locale. */
export function buildMobileLoginRegion(options: { locale?: string; timeZone?: string } = {}): string {
  const locale = options.locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  const language = locale.match(/^[a-z]{2,3}/i)?.[0]?.toLowerCase() ?? "en";
  const country = locale.match(/[-_]([A-Z]{2})\b/)?.[1]?.toUpperCase() ?? "US";
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  return `DomainRegion(simMcc=${MCC[country] ?? "310"},countryCode=${country},timeZoneId=${timeZone},language=${language},countryIso=${country.toLowerCase()})`;
}

export function buildMobileLoginPayload(account: string, pwdHash: string, checkStatus: 0 | 1, region = buildMobileLoginRegion()): Record<string, string | number | boolean> {
  if (!/^[a-f0-9]{32}$/i.test(pwdHash)) throw new Error("COROS password digest is invalid.");
  return {
    account: encryptMobileLoginField(account), accountType: 2, appKey: APP_KEY, checkStatus, clientType: 1, hasHrCalibrated: 0, kbValidity: 0,
    // The Android client passes the MD5 digest through the field cipher.
    pwd: encryptMobileLoginField(pwdHash.toLowerCase()), region, skipValidation: false,
  };
}

/** The YFHeader. A large user ID stays a JSON number literal: JSON.stringify would round it. */
export function buildMobileYfHeader(installId: string, timezoneQuarterHours: number, userId?: string): string {
  const safeUserId = userId && /^\d+$/.test(userId) ? userId : "0";
  const prefix = JSON.stringify({
    appVersion: APP_VERSION, clientType: 1, language: "en-US", mobileName: installId, releaseType: 1,
    systemDisplayId: `c${createHash("sha256").update(installId).digest("hex")}`, systemVersion: "16", timezone: timezoneQuarterHours,
  });
  const suffix = JSON.stringify({ userSettingScope: USER_SETTING_SCOPE, versionCode: VERSION_CODE });
  return `${prefix.slice(0, -1)},"userId":${safeUserId},${suffix.slice(1)}`;
}

export function mobileHeaders(installId: string, accessToken?: string, userId?: string): Record<string, string> {
  return {
    Accept: "application/json, text/plain, */*",
    YFHeader: buildMobileYfHeader(installId, -Math.round(new Date().getTimezoneOffset() / 15), userId),
    "app-state": "foreground",
    "request-time": String(Date.now()),
    ...(accessToken ? { accesstoken: accessToken } : {}),
  };
}

export function extractDecimalProperty(raw: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw.match(new RegExp(`"${escaped}"\\s*:\\s*(\\d+)`))?.[1];
}

/** Keeps watch-face IDs as decimal text before JSON.parse rounds those above Number.MAX_SAFE_INTEGER. */
export function parseCorosMobileJson(raw: string): unknown {
  return JSON.parse(raw.replace(
    /("(?:watchFaceThemeId|watchFaceTemplateId|srcWatchFaceTemplateId|watchfaceId|gearId|userId)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,
    (_m, prefix: string, value: string) => `${prefix}"${value}"`,
  )) as unknown;
}

/** The first non-image HTTPS URL in a JSON envelope (some resource endpoints answer with one pointing at the file). */
export function findHttpsUrlInJson(text: string): string | undefined {
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return undefined; }
  const queue: unknown[] = [payload];
  for (let depth = 0; depth < 200 && queue.length; depth++) {
    const value = queue.shift();
    if (typeof value === "string") {
      try {
        const u = new URL(value);
        if (u.protocol === "https:" && !/\.(png|jpe?g|webp|gif)$/i.test(u.pathname)) return u.toString();
      } catch { /* not a URL */ }
    } else if (Array.isArray(value)) queue.push(...value);
    else if (value && typeof value === "object") queue.push(...Object.values(value));
  }
  return undefined;
}

// ───── Face catalogs ─────

/** Which COROS list: its editable templates, its official faces, or the faces this account saved. */
export type CorosCatalog = "editable" | "official" | "custom";

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
function readString(r: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}
function readHttps(r: Record<string, unknown>, keys: string[]): string | undefined {
  const v = readString(r, keys);
  if (!v) return undefined;
  try { const u = new URL(v); return u.protocol === "https:" ? u.toString() : undefined; } catch { return undefined; }
}
function readInteger(r: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isSafeInteger(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v) && Number.isSafeInteger(Number(v))) return Number(v);
  }
  return undefined;
}
function nestedHttps(r: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const n = record(r[k]);
    const u = n && readHttps(n, ["url", "fileUrl", "downloadUrl", "resourceUrl", "uri"]);
    if (u) return u;
  }
  return undefined;
}
function entriesIn(r: Record<string, unknown>, keys: string[]): unknown[] {
  const lists = keys.flatMap((k) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : []));
  if (lists.length) return lists;
  return Object.values(r).flatMap((v) => { const n = record(v); return n ? keys.flatMap((k) => (Array.isArray(n[k]) ? (n[k] as unknown[]) : [])) : []; });
}
function themeEntries(data: unknown, catalog: CorosCatalog): unknown[] {
  if (Array.isArray(data)) return data;
  const r = record(data);
  if (!r) return [];
  // `watchFaceTemplateList` is the account's own faces: never mixed into the official list.
  if (catalog === "custom") return entriesIn(r, ["watchFaceTemplateUserCustomList", "watchFaceTemplateList"]);
  // Official faces are grouped under watchFaceThemeList[*].watchFaceList.
  if (catalog === "official" && Array.isArray(r.watchFaceThemeList)) {
    return r.watchFaceThemeList.flatMap((t) => { const g = record(t); return g && Array.isArray(g.watchFaceList) ? (g.watchFaceList as unknown[]) : []; });
  }
  return entriesIn(r, ["watchFaceThemeDTOList", "watchFaceTemplateList", "watchFaceList", "themeList", "list", "records"]);
}
function faceId(r: Record<string, unknown>): string | undefined {
  // Official IDs are beyond Number.MAX_SAFE_INTEGER; watchFaceUrl carries the same decimal ID as text.
  return readHttps(r, ["watchFaceUrl"])?.match(/\/watchface\/resource\/(\d+)$/)?.[1]
    ?? readString(r, ["watchFaceThemeId", "watchFaceTemplateId", "watchfaceId", "id"]);
}

/** COROS's few answer shapes for its face lists, as one small read-only shape (CorosLink's normalizeCorosWatchfaceThemes). */
export function normalizeCorosWatchfaceThemes(data: unknown, catalog: CorosCatalog = "official"): CorosWatchfaceTheme[] {
  const seen = new Set<string>();
  const themes: CorosWatchfaceTheme[] = [];
  for (const entry of themeEntries(data, catalog)) {
    const r = record(entry);
    if (!r) continue;
    const id = faceId(r);
    const sourceTemplateId = readString(r, ["srcWatchFaceTemplateId", "sourceTemplateId"]);
    const name = readString(r, ["watchFaceThemeName", "watchFaceTemplateName", "watchFaceName", "name", "title"]);
    const previewImageUrl = readHttps(r, ["previewImageUrl", "watchFaceThemePreviewImageUrl", "watchFaceTemplatePreviewImageUrl", "watchFacePreviewImageUrl", "imageUrl", "coverUrl"]);
    const candidate = readHttps(r, [
      "watchFaceTemplateUrl", "watchFaceTemplateUserCustomUrl", "watchFaceTemplateUserCustomZipFileUrl", "watchFaceTemplateUserCustomZipUrl",
      "watchFaceTemplateZipUrl", "watchFaceUrl", "watchfaceUrl", "watchFaceFileUrl", "fileUrl", "zipUrl", "downloadUrl", "resourceUrl",
    ]) ?? nestedHttps(r, ["watchFaceTemplateUserCustomZipFile"]);
    const packageUrl = candidate && candidate !== previewImageUrl ? candidate : undefined;
    const key = id || `${name ?? ""}|${previewImageUrl ?? ""}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const firmwareType = readString(r, ["firmwareType", "watchFirmwareType"]);
    const backgroundImageId = readInteger(r, ["backgroundImageId"]);
    const watchFaceVersion = readInteger(r, ["watchFaceVersion", "watchfaceVersion", "version"]);
    const diyVersion = readInteger(r, ["diyVersion"]);
    const templateType = readInteger(r, ["watchFaceTemplateType"]);
    const category = readString(r, ["categoryName", "watchFaceCategoryName", "category", "styleName"]);
    themes.push({
      ...(id ? { id } : {}), ...(sourceTemplateId ? { sourceTemplateId } : {}),
      name: name || (id ? `COROS theme ${id}` : "Untitled COROS theme"),
      ...(previewImageUrl ? { previewImageUrl } : {}), ...(packageUrl ? { packageUrl } : {}), ...(firmwareType ? { firmwareType } : {}),
      ...(backgroundImageId !== undefined ? { backgroundImageId } : {}), ...(watchFaceVersion !== undefined ? { watchFaceVersion } : {}),
      ...(diyVersion !== undefined ? { diyVersion } : {}), ...(templateType !== undefined ? { templateType } : {}), ...(category ? { category } : {}),
    });
  }
  return themes;
}

/** The catalog request bodies COROS's app sends. Catalog endpoints take any non-empty snCode; a real serial isn't needed. */
export function themeListBody(catalog: CorosCatalog, accessToken: string, q: { firmwareType: string; language: string; maxWatchFaceVersion: number; snCode: string }): string {
  return JSON.stringify(catalog === "editable"
    ? { accessToken, firmwareType: q.firmwareType, language: q.language, maxWatchFaceVersion: q.maxWatchFaceVersion, page: 0, releaseType: 1, saveOrUpdate: 1, size: 1000, version: 2 }
    : { accessToken, firmwareType: q.firmwareType, language: q.language, maxWatchFaceVersion: q.maxWatchFaceVersion, orderType: 1, releaseType: 1, saveOrUpdate: 1, snCode: q.snCode || "x", version: 2 });
}

export const themeListEndpoint = (catalog: CorosCatalog) => (catalog === "editable" ? "/watchfaceTemplate/query" : "/watchface/getWatchFaceThemeList");
