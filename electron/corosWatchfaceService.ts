import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, nativeImage, safeStorage } from "electron";
import QRCode from "qrcode";
import { deleteSettings, getSetting, setSetting } from "./database";
import { createStoreZip } from "./zipStore";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceArtwork,
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceCreatorInput,
  CorosWatchfacePublishInput,
  CorosWatchfaceProject,
  CorosWatchfaceProjectSaveInput,
  CorosWatchfaceProjectSummary,
  CorosWatchfaceResolutionDetails,
  CorosWatchfaceShareLink,
  CorosWatchfaceSpriteFile,
  CorosWatchfaceSpriteFolder,
  CorosWatchfaceStatus,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails,
  CorosWatchfaceTheme,
  CorosWatchfaceThemeDownload,
  CorosWatchfaceThemeDownloadInput,
  CorosWatchfaceThemeListInput,
  CorosBatteryQueryInput,
  CorosBatteryReport,
  CorosBatteryUsageDetail,
  CorosBatteryUsageGroup,
  CorosBatteryDay,
  CorosPairedDevice
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
const MAX_PROJECT_BYTES = 60 * 1024 * 1024;
const CREATOR_CANVAS_SIZE = 800;
const MAX_SPRITE_REPLACEMENTS = 800;
const MAX_SPRITE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_SPRITE_BYTES = 20 * 1024 * 1024;
const MAX_TEMPLATE_ASSET_REQUESTS = 800;
const MAX_CONFIG_OVERRIDE_FILES = 8;
const MAX_CONFIG_OVERRIDE_KEYS = 200;
const CONFIG_KEY_PATTERN = /^[a-z0-9_]{1,64}$/i;
const CREATED_STUDIO_SPRITE_PATTERN =
  /^watchface_(?:416x416|800x800)\/(?:studio\/[a-z0-9_-]{1,64}|cl_[a-z0-9_]{1,32})\/\d{2}\.png$/i;
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

/** Lists the official editable source templates exposed for a watch model. */
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

  const themes = await mobileRequest<unknown>("/watchfaceTemplate/query", {
    method: "POST",
    accessToken: session.accessToken,
    userId: session.userId,
    body: JSON.stringify({
      accessToken: session.accessToken,
      firmwareType,
      language: normalizeLanguage(input.language),
      maxWatchFaceVersion,
      page: 0,
      releaseType: 1,
      saveOrUpdate: 1,
      size: 1000,
      version: 2
    })
  });

  const normalized = normalizeCorosWatchfaceThemes(themes.data);
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

  const safeName = (input.name ?? "COROS template")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "")
    .trim()
    .slice(0, 60) || "COROS template";
  const outputDirectory = path.join(os.tmpdir(), "coroslink-watchface-themes");
  await fs.promises.mkdir(outputDirectory, { recursive: true });

  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    // Keep the raw payload so the unknown format can be analyzed offline.
    const rawPath = path.join(outputDirectory, `${crypto.randomUUID()}-raw.bin`);
    await fs.promises.writeFile(rawPath, bytes);
    return {
      fileName: `${safeName} (raw response)`,
      sizeBytes: bytes.length,
      usableAsTemplate: false,
      message: `COROS answered with ${describeUnknownPayload(bytes, contentType)}. A raw copy was saved to ${rawPath} for analysis.`
    };
  }

  const outputPath = path.join(outputDirectory, `${crypto.randomUUID()}.dat`);
  await fs.promises.writeFile(outputPath, bytes);

  try {
    const inspected = await inspectArchive(outputPath);
    const selected: SelectedArchive = { ...inspected, fileName: `${safeName}.dat` };
    selectedArchives.set(selected.archiveId, selected);
    return {
      fileName: selected.fileName,
      sizeBytes: selected.sizeBytes,
      usableAsTemplate: true,
      archive: toPublicArchive(selected),
      message: `Downloaded ${safeName} and validated it as a starter template.`
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
      message:
        inspectionError instanceof Error
          ? `Downloaded a ZIP package, but it is not a DIY starter: ${inspectionError.message}`
          : "Downloaded a ZIP package, but it is not a DIY starter template."
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
  if (bytes.length === 0 || bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error("The template package must be between 1 byte and 25 MB.");
  }
  return {
    bytes,
    contentType: response.headers.get("content-type") ?? "unknown"
  };
}

function withAccessTokenParam(url: string, session: StoredMobileSession): string {
  const parsed = new URL(url);
  if (
    parsed.hostname === "api.coros.com" &&
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
  const selected = await inspectArchive(archivePath);
  selectedArchives.set(selected.archiveId, selected);
  return toPublicArchive(selected);
}

interface StoredWatchfaceProject {
  projectId: string;
  name: string;
  updatedAt: string;
  sourceTemplateId: number;
  design: CorosWatchfaceProjectSaveInput["design"];
}

function watchfaceProjectsDirectory(): string {
  return path.join(app.getPath("userData"), "watchface-projects");
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
  ) as StoredWatchfaceProject;
  if (
    parsed.projectId !== id ||
    typeof parsed.name !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    !Number.isSafeInteger(parsed.sourceTemplateId) ||
    !parsed.design ||
    parsed.design.version !== 1
  ) {
    throw new Error("The saved watchface project metadata is invalid.");
  }
  return parsed;
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
  const stored: StoredWatchfaceProject = {
    projectId,
    name,
    updatedAt,
    sourceTemplateId: source.sourceTemplateId,
    design: input.design
  };
  const temporaryManifest = `${manifestPath}.tmp`;
  await fs.promises.writeFile(temporaryManifest, JSON.stringify(stored), "utf8");
  await fs.promises.rename(temporaryManifest, manifestPath);
  const selected = await inspectArchive(templatePath);
  selectedArchives.set(selected.archiveId, selected);
  return { ...stored, archive: toPublicArchive(selected) };
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
          const { design: _design, ...summary } = stored;
          return summary;
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
  const templatePath = path.join(
    watchfaceProjectsDirectory(),
    stored.projectId,
    "starter.dat"
  );
  const selected = await inspectArchive(templatePath);
  selectedArchives.set(selected.archiveId, selected);
  return { ...stored, archive: toPublicArchive(selected) };
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
  const sprites = decodeSpriteReplacements(input.assetReplacements);
  const configOverrides = validateConfigOverrides(input.configOverrides);
  const zip = await rewriteTemplateArchive(
    verifiedSource.path,
    replacements,
    background,
    sprites,
    configOverrides
  );
  const outputDirectory = path.join(app.getPath("userData"), "watchface-archives");
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
    resolutions.push({
      directory: directoryName,
      width: Number(dims[1]),
      height: Number(dims[2]),
      config: await readTemplateConfig(filesByPath, `${directoryName}/config.txt`),
      aodConfig: await readTemplateConfig(filesByPath, `${directoryName}/AODconfig.txt`),
      ...(await discoverSpriteAssets(files, directoryName))
    });
  }

  return { archiveId: source.archiveId, resolutions };
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
    if (data.length > MAX_SPRITE_BYTES) {
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
 * other byte (comments, ordering, CRLF). Keys the file does not define are an
 * error: the firmware only reads known keys, so a miss means a typo or a
 * template that does not support the element being moved.
 */
export function applyCorosWatchfaceConfigOverrides(
  text: string,
  overrides: Record<string, string>
): string {
  const pending = new Map(Object.entries(overrides));
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*)\[([^\]]+)\]\s*=.*$/);
    if (!match || !pending.has(match[2]!)) {
      return line;
    }
    const value = pending.get(match[2]!)!;
    pending.delete(match[2]!);
    return `${match[1]}[${match[2]}]=${value}`;
  });
  if (pending.size > 0) {
    throw new Error(
      `The template's config does not define: ${[...pending.keys()].join(", ")}.`
    );
  }
  return lines.join(newline);
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
 * 00.png–09.png is a digit font; 00.png–06.png is a weekday-label font. The
 * `a/` subtree holds the same structure for the always-on display.
 */
async function discoverSpriteAssets(
  files: UnzipperFile[],
  resolutionDirectory: string
): Promise<Pick<CorosWatchfaceResolutionDetails, "spriteFolders" | "icons">> {
  const prefix = `${resolutionDirectory}/`;
  const folderFiles = new Map<string, Map<number, UnzipperFile>>();
  const iconEntries: UnzipperFile[] = [];

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
    if (/^(a\/)?icon\/[^/]+\.png$/i.test(relative)) {
      iconEntries.push(entry);
    }
  }

  const spriteFolders: CorosWatchfaceSpriteFolder[] = [];
  for (const [folder, numbered] of folderFiles) {
    const kind = classifySpriteFolder(numbered);
    if (!kind) {
      continue;
    }
    const count = kind === "digits" ? 10 : 7;
    const spriteFiles: CorosWatchfaceSpriteFile[] = [];
    for (let index = 0; index < count; index += 1) {
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
      create: replacement.create === true
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
    const id = readWatchfaceId(record);
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
    const packageUrlCandidate = readHttpsUrl(record, [
      "watchFaceTemplateUrl",
      "watchFaceUrl",
      "watchfaceUrl",
      "watchFaceFileUrl",
      "fileUrl",
      "zipUrl",
      "downloadUrl",
      "resourceUrl"
    ]);
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
  const entries = record && Array.isArray(record.deviceParamList)
    ? record.deviceParamList
    : [];
  const devices: CorosPairedDevice[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const device = asRecord(entry);
    if (!device) {
      continue;
    }
    const deviceId = readString(device, ["deviceId"]);
    const firmwareType = readString(device, ["firmwareType"]);
    const uuid = readString(device, ["uuid"]);
    if (!deviceId || !firmwareType || !uuid || seen.has(deviceId)) {
      continue;
    }
    seen.add(deviceId);
    const mac = readString(device, ["mac"]);
    devices.push({
      deviceId,
      firmwareType,
      uuid,
      ...(mac ? { mac } : {})
    });
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

function findThemeEntries(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  const record = asRecord(data);
  if (!record) {
    return [];
  }

  // The response's `watchFaceTemplateList` is the signed-in user's custom
  // archives. Official catalog faces are grouped under
  // `watchFaceThemeList[*].watchFaceList`, so never merge the two here.
  if (Array.isArray(record.watchFaceThemeList)) {
    return record.watchFaceThemeList.flatMap((theme) => {
      const group = asRecord(theme);
      return group && Array.isArray(group.watchFaceList) ? group.watchFaceList : [];
    });
  }

  const listKeys = [
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
  background: Electron.NativeImage,
  spriteReplacements: Map<string, DecodedSpriteReplacement> = new Map(),
  configOverrides: Map<string, Record<string, string>> = new Map()
): Promise<Buffer> {
  const directory = await openTemplateArchive(sourcePath);
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
  for (const spritePath of spriteReplacements.keys()) {
    const sprite = spriteReplacements.get(spritePath)!;
    if (sprite.create && sourcePaths.has(spritePath)) {
      throw new Error("A new studio sprite collides with a starter template entry.");
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
      const backgroundData = replacements.get(entry.path);
      if (backgroundData) {
        return { name: entry.path, data: backgroundData };
      }
      const overrides = configOverrides.get(entry.path);
      if (overrides) {
        return {
          name: entry.path,
          data: Buffer.from(
            applyCorosWatchfaceConfigOverrides(
              (await entry.buffer()).toString("utf8"),
              overrides
            ),
            "utf8"
          )
        };
      }
      const sprite = spriteReplacements.get(entry.path);
      if (!sprite) {
        return { name: entry.path, data: await entry.buffer() };
      }
      // Sprites must keep the template's exact pixel size: the firmware lays
      // digits and icons out with the original bitmap dimensions.
      const original = nativeImage.createFromBuffer(await entry.buffer());
      const { width, height } = original.getSize();
      if (original.isEmpty() || width !== sprite.width || height !== sprite.height) {
        throw new Error(
          `The replacement for ${entry.path} must be a ${width}×${height} PNG like the template's.`
        );
      }
      return { name: entry.path, data: sprite.data };
    })
  );
  for (const [spritePath, sprite] of spriteReplacements) {
    if (sprite.create) {
      entries.push({ name: spritePath, data: sprite.data });
    }
  }
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

  const directory = await openTemplateArchive(normalizedPath);

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
    includeAccessTokenInQuery?: boolean;
    userId?: string;
    allowedResultCodes?: string[];
  }
): Promise<MobileApiEnvelope<T> & { raw: string }> {
  const query = options.accessToken && options.includeAccessTokenInQuery !== false
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
