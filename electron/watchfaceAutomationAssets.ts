import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { WatchfaceAutomationAssetRef } from "./watchfaceAutomationTypes";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_IMAGES = 128;
const MAX_DEPTH = 64;
const MAX_RASTER_FILES = 256;
const MAX_RASTER_BYTES = 12 * 1024 * 1024;
const MAX_PAYLOAD_NODES = 250_000;
const MAX_PAYLOAD_STRING_BYTES = 64 * 1024 * 1024;
const ASSET_ID_RE = /^[a-f0-9]{64}$/;

interface StoredAssetMetadata {
  version: 1;
  assetId: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
}

export interface WatchfaceAutomationImportedAsset extends WatchfaceAutomationAssetRef {
  mimeType: StoredAssetMetadata["mimeType"];
  sizeBytes: number;
  width: number;
  height: number;
}

export interface WatchfaceAutomationRasterFolder {
  label: string;
  sprites: Array<{
    name: string;
    relativePath: string;
    dataUrl: WatchfaceAutomationAssetRef;
    sizeBytes: number;
  }>;
}

function imageMimeType(bytes: Buffer): StoredAssetMetadata["mimeType"] | undefined {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  return undefined;
}

function imageDimensions(
  bytes: Buffer,
  mimeType: StoredAssetMetadata["mimeType"]
): { width: number; height: number } | undefined {
  let width = 0;
  let height = 0;
  if (mimeType === "image/png" && bytes.length >= 24 && bytes.subarray(12, 16).toString("ascii") === "IHDR") {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      if (offset + 4 > bytes.length) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + length;
    }
  } else if (mimeType === "image/webp" && bytes.length >= 30) {
    const kind = bytes.subarray(12, 16).toString("ascii");
    if (kind === "VP8X") {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    } else if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  }
  return width > 0 && height > 0 && width <= 16_384 && height <= 16_384
    ? { width, height }
    : undefined;
}

function parseDataImage(value: string): { mimeType: StoredAssetMetadata["mimeType"]; bytes: Buffer } | undefined {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return undefined;
  const bytes = Buffer.from(match[2]!, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_IMAGE_BYTES ||
    bytes.toString("base64").replace(/=+$/, "") !== match[2]!.replace(/=+$/, "")
  ) {
    throw new Error("An embedded watch-face image is empty, malformed, or too large.");
  }
  const detected = imageMimeType(bytes);
  if (!detected || detected !== match[1]) {
    throw new Error("An embedded watch-face image does not match its declared type.");
  }
  return { mimeType: detected, bytes };
}

function isExactAssetRef(value: unknown): value is WatchfaceAutomationAssetRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 &&
    typeof record.assetId === "string" && ASSET_ID_RE.test(record.assetId);
}

async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporary, data, { mode: 0o600, flag: "wx" });
    await fs.promises.rename(temporary, filePath);
    await fs.promises.chmod(filePath, 0o600);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export class WatchfaceAutomationAssetStore {
  private readonly directory: string;

  constructor(userDataPath: string) {
    this.directory = path.join(path.resolve(userDataPath), "watchface-automation-assets");
  }

  private async ensureDirectory(): Promise<void> {
    await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(this.directory, 0o700);
  }

  private async store(bytes: Buffer, mimeType: StoredAssetMetadata["mimeType"]): Promise<WatchfaceAutomationImportedAsset> {
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error("The watch-face image must be between 1 byte and 10 MB.");
    }
    const detected = imageMimeType(bytes);
    if (!detected || detected !== mimeType) {
      throw new Error("The watch-face image type is unsupported or malformed.");
    }
    const dimensions = imageDimensions(bytes, mimeType);
    if (!dimensions) throw new Error("The watch-face image dimensions could not be decoded.");
    // The production host is Electron, so ask its native decoder to verify the
    // complete payload rather than trusting the container header alone. Plain
    // Node test runners do not expose nativeImage and retain the structural check.
    const electronRuntime = require("electron") as Partial<typeof import("electron")>;
    if (electronRuntime.nativeImage) {
      const decoded = electronRuntime.nativeImage.createFromBuffer(bytes);
      const decodedSize = decoded.getSize();
      if (
        decoded.isEmpty() || decodedSize.width !== dimensions.width ||
        decodedSize.height !== dimensions.height
      ) throw new Error("The watch-face image could not be decoded.");
    }
    const assetId = crypto.createHash("sha256").update(bytes).digest("hex");
    const dataPath = path.join(this.directory, `${assetId}.bin`);
    const metadataPath = path.join(this.directory, `${assetId}.json`);
    await this.ensureDirectory();
    if (!await fileExists(dataPath)) await atomicWrite(dataPath, bytes);
    const metadata: StoredAssetMetadata = {
      version: 1, assetId, mimeType, sizeBytes: bytes.length, ...dimensions
    };
    if (!await fileExists(metadataPath)) {
      await atomicWrite(metadataPath, JSON.stringify(metadata));
    }
    return { assetId, mimeType, sizeBytes: bytes.length, ...dimensions };
  }

  async importImage(filePath: string): Promise<WatchfaceAutomationImportedAsset> {
    const resolved = await requireSafeAbsolutePath(filePath, "file");
    const stat = await fs.promises.stat(resolved);
    if (stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) {
      throw new Error("The watch-face image must be between 1 byte and 10 MB.");
    }
    const bytes = await fs.promises.readFile(resolved);
    const mimeType = imageMimeType(bytes);
    if (!mimeType) throw new Error("Choose a PNG, JPEG, or WebP image.");
    return this.store(bytes, mimeType);
  }

  /** Stores an image pasted into the Studio AI panel as a reusable asset. */
  async importImageDataUrl(dataUrl: string): Promise<WatchfaceAutomationImportedAsset> {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error("Attach a PNG, JPEG, or WebP image.");
    const bytes = Buffer.from(match[1]!, "base64");
    const mimeType = imageMimeType(bytes);
    if (!mimeType) throw new Error("Attach a PNG, JPEG, or WebP image.");
    return this.store(bytes, mimeType);
  }

  async importRasterFontFolder(folderPath: string): Promise<WatchfaceAutomationRasterFolder> {
    const root = await requireSafeAbsolutePath(folderPath, "directory");
    const paths = await collectPngFiles(root);
    if (paths.length === 0) throw new Error("The raster font folder has no PNG images.");
    if (paths.length > MAX_RASTER_FILES) throw new Error("A raster font folder can contain at most 256 PNG images.");
    let totalBytes = 0;
    const sprites = [] as WatchfaceAutomationRasterFolder["sprites"];
    for (const absolutePath of paths) {
      const stat = await fs.promises.stat(absolutePath);
      totalBytes += stat.size;
      if (totalBytes > MAX_RASTER_BYTES) {
        throw new Error("The raster font folder must be no larger than 12 MB.");
      }
      const imported = await this.importImage(absolutePath);
      if (imported.mimeType !== "image/png") throw new Error("Raster font folders may contain only PNG images.");
      sprites.push({
        name: path.basename(absolutePath),
        relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
        dataUrl: { assetId: imported.assetId },
        sizeBytes: imported.sizeBytes
      });
    }
    return { label: path.basename(root), sprites };
  }

  async externalizeDataImages<T>(value: T): Promise<T> {
    const budget = { count: 0, bytes: 0, nodes: 0, stringBytes: 0, images: new Map<string, Promise<WatchfaceAutomationAssetRef>>() };
    return this.transform(value, false, budget, 0) as Promise<T>;
  }

  async hydrateAssetRefs<T>(value: T): Promise<T> {
    const budget = { count: 0, bytes: 0, nodes: 0, stringBytes: 0, images: new Map<string, Promise<WatchfaceAutomationAssetRef>>() };
    return this.transform(value, true, budget, 0) as Promise<T>;
  }

  private async transform(
    value: unknown,
    hydrate: boolean,
    budget: { count: number; bytes: number; nodes: number; stringBytes: number; images: Map<string, Promise<WatchfaceAutomationAssetRef>> },
    depth: number
  ): Promise<unknown> {
    if (depth > MAX_DEPTH) throw new Error("The automation payload is nested too deeply.");
    budget.nodes += 1;
    if (budget.nodes > MAX_PAYLOAD_NODES) throw new Error("The automation payload contains too many values.");
    if (hydrate && isExactAssetRef(value)) {
      const asset = await this.read(value.assetId);
      budget.count += 1;
      budget.bytes += asset.bytes.length;
      assertTransformBudget(budget);
      return `data:${asset.metadata.mimeType};base64,${asset.bytes.toString("base64")}`;
    }
    if (!hydrate && typeof value === "string") {
      budget.stringBytes += Buffer.byteLength(value, "utf8");
      if (budget.stringBytes > MAX_PAYLOAD_STRING_BYTES) throw new Error("The automation payload contains too much text.");
      const existing = budget.images.get(value);
      if (existing) return existing;
      const image = parseDataImage(value);
      if (!image) return value;
      budget.count += 1;
      budget.bytes += image.bytes.length;
      assertTransformBudget(budget);
      // Shared digit/unit sprites appear in multiple fields and capabilities.
      // Store and budget each outgoing image once; input expansion remains bounded.
      const stored = this.store(image.bytes, image.mimeType).then(asset => ({ assetId: asset.assetId }));
      budget.images.set(value, stored);
      return stored;
    }
    if (hydrate && typeof value === "string") {
      budget.stringBytes += Buffer.byteLength(value, "utf8");
      if (budget.stringBytes > MAX_PAYLOAD_STRING_BYTES) throw new Error("The automation payload contains too much text.");
      return value;
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => this.transform(item, hydrate, budget, depth + 1)));
    }
    if (value && typeof value === "object") {
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (hydrate && (key === "__proto__" || key === "prototype" || key === "constructor")) {
          throw new Error(`Unsafe object key "${key}" is not allowed in automation input.`);
        }
        output[key] = await this.transform(child, hydrate, budget, depth + 1);
      }
      return output;
    }
    return value;
  }

  private async read(assetId: string): Promise<{ metadata: StoredAssetMetadata; bytes: Buffer }> {
    if (!ASSET_ID_RE.test(assetId)) throw new Error("The watch-face asset reference is invalid.");
    const metadataPath = path.join(this.directory, `${assetId}.json`);
    const dataPath = path.join(this.directory, `${assetId}.bin`);
    let metadata: StoredAssetMetadata;
    let bytes: Buffer;
    try {
      metadata = JSON.parse(await fs.promises.readFile(metadataPath, "utf8")) as StoredAssetMetadata;
      bytes = await fs.promises.readFile(dataPath);
    } catch {
      throw new Error("The referenced watch-face asset is unavailable.");
    }
    const dimensions = imageDimensions(bytes, metadata.mimeType);
    if (
      metadata.version !== 1 || metadata.assetId !== assetId ||
      metadata.sizeBytes !== bytes.length || imageMimeType(bytes) !== metadata.mimeType ||
      !dimensions || metadata.width !== dimensions.width || metadata.height !== dimensions.height ||
      crypto.createHash("sha256").update(bytes).digest("hex") !== assetId
    ) throw new Error("The referenced watch-face asset failed integrity validation.");
    return { metadata, bytes };
  }
}

export function createWatchfaceAutomationAssetStore(userDataPath: string): WatchfaceAutomationAssetStore {
  return new WatchfaceAutomationAssetStore(userDataPath);
}

function assertTransformBudget(budget: { count: number; bytes: number }): void {
  if (budget.count > MAX_IMAGES || budget.bytes > MAX_TOTAL_BYTES) {
    throw new Error("The automation payload contains too many or too much image data.");
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try { return (await fs.promises.stat(filePath)).isFile(); } catch { return false; }
}

async function requireSafeAbsolutePath(value: string, kind: "file" | "directory"): Promise<string> {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.length > 4096 || value.includes("\0")) {
    throw new Error(`Provide an absolute local ${kind} path.`);
  }
  const lstat = await fs.promises.lstat(value);
  if (lstat.isSymbolicLink()) throw new Error(`The ${kind} path may not be a symbolic link.`);
  const resolved = await fs.promises.realpath(value);
  const stat = await fs.promises.stat(resolved);
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
    throw new Error(`The provided path is not a ${kind}.`);
  }
  return resolved;
}

async function collectPngFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 8) throw new Error("The raster font folder is nested too deeply.");
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      const lstat = await fs.promises.lstat(child);
      if (lstat.isSymbolicLink()) throw new Error("Raster font folders may not contain symbolic links.");
      if (entry.isDirectory()) await visit(child, depth + 1);
      else if (entry.isFile()) {
        if (!entry.name.toLowerCase().endsWith(".png")) continue;
        files.push(child);
        if (files.length > MAX_RASTER_FILES) return;
      }
    }
  }
  await visit(root, 0);
  return files.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}
