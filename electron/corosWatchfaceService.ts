import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, nativeImage, safeStorage } from "electron";
import QRCode from "qrcode";
import { deleteSettings, getSetting, setSetting } from "./database";
import {
  clearStoredCorosCredentials,
  getStoredCorosCredentials,
  hashCorosPassword,
  storeCorosCredentials
} from "./corosCredentialStore";
import { createStoreZip } from "./zipStore";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceArtwork,
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceConfigTextFile,
  CorosWatchfaceCreatorInput,
  CorosWatchfaceExistingShareInput,
  CorosWatchfacePublishInput,
  CorosWatchfaceProject,
  CorosWatchfaceProjectExportInput,
  CorosWatchfaceProjectSaveInput,
  CorosWatchfaceProjectSummary,
  CorosWatchfaceRegion,
  CorosWatchfaceResolutionDetails,
  CorosWatchfaceShareImport,
  CorosWatchfaceShareLink,
  CorosWatchfaceSpriteFile,
  CorosWatchfaceSpriteFolder,
  CorosWatchfaceStatus,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails,
  CorosWatchfaceTheme,
  CorosWatchfaceThemeCatalog,
  CorosWatchfaceThemeDownload,
  CorosWatchfaceThemeDownloadInput,
  CorosWatchfaceThemeListInput,
  CorosBatteryQueryInput,
  CorosBatteryReport,
  CorosBatteryUsageDetail,
  CorosBatteryUsageGroup,
  CorosBatteryDay,
  CorosPairedDevice,
  WatchModelId
} from "./types";

// COROS accounts are region-bound: a mobile session is only valid on the host
// its account was registered on. Hitting the wrong host returns "Account is not
// registered", so the region is chosen at login and persisted with the session.
const MOBILE_API_BASE_URLS: Record<CorosWatchfaceRegion, string> = {
  eu: "https://apieu.coros.com/coros",
  us: "https://api.coros.com/coros",
  cn: "https://apicn.coros.com/coros"
};
const MOBILE_API_HOSTNAMES: Record<CorosWatchfaceRegion, string> = {
  eu: "apieu.coros.com",
  us: "api.coros.com",
  cn: "apicn.coros.com"
};
const DEFAULT_WATCHFACE_REGION: CorosWatchfaceRegion = "us";
const COROS_CONFIG_DELETE_VALUE = "__COROSLINK_DELETE_CONFIG_KEY__";

function normalizeWatchfaceRegion(value: unknown): CorosWatchfaceRegion {
  return value === "eu" || value === "us" || value === "cn"
    ? value
    : DEFAULT_WATCHFACE_REGION;
}

function mobileApiBaseUrl(region: CorosWatchfaceRegion | undefined): string {
  return MOBILE_API_BASE_URLS[region ?? DEFAULT_WATCHFACE_REGION];
}

/** Best-guess region for the login form, from the Training Hub session or locale. */
function suggestWatchfaceRegion(): CorosWatchfaceRegion {
  const trainingHubBaseUrl = getSetting("trainingHub.baseUrl") ?? "";
  if (trainingHubBaseUrl.includes("teameuapi")) {
    return "eu";
  }
  if (trainingHubBaseUrl.includes("teamcnapi")) {
    return "cn";
  }
  if (trainingHubBaseUrl.includes("teamapi")) {
    return "us";
  }
  const country =
    Intl.DateTimeFormat().resolvedOptions().locale.match(/[-_]([A-Z]{2})\b/)?.[1] ?? "";
  if (["CN", "HK", "MO", "TW"].includes(country)) {
    return "cn";
  }
  if (country && !["US", "CA", "MX"].includes(country)) {
    return "eu";
  }
  return DEFAULT_WATCHFACE_REGION;
}
const MOBILE_APP_KEY = "3475792298363620";
const MOBILE_LOGIN_IV = "weloop3_2015_03#";
const MOBILE_VERSION_CODE = "407081000";
const MOBILE_APP_VERSION = 1125929972137984;
const MOBILE_USER_SETTING_SCOPE = "CAEQARgBIAEoATABOAFAAQ==";
const API_SUCCESS = "0000";
const MAX_OFFICIAL_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_INFO_BYTES = 1024 * 1024;
const MAX_SHARE_PAGE_BYTES = 1024 * 1024;
const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
const MAX_PROJECT_BYTES = 60 * 1024 * 1024;
const MAX_PROJECT_MANIFEST_BYTES = MAX_PROJECT_BYTES + 64 * 1024;
const MAX_PROJECT_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_PROJECT_PACKAGE_EXPANDED_BYTES = 130 * 1024 * 1024;
const MAX_PROJECT_PACKAGE_FILES = 100;
const MAX_ARCHIVE_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 1_000;
const MAX_ARCHIVE_ENTRY_BYTES = 5 * 1024 * 1024;
const CREATOR_CANVAS_SIZE = 800;
const MAX_SPRITE_REPLACEMENTS = 800;
const MAX_SPRITE_BYTES = 2 * 1024 * 1024;
const MAX_TEMPLATE_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_SPRITE_BYTES = 20 * 1024 * 1024;
const MAX_TEMPLATE_ASSET_REQUESTS = 800;
const MAX_CONFIG_OVERRIDE_FILES = 8;
const MAX_CONFIG_OVERRIDE_KEYS = 200;
const MAX_CONFIG_TEXT_REPLACEMENTS = 8;
const PROJECT_PREVIEW_FILE_NAME = "preview.png";
const CONFIG_TEXT_PATH_PATTERN = /^watchface_\d{3,4}x\d{3,4}\/(?:AOD)?config\.txt$/i;
const CONFIG_KEY_PATTERN = /^[a-z0-9_]{1,64}$/i;
const CREATED_STUDIO_SPRITE_PATTERN =
  /^watchface_(\d{3,4})x\1\/(?:studio\/[a-z0-9_-]{1,64}|cl_[a-z0-9_]{1,32}|weather)\/\d{2}\.png$/i;
const CREATOR_ARTWORK_ENTRY_PATTERN =
  /^(?:watchface_customize\.png|watchface_\d{3,4}x\d{3,4}\/(?:background|watchface_customize|thmb)\.png)$/i;
// Values stay on one printable-ASCII line, matching the firmware's own syntax.
const CONFIG_VALUE_PATTERN = /^[\x20-\x7e]{0,160}$/;

// A small country → mobile-country-code map keeps the Android DomainRegion
// shape sensible outside the default US locale. The API accepts the region
// object as a hint; account routing still happens server-side.
const MOBILE_COUNTRY_MCC: Record<string, string> = {
  AU: "505",
  CA: "302",
  CN: "460",
  DE: "262",
  ES: "214",
  FR: "208",
  GB: "234",
  IT: "222",
  JP: "440",
  KR: "450",
  NZ: "530",
  US: "310"
};

const SETTINGS = {
  installId: "watchfaces.mobileInstallId",
  session: "watchfaces.mobileSession"
} as const;

interface StoredMobileSession {
  accessToken: string;
  /** Kept as text because COROS user IDs exceed Number.MAX_SAFE_INTEGER. */
  userId?: string;
  /** Regional mobile host the session was created on. */
  region?: CorosWatchfaceRegion;
}

interface MobileApiEnvelope<T> {
  result?: string;
  apiCode?: string;
  message?: string;
  data?: T;
}

interface ArchiveInfo {
  o_template_id?: number | string;
  o_diy_version?: number | string;
  o_wf_ver?: number | string;
}

interface SelectedArchive extends CorosWatchfaceArchive {
  path: string;
  modifiedMs: number;
  resolutionDirectories: string[];
}

interface CorosLinkWatchfaceProjectManifest {
  format: "coroslink-watchface-project";
  version: 1;
  name: string;
  sourceTemplateId: string;
  firmwareType?: string;
  design: CorosWatchfaceProjectExportInput["design"];
}

interface CorosLinkWatchfaceProjectPackage {
  manifest: CorosLinkWatchfaceProjectManifest;
  starterArchive: Buffer;
  preview?: Buffer;
}

interface UnzipperFile {
  path: string;
  type: "Directory" | "File" | string;
  size?: number;
  uncompressedSize?: number;
  buffer: () => Promise<Buffer>;
}

interface UnzipperModule {
  Open: {
    file: (zipPath: string) => Promise<{ files: UnzipperFile[] }>;
  };
}

const selectedArchives = new Map<string, SelectedArchive>();
// Package URLs seen in the most recent source-template catalog. Downloads are
// limited to these so the renderer can never request an arbitrary URL.
const knownThemePackageUrls = new Set<string>();
let inMemorySession: StoredMobileSession | null = null;

/**
 * The Android client obfuscates each login field before sending it. This is a
 * compatibility detail of its public app client, not a substitute for TLS.
 */
export function encryptMobileLoginField(value: string): string {
  const key = Buffer.from(MOBILE_APP_KEY, "utf8");
  const clear = Buffer.from(value, "utf8");
  const obfuscated = Buffer.from(clear);

  for (let index = 0; index < obfuscated.length; index += 1) {
    obfuscated[index] ^= key[index % key.length]!;
  }

  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    key,
    Buffer.from(MOBILE_LOGIN_IV, "utf8")
  );
  return Buffer.concat([cipher.update(obfuscated), cipher.final()]).toString(
    "base64"
  );
}

export function getCorosWatchfaceStatus(): CorosWatchfaceStatus {
  const session = readStoredSession();
  const credentials = getStoredCorosCredentials();
  return {
    authenticated: Boolean(session),
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    savedCredentialsAvailable: Boolean(credentials),
    savedEmail: credentials?.account,
    region: session?.region,
    suggestedRegion: session?.region ?? suggestWatchfaceRegion()
  };
}

export async function loginCorosWatchfaces(
  email: string,
  password: string,
  region?: CorosWatchfaceRegion,
  remember = false
): Promise<CorosWatchfaceStatus> {
  const account = email.trim();
  if (!account || !password) {
    throw new Error("Enter your COROS email and password.");
  }
  const pwdHash = hashCorosPassword(password);
  await establishCorosWatchfaceSession(account, pwdHash, region);

  if (remember) {
    storeCorosCredentials(account, pwdHash);
  } else {
    clearStoredCorosCredentials();
  }

  return getCorosWatchfaceStatus();
}

export async function loginCorosWatchfacesWithSavedCredentials(
  region?: CorosWatchfaceRegion
): Promise<CorosWatchfaceStatus> {
  const credentials = getStoredCorosCredentials();
  if (!credentials) {
    throw new Error(
      "No saved COROS credentials are available. Enter your email and password first."
    );
  }
  return establishCorosWatchfaceSession(
    credentials.account,
    credentials.pwdHash,
    region
  );
}

async function establishCorosWatchfaceSession(
  account: string,
  pwdHash: string,
  region?: CorosWatchfaceRegion
): Promise<CorosWatchfaceStatus> {
  const resolvedRegion = normalizeWatchfaceRegion(region);
  const baseUrl = mobileApiBaseUrl(resolvedRegion);

  let envelope = await mobileRequest<{ accessToken?: string }>(
    "/user/login",
    {
      method: "POST",
      baseUrl,
      body: JSON.stringify(buildMobileLoginPayload(account, pwdHash, 1)),
      allowedResultCodes: ["1115"]
    }
  );

  // `1115 / User logged in` is the mobile client's session-conflict checkpoint.
  // Retrying with checkStatus=0 is the app's own completion step and returns the
  // normal token-bearing 0000 response.
  if (mobileApiResult(envelope) === "1115") {
    envelope = await mobileRequest<{ accessToken?: string }>("/user/login", {
      method: "POST",
      baseUrl,
      body: JSON.stringify(buildMobileLoginPayload(account, pwdHash, 0))
    });
  }

  const accessToken = envelope.data?.accessToken?.trim();
  if (!accessToken) {
    throw new Error("COROS login did not return a session token.");
  }

  writeStoredSession({
    accessToken,
    userId: extractDecimalProperty(envelope.raw, "userId"),
    region: resolvedRegion
  });
  return getCorosWatchfaceStatus();
}

export function logoutCorosWatchfaces(): CorosWatchfaceStatus {
  inMemorySession = null;
  deleteSettings([SETTINGS.session]);
  return getCorosWatchfaceStatus();
}

/** Lists editable source templates, official on-watch faces, or the user's custom faces. */
export async function listCorosWatchfaceThemes(
  input: CorosWatchfaceThemeListInput
): Promise<CorosWatchfaceTheme[]> {
  const session = requireSession();
  const firmwareType = input?.firmwareType?.trim();
  if (!firmwareType) {
    throw new Error("Enter the COROS firmware type to browse templates.");
  }
  const maxWatchFaceVersion = input.maxWatchFaceVersion ?? 5;
  if (
    !Number.isSafeInteger(maxWatchFaceVersion) ||
    maxWatchFaceVersion < 0 ||
    maxWatchFaceVersion > 999
  ) {
    throw new Error("Maximum watchface version must be a whole number from 0 to 999.");
  }

  const catalog: CorosWatchfaceThemeCatalog =
    input.catalog === "official" || input.catalog === "custom"
      ? input.catalog
      : "editable";
  // Catalog endpoints accept any non-empty snCode; a real serial is not required.
  const snCode =
    input.snCode?.trim() ||
    (catalog === "official" || catalog === "custom" ? "x" : "");
  const modelVersion = input.modelVersion?.trim() ?? "";
  if (snCode.length > 80 || /[\u0000-\u001f\u007f]/.test(snCode)) {
    throw new Error("Enter a valid watch serial number.");
  }
  if (modelVersion.length > 120 || /[\u0000-\u001f\u007f]/.test(modelVersion)) {
    throw new Error("Enter a valid model version.");
  }

  const themes = await mobileRequest<unknown>(
    catalog === "editable"
      ? "/watchfaceTemplate/query"
      : "/watchface/getWatchFaceThemeList",
    {
      method: "POST",
      accessToken: session.accessToken,
      userId: session.userId,
      ...(catalog !== "editable" && modelVersion
        ? { extraHeaders: { "x-model-version": modelVersion } }
        : {}),
      body: JSON.stringify(
        catalog !== "editable"
          ? {
              accessToken: session.accessToken,
              firmwareType,
              language: normalizeLanguage(input.language),
              maxWatchFaceVersion,
              orderType: 1,
              releaseType: 1,
              saveOrUpdate: 1,
              snCode,
              version: 2
            }
          : {
              accessToken: session.accessToken,
              firmwareType,
              language: normalizeLanguage(input.language),
              maxWatchFaceVersion,
              page: 0,
              releaseType: 1,
              saveOrUpdate: 1,
              size: 1000,
              version: 2
            }
      )
    }
  );

  const normalized = normalizeCorosWatchfaceThemes(themes.data, catalog);
  for (const theme of normalized) {
    if (theme.packageUrl) {
      knownThemePackageUrls.add(theme.packageUrl);
    }
  }
  return normalized;
}

/**
 * Downloads an official source-template package and validates it as a DIY
 * starter. Only URLs returned by the catalog in this session may be fetched.
 */
export async function downloadCorosWatchfaceTheme(
  input: CorosWatchfaceThemeDownloadInput
): Promise<CorosWatchfaceThemeDownload> {
  const session = requireSession();
  const packageUrl = typeof input?.packageUrl === "string" ? input.packageUrl : "";
  const firmwareType = normalizeOptionalFirmwareType(input?.firmwareType);
  if (!knownThemePackageUrls.has(packageUrl)) {
    throw new Error("Load the template catalog first, then choose a listed template.");
  }

  // The mobile client also carries the token as a query parameter; some
  // resource endpoints ignore the header alone.
  const first = await fetchThemeResource(
    withAccessTokenParam(packageUrl, session),
    session
  );
  let bytes = first.bytes;
  let contentType = first.contentType;

  // Some resource endpoints answer with a JSON envelope that points at the
  // real file. Follow exactly one server-provided HTTPS hop.
  if (looksLikeJson(bytes)) {
    const nestedUrl = findHttpsUrlInJson(stripUtf8Bom(bytes).toString("utf8"));
    if (nestedUrl) {
      const second = await fetchThemeResource(nestedUrl, session);
      bytes = second.bytes;
      contentType = second.contentType;
    }
  }

  // Package CDNs sometimes serve the archive gzip-wrapped.
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = require("node:zlib").gunzipSync(bytes) as Buffer;
    } catch {
      // Leave the original bytes for the diagnostic below.
    }
  }

  const safeName = (input.name ?? "COROS watchface")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "")
    .trim()
    .slice(0, 60) || "COROS watchface";
  const outputDirectory = path.join(app.getPath("downloads"), "COROS watchfaces");
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  const uniqueName = `${safeName}-${crypto.randomUUID().slice(0, 8)}`;

  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    // Keep the raw payload so the unknown format can be analyzed offline.
    const rawPath = path.join(outputDirectory, `${uniqueName}.bin`);
    await fs.promises.writeFile(rawPath, bytes);
    return {
      fileName: `${safeName} (raw response)`,
      sizeBytes: bytes.length,
      usableAsTemplate: false,
      savedPath: rawPath,
      message: `COROS answered with ${describeUnknownPayload(bytes, contentType)}. A raw copy was saved to ${rawPath} for analysis.`
    };
  }

  const outputPath = path.join(outputDirectory, `${uniqueName}.zip`);
  await fs.promises.writeFile(outputPath, bytes);

  try {
    const inspected = await inspectArchive(outputPath);
    const selected: SelectedArchive = {
      ...inspected,
      fileName: `${safeName}.dat`,
      ...(firmwareType ? { firmwareType } : {})
    };
    selectedArchives.set(selected.archiveId, selected);
    return {
      fileName: selected.fileName,
      sizeBytes: selected.sizeBytes,
      usableAsTemplate: true,
      archive: toPublicArchive(selected),
      savedPath: outputPath,
      message: `Downloaded ${safeName} to ${outputPath} and validated it as a starter template.`
    };
  } catch (inspectionError) {
    const directory = await openTemplateArchive(outputPath);
    const entries = directory.files
      .filter((entry) => entry.type === "File")
      .map((entry) => entry.path)
      .sort()
      .slice(0, 40);
    return {
      fileName: `${safeName}.dat`,
      sizeBytes: bytes.length,
      usableAsTemplate: false,
      entries,
      savedPath: outputPath,
      message:
        inspectionError instanceof Error
          ? `Downloaded a ZIP package to ${outputPath}, but it is not a DIY starter: ${inspectionError.message}`
          : `Downloaded a ZIP package to ${outputPath}, but it is not a DIY starter template.`
    };
  }
}

async function fetchThemeResource(
  url: string,
  session: StoredMobileSession
): Promise<{ bytes: Buffer; contentType: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Template packages may only be fetched over HTTPS.");
  }
  const response = await fetch(url, {
    headers: mobileHeaders(session.accessToken, session.userId)
  });
  if (!response.ok) {
    throw new Error(`The template package request failed (HTTP ${response.status}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_OFFICIAL_ARCHIVE_BYTES) {
    throw new Error("The template package must be between 1 byte and 25 MB.");
  }
  return {
    bytes,
    contentType: response.headers.get("content-type") ?? "unknown"
  };
}

function withAccessTokenParam(url: string, session: StoredMobileSession): string {
  const parsed = new URL(url);
  const regionalHosts = Object.values(MOBILE_API_HOSTNAMES);
  if (
    regionalHosts.includes(parsed.hostname) &&
    !parsed.searchParams.has("accessToken")
  ) {
    parsed.searchParams.set("accessToken", session.accessToken);
  }
  return parsed.toString();
}

function stripUtf8Bom(bytes: Buffer): Buffer {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? bytes.subarray(3)
    : bytes;
}

function looksLikeJson(bytes: Buffer): boolean {
  const body = stripUtf8Bom(bytes);
  for (let index = 0; index < Math.min(body.length, 64); index += 1) {
    const byte = body[index]!;
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      continue;
    }
    return byte === 0x7b || byte === 0x5b;
  }
  return false;
}

/** A short, safe summary of a payload we could not use, for the UI notice. */
function describeUnknownPayload(bytes: Buffer, contentType: string): string {
  const head = bytes.subarray(0, 8).toString("hex");
  const printable = bytes
    .subarray(0, 60)
    .toString("latin1")
    .replace(/[^\x20-\x7e]/g, ".");
  // "614A" (bytes reversed to "A416") is COROS's compiled on-watch watchface
  // binary: a layout table of element records plus encoded bitmap blobs. It is
  // read-only firmware content, not the DIY ZIP the creator and upload use.
  const isCompiledFace = bytes.length >= 4 && bytes.subarray(0, 4).toString("latin1") === "614A";
  const kind = isCompiledFace
    ? "COROS's compiled on-watch watchface format (not an editable DIY template)"
    : printable.trimStart().startsWith("<")
      ? "an HTML page (likely an auth or error page)"
      : looksLikeJson(bytes)
        ? "JSON metadata without a package link"
        : "an unrecognized binary format";
  return `${kind} — ${bytes.length} bytes, content-type ${contentType}, first bytes ${head}, preview "${printable}"`;
}

export function findHttpsUrlInJson(text: string): string | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return undefined;
  }
  const queue: unknown[] = [payload];
  for (let depth = 0; depth < 200 && queue.length > 0; depth += 1) {
    const value = queue.shift();
    if (typeof value === "string") {
      try {
        const url = new URL(value);
        if (url.protocol === "https:" && !/\.(png|jpe?g|webp|gif)$/i.test(url.pathname)) {
          return url.toString();
        }
      } catch {
        // Not a URL; keep scanning.
      }
    } else if (Array.isArray(value)) {
      queue.push(...value);
    } else if (value && typeof value === "object") {
      queue.push(...Object.values(value));
    }
  }
  return undefined;
}

interface ParsedCorosWatchfaceSharePage {
  packageUrl: string;
  name: string;
  firmwareType?: string;
}

function normalizeCorosWatchfaceShareUrl(value: string): URL {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("Paste a valid COROS watch-face share link.");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Paste a valid COROS watch-face share link.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "faq.coros.com" ||
    url.pathname.replace(/\/$/, "") !== "/share/watchface" ||
    !/^\d{1,20}$/.test(url.searchParams.get("id") ?? "") ||
    url.searchParams.get("type") !== "2"
  ) {
    throw new Error("Use an official https://faq.coros.com/share/watchface link for a custom watch face.");
  }
  return url;
}

/** Extracts the downloadable DIY archive metadata embedded in a COROS share page. */
export function parseCorosWatchfaceSharePage(
  html: string
): ParsedCorosWatchfaceSharePage {
  const stateMatch = html.match(
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/
  );
  if (!stateMatch) {
    throw new Error("COROS did not return readable watch-face share data.");
  }

  let state: Record<string, unknown> | null = null;
  try {
    state = asRecord(JSON.parse(stateMatch[1]!));
  } catch {
    // Use the same user-facing error as a missing state block.
  }
  const apiData = state ? asRecord(state.apiData) : null;
  const apiEnvelope = apiData ? asRecord(apiData.data) : null;
  const payload = apiEnvelope ? asRecord(apiEnvelope.data) : null;
  const template = payload ? asRecord(payload.watchFaceTemplateUserCustom) : null;
  const pageData = state ? asRecord(state.pageData) : null;
  if (!template || pageData?.isExpired === true) {
    throw new Error(
      pageData?.isExpired === true
        ? "This COROS watch-face share link has expired."
        : "COROS did not include an editable watch-face archive in this share link."
    );
  }

  const packageUrl = readHttpsUrl(template, ["watchFaceTemplateUrl"]);
  if (!packageUrl) {
    throw new Error("COROS did not include an editable watch-face archive in this share link.");
  }
  const parsedPackageUrl = new URL(packageUrl);
  if (!/^s3[a-z0-9-]*\.coros\.com$/i.test(parsedPackageUrl.hostname)) {
    throw new Error("The watch-face package is not hosted by COROS.");
  }

  const rawName = readString(template, ["watchFaceTemplateName"]) ?? "COROS watch face";
  const name =
    rawName
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "")
      .trim()
      .slice(0, 60) || "COROS watch face";
  const firmwareType = readString(template, ["firmwareType"]);
  return {
    packageUrl: parsedPackageUrl.toString(),
    name,
    ...(firmwareType ? { firmwareType } : {})
  };
}

/** Downloads an official public share link and registers its ZIP for Studio. */
export async function importCorosWatchfaceShareLink(
  shareUrl: string
): Promise<CorosWatchfaceShareImport> {
  const url = normalizeCorosWatchfaceShareUrl(shareUrl);
  const pageResponse = await fetch(url, {
    headers: { accept: "text/html,application/xhtml+xml" }
  });
  if (!pageResponse.ok) {
    throw new Error(`The COROS share page request failed (HTTP ${pageResponse.status}).`);
  }
  const pageBytes = Buffer.from(await pageResponse.arrayBuffer());
  if (pageBytes.length === 0 || pageBytes.length > MAX_SHARE_PAGE_BYTES) {
    throw new Error("The COROS share page response was empty or unexpectedly large.");
  }
  const shared = parseCorosWatchfaceSharePage(pageBytes.toString("utf8"));

  const packageResponse = await fetch(shared.packageUrl, {
    headers: { accept: "application/zip,application/octet-stream" }
  });
  if (!packageResponse.ok) {
    throw new Error(`The COROS watch-face download failed (HTTP ${packageResponse.status}).`);
  }
  const bytes = Buffer.from(await packageResponse.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_OFFICIAL_ARCHIVE_BYTES) {
    throw new Error("The COROS watch-face archive must be between 1 byte and 25 MB.");
  }
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("COROS did not return a ZIP watch-face archive.");
  }

  const outputDirectory = path.join(app.getPath("userData"), "watchface-share-imports");
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${crypto.randomUUID()}.zip`);
  await fs.promises.writeFile(outputPath, bytes);

  try {
    const inspected = await inspectArchive(outputPath);
    const selected: SelectedArchive = {
      ...inspected,
      fileName: `${shared.name}.zip`,
      ...(shared.firmwareType ? { firmwareType: shared.firmwareType } : {})
    };
    selectedArchives.set(selected.archiveId, selected);
    return {
      archive: toPublicArchive(selected),
      name: shared.name,
      ...(shared.firmwareType ? { firmwareType: shared.firmwareType } : {})
    };
  } catch (caught) {
    await fs.promises.rm(outputPath, { force: true });
    throw caught;
  }
}

/**
 * Reads COROS's battery-consumption history for a user-supplied paired watch.
 * The device identifiers are deliberately not persisted by CorosLink.
 */
export async function getCorosBatteryReport(
  input: CorosBatteryQueryInput
): Promise<CorosBatteryReport> {
  const session = requireSession();
  const deviceId = normalizeCorosDeviceIdentifier(input?.deviceId, "Device ID");
  const uuid = normalizeCorosDeviceIdentifier(input?.uuid, "Watch UUID");
  const firmwareType = input?.firmwareType?.trim();
  if (!firmwareType || firmwareType.length > 120 || /[\u0000-\u001f\u007f]/.test(firmwareType)) {
    throw new Error("Enter a valid COROS firmware type.");
  }

  const response = await mobileRequest<unknown>("/device/battery/query", {
    method: "POST",
    accessToken: session.accessToken,
    includeAccessTokenInQuery: false,
    userId: session.userId,
    body: JSON.stringify({ deviceId, firmwareType, uuid })
  });
  return normalizeCorosBatteryReport(response.data);
}

/** Lists paired watches from the authenticated account's mobile profile. */
export async function listCorosPairedDevices(): Promise<CorosPairedDevice[]> {
  const session = requireSession();
  const response = await mobileRequest<unknown>("/user/profile", {
    method: "POST",
    accessToken: session.accessToken,
    userId: session.userId,
    // The captured app request includes a local calibration sync blob. It is
    // not needed to read the account's deviceParamList and is never stored.
    body: JSON.stringify({ clientType: 1 })
  });
  return normalizeCorosPairedDevices(response.data);
}

/**
 * Validate the selected package before it can be published. The opaque ID
 * deliberately prevents the renderer from asking the main process to upload
 * an arbitrary local file path.
 */
export async function selectCorosWatchfaceArchive(
  archivePath: string
): Promise<CorosWatchfaceArchive> {
  const editablePackage = await readCorosWatchfaceProjectPackage(archivePath);
  if (!editablePackage) {
    const selected = await inspectArchive(archivePath);
    selectedArchives.set(selected.archiveId, selected);
    return toPublicArchive(selected);
  }

  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(app.getPath("temp"), "coroslink-watchface-")
  );
  const starterPath = path.join(temporaryDirectory, "starter.dat");
  await fs.promises.writeFile(starterPath, editablePackage.starterArchive);
  let inspected: SelectedArchive;
  try {
    inspected = await inspectArchive(starterPath);
  } catch (caught) {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    throw caught;
  }
  if (inspected.sourceTemplateId !== editablePackage.manifest.sourceTemplateId) {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error("The editable project does not match its bundled starter template.");
  }
  const selected: SelectedArchive = {
    ...inspected,
    fileName: path.basename(archivePath),
    ...(editablePackage.manifest.firmwareType
      ? { firmwareType: editablePackage.manifest.firmwareType }
      : {}),
    editableProject: {
      name: editablePackage.manifest.name,
      design: editablePackage.manifest.design
    }
  };
  selectedArchives.set(selected.archiveId, selected);
  return toPublicArchive(selected);
}

/**
 * Build a portable project ZIP for website distribution. The original starter
 * is kept separate from the design state so importing and exporting again does
 * not apply layout changes twice.
 */
export async function exportCorosWatchfaceProject(
  input: CorosWatchfaceProjectExportInput,
  destinationPath: string
): Promise<void> {
  if (!input || typeof input.sourceArchiveId !== "string") {
    throw new Error("Choose a starter template before exporting the project.");
  }
  const source = requireSelectedArchive(input.sourceArchiveId);
  const verified = await inspectArchive(source.path, source.archiveId);
  if (verified.modifiedMs !== source.modifiedMs) {
    throw new Error(
      "The starter template changed. Open the project again before exporting."
    );
  }
  const name = sanitizeProjectName(input.name);
  validateProjectDesign(input.design);
  const firmwareType =
    normalizeOptionalFirmwareType(input.firmwareType) ?? source.firmwareType;
  const preview = decodePortableProjectPreview(input.previewDataUrl);
  const manifest: CorosLinkWatchfaceProjectManifest = {
    format: "coroslink-watchface-project",
    version: 1,
    name,
    sourceTemplateId: verified.sourceTemplateId,
    ...(firmwareType ? { firmwareType } : {}),
    design: input.design
  };
  const projectZip = createStoreZip([
    {
      name: "coroslink-project.json",
      data: Buffer.from(JSON.stringify(manifest), "utf8")
    },
    { name: "starter.dat", data: await fs.promises.readFile(source.path) },
    { name: "preview.png", data: preview }
  ]);
  if (projectZip.byteLength > MAX_PROJECT_PACKAGE_BYTES) {
    throw new Error("The editable watch-face package is too large to export.");
  }
  await fs.promises.writeFile(destinationPath, projectZip);
}

export async function readCorosWatchfaceProjectPackage(
  packagePath: string
): Promise<CorosLinkWatchfaceProjectPackage | null> {
  const stat = await fs.promises.stat(packagePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PROJECT_PACKAGE_BYTES) {
    throw new Error("The editable watch-face package must be smaller than 100 MB.");
  }
  const directory = await openTemplateArchive(packagePath);
  validateArchiveInventory(
    directory.files,
    MAX_PROJECT_PACKAGE_FILES,
    MAX_PROJECT_PACKAGE_EXPANDED_BYTES,
    MAX_PROJECT_PACKAGE_BYTES,
    8,
    "editable watch-face package"
  );
  const files = directory.files.filter(
    (entry) => entry.type === "File" && !entry.path.startsWith("__MACOSX/")
  );
  const manifestEntries = files.filter((entry) =>
    /^(?:[^/]+\/)?(?:coroslink-project|project)\.json$/i.test(entry.path)
  );
  if (manifestEntries.length > 1) {
    throw new Error(
      "The editable watch-face package contains multiple project manifests."
    );
  }
  const manifestEntry = manifestEntries[0];
  if (!manifestEntry) return null;
  // Finder's Compress action commonly wraps selected project files in one
  // enclosing folder. Resolve the remaining required entries relative to the
  // manifest so these otherwise valid packages import like root-level exports.
  const packagePrefix = manifestEntry.path.slice(
    0,
    -"coroslink-project.json".length
  );
  const datEntries = files.filter((entry) => {
    const relativePath = entry.path.slice(packagePrefix.length);
    return (
      entry.path.startsWith(packagePrefix) &&
      !relativePath.includes("/") &&
      /^[^/\\\u0000-\u001f\u007f]{1,100}\.dat$/i.test(relativePath)
    );
  });
  if (datEntries.length !== 1) {
    throw new Error("The editable watch-face package must contain exactly one DAT archive.");
  }
  const resolvedStarterEntry = datEntries[0]!;
  const previewEntry = files.find(
    (entry) => entry.path === `${packagePrefix}preview.png`
  );
  assertPackageEntrySize(
    manifestEntry,
    MAX_PROJECT_MANIFEST_BYTES,
    "project manifest"
  );
  assertPackageEntrySize(
    resolvedStarterEntry,
    MAX_ARCHIVE_BYTES,
    "starter archive"
  );
  if (previewEntry) {
    assertPackageEntrySize(previewEntry, MAX_ARTWORK_BYTES, "preview image");
  }

  let manifest: CorosLinkWatchfaceProjectManifest;
  try {
    manifest = JSON.parse(
      (await manifestEntry.buffer()).toString("utf8")
    ) as CorosLinkWatchfaceProjectManifest;
  } catch {
    throw new Error("The editable watch-face project manifest is not valid JSON.");
  }
  if (
    manifest.format !== "coroslink-watchface-project" ||
    manifest.version !== 1 ||
    typeof manifest.name !== "string" ||
    typeof manifest.sourceTemplateId !== "string" ||
    !/^\d{1,20}$/.test(manifest.sourceTemplateId)
  ) {
    throw new Error("This is not a supported CorosLink watch-face project.");
  }
  const normalizedFirmwareType = normalizeOptionalFirmwareType(
    manifest.firmwareType
  );
  const { firmwareType: _firmwareType, ...manifestWithoutFirmwareType } = manifest;
  manifest = {
    ...manifestWithoutFirmwareType,
    name: sanitizeProjectName(manifest.name),
    ...(normalizedFirmwareType ? { firmwareType: normalizedFirmwareType } : {})
  };
  validateProjectDesign(manifest.design);
  const starterArchive = await resolvedStarterEntry.buffer();
  const preview = previewEntry ? await previewEntry.buffer() : undefined;
  if (starterArchive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("The editable watch-face starter archive is too large.");
  }
  if (preview && preview.byteLength > MAX_ARTWORK_BYTES) {
    throw new Error("The editable watch-face preview is too large.");
  }
  if (preview) {
    assertPngBytes(preview, "The editable watch-face preview is not a PNG image.");
  }
  return { manifest, starterArchive, ...(preview ? { preview } : {}) };
}

function assertPackageEntrySize(
  entry: UnzipperFile,
  maximum: number,
  label: string
): void {
  const size = entry.uncompressedSize ?? entry.size;
  if (!Number.isFinite(size) || !size || size < 1 || size > maximum) {
    throw new Error(`The editable watch-face ${label} has an invalid size.`);
  }
}

function decodePortableProjectPreview(dataUrl: string): Buffer {
  const prefix = "data:image/png;base64,";
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix)) {
    throw new Error("The editable watch-face preview must be a PNG image.");
  }
  const encoded = dataUrl.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("The editable watch-face preview is not valid base64 data.");
  }
  const preview = Buffer.from(encoded, "base64");
  if (preview.byteLength === 0 || preview.byteLength > MAX_ARTWORK_BYTES) {
    throw new Error("The editable watch-face preview must be smaller than 10 MB.");
  }
  assertPngBytes(preview, "The editable watch-face preview is not a PNG image.");
  return preview;
}

function assertPngBytes(bytes: Buffer, message: string): void {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.byteLength < pngSignature.byteLength || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error(message);
  }
}

interface StoredWatchfaceProject {
  projectId: string;
  name: string;
  updatedAt: string;
  /** Decimal text; older saves stored a number and are migrated on read. */
  sourceTemplateId: string;
  firmwareType?: string;
  design: CorosWatchfaceProjectSaveInput["design"];
}

function watchfaceProjectsDirectory(): string {
  return path.join(app.getPath("userData"), "watchface-projects");
}

function encodeProjectPreviewDataUrl(preview: Buffer): string {
  return `data:image/png;base64,${preview.toString("base64")}`;
}

async function readStoredProjectPreview(
  projectDirectory: string
): Promise<string | undefined> {
  try {
    const previewPath = path.join(projectDirectory, PROJECT_PREVIEW_FILE_NAME);
    const stat = await fs.promises.stat(previewPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARTWORK_BYTES) {
      return undefined;
    }
    const preview = await fs.promises.readFile(previewPath);
    assertPngBytes(preview, "The saved watchface preview is not a PNG image.");
    return encodeProjectPreviewDataUrl(preview);
  } catch {
    // A missing or damaged thumbnail must never make the underlying project
    // unavailable. The renderer can rebuild and replace it on demand.
    return undefined;
  }
}

async function writeStoredProjectPreview(
  projectDirectory: string,
  preview: Buffer
): Promise<void> {
  const previewPath = path.join(projectDirectory, PROJECT_PREVIEW_FILE_NAME);
  const temporaryPreview = `${previewPath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPreview, preview);
    await fs.promises.rename(temporaryPreview, previewPath);
  } finally {
    await fs.promises.rm(temporaryPreview, { force: true }).catch(() => undefined);
  }
}

function validateProjectId(value: string | undefined): string {
  if (value === undefined) {
    return crypto.randomUUID();
  }
  if (!/^[a-f0-9-]{36}$/i.test(value)) {
    throw new Error("The saved watchface project ID is invalid.");
  }
  return value;
}

function validateProjectDesign(
  design: CorosWatchfaceProjectSaveInput["design"]
): string {
  if (!design || typeof design !== "object" || design.version !== 1) {
    throw new Error("The watchface project design is invalid.");
  }
  const encoded = JSON.stringify(design);
  if (Buffer.byteLength(encoded, "utf8") > MAX_PROJECT_BYTES) {
    throw new Error("The watchface project is too large to save.");
  }
  return encoded;
}

function sanitizeProjectName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name || name.length > 80) {
    throw new Error("Project names must contain between 1 and 80 characters.");
  }
  return name;
}

export function createDuplicateProjectName(
  sourceName: string,
  existingNames: Iterable<string>
): string {
  const sanitizedSourceName = sanitizeProjectName(sourceName);
  const copyMatch = sanitizedSourceName.match(
    /^(.*?)\s+copy(?:\s+(\d+))?$/i
  );
  const rootName = copyMatch?.[1]?.trim() || sanitizedSourceName;
  const sourceCopyNumber = copyMatch?.[2] ? Number(copyMatch[2]) : 1;
  const firstCopyNumber = copyMatch
    ? Number.isSafeInteger(sourceCopyNumber) &&
      sourceCopyNumber < Number.MAX_SAFE_INTEGER
      ? sourceCopyNumber + 1
      : 2
    : 1;
  const occupiedNames = new Set(
    Array.from(existingNames, (name) => name.trim().toLowerCase())
  );

  for (let copyNumber = firstCopyNumber; ; copyNumber += 1) {
    const suffix = copyNumber === 1 ? " copy" : ` copy ${copyNumber}`;
    const truncatedRoot = rootName
      .slice(0, Math.max(1, 80 - suffix.length))
      .trimEnd();
    const candidate = `${truncatedRoot}${suffix}`;
    if (!occupiedNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

async function readStoredWatchfaceProject(
  projectId: string
): Promise<StoredWatchfaceProject> {
  const id = validateProjectId(projectId);
  const manifestPath = path.join(watchfaceProjectsDirectory(), id, "project.json");
  const stat = await fs.promises.stat(manifestPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PROJECT_BYTES) {
    throw new Error("The saved watchface project is unreadable.");
  }
  const parsed = JSON.parse(
    await fs.promises.readFile(manifestPath, "utf8")
  ) as Omit<StoredWatchfaceProject, "sourceTemplateId"> & {
    sourceTemplateId: string | number;
  };
  // Migrate pre-string saves; large IDs must already be stored as text.
  const sourceTemplateId =
    typeof parsed.sourceTemplateId === "number" &&
    Number.isSafeInteger(parsed.sourceTemplateId)
      ? String(parsed.sourceTemplateId)
      : parsed.sourceTemplateId;
  if (
    parsed.projectId !== id ||
    typeof parsed.name !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    typeof sourceTemplateId !== "string" ||
    !/^\d{1,20}$/.test(sourceTemplateId) ||
    !parsed.design ||
    parsed.design.version !== 1
  ) {
    throw new Error("The saved watchface project metadata is invalid.");
  }
  const firmwareType = normalizeOptionalFirmwareType(parsed.firmwareType);
  return {
    ...parsed,
    sourceTemplateId,
    ...(firmwareType ? { firmwareType } : {})
  };
}

export async function saveCorosWatchfaceProject(
  input: CorosWatchfaceProjectSaveInput
): Promise<CorosWatchfaceProject> {
  if (!input || typeof input.sourceArchiveId !== "string") {
    throw new Error("Choose a starter template before saving the project.");
  }
  const source = requireSelectedArchive(input.sourceArchiveId);
  const projectId = validateProjectId(input.projectId);
  const name = sanitizeProjectName(input.name);
  validateProjectDesign(input.design);
  const preview = input.previewDataUrl
    ? decodePortableProjectPreview(input.previewDataUrl)
    : undefined;
  const projectDirectory = path.join(watchfaceProjectsDirectory(), projectId);
  const templatePath = path.join(projectDirectory, "starter.dat");
  const manifestPath = path.join(projectDirectory, "project.json");
  await fs.promises.mkdir(projectDirectory, { recursive: true });
  if (path.resolve(source.path) !== path.resolve(templatePath)) {
    const temporaryTemplate = `${templatePath}.tmp`;
    await fs.promises.copyFile(source.path, temporaryTemplate);
    await fs.promises.rename(temporaryTemplate, templatePath);
  }
  const updatedAt = new Date().toISOString();
  const projectFirmwareType =
    normalizeOptionalFirmwareType(input.firmwareType) ?? source.firmwareType;
  const stored: StoredWatchfaceProject = {
    projectId,
    name,
    updatedAt,
    sourceTemplateId: source.sourceTemplateId,
    ...(projectFirmwareType ? { firmwareType: projectFirmwareType } : {}),
    design: input.design
  };
  const temporaryManifest = `${manifestPath}.tmp`;
  if (preview) {
    await writeStoredProjectPreview(projectDirectory, preview);
  }
  await fs.promises.writeFile(temporaryManifest, JSON.stringify(stored), "utf8");
  await fs.promises.rename(temporaryManifest, manifestPath);
  if (!preview) {
    await fs.promises.rm(
      path.join(projectDirectory, PROJECT_PREVIEW_FILE_NAME),
      { force: true }
    );
  }
  const selected = {
    ...(await inspectArchive(templatePath)),
    ...(stored.firmwareType ? { firmwareType: stored.firmwareType } : {})
  };
  selectedArchives.set(selected.archiveId, selected);
  return {
    ...stored,
    ...(preview ? { previewDataUrl: encodeProjectPreviewDataUrl(preview) } : {}),
    archive: toPublicArchive(selected)
  };
}

export async function listCorosWatchfaceProjects(): Promise<
  CorosWatchfaceProjectSummary[]
> {
  const directory = watchfaceProjectsDirectory();
  await fs.promises.mkdir(directory, { recursive: true });
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          const stored = await readStoredWatchfaceProject(entry.name);
          const previewDataUrl = await readStoredProjectPreview(
            path.join(directory, stored.projectId)
          );
          const { design: _design, ...summary } = stored;
          return {
            ...summary,
            ...(previewDataUrl ? { previewDataUrl } : {})
          };
        } catch {
          return null;
        }
      })
  );
  return projects
    .filter((project): project is CorosWatchfaceProjectSummary => Boolean(project))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadCorosWatchfaceProject(
  projectId: string
): Promise<CorosWatchfaceProject> {
  const stored = await readStoredWatchfaceProject(projectId);
  const projectDirectory = path.join(
    watchfaceProjectsDirectory(),
    stored.projectId
  );
  const previewDataUrlPromise = readStoredProjectPreview(projectDirectory);
  const primaryTemplatePath = path.join(projectDirectory, "starter.dat");
  const legacyTemplatePath = path.join(projectDirectory, "starter.zip");
  const templatePath = (await pathIsFile(primaryTemplatePath))
    ? primaryTemplatePath
    : (await pathIsFile(legacyTemplatePath))
      ? legacyTemplatePath
      : primaryTemplatePath;
  await normalizeNestedProjectStarter(templatePath);
  const selected = {
    ...(await inspectArchive(templatePath)),
    ...(stored.firmwareType ? { firmwareType: stored.firmwareType } : {})
  };
  selectedArchives.set(selected.archiveId, selected);
  const previewDataUrl = await previewDataUrlPromise;
  return {
    ...stored,
    ...(previewDataUrl ? { previewDataUrl } : {}),
    archive: toPublicArchive(selected)
  };
}

export async function cacheCorosWatchfaceProjectPreview(
  projectId: string,
  previewDataUrl: string
): Promise<void> {
  const id = validateProjectId(projectId);
  const projectDirectory = path.join(watchfaceProjectsDirectory(), id);
  if (!(await pathIsFile(path.join(projectDirectory, "project.json")))) {
    throw new Error("The saved watchface project does not exist.");
  }
  await writeStoredProjectPreview(
    projectDirectory,
    decodePortableProjectPreview(previewDataUrl)
  );
}

export async function duplicateCorosWatchfaceProject(
  projectId: string
): Promise<CorosWatchfaceProject> {
  const sourceProject = await loadCorosWatchfaceProject(projectId);
  const existingProjects = await listCorosWatchfaceProjects();
  return saveCorosWatchfaceProject({
    name: createDuplicateProjectName(
      sourceProject.name,
      existingProjects.map((project) => project.name)
    ),
    sourceArchiveId: sourceProject.archive.archiveId,
    ...(sourceProject.firmwareType
      ? { firmwareType: sourceProject.firmwareType }
      : {}),
    design: structuredClone(sourceProject.design),
    ...(sourceProject.previewDataUrl
      ? { previewDataUrl: sourceProject.previewDataUrl }
      : {})
  });
}

async function pathIsFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw caught;
  }
}

/**
 * Finder commonly wraps an edited archive in one enclosing folder and adds
 * __MACOSX/.DS_Store entries. COROS requires info.json and the resolution
 * folders at the ZIP root, so repair that unambiguous shape on project load.
 */
async function normalizeNestedProjectStarter(templatePath: string): Promise<void> {
  const directory = await openTemplateArchive(templatePath);
  const files = directory.files.filter((entry) => entry.type === "File");
  if (files.some((entry) => entry.path === "info.json")) {
    return;
  }
  const manifestCandidates = files.filter(
    (entry) =>
      /^[^/]+\/info\.json$/i.test(entry.path) &&
      !entry.path.startsWith("__MACOSX/")
  );
  if (manifestCandidates.length !== 1) {
    return;
  }
  const prefix = manifestCandidates[0]!.path.slice(0, -"info.json".length);
  const nestedFiles = files.filter(
    (entry) =>
      entry.path.startsWith(prefix) &&
      !entry.path.includes("/__MACOSX/") &&
      !/(^|\/)\.DS_Store$/i.test(entry.path)
  );
  const normalized = await Promise.all(
    nestedFiles.map(async (entry) => ({
      name: entry.path.slice(prefix.length),
      data: await entry.buffer()
    }))
  );
  if (
    !normalized.some((entry) => entry.name === "info.json") ||
    !normalized.some((entry) => /^watchface_\d+x\d+\/config\.txt$/i.test(entry.name))
  ) {
    return;
  }
  const backupPath = `${templatePath}.nested-backup`;
  try {
    await fs.promises.access(backupPath);
  } catch {
    await fs.promises.copyFile(templatePath, backupPath);
  }
  const temporaryPath = `${templatePath}.normalize.tmp`;
  await fs.promises.writeFile(temporaryPath, createStoreZip(normalized));
  await fs.promises.rename(temporaryPath, templatePath);
}

export async function deleteCorosWatchfaceProject(
  projectId: string
): Promise<void> {
  const id = validateProjectId(projectId);
  await fs.promises.rm(path.join(watchfaceProjectsDirectory(), id), {
    recursive: true,
    force: true
  });
}

function artworkMimeType(bytes: Buffer): string {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

/**
 * Import a user-selected image as an editor asset. It stays renderer-visible
 * only as a data URL; the original path never crosses the IPC bridge.
 *
 * The original bytes are shipped untouched: Chromium's color-managed decoder
 * honors any embedded ICC profile, while a nativeImage re-encode strips it
 * and leaves wide-gamut (Display P3) artwork looking darker than the source.
 * Oversized images are downscaled by the renderer after that correct decode.
 */
export async function loadCorosWatchfaceArtwork(
  artworkPath: string
): Promise<CorosWatchfaceArtwork> {
  const stat = await fs.promises.stat(artworkPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARTWORK_BYTES) {
    throw new Error("Choose an image smaller than 10 MB.");
  }

  const image = nativeImage.createFromPath(artworkPath);
  if (image.isEmpty()) {
    throw new Error("That image could not be opened.");
  }
  const bytes = await fs.promises.readFile(artworkPath);
  const mimeType = artworkMimeType(bytes);
  if (mimeType === "application/octet-stream") {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  const size = image.getSize();
  return {
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    width: size.width,
    height: size.height
  };
}

/**
 * Builds a new uploadable archive from the source template. Dynamic controls
 * remain firmware-backed; the renderer supplies a composed root image so the
 * COROS share/install preview matches the face instead of showing only artwork.
 */
export async function createCorosWatchfaceArchive(
  input: CorosWatchfaceCreatorInput
): Promise<CorosWatchfaceArchive> {
  if (!input || typeof input.sourceArchiveId !== "string") {
    throw new Error("Choose a starter template before creating a watchface.");
  }
  const source = selectedArchives.get(input.sourceArchiveId);
  if (!source) {
    throw new Error("The starter template is no longer available. Choose it again.");
  }
  const verifiedSource = {
    ...(await inspectArchive(source.path, source.archiveId)),
    ...(source.firmwareType ? { firmwareType: source.firmwareType } : {})
  };
  if (verifiedSource.modifiedMs !== source.modifiedMs) {
    selectedArchives.set(verifiedSource.archiveId, verifiedSource);
    throw new Error("The starter template changed. Choose it again before creating.");
  }

  const requestedFirmwareType = normalizeOptionalFirmwareType(input.firmwareType);
  if (
    requestedFirmwareType &&
    source.firmwareType &&
    requestedFirmwareType.toUpperCase() !== source.firmwareType.toUpperCase()
  ) {
    throw new Error(
      `This starter template was selected for ${source.firmwareType}, not ${requestedFirmwareType}. Browse templates again for the connected watch.`
    );
  }
  const firmwareType = requestedFirmwareType ?? source.firmwareType;
  assertFirmwareResolutionCompatibility(
    verifiedSource.resolutionDirectories,
    firmwareType,
    input.watchModel
  );

  const background = renderCreatorBackground(input.backgroundDataUrl);
  const preview = input.previewDataUrl
    ? renderCreatorBackground(input.previewDataUrl, "preview")
    : background;
  const replacements = new Map<string, Buffer>();
  const sprites = decodeSpriteReplacements(input.assetReplacements);
  const configOverrides = validateConfigOverrides(input.configOverrides);
  const configTextReplacements = validateConfigTextReplacements(
    input.configTextReplacements
  );
  const minimumWatchFaceVersion = validateOptionalWatchFaceVersion(
    input.minWatchFaceVersion,
    "Minimum watch-face version"
  );
  const watchFaceVersion = validateOptionalWatchFaceVersion(
    input.watchFaceVersion,
    "Archive watch-face version"
  );
  const templateIdOverride =
    input.templateIdOverride === undefined
      ? undefined
      : String(input.templateIdOverride).trim();
  const watchfaceIdOverride =
    input.watchfaceIdOverride === undefined
      ? undefined
      : normalizeWatchfaceIdOverride(String(input.watchfaceIdOverride));
  const templateNameOverride =
    input.templateNameOverride === undefined
      ? undefined
      : String(input.templateNameOverride).trim();
  if (
    templateIdOverride !== undefined &&
    (!/^\d{1,20}$/.test(templateIdOverride) || /^0+$/.test(templateIdOverride))
  ) {
    throw new Error("Template ID overrides must contain 1–20 decimal digits.");
  }
  if (
    templateNameOverride !== undefined &&
    (templateNameOverride.length === 0 || templateNameOverride.length > 64)
  ) {
    throw new Error("Template name overrides must contain 1–64 characters.");
  }
  if (
    watchFaceVersion !== undefined &&
    minimumWatchFaceVersion !== undefined &&
    watchFaceVersion < minimumWatchFaceVersion
  ) {
    throw new Error(
      `Archive watch-face version ${watchFaceVersion} is too low for the selected features; use version ${minimumWatchFaceVersion} or newer.`
    );
  }
  const zip = await rewriteTemplateArchive(
    verifiedSource.path,
    replacements,
    background,
    preview,
    sprites,
    configOverrides,
    minimumWatchFaceVersion,
    watchFaceVersion,
    templateIdOverride,
    templateNameOverride,
    watchfaceIdOverride,
    configTextReplacements,
    input.stripBlankConfigKeys === true
  );
  const outputDirectory = path.join(app.getPath("userData"), "watchface-archives");
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${crypto.randomUUID()}.dat`);
  await fs.promises.writeFile(outputPath, zip);

  const generated = await inspectArchive(outputPath);
  const selected: SelectedArchive = {
    ...generated,
    fileName: "CorosLink custom face.dat",
    ...(firmwareType ? { firmwareType } : {})
  };
  selectedArchives.set(selected.archiveId, selected);
  return toPublicArchive(selected);
}

/** Saves an already composed final watch-face archive without publishing it. */
export async function exportCorosWatchfaceArchive(
  archiveId: string,
  destinationPath: string
): Promise<void> {
  const archive = requireSelectedArchive(archiveId);
  const freshArchive = await inspectArchive(archive.path, archive.archiveId);
  if (freshArchive.modifiedMs !== archive.modifiedMs) {
    selectedArchives.set(freshArchive.archiveId, freshArchive);
    throw new Error("The generated watch-face archive changed before export.");
  }
  await fs.promises.copyFile(archive.path, destinationPath);
}

/**
 * Describes everything the renderer's studio needs to restyle a template:
 * the per-resolution layout configs plus the bitmap-font sprite folders and
 * icon files (with exact pixel sizes) that replacements must match.
 */
export async function describeCorosWatchfaceTemplate(
  archiveId: string
): Promise<CorosWatchfaceTemplateDetails> {
  const source = requireSelectedArchive(archiveId);
  const directory = await openTemplateArchive(source.path);
  const files = directory.files.filter((entry) => entry.type === "File");
  const filesByPath = new Map(files.map((entry) => [entry.path, entry] as const));

  const resolutionNames = [
    ...new Set(
      files
        .map((entry) => entry.path.match(/^(watchface_(\d+)x(\d+))\//)?.[1])
        .filter((name): name is string => Boolean(name))
    )
  ];
  if (resolutionNames.length === 0) {
    throw new Error("This template does not contain any watchface resolution folders.");
  }

  const resolutions: CorosWatchfaceResolutionDetails[] = [];
  for (const directoryName of resolutionNames) {
    const dims = directoryName.match(/_(\d+)x(\d+)$/)!;
    const config = await readTemplateConfig(filesByPath, `${directoryName}/config.txt`);
    const aodConfig = await readTemplateConfig(filesByPath, `${directoryName}/AODconfig.txt`);
    resolutions.push({
      directory: directoryName,
      width: Number(dims[1]),
      height: Number(dims[2]),
      config,
      aodConfig,
      ...(await discoverSpriteAssets(files, directoryName, [config, aodConfig]))
    });
  }

  return { archiveId: source.archiveId, resolutions };
}

/**
 * Returns the raw UTF-8 bodies of every config.txt / AODconfig.txt in the
 * selected template so Studio can offer a direct text editor.
 */
export async function loadCorosWatchfaceTemplateConfigTexts(
  archiveId: string
): Promise<CorosWatchfaceConfigTextFile[]> {
  const source = requireSelectedArchive(archiveId);
  const directory = await openTemplateArchive(source.path);
  const files = directory.files
    .filter(
      (entry) =>
        entry.type === "File" &&
        CONFIG_TEXT_PATH_PATTERN.test(entry.path.replace(/^\.\//, ""))
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const texts: CorosWatchfaceConfigTextFile[] = [];
  for (const entry of files) {
    const size = entry.size ?? entry.uncompressedSize ?? 0;
    if (size <= 0 || size > MAX_INFO_BYTES) {
      throw new Error(`The template config at ${entry.path} is unreadable.`);
    }
    texts.push({
      path: entry.path.replace(/^\.\//, ""),
      text: (await entry.buffer()).toString("utf8")
    });
  }
  return texts;
}

/**
 * Exports template PNGs to the renderer so it can tint or preview them. Only
 * entries of the already-validated selected archive can be requested.
 */
export async function loadCorosWatchfaceTemplateAssets(
  archiveId: string,
  paths: string[]
): Promise<CorosWatchfaceTemplateAsset[]> {
  const source = requireSelectedArchive(archiveId);
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("Request at least one template image.");
  }
  if (paths.length > MAX_TEMPLATE_ASSET_REQUESTS) {
    throw new Error("Too many template images were requested at once.");
  }

  const directory = await openTemplateArchive(source.path);
  const filesByPath = new Map(
    directory.files
      .filter((entry) => entry.type === "File")
      .map((entry) => [entry.path, entry] as const)
  );

  const assets: CorosWatchfaceTemplateAsset[] = [];
  for (const assetPath of new Set(paths)) {
    if (typeof assetPath !== "string" || !assetPath.toLowerCase().endsWith(".png")) {
      throw new Error("Template images must be PNG entries of the archive.");
    }
    const entry = filesByPath.get(assetPath);
    if (!entry) {
      throw new Error("The template does not contain one of the requested images.");
    }
    const data = await entry.buffer();
    if (data.length > MAX_TEMPLATE_ASSET_BYTES) {
      throw new Error("A requested template image is unexpectedly large.");
    }
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) {
      throw new Error(`The template image ${assetPath} could not be decoded.`);
    }
    const { width, height } = image.getSize();
    assets.push({ path: assetPath, dataUrl: image.toDataURL(), width, height });
  }
  return assets;
}

/**
 * Parses the firmware's INI-style layout files: `[key]=value` lines with
 * `//` and `#` comment lines. Values keep their original firmware syntax.
 */
export function parseCorosWatchfaceConfig(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*=\s*(.*?)\s*$/);
    if (match) {
      entries[match[1]!] = match[2]!;
    }
  }
  return entries;
}

/**
 * Rewrites `[key]=value` lines in a firmware config file, preserving every
 * other byte (comments, ordering, CRLF). Confirmed optional firmware keys may
 * be appended when a template omits their empty declarations. Every other
 * missing key remains an error so typos cannot silently corrupt an archive.
 */
export function applyCorosWatchfaceConfigOverrides(
  text: string,
  overrides: Record<string, string>
): string {
  const pending = new Map(Object.entries(overrides));
  const matched = new Set<string>();
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(\s*)\[([^\]]+)\]\s*=.*$/);
    if (!match || !pending.has(match[2]!)) {
      return [line];
    }
    const value = pending.get(match[2]!)!;
    // Raw config editing can introduce duplicate declarations. Rewrite every
    // occurrence so the last-value-wins parser and the exported file agree.
    matched.add(match[2]!);
    return value === COROS_CONFIG_DELETE_VALUE
      ? []
      : [`${match[1]}[${match[2]}]=${value}`];
  });
  for (const key of matched) {
    pending.delete(key);
  }
  const appendableKeys = new Set([
    "watchface_id",
    // Independent AOD artwork may add a flattened background to a valid
    // color-only AODconfig that did not originally declare a PNG.
    "background_icon",
    // Studio can expose selectable components that the imported template did
    // not originally declare. The renderer only emits this fixed allow-list;
    // arbitrary missing keys remain rejected below.
    "rect_control1_pos",
    "weather_icon_pos",
    "weather_icon_dir",
    "battery_icon_pos",
    "battery_icon_dir",
    "battery_level_rect",
    "battery_level_font",
    "battery_level_font_color",
    "temperature_rect",
    "temperature_font",
    "temperature_font_color",
    "temperature_negative_sign_icon",
    "kcal_progress_arc",
    "kcal_progress_arc_color",
    "kcal_progress_rect",
    "kcal_progress_color",
    "exercise_progress_arc",
    "exercise_progress_rect",
    "exercise_progress_color",
    "control_temperature_icon_pos",
    "control_temperature_icon",
    "control_temperature_rect",
    "control_temperature_font",
    "control_temperature_font_color",
    "control_temperature_negative_sign_icon",
    "control_barometer_icon_pos",
    "control_barometer_icon",
    "control_barometer_down_icon",
    "control_barometer_flat_icon",
    "control_barometer_up_icon",
    "control_barometer_integer_rect",
    "control_barometer_decimal_rect",
    "control_barometer_rect",
    "control_barometer_font",
    "control_barometer_font_color",
    "control_point_icon",
    "control_negative_sign_icon",
    "control_hr_font_color",
    "control_step_font_color",
    "control_kcal_font_color",
    "control_floor_font_color",
    "control_elevation_font_color",
    "control_exercise_font_color",
    "control_sunrise_font_color",
    "control_sunset_font_color",
    "control_battery_level_font",
    "control_battery_level_font_color",
    "time_hour_high_pos",
    "time_hour_high_font",
    "time_hour_low_pos",
    "time_hour_low_font",
    "time_minute_high_pos",
    "time_minute_high_font",
    "time_minute_low_pos",
    "time_minute_low_font",
    "colon_icon"
  ]);
  for (const prefix of [
    "hr",
    "step",
    "kcal",
    "floor",
    "elevation",
    "temperature"
  ]) {
    for (const suffix of [
      "icon_pos",
      "icon",
      "rect",
      "font",
      "font_color"
    ]) {
      appendableKeys.add(`control_${prefix}_${suffix}`);
    }
  }
  appendableKeys.add("control_temperature_negative_sign_icon");
  for (const prefix of ["exercise", "sunrise", "sunset"]) {
    for (const suffix of [
      "icon_pos",
      "icon",
      "hour_rect",
      "minute_rect",
      "font",
      "font_color"
    ]) {
      appendableKeys.add(`control_${prefix}_${suffix}`);
    }
  }
  for (const suffix of [
    "icon_dir",
    "level_rect",
    "level_font",
    "level_font_color"
  ]) {
    appendableKeys.add(`control_battery_${suffix}`);
  }
  const appended: string[] = [];
  for (const [key, value] of pending) {
    if (value === COROS_CONFIG_DELETE_VALUE) {
      // Deleting an optional key that is already absent is idempotent.
      pending.delete(key);
      continue;
    }
    if (appendableKeys.has(key)) {
      appended.push(`[${key}]=${value}`);
      pending.delete(key);
    }
  }
  if (pending.size > 0) {
    throw new Error(
      `The template's config does not define: ${[...pending.keys()].join(", ")}.`
    );
  }
  if (appended.length > 0) {
    const insertionIndex = lines.at(-1) === "" ? lines.length - 1 : lines.length;
    lines.splice(insertionIndex, 0, ...appended);
  }
  return lines.join(newline);
}

/**
 * Deletes every `[key]=` declaration whose value is blank. Firmware treats a
 * declared key as feature-present even when its value is empty — a template
 * shipping an empty `control_barometer_*` group still lists barometer in the
 * on-watch selector and renders a blank slot. Removing the whole line is the
 * same mechanism COROS_CONFIG_DELETE_VALUE uses to switch features off.
 */
export function stripBlankCorosWatchfaceConfigKeys(text: string): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[[^\]]+\]\s*=\s*$/.test(line))
    .join(newline);
}

const BAROMETER_DIRECTIONAL_REQUIRED_KEYS = [
  "control_barometer_icon_pos",
  "control_barometer_down_icon",
  "control_barometer_flat_icon",
  "control_barometer_up_icon",
  "control_barometer_integer_rect",
  "control_barometer_decimal_rect",
  "control_barometer_font",
  "control_barometer_font_color",
  "control_point_icon"
] as const;
const BAROMETER_STATIC_REQUIRED_KEYS = [
  "control_barometer_icon_pos",
  "control_barometer_icon",
  "control_barometer_rect",
  "control_barometer_font",
  "control_barometer_font_color",
  "control_point_icon"
] as const;
const BAROMETER_DIRECTIONAL_BRANCH_KEYS = [
  "control_barometer_down_icon",
  "control_barometer_flat_icon",
  "control_barometer_up_icon",
  "control_barometer_integer_rect",
  "control_barometer_decimal_rect"
] as const;

/**
 * Enforces exactly one complete barometer parser branch. Static remains an
 * experimental v4 path because an earlier archive crashed on-watch.
 */
export function finalizeCorosWatchfaceBarometerConfig(text: string): string {
  const config = parseCorosWatchfaceConfig(text);
  const hasValue = (key: string) => Boolean(config[key]?.trim());
  const hasDeclaration = (key: string) =>
    Object.prototype.hasOwnProperty.call(config, key);
  const hasStaticBranch =
    hasValue("control_barometer_icon") ||
    hasValue("control_barometer_rect");
  const hasDirectionalBranch = BAROMETER_DIRECTIONAL_BRANCH_KEYS.some(
    (key) => hasValue(key)
  );
  if (hasStaticBranch && hasDirectionalBranch) {
    throw new Error(
      "The barometer config mixes Static and Directional parser branches. Select exactly one format."
    );
  }

  const hasBarometer = Object.keys(config).some(
    (key) => key.startsWith("control_barometer_") && hasValue(key)
  );
  if (hasBarometer) {
    const requiredKeys = hasStaticBranch
      ? BAROMETER_STATIC_REQUIRED_KEYS
      : BAROMETER_DIRECTIONAL_REQUIRED_KEYS;
    const missing: string[] = requiredKeys.filter(
      (key) => key === "control_barometer_font_color"
        ? !hasDeclaration(key)
        : !hasValue(key)
    );
    if (!hasStaticBranch && !hasDirectionalBranch) {
      missing.push("a Static or Directional barometer branch");
    }
    const hasControlSlot = Object.entries(config).some(
      ([key, value]) =>
        /^rect_control\d+_pos$/.test(key) &&
        /^\{\s*-?\d+\s*,\s*-?\d+\s*\}$/.test(value.trim())
    );
    if (!hasControlSlot) missing.push("rect_controlN_pos");
    if (missing.length > 0) {
      throw new Error(
        `The ${hasStaticBranch ? "static" : "directional"} barometer config is incomplete: ${missing.join(", ")}.`
      );
    }
  }

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\s*\[([^\]]+)\]\s*=\s*$/);
      return !match || (
        match[1] === "control_barometer_font_color" ||
        (
          !match[1]!.startsWith("control_barometer_") &&
          match[1] !== "control_point_icon"
        )
      );
    })
    .join(newline);
}

/**
 * Builds an AODconfig for a resolution that lacks one by rescaling another
 * resolution's file. Coordinate fields inside `{...}` tuples are scaled;
 * WFArc angles and flags remain unchanged;
 * font-folder and PNG references are remapped to assets the target tree
 * actually ships (official 800×800 templates reuse main-face assets for AOD
 * instead of shipping `aod_*` copies), trying the literal name first, then
 * with the `aod_`/`a/` prefix removed. Keys whose assets cannot be resolved
 * are dropped rather than left dangling.
 */
export function synthesizeScaledCorosAodConfig(
  sourceText: string,
  scale: number,
  archivePaths: Set<string>,
  targetDirectory: string
): string {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/^\.\//, "");
  const hasFile = (relative: string) =>
    archivePaths.has(`${targetDirectory}/${normalize(relative)}`);
  const folders = new Set<string>();
  for (const archivePath of archivePaths) {
    if (!archivePath.startsWith(`${targetDirectory}/`)) continue;
    const segments = archivePath.slice(targetDirectory.length + 1).split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      folders.add(segments.slice(0, depth).join("/"));
    }
  }
  const resolveFolder = (value: string) =>
    [
      value,
      value.replace(/^aod_/i, ""),
      value.replace(/^a[\\/]/i, "")
    ].find((candidate) => candidate && folders.has(normalize(candidate)));
  const resolveFile = (value: string) =>
    [
      value,
      value.replace(/(^|[\\/])aod_([^\\/]+\.png)$/i, "$1$2"),
      value.replace(/^a[\\/]/i, "")
    ].find((candidate) => hasFile(candidate));
  const newline = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const lines: string[] = [];
  for (const line of sourceText.split(/\r?\n/)) {
    const match = line.match(/^(\s*)\[([^\]]+)\]\s*=(.*)$/);
    if (!match) {
      lines.push(line);
      continue;
    }
    const [, indent, key, rawValue] = match;
    const configKey = key!;
    const value = rawValue!.trim();
    if (!value) {
      lines.push(`${indent}[${configKey}]=`);
      continue;
    }
    const scaled = value.replace(/\{([^}]*)\}/g, (_group, inner: string) =>
      `{${inner
        .split(",")
        .map((part, index) => {
          const token = part.trim();
          const isProgressArcCoordinate =
            !/_progress_arc$/i.test(configKey) ||
            index < 4 ||
            index === 6;
          return /^-?\d+$/.test(token) && isProgressArcCoordinate
            ? String(Math.round(Number(token) * scale))
            : token;
        })
        .join(",")}}`
    );
    if (/\.png$/i.test(normalize(scaled))) {
      const resolved = resolveFile(scaled);
      if (resolved !== undefined) lines.push(`${indent}[${configKey}]=${resolved}`);
      continue;
    }
    if (/_font$/i.test(configKey) || /_icon_dir$/i.test(configKey)) {
      const resolved = resolveFolder(scaled);
      if (resolved !== undefined) lines.push(`${indent}[${configKey}]=${resolved}`);
      continue;
    }
    lines.push(`${indent}[${configKey}]=${scaled}`);
  }
  return lines.join(newline);
}

/** Ensures a composed standalone battery folder is actually referenced. */
export function repairStandaloneBatteryConfigOverrides(
  text: string,
  overrides: Record<string, string>,
  hasStudioBatteryFolder: boolean
): Record<string, string> {
  if (!hasStudioBatteryFolder) return overrides;
  const config = parseCorosWatchfaceConfig(text);
  const position = overrides.battery_icon_pos ?? config.battery_icon_pos ?? "";
  const folder = overrides.battery_icon_dir ?? config.battery_icon_dir ?? "";
  return position.trim() && !folder.trim()
    ? { ...overrides, battery_icon_dir: "cl_battery_icon" }
    : overrides;
}

function validateConfigOverrides(
  overrides: CorosWatchfaceConfigOverride[] | undefined
): Map<string, Record<string, string>> {
  const validated = new Map<string, Record<string, string>>();
  if (overrides === undefined) {
    return validated;
  }
  if (!Array.isArray(overrides) || overrides.length > MAX_CONFIG_OVERRIDE_FILES) {
    throw new Error("The creator sent an invalid layout override list.");
  }
  for (const override of overrides) {
    if (
      !override ||
      typeof override.path !== "string" ||
      !/(^|\/)(AODconfig|config)\.txt$/i.test(override.path) ||
      !override.values ||
      typeof override.values !== "object" ||
      Array.isArray(override.values)
    ) {
      throw new Error("Layout overrides must target a template config file.");
    }
    if (validated.has(override.path)) {
      throw new Error("Layout overrides contain a duplicated config file.");
    }
    const entries = Object.entries(override.values);
    if (entries.length === 0 || entries.length > MAX_CONFIG_OVERRIDE_KEYS) {
      throw new Error("Layout overrides must change between 1 and 200 keys.");
    }
    for (const [key, value] of entries) {
      if (
        !CONFIG_KEY_PATTERN.test(key) ||
        typeof value !== "string" ||
        !CONFIG_VALUE_PATTERN.test(value)
      ) {
        throw new Error("A layout override key or value is not valid config syntax.");
      }
    }
    validated.set(override.path, { ...override.values });
  }
  return validated;
}

export function validateConfigTextReplacements(
  replacements: CorosWatchfaceConfigTextFile[] | undefined
): Map<string, string> {
  const validated = new Map<string, string>();
  if (replacements === undefined) {
    return validated;
  }
  if (
    !Array.isArray(replacements) ||
    replacements.length > MAX_CONFIG_TEXT_REPLACEMENTS
  ) {
    throw new Error("The creator sent an invalid config text replacement list.");
  }
  for (const replacement of replacements) {
    if (
      !replacement ||
      typeof replacement.path !== "string" ||
      !CONFIG_TEXT_PATH_PATTERN.test(replacement.path) ||
      typeof replacement.text !== "string"
    ) {
      throw new Error(
        "Config text replacements must target an existing template config file."
      );
    }
    if (validated.has(replacement.path)) {
      throw new Error("Config text replacements contain a duplicated config file.");
    }
    if (Buffer.byteLength(replacement.text, "utf8") > MAX_INFO_BYTES) {
      throw new Error("A replaced config file is unexpectedly large.");
    }
    validated.set(replacement.path, replacement.text);
  }
  return validated;
}

async function readTemplateConfig(
  filesByPath: Map<string, UnzipperFile>,
  configPath: string
): Promise<Record<string, string>> {
  const entry = filesByPath.get(configPath);
  if (!entry || (entry.size ?? entry.uncompressedSize ?? 0) > MAX_INFO_BYTES) {
    return {};
  }
  return parseCorosWatchfaceConfig((await entry.buffer()).toString("utf8"));
}

/**
 * Finds the bitmap-font folders inside one resolution directory. A folder of
 * 00.png–09.png is a digit font; 00.png–06.png is a weekday-label font; and
 * 00.png–11.png is a single-image-per-month label set. The `a/` subtree holds
 * the same structures for the always-on display.
 */
async function discoverSpriteAssets(
  files: UnzipperFile[],
  resolutionDirectory: string,
  configs: Record<string, string>[]
): Promise<Pick<CorosWatchfaceResolutionDetails, "spriteFolders" | "icons">> {
  const prefix = `${resolutionDirectory}/`;
  const folderFiles = new Map<string, Map<number, UnzipperFile>>();
  const iconEntries: UnzipperFile[] = [];
  const iconEntryPaths = new Set<string>();
  const directlyReferencedPngs = new Set(
    configs.flatMap((config) => Object.values(config))
      .map((value) => value.replace(/\\/g, "/").replace(/^\.\//, ""))
      .filter((value) => /^[^/].*\.png$/i.test(value))
  );

  const addIconEntry = (entry: UnzipperFile) => {
    if (!iconEntryPaths.has(entry.path)) {
      iconEntryPaths.add(entry.path);
      iconEntries.push(entry);
    }
  };

  for (const entry of files) {
    if (!entry.path.startsWith(prefix)) {
      continue;
    }
    const relative = entry.path.slice(prefix.length);
    const spriteMatch = relative.match(/^(.+)\/(\d{2})\.png$/i);
    if (spriteMatch) {
      const folder = spriteMatch[1]!;
      const numbered = folderFiles.get(folder) ?? new Map<number, UnzipperFile>();
      numbered.set(Number(spriteMatch[2]), entry);
      folderFiles.set(folder, numbered);
      continue;
    }
    if (
      /^(a\/)?icon\/[^/]+\.png$/i.test(relative) ||
      directlyReferencedPngs.has(relative)
    ) {
      addIconEntry(entry);
    }
  }

  const spriteFolders: CorosWatchfaceSpriteFolder[] = [];
  const stateFolders = new Set(
    configs.flatMap((config) => Object.entries(config))
      .filter(([key, value]) => /_icon_dir$/.test(key) && Boolean(value))
      .map(([, value]) => value.replace(/\\/g, "/").replace(/^\.\//, ""))
  );
  for (const [folder, numbered] of folderFiles) {
    const plainFolder = folder.replace(/^a\//, "");
    const kind = stateFolders.has(folder) || stateFolders.has(plainFolder) ||
      /^(?:battery|weather|cl_battery_icon)$/i.test(plainFolder)
      ? "state"
      : classifySpriteFolder(numbered);
    if (!kind) {
      continue;
    }
    const indices = kind === "state"
      ? [...numbered.keys()].sort((left, right) => left - right)
      : Array.from(
          { length: kind === "month" ? 12 : kind === "digits" ? 10 : 7 },
          (_, index) => index
        );
    const spriteFiles: CorosWatchfaceSpriteFile[] = [];
    for (const index of indices) {
      spriteFiles.push(await describeSpriteFile(numbered.get(index)!));
    }
    spriteFolders.push({
      folder,
      kind,
      aod: folder === "a" || folder.startsWith("a/"),
      files: spriteFiles
    });
  }
  spriteFolders.sort((left, right) => left.folder.localeCompare(right.folder));

  const icons: CorosWatchfaceSpriteFile[] = [];
  for (const entry of iconEntries) {
    icons.push(await describeSpriteFile(entry));
  }
  icons.sort((left, right) => left.path.localeCompare(right.path));

  return { spriteFolders, icons };
}

function classifySpriteFolder(
  numbered: Map<number, UnzipperFile>
): CorosWatchfaceSpriteFolder["kind"] | null {
  const hasRange = (count: number) =>
    Array.from({ length: count }, (_, index) => index).every((index) =>
      numbered.has(index)
    );
  if (hasRange(12)) {
    return "month";
  }
  if (hasRange(10)) {
    return "digits";
  }
  if (hasRange(7)) {
    return "week";
  }
  return null;
}

async function describeSpriteFile(entry: UnzipperFile): Promise<CorosWatchfaceSpriteFile> {
  const image = nativeImage.createFromBuffer(await entry.buffer());
  if (image.isEmpty()) {
    throw new Error(`The template sprite ${entry.path} could not be decoded.`);
  }
  const { width, height } = image.getSize();
  return { path: entry.path, width, height };
}

interface DecodedSpriteReplacement {
  data: Buffer;
  width: number;
  height: number;
  create: boolean;
  allowDimensionOverride: boolean;
}

function decodeSpriteReplacements(
  replacements: CorosWatchfaceAssetReplacement[] | undefined
): Map<string, DecodedSpriteReplacement> {
  const decoded = new Map<string, DecodedSpriteReplacement>();
  if (replacements === undefined) {
    return decoded;
  }
  if (!Array.isArray(replacements) || replacements.length > MAX_SPRITE_REPLACEMENTS) {
    throw new Error("The creator sent an invalid sprite replacement list.");
  }

  let totalBytes = 0;
  for (const replacement of replacements) {
    if (
      !replacement ||
      typeof replacement.path !== "string" ||
      typeof replacement.dataUrl !== "string" ||
      !replacement.dataUrl.startsWith("data:image/png;base64,")
    ) {
      throw new Error("Sprite replacements must be PNG images with template paths.");
    }
    if (replacement.create && !CREATED_STUDIO_SPRITE_PATTERN.test(replacement.path)) {
      throw new Error("New sprites must use a watchface resolution studio folder.");
    }
    if (decoded.has(replacement.path)) {
      throw new Error("Sprite replacements contain a duplicated template path.");
    }
    const data = Buffer.from(
      replacement.dataUrl.slice("data:image/png;base64,".length),
      "base64"
    );
    totalBytes += data.length;
    if (data.length === 0 || data.length > MAX_SPRITE_BYTES || totalBytes > MAX_TOTAL_SPRITE_BYTES) {
      throw new Error("A sprite replacement is empty or too large.");
    }
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) {
      throw new Error("A sprite replacement could not be decoded as an image.");
    }
    decoded.set(replacement.path, {
      data,
      ...image.getSize(),
      create: replacement.create === true,
      allowDimensionOverride: replacement.allowDimensionOverride === true
    });
  }
  return decoded;
}

function requireSelectedArchive(archiveId: string): SelectedArchive {
  const archive =
    typeof archiveId === "string" ? selectedArchives.get(archiveId) : undefined;
  if (!archive) {
    throw new Error("Choose the template archive again.");
  }
  return archive;
}

async function openTemplateArchive(
  archivePath: string
): Promise<{ files: UnzipperFile[] }> {
  const unzipper = require("unzipper") as UnzipperModule;
  try {
    return await unzipper.Open.file(archivePath);
  } catch {
    throw new Error("That file is not a readable ZIP watchface archive.");
  }
}

export async function publishCorosWatchface(
  input: CorosWatchfacePublishInput
): Promise<CorosWatchfaceShareLink> {
  const session = requireSession();
  const archive = selectedArchives.get(input.archiveId);
  if (!archive) {
    throw new Error("Choose the watchface archive again before publishing.");
  }

  const freshArchive = await inspectArchive(archive.path, archive.archiveId);
  if (freshArchive.modifiedMs !== archive.modifiedMs) {
    selectedArchives.set(freshArchive.archiveId, freshArchive);
    throw new Error(
      "The archive changed after it was selected. Review it and publish again."
    );
  }

  const name = sanitizeTemplateName(input.name);
  const firmwareType = normalizeOptionalFirmwareType(input.firmwareType);
  if (!firmwareType) {
    throw new Error("Enter the COROS firmware type for this template.");
  }
  if (
    archive.firmwareType &&
    archive.firmwareType.toUpperCase() !== firmwareType.toUpperCase()
  ) {
    throw new Error(
      `This archive was built for ${archive.firmwareType}, not ${firmwareType}. Reopen a compatible template for the connected watch.`
    );
  }
  assertFirmwareResolutionCompatibility(
    freshArchive.resolutionDirectories,
    firmwareType
  );
  if (!Number.isSafeInteger(input.backgroundImageId) || input.backgroundImageId < 0) {
    throw new Error("Background image ID must be a non-negative integer.");
  }

  const archiveBytes = await fs.promises.readFile(freshArchive.path);
  if (!/^\d+$/.test(freshArchive.sourceTemplateId)) {
    throw new Error("Invalid COROS source template ID.");
  }
  const saveBody = {
    accessToken: session.accessToken,
    backgroundImageId: input.backgroundImageId,
    firmwareType,
    language: normalizeLanguage(input.language),
    maxWatchFaceVersion: freshArchive.watchFaceVersion,
    releaseType: 1,
    saveOrUpdate: 1,
    // Placeholder: the ID must be a raw JSON number, but it exceeds
    // Number.MAX_SAFE_INTEGER, so it is spliced in after stringification.
    srcWatchFaceTemplateId: "__SRC_TEMPLATE_ID__",
    version: 2,
    watchFaceTemplateName: name
  };
  const form = new FormData();
  form.append(
    "jsonParameter",
    JSON.stringify(saveBody).replace(
      '"__SRC_TEMPLATE_ID__"',
      freshArchive.sourceTemplateId
    )
  );
  form.append("saveOrUpdate", "1");
  form.append(
    "watchFaceTemplateUserCustomZipFile",
    new Blob([archiveBytes], { type: "application/zip" }),
    "watchFaceTemplateUserCustomZipFile.dat"
  );

  const saved = await mobileRequest<Record<string, unknown>>(
    "/watchFaceTemplateUserCustom/saveOrUpdateV2",
    {
      method: "POST",
      accessToken: session.accessToken,
      userId: session.userId,
      body: form
    }
  );

  // Template IDs exceed JavaScript's safe integer range. Extract the raw JSON
  // number and put it straight back into the link request, never JSON.parse it.
  const templateId = extractDecimalProperty(saved.raw, "watchFaceTemplateId");
  if (!templateId) {
    throw new Error("COROS saved the template but did not return its ID.");
  }

  return requestCorosWatchfaceShareLink(session, {
    backgroundImageId: input.backgroundImageId,
    firmwareType,
    sourceTemplateId: freshArchive.sourceTemplateId,
    templateId,
    name
  });
}

export async function createCorosWatchfaceShareLink(
  input: CorosWatchfaceExistingShareInput
): Promise<CorosWatchfaceShareLink> {
  const session = requireSession();
  const name = sanitizeTemplateName(input.name);
  const firmwareType = normalizeOptionalFirmwareType(input.firmwareType);
  if (!firmwareType) {
    throw new Error("This custom face does not include a COROS firmware type.");
  }
  if (!Number.isSafeInteger(input.backgroundImageId) || input.backgroundImageId < 0) {
    throw new Error("Background image ID must be a non-negative integer.");
  }

  const templateId = input.templateId.trim();
  const sourceTemplateId = input.sourceTemplateId.trim();
  if (!/^\d{1,20}$/.test(templateId) || !/^\d{1,20}$/.test(sourceTemplateId)) {
    throw new Error("This custom face does not include valid COROS template IDs.");
  }

  return requestCorosWatchfaceShareLink(session, {
    backgroundImageId: input.backgroundImageId,
    firmwareType,
    sourceTemplateId,
    templateId,
    name
  });
}

async function requestCorosWatchfaceShareLink(
  session: StoredMobileSession,
  input: {
    backgroundImageId: number;
    firmwareType: string;
    sourceTemplateId: string;
    templateId: string;
    name: string;
  }
): Promise<CorosWatchfaceShareLink> {
  const linkBody = buildCreateLinkBody(input);
  const link = await mobileRequest<{
    url?: string;
    expireTimestamp?: number;
    previewImageUrl?: string;
  }>("/watchface/share/createLink", {
    method: "POST",
    accessToken: session.accessToken,
    userId: session.userId,
    body: linkBody
  });

  const url = link.data?.url?.trim();
  if (!url || !isOfficialShareUrl(url)) {
    throw new Error("COROS did not return an official watchface share link.");
  }

  const expiresAt = Number.isFinite(link.data?.expireTimestamp)
    ? new Date(link.data!.expireTimestamp!).toISOString()
    : new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const qrDataUrl = await QRCode.toDataURL(url, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: "M"
  });

  return {
    url,
    qrDataUrl,
    expiresAt,
    previewImageUrl: link.data?.previewImageUrl
  };
}

export function buildCreateLinkBody(input: {
  backgroundImageId: number;
  firmwareType: string;
  /** Decimal text, inserted as a raw JSON number. */
  sourceTemplateId: string;
  templateId: string;
  name: string;
}): string {
  if (!/^\d+$/.test(input.templateId) || !/^\d+$/.test(input.sourceTemplateId)) {
    throw new Error("Invalid COROS watchface template ID.");
  }

  return `{"type":2,"watchFaceTemplateUserCustom":{"backgroundImageId":${input.backgroundImageId},"firmwareType":${JSON.stringify(input.firmwareType)},"srcWatchFaceTemplateId":${input.sourceTemplateId},"watchFaceTemplateId":${input.templateId},"watchFaceTemplateName":${JSON.stringify(input.name)}}}`;
}

export function extractDecimalProperty(raw: string, property: string): string | undefined {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`"${escapedProperty}"\\s*:\\s*(\\d+)`));
  return match?.[1];
}

/**
 * Preserve COROS watch-face IDs as decimal text before JSON.parse can round
 * values above Number.MAX_SAFE_INTEGER.
 */
export function parseCorosMobileJson(raw: string): unknown {
  const losslessRaw = raw.replace(
    /("(?:watchFaceThemeId|watchFaceTemplateId|srcWatchFaceTemplateId|watchfaceId)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,
    (_match, prefix: string, value: string) => `${prefix}"${value}"`
  );
  return JSON.parse(losslessRaw) as unknown;
}

/**
 * The mobile client has used a few response shapes for this endpoint. Keep
 * the renderer insulated from those server-side naming changes and expose a
 * small, safe read-only catalog shape instead.
 */
export function normalizeCorosWatchfaceThemes(
  data: unknown,
  catalog: CorosWatchfaceThemeCatalog = "official"
): CorosWatchfaceTheme[] {
  const entries = findThemeEntries(data, catalog);
  const seen = new Set<string>();
  const themes: CorosWatchfaceTheme[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = readWatchfaceId(record);
    const sourceTemplateId = readString(record, [
      "srcWatchFaceTemplateId",
      "sourceTemplateId"
    ]);
    const name = readString(record, [
      "watchFaceThemeName",
      "watchFaceTemplateName",
      "watchFaceName",
      "name",
      "title"
    ]);
    const previewImageUrl = readHttpsUrl(record, [
      "previewImageUrl",
      "watchFaceThemePreviewImageUrl",
      "watchFaceTemplatePreviewImageUrl",
      "watchFacePreviewImageUrl",
      "imageUrl",
      "coverUrl"
    ]);
    const packageUrlCandidate =
      readHttpsUrl(record, [
        "watchFaceTemplateUrl",
        "watchFaceTemplateUserCustomUrl",
        "watchFaceTemplateUserCustomZipFileUrl",
        "watchFaceTemplateUserCustomZipUrl",
        "watchFaceTemplateZipUrl",
        "watchFaceUrl",
        "watchfaceUrl",
        "watchFaceFileUrl",
        "fileUrl",
        "zipUrl",
        "downloadUrl",
        "resourceUrl"
      ]) ?? readNestedHttpsUrl(record, ["watchFaceTemplateUserCustomZipFile"]);
    const packageUrl =
      packageUrlCandidate && packageUrlCandidate !== previewImageUrl
        ? packageUrlCandidate
        : undefined;
    const key = id || `${name ?? ""}|${previewImageUrl ?? ""}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    themes.push({
      ...(id ? { id } : {}),
      ...(sourceTemplateId ? { sourceTemplateId } : {}),
      name: name || (id ? `COROS theme ${id}` : "Untitled COROS theme"),
      ...(previewImageUrl ? { previewImageUrl } : {}),
      ...(packageUrl ? { packageUrl } : {}),
      ...(readString(record, ["firmwareType", "watchFirmwareType"]) ? {
        firmwareType: readString(record, ["firmwareType", "watchFirmwareType"])
      } : {}),
      ...(readInteger(record, ["backgroundImageId"]) !== undefined ? {
        backgroundImageId: readInteger(record, ["backgroundImageId"])
      } : {}),
      ...(readInteger(record, ["watchFaceVersion", "watchfaceVersion", "version"]) !== undefined ? {
        watchFaceVersion: readInteger(record, ["watchFaceVersion", "watchfaceVersion", "version"])
      } : {}),
      ...(readInteger(record, ["diyVersion"]) !== undefined ? {
        diyVersion: readInteger(record, ["diyVersion"])
      } : {}),
      ...(readInteger(record, ["watchFaceTemplateType"]) !== undefined ? {
        templateType: readInteger(record, ["watchFaceTemplateType"])
      } : {}),
      ...(readString(record, ["categoryName", "watchFaceCategoryName", "category", "styleName"]) ? {
        category: readString(record, ["categoryName", "watchFaceCategoryName", "category", "styleName"])
      } : {})
    });
  }

  return themes;
}

export function normalizeCorosBatteryReport(data: unknown): CorosBatteryReport {
  const record = asRecord(data);
  if (!record) {
    return { days: [] };
  }
  const days = Array.isArray(record.days)
    ? record.days.flatMap((entry) => normalizeCorosBatteryDay(entry))
    : [];
  const alarmStatus = readInteger(record, ["alarmStatus"]);
  const timestamp = readFiniteNumber(record, ["timestamp"]);
  return {
    ...(alarmStatus !== undefined ? { alarmStatus } : {}),
    ...(timestamp !== undefined ? { updatedAt: toIsoTimestamp(timestamp) } : {}),
    days
  };
}

export function normalizeCorosPairedDevices(data: unknown): CorosPairedDevice[] {
  const record = asRecord(data);
  const entries = record
    ? [
        ...(Array.isArray(record.deviceParamList) ? record.deviceParamList : []),
        ...(Array.isArray(record.deviceProfiles) ? record.deviceProfiles : [])
      ]
    : [];
  const devices: CorosPairedDevice[] = [];
  const byDeviceId = new Map<string, CorosPairedDevice>();
  for (const entry of entries) {
    const device = asRecord(entry);
    if (!device) {
      continue;
    }
    const deviceId = readString(device, ["deviceId"]);
    const firmwareType = readString(device, ["firmwareType"]);
    const uuid = readString(device, ["uuid"]);
    if (!deviceId || !firmwareType || !uuid) {
      continue;
    }
    const mac = readString(device, ["mac"]);
    const colorType = readString(device, ["colorType"]);
    const imagePackUrl = readHttpsUrl(device, ["imagePackUrl"]);
    const profileVersion = readFiniteNumber(device, ["version"]);
    const existing = byDeviceId.get(deviceId);
    if (existing) {
      if (!existing.mac && mac) existing.mac = mac;
      if (!existing.colorType && colorType) existing.colorType = colorType;
      if (!existing.imagePackUrl && imagePackUrl) existing.imagePackUrl = imagePackUrl;
      if (existing.profileVersion === undefined && profileVersion !== undefined) {
        existing.profileVersion = profileVersion;
      }
      continue;
    }
    const pairedDevice: CorosPairedDevice = {
      deviceId,
      firmwareType,
      uuid,
      ...(mac ? { mac } : {}),
      ...(colorType ? { colorType } : {}),
      ...(imagePackUrl ? { imagePackUrl } : {}),
      ...(profileVersion !== undefined ? { profileVersion } : {})
    };
    byDeviceId.set(deviceId, pairedDevice);
    devices.push(pairedDevice);
  }
  return devices;
}

function normalizeCorosBatteryDay(value: unknown): CorosBatteryDay[] {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  const date = formatCorosDay(record.happenDay);
  if (!date) {
    return [];
  }
  const groups = Array.isArray(record.groups)
    ? record.groups.flatMap((entry) => normalizeCorosBatteryUsageGroup(entry))
    : [];
  const percentAtQueryTime = readFiniteNumber(record, ["pctAtQueryTime"]);
  const totalPercent = readFiniteNumber(record, ["totalPct"]);
  return [{
    date,
    ...(percentAtQueryTime !== undefined ? { percentAtQueryTime } : {}),
    ...(totalPercent !== undefined ? { totalPercent } : {}),
    groups
  }];
}

function normalizeCorosBatteryUsageGroup(value: unknown): CorosBatteryUsageGroup[] {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  const name = readString(record, ["typeName", "itemName", "name"]);
  if (!name) {
    return [];
  }
  const details = Array.isArray(record.details)
    ? record.details.flatMap((detail): CorosBatteryUsageDetail[] => {
        const item = asRecord(detail);
        const detailName = item && readString(item, ["itemName", "typeName", "name"]);
        if (!detailName) {
          return [];
        }
        const percent = readFiniteNumber(item, ["pct", "typePct"]);
        return [{ name: detailName, ...(percent !== undefined ? { percent } : {}) }];
      })
    : [];
  const percent = readFiniteNumber(record, ["typePct", "pct"]);
  return [{ name, ...(percent !== undefined ? { percent } : {}), details }];
}

function formatCorosDay(value: unknown): string | undefined {
  const day = typeof value === "number" || typeof value === "string" ? String(value) : "";
  const match = day.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) {
    return undefined;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function toIsoTimestamp(value: number): string {
  const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function findThemeEntries(
  data: unknown,
  catalog: CorosWatchfaceThemeCatalog
): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  const record = asRecord(data);
  if (!record) {
    return [];
  }

  // The response's `watchFaceTemplateList` is the signed-in user's custom
  // archives. It is distinct from the grouped official catalog below.
  if (catalog === "custom") {
    return findCatalogEntries(record, [
      "watchFaceTemplateUserCustomList",
      "watchFaceTemplateList"
    ]);
  }

  // Official catalog faces are grouped under
  // `watchFaceThemeList[*].watchFaceList`, so never merge the two here.
  if (catalog === "official" && Array.isArray(record.watchFaceThemeList)) {
    return record.watchFaceThemeList.flatMap((theme) => {
      const group = asRecord(theme);
      return group && Array.isArray(group.watchFaceList) ? group.watchFaceList : [];
    });
  }

  return findCatalogEntries(record, [
    "watchFaceThemeDTOList",
    "watchFaceTemplateList",
    "watchFaceList",
    "themeList",
    "list",
    "records"
  ]);
}

function findCatalogEntries(record: Record<string, unknown>, listKeys: string[]): unknown[] {
  const lists = listKeys.flatMap((key) => (Array.isArray(record[key]) ? record[key] : []));
  if (lists.length > 0) {
    return lists;
  }
  return Object.values(record).flatMap((value) => {
    const nested = asRecord(value);
    if (!nested) {
      return [];
    }
    return listKeys.flatMap((key) => (Array.isArray(nested[key]) ? nested[key] : []));
  });
}

function readWatchfaceId(record: Record<string, unknown>): string | undefined {
  // Official IDs are larger than Number.MAX_SAFE_INTEGER. `watchFaceUrl`
  // carries the exact same decimal identifier as URL text, so prefer it.
  const resourceUrl = readHttpsUrl(record, ["watchFaceUrl"]);
  const resourceId = resourceUrl?.match(/\/watchface\/resource\/(\d+)$/)?.[1];
  return resourceId ?? readString(record, [
    "watchFaceThemeId",
    "watchFaceTemplateId",
    "watchfaceId",
    "id"
  ]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

/** Some custom-face responses wrap the archive link in a file object. */
function readNestedHttpsUrl(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (!nested) {
      continue;
    }
    const url = readHttpsUrl(nested, [
      "url",
      "fileUrl",
      "downloadUrl",
      "resourceUrl",
      "uri"
    ]);
    if (url) {
      return url;
    }
  }
  return undefined;
}

function readInteger(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function readFiniteNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function readHttpsUrl(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = readString(record, keys);
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Android sends a serialized DomainRegion rather than a short country code.
 * Keep the same wire shape while deriving the locale from the desktop host.
 */
export function buildMobileLoginRegion(options?: {
  locale?: string;
  timeZone?: string;
}): string {
  const locale = options?.locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  const language = locale.match(/^[a-z]{2,3}/i)?.[0]?.toLowerCase() ?? "en";
  const countryCode =
    locale.match(/[-_]([A-Z]{2})\b/)?.[1]?.toUpperCase() ?? "US";
  const timeZone =
    options?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const simMcc = MOBILE_COUNTRY_MCC[countryCode] ?? "310";

  return `DomainRegion(simMcc=${simMcc},countryCode=${countryCode},timeZoneId=${timeZone},language=${language},countryIso=${countryCode.toLowerCase()})`;
}

function buildMobileLoginPayload(
  account: string,
  pwdHash: string,
  checkStatus: 0 | 1
): Record<string, string | number | boolean> {
  if (!/^[a-f0-9]{32}$/i.test(pwdHash)) {
    throw new Error("COROS password digest is invalid.");
  }
  return {
    account: encryptMobileLoginField(account),
    accountType: 2,
    appKey: MOBILE_APP_KEY,
    checkStatus,
    clientType: 1,
    hasHrCalibrated: 0,
    kbValidity: 0,
    // The Android client passes the 32-character MD5 digest through the
    // mobile-field cipher. Keeping that digest in secure storage lets the
    // separate Training Hub and mobile APIs create their own sessions.
    pwd: encryptMobileLoginField(pwdHash.toLowerCase()),
    region: buildMobileLoginRegion(),
    skipValidation: false
  };
}

function renderCreatorBackground(
  dataUrl: string,
  imageKind: "background" | "preview" = "background"
) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error(`The creator ${imageKind} must be a PNG canvas image.`);
  }
  const encoded = dataUrl.slice("data:image/png;base64,".length);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > MAX_ARTWORK_BYTES) {
    throw new Error("The created watchface image must be smaller than 10 MB.");
  }
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error(`The created watchface ${imageKind} could not be rendered.`);
  }
  return image.resize({
    width: CREATOR_CANVAS_SIZE,
    height: CREATOR_CANVAS_SIZE,
    quality: "best"
  });
}

/**
 * Raises info.json's `o_wf_ver` to at least `minimum`, editing the manifest as
 * raw text. The file must never be JSON round-tripped: `o_template_id` exceeds
 * Number.MAX_SAFE_INTEGER (see extractDecimalProperty), so parsing would
 * corrupt it. Only the numeric `o_wf_ver` value is touched.
 */
function raiseWatchFaceVersion(rawInfo: string, minimum: number): string {
  const match = rawInfo.match(/"o_wf_ver"\s*:\s*(\d+)/);
  if (match) {
    if (Number(match[1]) >= minimum) {
      return rawInfo;
    }
    return rawInfo.replace(/"o_wf_ver"\s*:\s*\d+/, `"o_wf_ver":${minimum}`);
  }
  // Templates without the key predate weather support; declare it up front.
  return rawInfo.replace(/^(\s*\{)/, `$1"o_wf_ver":${minimum},`);
}

function setWatchFaceVersion(rawInfo: string, version: number): string {
  if (/"o_wf_ver"\s*:\s*\d+/.test(rawInfo)) {
    return rawInfo.replace(/"o_wf_ver"\s*:\s*\d+/, `"o_wf_ver":${version}`);
  }
  return rawInfo.replace(/^(\s*\{)/, `$1"o_wf_ver":${version},`);
}

/** Rewrites the lossless raw numeric template ID without JSON round-tripping. */
export function setWatchfaceTemplateId(
  rawInfo: string,
  templateId: string
): string {
  if (!/^\d{1,20}$/.test(templateId) || /^0+$/.test(templateId)) {
    throw new Error("Template ID overrides must contain 1–20 decimal digits.");
  }
  if (/"o_template_id"\s*:\s*(?:"\d+"|\d+)/.test(rawInfo)) {
    return rawInfo.replace(
      /"o_template_id"\s*:\s*(?:"\d+"|\d+)/,
      `"o_template_id":${templateId}`
    );
  }
  return rawInfo.replace(/^(\s*\{)/, `$1"o_template_id":${templateId},`);
}

/**
 * Normalizes a config `[watchface_id]` override. Decimal stays decimal; hex is
 * uppercased and zero-padded to 8 digits (`0x26` → `0x00000026`).
 */
export function normalizeWatchfaceIdOverride(value: string): string {
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{1,8}$/i.test(trimmed)) {
    return `0x${trimmed.slice(2).toUpperCase().padStart(8, "0")}`;
  }
  if (/^(?:0|[1-9]\d{0,9})$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
      throw new Error(
        "Watch-face ID overrides must be a 32-bit decimal or 0x hex value."
      );
    }
    return trimmed;
  }
  throw new Error(
    "Watch-face ID overrides must be a 32-bit decimal or 0x hex value."
  );
}

/** Rewrites the manifest name while preserving all other raw fields. */
export function setWatchfaceTemplateName(
  rawInfo: string,
  templateName: string
): string {
  const name = templateName.trim();
  if (name.length === 0 || name.length > 64) {
    throw new Error("Template name overrides must contain 1–64 characters.");
  }
  const encoded = JSON.stringify(name);
  if (/"m_name"\s*:\s*"(?:\\.|[^"\\])*"/.test(rawInfo)) {
    return rawInfo.replace(
      /"m_name"\s*:\s*"(?:\\.|[^"\\])*"/,
      `"m_name":${encoded}`
    );
  }
  return rawInfo.replace(/^(\s*\{)/, `$1"m_name":${encoded},`);
}

async function rewriteTemplateArchive(
  sourcePath: string,
  replacements: Map<string, Buffer>,
  background: Electron.NativeImage,
  preview: Electron.NativeImage,
  spriteReplacements: Map<string, DecodedSpriteReplacement> = new Map(),
  configOverrides: Map<string, Record<string, string>> = new Map(),
  minWatchFaceVersion?: number,
  watchFaceVersion?: number,
  templateIdOverride?: string,
  templateNameOverride?: string,
  watchfaceIdOverride?: string,
  configTextReplacements: Map<string, string> = new Map(),
  stripBlankConfigKeys = false
): Promise<Buffer> {
  const directory = await openTemplateArchive(sourcePath);
  const originalSourceFiles = directory.files.filter((entry) => entry.type === "File");
  const sourcePaths = new Set(originalSourceFiles.map((entry) => entry.path));
  for (const configPath of configTextReplacements.keys()) {
    if (!sourcePaths.has(configPath)) {
      throw new Error(
        "A config text replacement targets a file the template does not have."
      );
    }
  }
  const configEntries = originalSourceFiles.filter((entry) =>
    /(^|\/)(?:AODconfig|config)\.txt$/i.test(entry.path)
  );
  if (watchfaceIdOverride !== undefined) {
    for (const entry of configEntries) {
      const existing = configOverrides.get(entry.path) ?? {};
      configOverrides.set(entry.path, {
        ...existing,
        watchface_id: watchfaceIdOverride
      });
    }
  }
  const parsedConfigs = new Map<string, Record<string, string>>();
  for (const entry of configEntries) {
    const rawText =
      configTextReplacements.get(entry.path) ??
      (await entry.buffer()).toString("utf8");
    parsedConfigs.set(entry.path, parseCorosWatchfaceConfig(rawText));
  }
  const normalizeConfigFolder = (value: string | undefined) =>
    value
      ?.replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+|\/+$/g, "") ?? "";
  const removedControlBatteryPrefixes = new Set<string>();
  for (const [configPath, overrides] of configOverrides) {
    if (overrides.control_battery_icon_dir !== COROS_CONFIG_DELETE_VALUE) continue;
    const config = parsedConfigs.get(configPath);
    if (!config) continue;
    const folder = normalizeConfigFolder(config.control_battery_icon_dir);
    const resolutionDirectory = configPath.split("/", 1)[0]!;
    const folderIsStillReferenced = configEntries.some((entry) => {
      if (entry.path.split("/", 1)[0] !== resolutionDirectory) return false;
      const effectiveConfig = {
        ...(parsedConfigs.get(entry.path) ?? {}),
        ...(configOverrides.get(entry.path) ?? {})
      };
      return Object.entries(effectiveConfig).some(
        ([key, value]) =>
          /_icon_dir$/i.test(key) &&
          value !== COROS_CONFIG_DELETE_VALUE &&
          normalizeConfigFolder(value) === folder
      );
    });
    if (folder && !folderIsStillReferenced) {
      removedControlBatteryPrefixes.add(
        `${resolutionDirectory}/${folder}/`
      );
    }
  }
  const sourceFiles = originalSourceFiles.filter(
    (entry) =>
      ![...removedControlBatteryPrefixes].some((prefix) =>
        entry.path.startsWith(prefix)
      )
  );
  const studioBatteryResolutions = new Set<string>();
  for (const spritePath of [...sourcePaths, ...spriteReplacements.keys()]) {
    const match = spritePath.match(/^(watchface_\d+x\d+)\/cl_battery_icon\/\d{2}\.png$/i);
    if (match) studioBatteryResolutions.add(match[1]!);
  }
  for (const required of [
    "watchface_customize.png",
    "watchface_800x800/background.png",
    "watchface_800x800/thmb.png"
  ]) {
    if (!sourcePaths.has(required)) {
      throw new Error("This template does not include the assets required by the creator.");
    }
  }

  // Every firmware family ships its own resolution trees. Replace each
  // template artwork entry at its native size instead of assuming the
  // 416px AMOLED layout used by PACE Pro.
  await Promise.all(
    sourceFiles
      .filter((entry) => CREATOR_ARTWORK_ENTRY_PATTERN.test(entry.path))
      .map(async (entry) => {
        const original = nativeImage.createFromBuffer(await entry.buffer());
        const { width, height } = original.getSize();
        if (original.isEmpty() || width <= 0 || height <= 0) {
          throw new Error(`This template has an unreadable artwork image at ${entry.path}.`);
        }
        const artwork = entry.path.toLowerCase() === "watchface_customize.png"
          ? preview
          : background;
        replacements.set(
          entry.path,
          artwork.resize({ width, height, quality: "best" }).toPNG()
        );
      })
  );

  for (const spritePath of spriteReplacements.keys()) {
    const sprite = spriteReplacements.get(spritePath)!;
    if (
      sprite.create &&
      !sourcePaths.has(`${spritePath.split("/", 1)[0]!}/config.txt`)
    ) {
      throw new Error("A new studio sprite targets a resolution the template does not have.");
    }
    if (!sprite.create && !sourcePaths.has(spritePath)) {
      throw new Error("A sprite replacement does not exist in the starter template.");
    }
    if (replacements.has(spritePath) || spritePath.toLowerCase().endsWith("/custom_bg.png")) {
      throw new Error("Sprite replacements may not target the background or preview images.");
    }
  }
  for (const configPath of configOverrides.keys()) {
    if (!sourcePaths.has(configPath)) {
      throw new Error("A layout override targets a config file the template does not have.");
    }
  }

  // Templates that support COROS's custom-background picker keep the on-watch
  // artwork in this file. `custom.pb` points to it, so changing only the
  // normal background and preview PNGs makes the share preview look right but
  // leaves the original background on the watch. Preserve its native size as
  // different templates use different bitmap dimensions.
  await Promise.all(
    sourceFiles
      .filter((entry) => entry.path.toLowerCase().endsWith("/custom_bg.png"))
      .map(async (entry) => {
        const original = nativeImage.createFromBuffer(await entry.buffer());
        const { width, height } = original.getSize();
        if (original.isEmpty() || width <= 0 || height <= 0) {
          throw new Error("This template has an unreadable custom background image.");
        }
        replacements.set(
          entry.path,
          background.resize({ width, height, quality: "best" }).toPNG()
        );
      })
  );

  const entries = await Promise.all(
    sourceFiles.map(async (entry) => {
      if (
        (
          minWatchFaceVersion !== undefined ||
          watchFaceVersion !== undefined ||
          templateIdOverride !== undefined ||
          templateNameOverride !== undefined
        ) &&
        entry.path.replace(/^\.\//, "") === "info.json"
      ) {
        const rawInfo = (await entry.buffer()).toString("utf8");
        const versionedInfo =
          watchFaceVersion !== undefined
            ? setWatchFaceVersion(rawInfo, watchFaceVersion)
            : minWatchFaceVersion !== undefined
              ? raiseWatchFaceVersion(rawInfo, minWatchFaceVersion)
              : rawInfo;
        const identifiedInfo =
          templateIdOverride !== undefined
            ? setWatchfaceTemplateId(versionedInfo, templateIdOverride)
            : versionedInfo;
        return {
          name: entry.path,
          data: Buffer.from(
            templateNameOverride !== undefined
              ? setWatchfaceTemplateName(identifiedInfo, templateNameOverride)
              : identifiedInfo,
            "utf8"
          )
        };
      }
      const backgroundData = replacements.get(entry.path);
      if (backgroundData) {
        return { name: entry.path, data: backgroundData };
      }
      const overrides = configOverrides.get(entry.path);
      const textReplacement = configTextReplacements.get(entry.path);
      const isConfigFile = /(^|\/)(?:AODconfig|config)\.txt$/i.test(entry.path);
      const isNormalConfig = /(^|\/)config\.txt$/i.test(entry.path);
      if (
        isConfigFile ||
        overrides ||
        textReplacement !== undefined ||
        (isNormalConfig &&
          studioBatteryResolutions.has(entry.path.split("/", 1)[0]!)) ||
        (isConfigFile && watchfaceIdOverride !== undefined) ||
        (isConfigFile && stripBlankConfigKeys)
      ) {
        const rawConfig =
          textReplacement ?? (await entry.buffer()).toString("utf8");
        const resolutionDirectory = entry.path.split("/", 1)[0]!;
        const withWatchfaceId =
          watchfaceIdOverride !== undefined
            ? { ...(overrides ?? {}), watchface_id: watchfaceIdOverride }
            : (overrides ?? {});
        const effectiveOverrides = isNormalConfig
          ? repairStandaloneBatteryConfigOverrides(
              rawConfig,
              withWatchfaceId,
              studioBatteryResolutions.has(resolutionDirectory)
            )
          : withWatchfaceId;
        // Barometer validation and blank-key stripping run after overrides so
        // old static projects can first be normalized to Directional.
        const finalizeConfig = (configText: string) => {
          const safeBarometerConfig = isConfigFile
            ? finalizeCorosWatchfaceBarometerConfig(configText)
            : configText;
          return isConfigFile && stripBlankConfigKeys
            ? stripBlankCorosWatchfaceConfigKeys(safeBarometerConfig)
            : safeBarometerConfig;
        };
        if (Object.keys(effectiveOverrides).length === 0) {
          return {
            name: entry.path,
            data: Buffer.from(finalizeConfig(rawConfig), "utf8")
          };
        }
        return {
          name: entry.path,
          data: Buffer.from(
            finalizeConfig(
              applyCorosWatchfaceConfigOverrides(rawConfig, effectiveOverrides)
            ),
            "utf8"
          )
        };
      }
      const sprite = spriteReplacements.get(entry.path);
      if (!sprite) {
        return { name: entry.path, data: await entry.buffer() };
      }
      // Studio paths are upserts: rebuilding from a previously generated
      // archive should replace the old sprite, even when its size changed.
      if (sprite.create) {
        return { name: entry.path, data: sprite.data };
      }
      // Sprites must keep the template's exact pixel size: the firmware lays
      // digits and icons out with the original bitmap dimensions.
      const original = nativeImage.createFromBuffer(await entry.buffer());
      const { width, height } = original.getSize();
      if (
        original.isEmpty() ||
        (!sprite.allowDimensionOverride && (width !== sprite.width || height !== sprite.height))
      ) {
        throw new Error(
          `The replacement for ${entry.path} must be a ${width}×${height} PNG like the template's.`
        );
      }
      return { name: entry.path, data: sprite.data };
    })
  );
  const createdByResolution = new Map<string, { name: string; data: Buffer }[]>();
  const retainedSourcePaths = new Set(sourceFiles.map((entry) => entry.path));
  for (const [spritePath, sprite] of spriteReplacements) {
    if (!sprite.create || retainedSourcePaths.has(spritePath)) {
      continue;
    }
    const resolutionDirectory = spritePath.split("/", 1)[0]!;
    const created = createdByResolution.get(resolutionDirectory) ?? [];
    created.push({ name: spritePath, data: sprite.data });
    createdByResolution.set(resolutionDirectory, created);
  }
  for (const created of createdByResolution.values()) {
    created.sort((left, right) => left.name.localeCompare(right.name));
  }
  const orderedEntries: { name: string; data: Buffer }[] = [];
  for (const entry of entries) {
    if (/(^|\/)config\.txt$/i.test(entry.name)) {
      const resolutionDirectory = entry.name.split("/", 1)[0]!;
      orderedEntries.push(...(createdByResolution.get(resolutionDirectory) ?? []));
      createdByResolution.delete(resolutionDirectory);
    }
    orderedEntries.push(entry);
  }
  for (const created of createdByResolution.values()) {
    orderedEntries.push(...created);
  }
  // Some templates ship AODconfig.txt for only one resolution (the 250506
  // "TOP PART" family has it at 416 only), leaving the other resolution with
  // no always-on display. Synthesize the missing file from an existing one.
  const finalPaths = new Set(orderedEntries.map((entry) => entry.name));
  const aodSource = orderedEntries.find((entry) =>
    /^watchface_\d+x\d+\/AODconfig\.txt$/i.test(entry.name)
  );
  if (aodSource) {
    const sourceWidth = Number(
      aodSource.name.match(/^watchface_(\d+)x/i)![1]
    );
    for (const entry of [...orderedEntries]) {
      const match = entry.name.match(/^(watchface_(\d+)x\d+)\/config\.txt$/i);
      if (!match) continue;
      const targetDirectory = match[1]!;
      const aodPath = `${targetDirectory}/AODconfig.txt`;
      if (finalPaths.has(aodPath)) continue;
      const synthesized = synthesizeScaledCorosAodConfig(
        aodSource.data.toString("utf8"),
        Number(match[2]!) / sourceWidth,
        finalPaths,
        targetDirectory
      );
      // The AOD id must pair with this resolution's current-face config, not
      // with the resolution the source file came from.
      const targetId = parseCorosWatchfaceConfig(
        entry.data.toString("utf8")
      ).watchface_id;
      const paired = targetId
        ? applyCorosWatchfaceConfigOverrides(synthesized, {
            watchface_id: targetId
          })
        : synthesized;
      orderedEntries.splice(orderedEntries.indexOf(entry) + 1, 0, {
        name: aodPath,
        data: Buffer.from(paired, "utf8")
      });
      finalPaths.add(aodPath);
    }
  }
  return createStoreZip(orderedEntries);
}

async function inspectArchive(
  archivePath: string,
  archiveId: string = crypto.randomUUID()
): Promise<SelectedArchive> {
  const normalizedPath = path.resolve(archivePath);
  const stat = await fs.promises.stat(normalizedPath);
  if (!stat.isFile()) {
    throw new Error("Choose a watchface archive file.");
  }
  if (stat.size <= 0 || stat.size > MAX_ARCHIVE_BYTES) {
    throw new Error("The archive must be between 1 byte and 25 MB.");
  }

  const directory = await openTemplateArchive(normalizedPath);
  validateArchiveInventory(
    directory.files,
    MAX_ARCHIVE_FILES,
    MAX_ARCHIVE_EXPANDED_BYTES,
    MAX_ARCHIVE_ENTRY_BYTES,
    7,
    "watch-face archive"
  );
  const resolutionDirectories = [
    ...new Set(
      directory.files.flatMap((entry) => {
        const match = entry.path.match(/^(watchface_(\d+)x(\d+))\/config\.txt$/i);
        return match ? [match[1]!] : [];
      })
    )
  ].sort();
  const resolutionProfile = detectWatchfaceResolutionProfile(
    resolutionDirectories
  );

  const infoEntry = directory.files.find(
    (entry) => entry.type === "File" && entry.path.replace(/^\.\//, "") === "info.json"
  );
  if (!infoEntry) {
    throw new Error("The archive must contain an info.json template manifest.");
  }
  if ((infoEntry.size ?? infoEntry.uncompressedSize ?? 0) > MAX_INFO_BYTES) {
    throw new Error("The template manifest is unexpectedly large.");
  }
  if (!directory.files.some((entry) => entry.path === "watchface_customize.png")) {
    throw new Error("The archive is missing watchface_customize.png.");
  }

  const rawInfo = (await infoEntry.buffer()).toString("utf8");
  let manifest: ArchiveInfo;
  try {
    manifest = JSON.parse(rawInfo) as ArchiveInfo;
  } catch {
    throw new Error("info.json is not valid UTF-8 JSON.");
  }
  // Official template IDs exceed Number.MAX_SAFE_INTEGER, so take the digits
  // straight from the raw manifest text and keep the ID as decimal text.
  const sourceTemplateId =
    extractDecimalProperty(rawInfo, "o_template_id") ??
    (typeof manifest.o_template_id === "string"
      ? manifest.o_template_id.trim()
      : undefined);
  const diyVersion = Number(manifest.o_diy_version ?? 1);
  const watchFaceVersion = Number(manifest.o_wf_ver ?? 0);
  if (
    !sourceTemplateId ||
    !/^\d{1,20}$/.test(sourceTemplateId) ||
    /^0+$/.test(sourceTemplateId)
  ) {
    throw new Error("info.json must include a valid o_template_id.");
  }
  if (!Number.isSafeInteger(diyVersion) || diyVersion < 1) {
    throw new Error("info.json must include a valid o_diy_version.");
  }
  if (
    !Number.isSafeInteger(watchFaceVersion) ||
    watchFaceVersion < 0 ||
    watchFaceVersion > 999
  ) {
    throw new Error("info.json must include a valid o_wf_ver when present.");
  }

  return {
    archiveId,
    path: normalizedPath,
    modifiedMs: stat.mtimeMs,
    fileName: path.basename(normalizedPath),
    sizeBytes: stat.size,
    sourceTemplateId,
    diyVersion,
    watchFaceVersion,
    resolutionDirectories,
    resolutionProfile
  };
}

function validateArchiveInventory(
  entries: UnzipperFile[],
  maxFiles: number,
  maxExpandedBytes: number,
  maxEntryBytes: number,
  maxDepth: number,
  label: string
): void {
  const files = entries.filter((entry) => entry.type === "File");
  if (files.length > maxFiles) {
    throw new Error(`The ${label} contains too many files.`);
  }
  let expandedBytes = 0;
  for (const entry of entries) {
    const normalized = entry.path.normalize("NFC");
    const contentPath = normalized.endsWith("/")
      ? normalized.slice(0, -1)
      : normalized;
    const parts = contentPath.split("/");
    if (
      !contentPath ||
      normalized.length > 900 ||
      /[\u0000-\u001f\u007f\\]/.test(normalized) ||
      normalized.startsWith("/") ||
      /^[a-z]:\//i.test(normalized) ||
      parts.some((part) => !part || part === "." || part === "..") ||
      parts.length > maxDepth
    ) {
      throw new Error(`The ${label} contains an unsafe path.`);
    }
    if (entry.type !== "File") continue;
    const size = entry.uncompressedSize ?? entry.size ?? 0;
    if (!Number.isFinite(size) || size < 0 || size > maxEntryBytes) {
      throw new Error(`The ${label} contains an invalid or oversized file.`);
    }
    expandedBytes += size;
    if (expandedBytes > maxExpandedBytes) {
      throw new Error(`The ${label} expands beyond its safe size limit.`);
    }
  }
}

function toPublicArchive(archive: SelectedArchive): CorosWatchfaceArchive {
  const {
    path: _path,
    modifiedMs: _modifiedMs,
    resolutionDirectories: _resolutionDirectories,
    ...publicArchive
  } = archive;
  return publicArchive;
}

function sanitizeTemplateName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name) {
    throw new Error("Enter a name for the custom watchface.");
  }
  if (name.length > 64) {
    throw new Error("Watchface names must be 64 characters or fewer.");
  }
  return name;
}

function normalizeLanguage(value: string | undefined): string {
  const language = (value || "en-US").trim();
  if (!/^[a-z]{2,3}-[A-Z]{2}$/.test(language)) {
    throw new Error("Language must use a locale such as en-US.");
  }
  return language;
}

function normalizeOptionalFirmwareType(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const firmwareType = typeof value === "string" ? value.trim() : "";
  if (
    !firmwareType ||
    firmwareType.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(firmwareType)
  ) {
    throw new Error("Enter a valid COROS firmware type.");
  }
  return firmwareType;
}

function validateOptionalWatchFaceVersion(
  value: unknown,
  label: string
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 999) {
    throw new Error(`${label} must be a whole number from 0 to 999.`);
  }
  return Number(value);
}

function assertFirmwareResolutionCompatibility(
  resolutionDirectories: string[],
  firmwareType: string | undefined,
  watchModel?: WatchModelId
): void {
  const normalizedFirmwareType = firmwareType?.trim().toUpperCase();
  const compatibility =
    normalizedFirmwareType === "COROS W336" || watchModel === "pace-4"
      ? {
          label: "PACE 4",
          required: ["watchface_390x390", "watchface_800x800"]
        }
      : normalizedFirmwareType === "COROS W541" || watchModel === "apex-4"
        ? {
            label: "APEX 4",
            required: ["watchface_240x240", "watchface_260x260"]
          }
        : null;
  if (!compatibility) {
    return;
  }
  const missing = compatibility.required.filter(
    (directory) => !resolutionDirectories.includes(directory)
  );
  if (missing.length > 0) {
    throw new Error(
      `${compatibility.label}${firmwareType ? ` (${firmwareType})` : ""} requires ${compatibility.required
        .map((directory) => directory.replace("watchface_", "").replace("x", "×"))
        .join(" and ")} exports. This template is missing ${missing
        .map((directory) => directory.replace("watchface_", ""))
        .join(" and ")}. Browse and choose a ${compatibility.label} template before exporting.`
    );
  }
}

function detectWatchfaceResolutionProfile(
  resolutionDirectories: string[]
): CorosWatchfaceArchive["resolutionProfile"] {
  const resolutions = new Set(resolutionDirectories);
  if (
    resolutions.has("watchface_240x240") &&
    resolutions.has("watchface_260x260") &&
    resolutions.has("watchface_800x800")
  ) {
    return "mip-240-260-800";
  }
  if (
    resolutions.has("watchface_416x416") &&
    resolutions.has("watchface_800x800")
  ) {
    return "amoled-416-800";
  }
  // PACE 4 class: 1.2" AMOLED trees ship as 390px plus the 800px master.
  if (
    resolutions.has("watchface_390x390") &&
    resolutions.has("watchface_800x800")
  ) {
    return "amoled-390-800";
  }
  return "other";
}

async function mobileRequest<T>(
  endpoint: string,
  options: {
    method: "POST";
    body: string | FormData;
    accessToken?: string;
    includeAccessTokenInQuery?: boolean;
    userId?: string;
    allowedResultCodes?: string[];
    extraHeaders?: Record<string, string>;
    /** Override the regional host (used by login, before a session exists). */
    baseUrl?: string;
  }
): Promise<MobileApiEnvelope<T> & { raw: string }> {
  const query = options.accessToken && options.includeAccessTokenInQuery !== false
    ? `?accessToken=${encodeURIComponent(options.accessToken)}`
    : "";
  const headers: Record<string, string> = {
    ...mobileHeaders(options.accessToken, options.userId),
    ...options.extraHeaders
  };
  if (typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  const baseUrl = options.baseUrl ?? mobileApiBaseUrl(readStoredSession()?.region);
  const response = await fetch(`${baseUrl}${endpoint}${query}`, {
    method: options.method,
    headers,
    body: options.body
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`COROS watchface request failed (HTTP ${response.status}).`);
  }

  let payload: MobileApiEnvelope<T>;
  try {
    payload = parseCorosMobileJson(raw) as MobileApiEnvelope<T>;
  } catch {
    throw new Error("COROS returned an unreadable watchface response.");
  }
  const result = mobileApiResult(payload);
  if (result !== API_SUCCESS && !options.allowedResultCodes?.includes(result)) {
    if (result === "1019") {
      logoutCorosWatchfaces();
      throw new Error("Your COROS mobile session expired. Sign in again.");
    }
    throw new Error(payload.message?.trim() || "COROS rejected the watchface request.");
  }
  return { ...payload, raw };
}

function normalizeCorosDeviceIdentifier(value: unknown, label: string): string {
  const identifier = typeof value === "string" ? value.trim() : "";
  if (!identifier || identifier.length > 128 || /[\u0000-\u001f\u007f]/.test(identifier)) {
    throw new Error(`Enter a valid ${label}.`);
  }
  return identifier;
}

function mobileApiResult(payload: MobileApiEnvelope<unknown>): string {
  return String(payload.result ?? payload.apiCode ?? "");
}

function mobileHeaders(accessToken?: string, userId?: string): Record<string, string> {
  const installId = getMobileInstallId();
  const timezoneQuarterHours = -Math.round(new Date().getTimezoneOffset() / 15);
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "YFHeader": buildMobileYfHeader(installId, timezoneQuarterHours, userId),
    "app-state": "foreground",
    "request-time": String(Date.now())
  };
  if (accessToken) {
    headers.accesstoken = accessToken;
  }
  return headers;
}

function buildMobileYfHeader(
  installId: string,
  timezoneQuarterHours: number,
  userId?: string
): string {
  const safeUserId = userId && /^\d+$/.test(userId) ? userId : "0";
  const prefix = JSON.stringify({
    appVersion: MOBILE_APP_VERSION,
    clientType: 1,
    language: "en-US",
    mobileName: installId,
    releaseType: 1,
    systemDisplayId: `c${crypto.createHash("sha256").update(installId).digest("hex")}`,
    systemVersion: "16",
    timezone: timezoneQuarterHours
  });
  const suffix = JSON.stringify({
    userSettingScope: MOBILE_USER_SETTING_SCOPE,
    versionCode: MOBILE_VERSION_CODE
  });

  // Keep a large user ID as a JSON numeric literal. JSON.stringify would round
  // the value before it ever reached the COROS API.
  return `${prefix.slice(0, -1)},"userId":${safeUserId},${suffix.slice(1)}`;
}

function getMobileInstallId(): string {
  const existing = getSetting(SETTINGS.installId);
  if (existing && /^[a-f0-9]{32}$/.test(existing)) {
    return existing;
  }
  const installId = crypto.randomBytes(16).toString("hex");
  setSetting(SETTINGS.installId, installId);
  return installId;
}

function isOfficialShareUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "faq.coros.com";
  } catch {
    return false;
  }
}

function requireSession(): StoredMobileSession {
  const session = readStoredSession();
  if (!session) {
    throw new Error("Sign in to your COROS mobile account before publishing.");
  }
  return session;
}

function readStoredSession(): StoredMobileSession | null {
  if (inMemorySession) {
    return inMemorySession;
  }
  const encoded = getSetting(SETTINGS.session);
  if (!encoded || !safeStorage.isEncryptionAvailable()) {
    return null;
  }
  try {
    const session = JSON.parse(
      safeStorage.decryptString(Buffer.from(encoded, "base64"))
    ) as StoredMobileSession;
    if (!session.accessToken?.trim()) {
      return null;
    }
    inMemorySession = session;
    return session;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredMobileSession): void {
  inMemorySession = session;
  if (!safeStorage.isEncryptionAvailable()) {
    // Never fall back to plaintext persistence for a mobile session.
    deleteSettings([SETTINGS.session]);
    return;
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(session)).toString("base64");
  setSetting(SETTINGS.session, encrypted);
}
