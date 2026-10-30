import { createHash, randomUUID } from "node:crypto";
import type { CorosMapAreaFile, CorosWifiMapPreview, CorosWifiMapTile } from "./corosWifiMapTypes";
import { corosMapQuadkey } from "./corosMapGrid";

const HOST = "https://mapstatic.coros.com";
const ASSETS = "https://map-oss-us.coros.com/coros-map/";
const ENDPOINT = "/openapi/tileMap/getMapPackage";
interface ClientConfiguration { id: string; key: string }
let configuration: Promise<ClientConfiguration> | undefined;
const previews = new Map<string, { value: CorosWifiMapPreview; deviceModel: string; expires: number }>();

export function normalizeWifiMapTiles(input: unknown): CorosWifiMapTile[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 16) throw new Error("Select between one and sixteen map areas.");
  const tiles = new Map<string, CorosWifiMapTile>();
  for (const value of input) {
    if (!value || !Number.isInteger(value.x) || !Number.isInteger(value.y) || value.x < 0 || value.x > 127 || value.y < 0 || value.y > 127) {
      throw new Error("The selected map area is invalid.");
    }
    tiles.set(`${value.x},${value.y}`, { x: value.x, y: value.y });
  }
  return [...tiles.values()].sort((a, b) => a.x - b.x || a.y - b.y);
}

async function text(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000), redirect: "error" });
  if (!response.ok) throw new Error(`COROS map service request failed (${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("COROS map service returned an empty response.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2_000_000) throw new Error("COROS map service returned an oversized response.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}

export function readPublishedMapConfiguration(source: string): ClientConfiguration | undefined {
  const match = /prod:\{app_id:"(\d{10,24})",app_secret:"([a-f0-9]{32})"\}/.exec(source);
  return match ? { id: match[1]!, key: match[2]! } : undefined;
}

async function loadConfiguration(): Promise<ClientConfiguration> {
  // The public COROS web client publishes its request-signing configuration.
  // Read it as data: never execute remote JavaScript or send it to the renderer.
  const html = await text(HOST + "/");
  const main = /window\.__assetsPath\("(public\/main-[A-Za-z0-9_-]+\.js)"\)/.exec(html)?.[1];
  if (!main) throw new Error("COROS changed its map service configuration. Update CorosLink and try again.");
  const source = await text(ASSETS + main);
  const files = [...new Set(source.match(/public\/index-[A-Za-z0-9_-]+\.js/g) ?? [])].slice(0, 8);
  const results = await Promise.allSettled(files.map(file => text(ASSETS + file)));
  for (const result of results) {
    if (result.status === "fulfilled") {
      const parsed = readPublishedMapConfiguration(result.value);
      if (parsed) return parsed;
    }
  }
  throw new Error("COROS map service configuration is unavailable. Try again later.");
}

export function signMapRequest(body: Record<string, unknown>, key: string): string {
  const serialized = Object.keys(body).filter(k => k !== "sign").sort().map(k => {
    const v = body[k];
    return k + (v !== null && typeof v === "object" ? "" : String(v ?? ""));
  }).join("");
  return createHash("md5").update(serialized + key).digest("hex").toUpperCase();
}

/** COROS packages map tiles per watch model ("W332"); PACE Pro is the one checked on a watch. */
async function packageRequest(tiles: CorosWifiMapTile[], action: "check" | "download", deviceModel: string) {
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(deviceModel)) throw new Error("Unsupported watch model for map downloads.");
  configuration ??= loadConfiguration().catch(error => { configuration = undefined; throw error; });
  const client = await configuration;
  const body: Record<string, unknown> = { action, list: tiles.map(tile => ({ quadkey: corosMapQuadkey(tile), O: 0, C: 0 })), deviceModel, app_id: client.id };
  body.sign = signMapRequest(body, client.key);
  let response;
  try { response = JSON.parse(await text(HOST + ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); }
  catch (error) { throw error instanceof SyntaxError ? new Error("COROS map service returned an invalid response.") : error; }
  if (response.code !== 200 || !response.data || !Number.isSafeInteger(response.data.fileSize) || response.data.fileSize < 0 ||
      !Number.isSafeInteger(response.data.fileCount) || response.data.fileCount < 0) throw new Error("COROS could not prepare the selected map areas.");
  return response.data as { fileSize: number; fileCount: number; map_id?: string; files?: unknown };
}

/**
 * The files COROS packs for these areas, as the watch fetches them over Wi-Fi: per area,
 * the landscape map (S<quadkey>V<nn>.t, layer VSM) and its contour lines (C…, layer VCM).
 */
export async function listMapAreaFiles(input: unknown, deviceModel = "W332"): Promise<CorosMapAreaFile[]> {
  const tiles = normalizeWifiMapTiles(input);
  const quadkeys = new Set(tiles.map(corosMapQuadkey));
  const data = await packageRequest(tiles, "check", deviceModel);
  if (!Array.isArray(data.files) || data.files.length !== data.fileCount) throw new Error("COROS returned an invalid map file list.");
  const files = data.files.map((file: { name?: unknown; size?: unknown }) => {
    const match = typeof file?.name === "string" ? /^([SC])([0-3]{7})(V\d{2})\.t$/.exec(file.name) : null;
    if (!match || !quadkeys.has(match[2]!) || !Number.isSafeInteger(file.size) || (file.size as number) <= 0 || (file.size as number) > 2_000_000_000) {
      throw new Error("COROS returned an invalid map file list.");
    }
    return { name: file.name as string, layer: match[1] === "S" ? "VSM" : "VCM", quadkey: match[2]!, version: match[3]!, sizeBytes: file.size as number } satisfies CorosMapAreaFile;
  });
  if (new Set(files.map(file => file.name)).size !== files.length) throw new Error("COROS returned an invalid map file list.");
  return files;
}

export async function previewWifiMap(input: unknown, deviceModel = "W332"): Promise<CorosWifiMapPreview> {
  const tiles = normalizeWifiMapTiles(input);
  const data = await packageRequest(tiles, "check", deviceModel);
  for (const [id, entry] of previews) if (entry.expires < Date.now()) previews.delete(id);
  if (previews.size > 100) previews.delete(previews.keys().next().value!);
  const preview = { id: randomUUID(), tiles, fileCount: data.fileCount, sizeBytes: data.fileSize };
  previews.set(preview.id, { value: preview, deviceModel, expires: Date.now() + 10 * 60_000 });
  return preview;
}

export async function createWifiMapTask(previewId: string, deviceModel = "W332"): Promise<string> {
  const preview = previews.get(previewId);
  // A preview sized for another watch model would download the wrong package.
  if (!preview || preview.expires < Date.now() || preview.deviceModel !== deviceModel) throw new Error("Check the selected map size again before downloading.");
  if (!preview.value.fileCount || !preview.value.sizeBytes) throw new Error("COROS has no map files for the selected areas.");
  const data = await packageRequest(preview.value.tiles, "download", deviceModel);
  if (typeof data.map_id !== "string" || !/^[A-Za-z0-9_-]{8}$/.test(data.map_id)) throw new Error("COROS returned an invalid map download identifier.");
  previews.delete(previewId);
  return data.map_id;
}
