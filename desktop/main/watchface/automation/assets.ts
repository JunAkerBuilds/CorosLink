// Images for automation, kept by content (CorosLink's watchfaceAutomationAssets.ts). Image bytes never travel in
// tool JSON: a data URL in a document becomes `{ assetId }` on the way out to an agent, and an `{ assetId }` in a
// command becomes the data URL again only on the way in to the editor. Stored in the app's own folder, bounded in
// count and size; the oldest go first.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

export const ASSET_ID = /^img_[0-9a-f]{32}$/;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;
type Kind = keyof typeof MIME;

export interface StoredAsset { assetId: string; mime: string; bytes: Buffer }

/** What a file's first bytes say it is, or null when it isn't a PNG, JPEG or WebP. */
export function sniffImage(bytes: Uint8Array): Kind | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 12 && Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** Width and height from a PNG's header, or null. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (sniffImage(bytes) !== "png" || bytes.length < 24) return null;
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}

export class AssetStore {
  constructor(private readonly folder: string, private readonly limits = { count: 600, bytes: 256 * 1024 * 1024, perAsset: 16 * 1024 * 1024 }) {}

  private file(id: string, kind: Kind) { return path.join(this.folder, `${id}.${kind}`); }

  /** Keeps the bytes; the same bytes always get the same id. */
  async put(bytes: Uint8Array): Promise<string> {
    const kind = sniffImage(bytes);
    if (!kind) throw new Error("Only PNG, JPEG and WebP images are taken.");
    if (bytes.length > this.limits.perAsset) throw new Error("That image is too large.");
    const id = `img_${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}`;
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const file = this.file(id, kind);
    const now = new Date();
    try { await utimes(file, now, now); } catch {
      await writeFile(file, bytes, { mode: 0o600 });
      await this.prune();
    }
    return id;
  }

  async get(id: string): Promise<StoredAsset> {
    if (!ASSET_ID.test(id)) throw new Error(`${id} isn't an asset id.`);
    for (const kind of Object.keys(MIME) as Kind[]) {
      const bytes = await readFile(this.file(id, kind)).catch(() => null);
      if (bytes) return { assetId: id, mime: MIME[kind], bytes };
    }
    throw new Error(`There is no asset ${id}. It may have been cleared; make or import it again.`);
  }

  async dataUrl(id: string): Promise<string> {
    const asset = await this.get(id);
    return `data:${asset.mime};base64,${asset.bytes.toString("base64")}`;
  }

  async putDataUrl(url: string): Promise<string> {
    const m = DATA_URL.exec(url);
    if (!m) throw new Error("That isn't an image data URL.");
    return this.put(Buffer.from(m[2], "base64"));
  }

  private async prune(): Promise<void> {
    const names = await readdir(this.folder).catch(() => [] as string[]);
    const files = await Promise.all(names.filter((n) => /^img_[0-9a-f]{32}\.(png|jpeg|webp)$/.test(n)).map(async (n) => {
      const s = await stat(path.join(this.folder, n)).catch(() => null);
      return s ? { n, size: s.size, at: s.mtimeMs } : null;
    }));
    const live = files.filter((f): f is NonNullable<typeof f> => !!f).sort((a, b) => b.at - a.at);
    let total = 0;
    for (const [i, f] of live.entries()) {
      total += f.size;
      if (i >= this.limits.count || total > this.limits.bytes) await unlink(path.join(this.folder, f.n)).catch(() => undefined);
    }
  }

  /** A value with every image data URL in it replaced by `{ assetId }`. */
  async toRefs<T>(value: T): Promise<T> {
    const seen = new Map<string, string>();
    const walk = async (v: unknown): Promise<unknown> => {
      if (typeof v === "string") {
        if (!DATA_URL.test(v)) return v;
        const id = seen.get(v) ?? await this.putDataUrl(v);
        seen.set(v, id);
        return { assetId: id };
      }
      if (Array.isArray(v)) return Promise.all(v.map(walk));
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) out[k] = await walk(x);
        return out;
      }
      return v;
    };
    return (await walk(value)) as T;
  }

  /** A value with every `{ assetId }` (an object with that one key) back as its data URL. */
  async fromRefs<T>(value: T): Promise<T> {
    const walk = async (v: unknown): Promise<unknown> => {
      if (Array.isArray(v)) return Promise.all(v.map(walk));
      if (v && typeof v === "object") {
        const keys = Object.keys(v);
        if (keys.length === 1 && keys[0] === "assetId" && typeof (v as { assetId: unknown }).assetId === "string") return this.dataUrl((v as { assetId: string }).assetId);
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) out[k] = await walk(x);
        return out;
      }
      return v;
    };
    return (await walk(value)) as T;
  }
}
