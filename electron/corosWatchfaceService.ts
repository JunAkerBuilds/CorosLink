import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativeImage, safeStorage } from "electron";
import QRCode from "qrcode";
import { deleteSettings, getSetting, setSetting } from "./database";
import { createStoreZip } from "./zipStore";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceArtwork,
  CorosWatchfaceCreatorInput,
  CorosWatchfacePublishInput,
  CorosWatchfaceShareLink,
  CorosWatchfaceStatus,
  CorosWatchfaceTheme,
  CorosWatchfaceThemeListInput
} from "./types";

const API_BASE_URL = "https://api.coros.com/coros";
const MOBILE_APP_KEY = "3475792298363620";
const MOBILE_LOGIN_IV = "weloop3_2015_03#";
const MOBILE_VERSION_CODE = "407081000";
const MOBILE_APP_VERSION = 1125929972137984;
const MOBILE_USER_SETTING_SCOPE = "CAEQARgBIAEoATABOAFAAQ==";
const API_SUCCESS = "0000";
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_INFO_BYTES = 1024 * 1024;
const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
const CREATOR_CANVAS_SIZE = 800;

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
}

interface SelectedArchive extends CorosWatchfaceArchive {
  path: string;
  modifiedMs: number;
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
  return {
    authenticated: Boolean(readStoredSession()),
    secureStorageAvailable: safeStorage.isEncryptionAvailable()
  };
}

export async function loginCorosWatchfaces(
  email: string,
  password: string
): Promise<CorosWatchfaceStatus> {
  const account = email.trim();
  if (!account || !password) {
    throw new Error("Enter your COROS email and password.");
  }

  let envelope = await mobileRequest<{ accessToken?: string }>(
    "/user/login",
    {
      method: "POST",
      body: JSON.stringify(buildMobileLoginPayload(account, password, 1)),
      allowedResultCodes: ["1115"]
    }
  );

  // `1115 / User logged in` is the mobile client's session-conflict checkpoint.
  // Retrying with checkStatus=0 is the app's own completion step and returns the
  // normal token-bearing 0000 response.
  if (mobileApiResult(envelope) === "1115") {
    envelope = await mobileRequest<{ accessToken?: string }>("/user/login", {
      method: "POST",
      body: JSON.stringify(buildMobileLoginPayload(account, password, 0))
    });
  }

  const accessToken = envelope.data?.accessToken?.trim();
  if (!accessToken) {
    throw new Error("COROS login did not return a session token.");
  }

  writeStoredSession({
    accessToken,
    userId: extractDecimalProperty(envelope.raw, "userId")
  });
  return getCorosWatchfaceStatus();
}

export function logoutCorosWatchfaces(): CorosWatchfaceStatus {
  inMemorySession = null;
  deleteSettings([SETTINGS.session]);
  return getCorosWatchfaceStatus();
}

/**
 * Lists the official themes that the COROS mobile app exposes for a watch
 * model. This is deliberately read-only: a listed theme is not an uploadable
 * source archive and still must be obtained through COROS's own app flow.
 */
export async function listCorosWatchfaceThemes(
  input: CorosWatchfaceThemeListInput
): Promise<CorosWatchfaceTheme[]> {
  const session = requireSession();
  const firmwareType = input?.firmwareType?.trim();
  if (!firmwareType) {
    throw new Error("Enter the COROS firmware type to browse themes.");
  }
  const maxWatchFaceVersion = input.maxWatchFaceVersion ?? 5;
  if (
    !Number.isSafeInteger(maxWatchFaceVersion) ||
    maxWatchFaceVersion < 0 ||
    maxWatchFaceVersion > 999
  ) {
    throw new Error("Maximum watchface version must be a whole number from 0 to 999.");
  }

  const serialNumber = input.serialNumber?.trim();
  if (serialNumber && (serialNumber.length > 80 || /[\u0000-\u001f\u007f]/.test(serialNumber))) {
    throw new Error("Watch serial number contains unsupported characters.");
  }

  const themes = await mobileRequest<unknown>("/watchface/getWatchFaceThemeList", {
    method: "POST",
    accessToken: session.accessToken,
    userId: session.userId,
    body: JSON.stringify({
      accessToken: session.accessToken,
      firmwareType,
      language: normalizeLanguage(input.language),
      maxWatchFaceVersion,
      orderType: 1,
      releaseType: 1,
      saveOrUpdate: 1,
      ...(serialNumber ? { snCode: serialNumber } : {}),
      version: 2
    })
  });

  return normalizeCorosWatchfaceThemes(themes.data);
}

/**
 * Validate the selected package before it can be published. The opaque ID
 * deliberately prevents the renderer from asking the main process to upload
 * an arbitrary local file path.
 */
export async function selectCorosWatchfaceArchive(
  archivePath: string
): Promise<CorosWatchfaceArchive> {
  const selected = await inspectArchive(archivePath);
  selectedArchives.set(selected.archiveId, selected);
  return toPublicArchive(selected);
}

/**
 * Import a user-selected image as an editor asset. It stays renderer-visible
 * only as a resized data URL; the original path never crosses the IPC bridge.
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
  const originalSize = image.getSize();
  const maxDimension = Math.max(originalSize.width, originalSize.height);
  const scaled =
    maxDimension > 1400
      ? image.resize({
          width: Math.round((originalSize.width / maxDimension) * 1400),
          height: Math.round((originalSize.height / maxDimension) * 1400),
          quality: "best"
        })
      : image;
  const size = scaled.getSize();
  return {
    dataUrl: scaled.toDataURL(),
    width: size.width,
    height: size.height
  };
}

/**
 * Builds a new uploadable archive by replacing only the source template's
 * background and preview assets. Its time, date, battery, and complications
 * remain the known-good template controls rather than a simulated preview.
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
  const verifiedSource = await inspectArchive(source.path, source.archiveId);
  if (verifiedSource.modifiedMs !== source.modifiedMs) {
    selectedArchives.set(verifiedSource.archiveId, verifiedSource);
    throw new Error("The starter template changed. Choose it again before creating.");
  }

  const background = renderCreatorBackground(input.backgroundDataUrl);
  const replacements = buildCreatorAssetReplacements(background);
  const zip = await rewriteTemplateArchive(verifiedSource.path, replacements, background);
  const outputDirectory = path.join(os.tmpdir(), "coroslink-watchface-creator");
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${crypto.randomUUID()}.dat`);
  await fs.promises.writeFile(outputPath, zip);

  const generated = await inspectArchive(outputPath);
  const selected: SelectedArchive = {
    ...generated,
    fileName: "CorosLink custom face.dat"
  };
  selectedArchives.set(selected.archiveId, selected);
  return toPublicArchive(selected);
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
  const firmwareType = input.firmwareType.trim();
  if (!firmwareType) {
    throw new Error("Enter the COROS firmware type for this template.");
  }
  if (!Number.isSafeInteger(input.backgroundImageId) || input.backgroundImageId < 0) {
    throw new Error("Background image ID must be a non-negative integer.");
  }

  const archiveBytes = await fs.promises.readFile(freshArchive.path);
  const saveBody = {
    accessToken: session.accessToken,
    backgroundImageId: input.backgroundImageId,
    firmwareType,
    language: normalizeLanguage(input.language),
    maxWatchFaceVersion: 0,
    releaseType: 1,
    saveOrUpdate: 1,
    srcWatchFaceTemplateId: freshArchive.sourceTemplateId,
    version: 2,
    watchFaceTemplateName: name
  };
  const form = new FormData();
  form.append("jsonParameter", JSON.stringify(saveBody));
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

  const linkBody = buildCreateLinkBody({
    backgroundImageId: input.backgroundImageId,
    firmwareType,
    sourceTemplateId: freshArchive.sourceTemplateId,
    templateId,
    name
  });
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
  sourceTemplateId: number;
  templateId: string;
  name: string;
}): string {
  if (!/^\d+$/.test(input.templateId)) {
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
 * The mobile client has used a few response shapes for this endpoint. Keep
 * the renderer insulated from those server-side naming changes and expose a
 * small, safe read-only catalog shape instead.
 */
export function normalizeCorosWatchfaceThemes(data: unknown): CorosWatchfaceTheme[] {
  const entries = findThemeEntries(data);
  const seen = new Set<string>();
  const themes: CorosWatchfaceTheme[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = readString(record, [
      "watchFaceThemeId",
      "watchFaceTemplateId",
      "watchfaceId",
      "id"
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
    const key = id || `${name ?? ""}|${previewImageUrl ?? ""}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    themes.push({
      ...(id ? { id } : {}),
      name: name || (id ? `COROS theme ${id}` : "Untitled COROS theme"),
      ...(previewImageUrl ? { previewImageUrl } : {}),
      ...(readString(record, ["firmwareType", "watchFirmwareType"]) ? {
        firmwareType: readString(record, ["firmwareType", "watchFirmwareType"])
      } : {}),
      ...(readInteger(record, ["backgroundImageId"]) !== undefined ? {
        backgroundImageId: readInteger(record, ["backgroundImageId"])
      } : {}),
      ...(readInteger(record, ["watchFaceVersion", "watchfaceVersion", "version"]) !== undefined ? {
        watchFaceVersion: readInteger(record, ["watchFaceVersion", "watchfaceVersion", "version"])
      } : {}),
      ...(readString(record, ["categoryName", "watchFaceCategoryName", "category", "styleName"]) ? {
        category: readString(record, ["categoryName", "watchFaceCategoryName", "category", "styleName"])
      } : {})
    });
  }

  return themes;
}

function findThemeEntries(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  const record = asRecord(data);
  if (!record) {
    return [];
  }
  const listKeys = [
    "watchFaceThemeList",
    "watchFaceThemeDTOList",
    "watchFaceTemplateList",
    "watchFaceList",
    "themeList",
    "list",
    "records"
  ];
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
  password: string,
  checkStatus: 0 | 1
): Record<string, string | number | boolean> {
  return {
    account: encryptMobileLoginField(account),
    accountType: 2,
    appKey: MOBILE_APP_KEY,
    checkStatus,
    clientType: 1,
    hasHrCalibrated: 0,
    kbValidity: 0,
    // The Android client MD5-hashes the password before passing its
    // 32-character hex value through the mobile-field cipher.
    pwd: encryptMobileLoginField(
      crypto.createHash("md5").update(password, "utf8").digest("hex")
    ),
    region: buildMobileLoginRegion(),
    skipValidation: false
  };
}

function renderCreatorBackground(dataUrl: string) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("The creator background must be a PNG canvas image.");
  }
  const encoded = dataUrl.slice("data:image/png;base64,".length);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > MAX_ARTWORK_BYTES) {
    throw new Error("The created watchface image must be smaller than 10 MB.");
  }
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error("The created watchface image could not be rendered.");
  }
  return image.resize({
    width: CREATOR_CANVAS_SIZE,
    height: CREATOR_CANVAS_SIZE,
    quality: "best"
  });
}

function buildCreatorAssetReplacements(background: Electron.NativeImage): Map<string, Buffer> {
  const full = background.toPNG();
  const compact = background
    .resize({ width: 416, height: 416, quality: "best" })
    .toPNG();
  const replacements = new Map<string, Buffer>();

  // The full-size background is the only active visual element we alter. The
  // template renders dynamic fields above it from config.txt and sprite assets.
  replacements.set("watchface_800x800/background.png", full);
  replacements.set("watchface_416x416/background.png", compact);
  replacements.set("watchface_customize.png", full);
  replacements.set("watchface_800x800/watchface_customize.png", full);
  replacements.set("watchface_416x416/watchface_customize.png", compact);
  replacements.set(
    "watchface_800x800/thmb.png",
    background.resize({ width: 606, height: 606, quality: "best" }).toPNG()
  );
  replacements.set(
    "watchface_416x416/thmb.png",
    background.resize({ width: 315, height: 315, quality: "best" }).toPNG()
  );
  return replacements;
}

async function rewriteTemplateArchive(
  sourcePath: string,
  replacements: Map<string, Buffer>,
  background: Electron.NativeImage
): Promise<Buffer> {
  const unzipper = require("unzipper") as UnzipperModule;
  const directory = await unzipper.Open.file(sourcePath);
  const sourceFiles = directory.files.filter((entry) => entry.type === "File");
  const sourcePaths = new Set(sourceFiles.map((entry) => entry.path));
  for (const required of [
    "watchface_customize.png",
    "watchface_800x800/background.png",
    "watchface_800x800/thmb.png"
  ]) {
    if (!sourcePaths.has(required)) {
      throw new Error("This template does not include the assets required by the creator.");
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
    sourceFiles.map(async (entry) => ({
      name: entry.path,
      data: replacements.get(entry.path) ?? (await entry.buffer())
    }))
  );
  return createStoreZip(entries);
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

  const unzipper = require("unzipper") as UnzipperModule;
  let directory: { files: UnzipperFile[] };
  try {
    directory = await unzipper.Open.file(normalizedPath);
  } catch {
    throw new Error("That file is not a readable ZIP watchface archive.");
  }

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

  let manifest: ArchiveInfo;
  try {
    manifest = JSON.parse((await infoEntry.buffer()).toString("utf8")) as ArchiveInfo;
  } catch {
    throw new Error("info.json is not valid UTF-8 JSON.");
  }
  const sourceTemplateId = Number(manifest.o_template_id);
  const diyVersion = Number(manifest.o_diy_version ?? 1);
  if (!Number.isSafeInteger(sourceTemplateId) || sourceTemplateId <= 0) {
    throw new Error("info.json must include a valid o_template_id.");
  }
  if (!Number.isSafeInteger(diyVersion) || diyVersion < 1) {
    throw new Error("info.json must include a valid o_diy_version.");
  }

  return {
    archiveId,
    path: normalizedPath,
    modifiedMs: stat.mtimeMs,
    fileName: path.basename(normalizedPath),
    sizeBytes: stat.size,
    sourceTemplateId,
    diyVersion
  };
}

function toPublicArchive(archive: SelectedArchive): CorosWatchfaceArchive {
  const { path: _path, modifiedMs: _modifiedMs, ...publicArchive } = archive;
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

async function mobileRequest<T>(
  endpoint: string,
  options: {
    method: "POST";
    body: string | FormData;
    accessToken?: string;
    userId?: string;
    allowedResultCodes?: string[];
  }
): Promise<MobileApiEnvelope<T> & { raw: string }> {
  const query = options.accessToken
    ? `?accessToken=${encodeURIComponent(options.accessToken)}`
    : "";
  const headers = mobileHeaders(options.accessToken, options.userId);
  if (typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${API_BASE_URL}${endpoint}${query}`, {
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
    payload = JSON.parse(raw) as MobileApiEnvelope<T>;
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
