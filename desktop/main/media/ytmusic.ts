// YouTube Music: the person signs in to music.youtube.com in a window of its own, and the app reads their library
// the way the web player does (its "youtubei" API, with the session's cookies and the SAPISIDHASH header Google
// asks signed-in requests to carry). Songs download by their own video, so nothing is searched for.
import { createHash } from "node:crypto";
import { clockSecs, SourceProblem, type MusicSource, type Playlist, type Song, type SourceStatus } from "./sources";
import type { WebHost } from "./webHost";
import { t } from "@/lib/i18n";

const PARTITION = "persist:clink-ytmusic";
const ORIGIN = "https://music.youtube.com";
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20251110.01.00", hl: "en", gl: "US" };
/** The most songs read from one playlist, and how long a request and a whole playlist may take. */
export const MAX_SONGS = 5000;
const REQUEST_TIMEOUT = 60_000;
const PLAYLIST_TIMEOUT = 180_000;

type Json = Record<string, unknown>;

/** Every object under `key` anywhere in a response (the layout moves around; the item shapes don't). */
export function findAll(node: unknown, key: string, out: Json[] = []): Json[] {
  if (Array.isArray(node)) for (const n of node) findAll(n, key, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Json)) {
      if (k === key && v && typeof v === "object") out.push(v as Json);
      else findAll(v, key, out);
    }
  }
  return out;
}

const pick = (node: unknown, ...path: (string | number)[]): unknown => path.reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Record<string | number, unknown>)[k] : undefined), node);
const runs = (node: unknown): string => ((pick(node, "runs") as { text?: string }[] | undefined) ?? []).map((r) => r.text ?? "").join("");

/** The header Google wants on signed-in requests: SHA-1 of "time SAPISID origin". */
export function sapisidHash(sapisid: string, now = Date.now()): string {
  const ts = Math.floor(now / 1000);
  return `SAPISIDHASH ${ts}_${createHash("sha1").update(`${ts} ${sapisid} ${ORIGIN}`).digest("hex")}`;
}

/** Playlists from the library page's tiles, and the token for more of them. */
export function readPlaylists(response: unknown): Playlist[] {
  const out: Playlist[] = [];
  for (const tile of findAll(response, "musicTwoRowItemRenderer")) {
    const browseId = pick(tile, "navigationEndpoint", "browseEndpoint", "browseId");
    if (typeof browseId !== "string" || !browseId.startsWith("VL")) continue;
    const subtitle = runs(pick(tile, "subtitle"));
    const count = /([\d,]+)\s+(songs?|tracks?)/i.exec(subtitle);
    // "Ana • 42 songs", "Playlist • Ana • 42 songs", "Auto playlist": the owner is the part that's a name.
    const owner = subtitle.split(" • ").map((x) => x.trim()).find((x) => x && !/^(auto )?playlist$/i.test(x) && !/\d\s+(songs?|tracks?|views?)$/i.test(x)) ?? null;
    const thumbs = pick(tile, "thumbnailRenderer", "musicThumbnailRenderer", "thumbnail", "thumbnails") as { url: string }[] | undefined;
    out.push({ id: browseId.slice(2), name: runs(pick(tile, "title")) || "Playlist", count: count ? Number(count[1].replace(/,/g, "")) : null, owner, artwork: thumbs?.at(-1)?.url ?? null });
  }
  return out.filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
}

/** A continuation: sent in the body (the current form) or as ctoken/continuation parameters (the older one). */
export interface Next { token: string; style: "body" | "params" }

/** The token for the next page inside these containers (never a section's "suggestions" continuation). */
function nextIn(containers: unknown[]): Next | null {
  for (const c of containers) {
    const body = findAll(c, "continuationItemRenderer").map((r) => pick(r, "continuationEndpoint", "continuationCommand", "token")).find((t) => typeof t === "string");
    if (typeof body === "string") return { token: body, style: "body" };
    const old = findAll(c, "nextContinuationData").map((r) => r.continuation).find((t) => typeof t === "string");
    if (typeof old === "string") return { token: old, style: "params" };
  }
  return null;
}

/** The parts of a response that hold the playlist's own rows: its shelf, or the rows a continuation appends. */
function songContainers(response: unknown): unknown[] {
  for (const key of ["musicPlaylistShelfRenderer", "musicPlaylistShelfContinuation", "appendContinuationItemsAction", "musicShelfRenderer", "musicShelfContinuation"]) {
    const found = findAll(response, key);
    if (found.length) return key === "musicShelfRenderer" ? found.slice(0, 1) : found;
  }
  return [response];
}

function readRow(row: Json): Song | null {
  const cols = (pick(row, "flexColumns") as unknown[] | undefined) ?? [];
  const videoId = (pick(row, "playlistItemData", "videoId")
    ?? pick(row, "overlay", "musicItemThumbnailOverlayRenderer", "content", "musicPlayButtonRenderer", "playNavigationEndpoint", "watchEndpoint", "videoId")
    ?? pick(cols[0], "musicResponsiveListItemFlexColumnRenderer", "text", "runs", 0, "navigationEndpoint", "watchEndpoint", "videoId")) as string | undefined;
  if (!videoId || !/^[\w-]{6,}$/.test(videoId)) return null;
  const text = (i: number) => runs(pick(cols[i], "musicResponsiveListItemFlexColumnRenderer", "text"));
  const fixed = runs(pick((pick(row, "fixedColumns") as unknown[] | undefined)?.[0], "musicResponsiveListItemFixedColumnRenderer", "text"));
  const title = text(0);
  if (!title) return null;
  // Some layouts put "Song • Artist • Album • 3:12" in one column.
  const parts = text(1).split(" • ").map((x) => x.trim()).filter((x) => x && !/^(song|video|episode)$/i.test(x));
  const secs = clockSecs(fixed) ?? clockSecs(parts.find((x) => clockSecs(x) != null));
  const thumbs = pick(row, "thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails") as { url: string }[] | undefined;
  return { origin: `ytm:${videoId}`, title, artist: parts[0] ?? "", album: text(2) || (parts.length > 2 ? parts[1] : null) || null, secs, artwork: thumbs?.[0]?.url ?? null, target: `${ORIGIN}/watch?v=${videoId}` };
}

/** A playlist page's songs, and the next page's token. */
export function readSongs(response: unknown): { songs: Song[]; next: string | null; style: Next["style"] } {
  const containers = songContainers(response);
  const songs = containers.flatMap((c) => findAll(c, "musicResponsiveListItemRenderer")).map(readRow).filter((s): s is Song => !!s);
  const next = nextIn(containers);
  return { songs, next: next?.token ?? null, style: next?.style ?? "body" };
}

export class YouTubeMusic implements MusicSource {
  readonly source = "YouTube Music" as const;
  constructor(private readonly web: WebHost) {}

  private async sapisid(): Promise<string | null> {
    const cookies = await this.web.cookies(PARTITION, ORIGIN);
    return cookies.find((c) => c.name === "SAPISID")?.value ?? cookies.find((c) => c.name === "__Secure-3PAPISID")?.value ?? null;
  }

  async status(): Promise<SourceStatus> {
    return { connected: !!(await this.sapisid()), account: null };
  }

  async connect(): Promise<SourceStatus> {
    await this.web.signIn({
      url: `https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=${encodeURIComponent(`${ORIGIN}/library`)}`,
      partition: PARTITION, title: t("Sign in to YouTube Music"),
      done: (u) => u.startsWith(`${ORIGIN}/`),
    });
    return this.status();
  }

  async disconnect(): Promise<SourceStatus> {
    await this.web.clear(PARTITION);
    return this.status();
  }

  private async browse(body: Json, next?: Next): Promise<unknown> {
    const sapisid = await this.sapisid();
    if (!sapisid) throw new SourceProblem(t("Sign in to YouTube Music first."), "signedOut");
    const params = next?.style === "params" ? `&ctoken=${encodeURIComponent(next.token)}&continuation=${encodeURIComponent(next.token)}&type=next` : "";
    if (next?.style === "body") body = { ...body, continuation: next.token };
    const answer = await this.web.fetch(PARTITION, `${ORIGIN}/youtubei/v1/browse?prettyPrint=false${params}`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      headers: { "Content-Type": "application/json", Authorization: sapisidHash(sapisid), "X-Origin": ORIGIN, Origin: ORIGIN, "X-Goog-AuthUser": "0" },
      body: JSON.stringify({ context: { client: CLIENT }, ...body }),
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "TimeoutError") throw new SourceProblem(t("YouTube Music took too long to answer."), "timeout");
      throw new SourceProblem(t("YouTube Music couldn't be reached."), "offline");
    });
    if (answer.status === 401 || answer.status === 403) throw new SourceProblem(t("YouTube Music signed you out. Sign in again."), "signedOut");
    if (!answer.ok) throw new SourceProblem(t("YouTube Music didn't answer ({status}).", { status: answer.status }), "ytmusic");
    return answer.json();
  }

  async playlists(): Promise<Playlist[]> {
    let page = await this.browse({ browseId: "FEmusic_liked_playlists" });
    const found = readPlaylists(page);
    // A big library comes in pages too.
    for (let i = 0; i < 20; i++) {
      const next = nextIn([page]);
      if (!next) break;
      page = await this.browse({}, next);
      const more = readPlaylists(page).filter((p) => !found.some((f) => f.id === p.id));
      if (!more.length) break;
      found.push(...more);
    }
    // Liked songs isn't always among the tiles.
    if (!found.some((p) => p.id === "LM")) found.unshift({ id: "LM", name: "Liked music", count: null, owner: null, artwork: null });
    return found;
  }

  async songs(playlistId: string): Promise<Song[]> {
    if (!/^[\w-]{2,64}$/.test(playlistId)) throw new SourceProblem(t("Not a YouTube Music playlist."), "playlist");
    const all: Song[] = [];
    const seen = new Set<string>();
    const until = Date.now() + PLAYLIST_TIMEOUT;
    let page = readSongs(await this.browse({ browseId: `VL${playlistId}` }));
    for (let i = 0; i < 200; i++) {
      const before = all.length;
      for (const s of page.songs) if (!seen.has(s.origin) && all.length < MAX_SONGS) { seen.add(s.origin); all.push(s); }
      if (!page.next || all.length >= MAX_SONGS || (i > 0 && all.length === before)) break;
      if (Date.now() > until) throw new SourceProblem(t("That playlist took too long to read."), "timeout");
      page = readSongs(await this.browse({}, { token: page.next, style: page.style }));
    }
    return all;
  }
}
