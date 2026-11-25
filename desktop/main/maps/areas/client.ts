// COROS's map package service for map areas (zoom-7 squares): how big the chosen squares are for a watch model, the
// per-square files COROS packs for them, and the task id the watch downloads over its own Wi-Fi. Requests are signed
// as COROS's public web client signs them; its signing configuration is read out of that client's script as text,
// never run. Rewritten from CorosLink's corosWifiMapService.ts.
import { createHash, randomUUID } from "node:crypto";
import { AREA_ZOOM, MAX_AREA_TILES, quadkey, type AreaPreview, type Tile } from "../../../maps/types";

const HOST = "https://mapstatic.coros.com";
const ASSETS = "https://map-oss-us.coros.com/coros-map/";
const ENDPOINT = "/openapi/tileMap/getMapPackage";
/** Where the watch (and a USB copy) fetches each area file: <host>/tiles_<version>/<layer>/<name>. */
export const AREA_FILE_HOST = "https://map-oss-us.coros.com/osm";
const PREVIEW_MS = 10 * 60_000;
const CELLS = 1 << AREA_ZOOM;

export class AreasProblem extends Error {
  constructor(message: string, readonly code = "maps", readonly status = 400) { super(message); }
}

/** One per-square file and the watch folder it goes in: Map/<layer>/<first 3 quadkey digits>/<name>. */
export interface AreaFile { name: string; layer: "VSM" | "VCM"; quadkey: string; version: string; sizeBytes: number }

export interface Signing { id: string; key: string }

/** 1–16 squares, each x and y a whole number from 0 to 127; duplicates dropped, sorted. */
export function normalizeTiles(input: unknown): Tile[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_AREA_TILES) throw new AreasProblem(`Pick between one and ${MAX_AREA_TILES} map areas.`);
  const tiles = new Map<string, Tile>();
  for (const value of input as unknown[]) {
    const t = value as Partial<Tile> | null;
    const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < CELLS;
    if (!t || !ok(t.x) || !ok(t.y)) throw new AreasProblem("That map area isn't on COROS's map grid.");
    tiles.set(`${t.x},${t.y}`, { x: t.x, y: t.y });
  }
  return [...tiles.values()].sort((a, b) => a.x - b.x || a.y - b.y);
}

/** The signing id and key in COROS's published web client, found as text. */
export function readSigning(source: string): Signing | undefined {
  const match = /prod:\{app_id:"(\d{10,24})",app_secret:"([a-f0-9]{32})"\}/.exec(source);
  return match ? { id: match[1], key: match[2] } : undefined;
}

/** COROS's request signature: keys sorted, each key followed by its value (objects and arrays add nothing), the key appended, MD5, upper case. */
export function signRequest(body: Record<string, unknown>, key: string): string {
  const text = Object.keys(body).filter((k) => k !== "sign").sort().map((k) => {
    const v = body[k];
    return k + (v !== null && typeof v === "object" ? "" : String(v ?? ""));
  }).join("");
  return createHash("md5").update(text + key).digest("hex").toUpperCase();
}

export interface Preview extends AreaPreview { files: AreaFile[] }

export interface ClientHost { fetch?: typeof fetch; now?: () => number }

export class MapPackageClient {
  private signing: Promise<Signing> | null = null;
  private readonly previews = new Map<string, { value: Preview; model: string; expires: number }>();

  constructor(private readonly host: ClientHost = {}) {}

  private now() { return this.host.now?.() ?? Date.now(); }

  /** Text from COROS, capped at 2 MB, never following redirects. */
  private async text(url: string, init?: RequestInit, acceptNotFound = false): Promise<string> {
    const answer = await (this.host.fetch ?? fetch)(url, { ...init, signal: AbortSignal.timeout(25_000), redirect: "error" })
      .catch(() => { throw new AreasProblem("COROS's map service couldn't be reached. Check the connection.", "network", 502); });
    if (!answer.ok && !(acceptNotFound && answer.status === 404)) throw new AreasProblem(`COROS's map service answered ${answer.status}. Try again later.`, "coros", 502);
    const body = Buffer.from(await answer.arrayBuffer());
    if (body.length > 2_000_000) throw new AreasProblem("COROS's map service answered with too much.", "coros", 502);
    return body.toString("utf8");
  }

  /** Reads the signing configuration out of COROS's web client as text: the page names its main script, which names its chunks. */
  private async loadSigning(): Promise<Signing> {
    // The page is a single-page app whose root can answer 404 with the full page; the script reference is what counts.
    const html = await this.text(`${HOST}/`, undefined, true);
    const main = /window\.__assetsPath\("(public\/main-[A-Za-z0-9_-]+\.js)"\)/.exec(html)?.[1];
    if (!main) throw new AreasProblem("COROS changed its map service. Update C-LINK and try again.", "coros", 502);
    const source = await this.text(ASSETS + main);
    const direct = readSigning(source);
    if (direct) return direct;
    const chunks = [...new Set(source.match(/public\/index-[A-Za-z0-9_-]+\.js/g) ?? [])].slice(0, 8);
    for (const result of await Promise.allSettled(chunks.map((c) => this.text(ASSETS + c)))) {
      const found = result.status === "fulfilled" ? readSigning(result.value) : undefined;
      if (found) return found;
    }
    throw new AreasProblem("COROS's map service isn't available. Try again later.", "coros", 502);
  }

  private async request(tiles: Tile[], action: "check" | "download", model: string) {
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(model)) throw new AreasProblem("Map areas aren't made for this watch.");
    this.signing ??= this.loadSigning().catch((error: unknown) => { this.signing = null; throw error; });
    const signing = await this.signing;
    const body: Record<string, unknown> = { action, list: tiles.map((t) => ({ quadkey: quadkey(t), O: 0, C: 0 })), deviceModel: model, app_id: signing.id };
    body.sign = signRequest(body, signing.key);
    let answer: { code?: unknown; data?: { fileSize?: unknown; fileCount?: unknown; map_id?: unknown; files?: unknown } };
    try {
      answer = JSON.parse(await this.text(HOST + ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })) as typeof answer;
    } catch (error) {
      if (error instanceof AreasProblem) throw error;
      throw new AreasProblem("COROS's map service answered with something unreadable.", "coros", 502);
    }
    const data = answer.data;
    if (answer.code !== 200 || !data || !Number.isSafeInteger(data.fileSize) || (data.fileSize as number) < 0
      || !Number.isSafeInteger(data.fileCount) || (data.fileCount as number) < 0) throw new AreasProblem("COROS couldn't prepare these map areas.", "coros", 502);
    return data as { fileSize: number; fileCount: number; map_id?: unknown; files?: unknown };
  }

  /** The files COROS packs for these squares: per square the landscape map (S…, folder VSM) and its contour lines (C…, VCM). */
  static files(tiles: Tile[], data: { fileCount: number; files?: unknown }): AreaFile[] {
    const keys = new Set(tiles.map(quadkey));
    if (!Array.isArray(data.files) || data.files.length !== data.fileCount) throw new AreasProblem("COROS sent a map file list that doesn't add up.", "coros", 502);
    const files = (data.files as { name?: unknown; size?: unknown }[]).map((f) => {
      const match = typeof f?.name === "string" ? /^([SC])([0-3]{7})(V\d{2})\.t$/.exec(f.name) : null;
      const size = f?.size;
      if (!match || !keys.has(match[2]) || !Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > 2_000_000_000) {
        throw new AreasProblem("COROS sent a map file list that doesn't add up.", "coros", 502);
      }
      return { name: f.name as string, layer: match[1] === "S" ? "VSM" : "VCM", quadkey: match[2], version: match[3], sizeBytes: size as number } satisfies AreaFile;
    });
    if (new Set(files.map((f) => f.name)).size !== files.length) throw new AreasProblem("COROS sent a map file list that doesn't add up.", "coros", 502);
    return files;
  }

  /** How big these squares are for this model ("W332"). Kept 10 minutes, for that model only. */
  async preview(input: unknown, model: string): Promise<Preview> {
    const tiles = normalizeTiles(input);
    const data = await this.request(tiles, "check", model);
    const files = MapPackageClient.files(tiles, data);
    const now = this.now();
    for (const [id, entry] of this.previews) if (entry.expires < now) this.previews.delete(id);
    if (this.previews.size > 100) this.previews.delete(this.previews.keys().next().value!);
    const value: Preview = { id: randomUUID(), tiles, fileCount: data.fileCount, sizeBytes: data.fileSize, files };
    this.previews.set(value.id, { value, model, expires: now + PREVIEW_MS });
    return value;
  }

  /** A preview still fresh and made for this model; one sized for another watch would fetch the wrong package. */
  take(previewId: string, model: string): Preview {
    const entry = this.previews.get(previewId);
    if (!entry || entry.expires < this.now() || entry.model !== model) throw new AreasProblem("Check the size of these map areas again first.", "stale");
    if (!entry.value.fileCount || !entry.value.sizeBytes) throw new AreasProblem("COROS has no maps for these areas.", "empty");
    return entry.value;
  }

  forget(previewId: string): void { this.previews.delete(previewId); }

  /** Asks COROS for the Wi-Fi download task of a checked preview; answers its 8-character id. */
  async createTask(previewId: string, model: string): Promise<string> {
    const preview = this.take(previewId, model);
    const data = await this.request(preview.tiles, "download", model);
    if (typeof data.map_id !== "string" || !/^[A-Za-z0-9_-]{8}$/.test(data.map_id)) throw new AreasProblem("COROS returned an invalid map download id.", "coros", 502);
    return data.map_id;
  }

  /** Where one area file is fetched from. */
  static fileUrl(file: AreaFile): string { return `${AREA_FILE_HOST}/tiles_${file.version}/${file.layer}/${file.name}`; }
}
