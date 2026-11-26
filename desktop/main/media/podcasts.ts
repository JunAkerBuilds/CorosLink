// Podcasts: shows found through Apple's public podcast search, episodes read from the show's own RSS feed, and an
// episode downloaded from the publisher's enclosure URL (never a URL the page sends). Episodes that aren't MP3s are
// converted with ffmpeg. A long episode can instead be split like an audiobook (audiobooks.ts), into parts that end at
// pauses.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { isMp3, safeName, withFile } from "./mp3";
import { ffmpegArgs, run } from "./tools";
import type { Work } from "./downloads";
import { WatchProblem } from "./watchDrive";
import { t } from "@/lib/i18n";

export interface Show { id: string; title: string; author: string; artwork: string | null; episodes?: number; genre?: string | null }
export interface Episode {
  id: string; title: string; published: number | null; secs: number | null; bytes: number | null; type: string; url: string;
  /** The episode's own cover, when the feed gives one. */
  artwork: string | null;
  season: number | null;
  number: number | null;
}
export interface ShowDetail extends Show { feed: string; episodes: number; page: Episode[]; offset: number; about: string | null }

export const PAGE = 50;
const SEARCH_LIMIT = 25;
const FEED_TTL = 10 * 60_000;
const MAX_EPISODE = 1024 * 1024 * 1024;

type Get = (url: string, init?: RequestInit) => Promise<Response>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
export function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) => {
      if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : all; }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .trim();
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? decode(m[1]) : null;
};
const attr = (xml: string, name: string, key: string) => {
  const m = new RegExp(`<${name}\\s[^>]*?\\b${key}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(xml);
  return m ? decode(m[2] ?? m[3] ?? "") : null;
};

/** Feed text as plain words: no markup, one space between words. */
export const plainText = (html: string | null) => (html ? html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null : null);

const whole = (text: string | null) => { const n = Number(text); return Number.isInteger(n) && n > 0 ? n : null; };

/** "1:02:03", "62:03" or "3723" → seconds. */
export function duration(text: string | null): number | null {
  if (!text) return null;
  const parts = text.trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return Math.round(parts.reduce((a, n) => a * 60 + n, 0));
}

/** The episodes in a podcast's RSS feed that have audio, in the feed's order (newest first, as publishers write them). */
export function parseFeed(xml: string): { title: string | null; author: string | null; artwork: string | null; about: string | null; episodes: Episode[] } {
  const channel = xml.split(/<item[\s>]/i)[0];
  const episodes: Episode[] = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const item = m[1];
    const url = attr(item, "enclosure", "url");
    const type = attr(item, "enclosure", "type") ?? "";
    if (!url || !/^https?:\/\//i.test(url) || (type && !/^audio\//i.test(type) && !/\.(mp3|m4a|aac)(\?|$)/i.test(url))) continue;
    const guid = tag(item, "guid") || url;
    const published = Date.parse(tag(item, "pubDate") ?? "");
    const bytes = Number(attr(item, "enclosure", "length"));
    episodes.push({
      id: createHash("sha1").update(guid).digest("hex").slice(0, 20), title: tag(item, "title") ?? "Episode", url, type,
      published: Number.isFinite(published) ? published : null, secs: duration(tag(item, "itunes:duration")), bytes: bytes > 0 ? bytes : null,
      artwork: attr(item, "itunes:image", "href"), season: whole(tag(item, "itunes:season")), number: whole(tag(item, "itunes:episode")),
    });
  }
  const about = plainText(tag(channel, "itunes:summary") ?? tag(channel, "description"));
  return { title: tag(channel, "title"), author: tag(channel, "itunes:author"), artwork: attr(channel, "itunes:image", "href"), about: about ? about.slice(0, 600) : null, episodes };
}

interface ItunesResult { collectionId?: number; collectionName?: string; artistName?: string; feedUrl?: string; artworkUrl600?: string; artworkUrl100?: string; trackCount?: number; primaryGenreName?: string }

/** Apple's storefront for this computer's region. */
const storefront = () => (Intl.DateTimeFormat().resolvedOptions().locale.split("-")[1] ?? "us").toLowerCase();

/** A show id from an id or an Apple Podcasts link (…/id1234567890). */
export function showId(input: string): string | null {
  const m = /(?:^|\/id|[?&]id=)(\d{4,})/.exec(input.trim());
  return m ? m[1] : null;
}

export class Podcasts {
  private readonly feeds = new Map<string, { at: number; show: Show & { feed: string; about: string | null }; episodes: Episode[] }>();

  constructor(private readonly get: Get = (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) })) {}

  private async json<T>(url: URL): Promise<T> {
    const answer = await this.get(url.href, { headers: { Accept: "application/json" } });
    if (!answer.ok) throw new WatchProblem(t("Apple Podcasts didn't answer. Try again in a moment."), "podcasts");
    return (await answer.json()) as T;
  }

  async search(query: string): Promise<Show[]> {
    const id = showId(query);
    if (id) return [await this.lookup(id)].map(({ feed: _f, ...show }) => show);
    const term = query.trim();
    if (!term) return [];
    const url = new URL("https://itunes.apple.com/search");
    for (const [k, v] of Object.entries({ term, media: "podcast", entity: "podcast", limit: String(SEARCH_LIMIT), country: storefront() })) url.searchParams.set(k, v);
    const { results = [] } = await this.json<{ results?: ItunesResult[] }>(url);
    return results.filter((r) => r.collectionId && r.feedUrl).map((r) => ({
      id: String(r.collectionId), title: r.collectionName ?? "Podcast", author: r.artistName ?? "", artwork: r.artworkUrl600 ?? r.artworkUrl100 ?? null, episodes: r.trackCount,
      genre: r.primaryGenreName ?? null,
    }));
  }

  private async lookup(id: string): Promise<Show & { feed: string }> {
    const url = new URL("https://itunes.apple.com/lookup");
    url.searchParams.set("id", id);
    url.searchParams.set("entity", "podcast");
    url.searchParams.set("country", storefront());
    const r = (await this.json<{ results?: ItunesResult[] }>(url)).results?.find((x) => String(x.collectionId) === id);
    if (!r) throw new WatchProblem(t("Apple Podcasts doesn't know that show."), "notFound");
    if (!r.feedUrl) throw new WatchProblem(t("This show has no public feed, so its episodes can't be downloaded."), "noFeed");
    return { id, title: r.collectionName ?? "Podcast", author: r.artistName ?? "", artwork: r.artworkUrl600 ?? r.artworkUrl100 ?? null, genre: r.primaryGenreName ?? null, feed: r.feedUrl };
  }

  private async load(id: string) {
    const cached = this.feeds.get(id);
    if (cached && Date.now() - cached.at < FEED_TTL) return cached;
    const show = await this.lookup(id);
    const answer = await this.get(show.feed, { headers: { Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1" } });
    if (!answer.ok) throw new WatchProblem(t("The show's feed didn't load. Try again in a moment."), "feed");
    const parsed = parseFeed(await answer.text());
    const entry = { at: Date.now(), show: { ...show, artwork: show.artwork ?? parsed.artwork, about: parsed.about }, episodes: parsed.episodes };
    this.feeds.set(id, entry);
    if (this.feeds.size > 12) this.feeds.delete(this.feeds.keys().next().value!);
    return entry;
  }

  async show(id: string, offset = 0): Promise<ShowDetail> {
    const { show, episodes } = await this.load(id);
    return { ...show, episodes: episodes.length, offset, page: episodes.slice(offset, offset + PAGE) };
  }

  /** One episode as the feed has it, with its show: what an audiobook split downloads. */
  async find(id: string, episodeId: string): Promise<Episode & { show: string }> {
    const { show, episodes } = await this.load(id);
    const ep = episodes.find((e) => e.id === episodeId);
    if (!ep) throw new WatchProblem(t("That episode isn't in the show's feed any more."), "notFound");
    return { ...ep, artwork: ep.artwork ?? show.artwork, show: show.title };
  }

  /** The work that downloads one episode, as the feed has it. */
  async episode(id: string, episodeId: string, ffmpeg: () => string | null): Promise<{ title: string; artist: string; origin: string; work: Work }> {
    const { show, episodes } = await this.load(id);
    const ep = episodes.find((e) => e.id === episodeId);
    if (!ep) throw new WatchProblem(t("That episode isn't in the show's feed any more."), "notFound");
    const origin = `podcast:${id}:${ep.id}`;
    const work: Work = async ({ dir, progress, signal }) => {
      const answer = await this.get(ep.url, { signal });
      if (!answer.ok || !answer.body) throw new Error(t("The episode didn't download ({status}).", { status: answer.status }));
      const total = Number(answer.headers.get("content-length")) || ep.bytes || 0;
      if (total > MAX_EPISODE) throw new Error(t("That episode is too big for the watch."));
      const ext = /mpeg|mp3/i.test(answer.headers.get("content-type") ?? ep.type) || /\.mp3(\?|$)/i.test(ep.url) ? "mp3" : "m4a";
      let file = path.join(dir, `episode.${ext}`);
      const out = createWriteStream(file);
      let got = 0;
      const reader = answer.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (got > MAX_EPISODE) throw new Error(t("That episode is too big for the watch."));
          if (!out.write(value)) await once(out, "drain");
          if (total) progress(Math.min(0.95, got / total));
        }
      } finally {
        out.end();
        await once(out, "close").catch(() => undefined);
      }
      if (!(await withFile(file, (read) => isMp3(read)))) {
        const tool = ffmpeg();
        if (!tool) throw new Error(t("This episode isn't an MP3, and converting it needs ffmpeg."));
        const mp3 = path.join(dir, "converted.mp3");
        if (ext === "mp3") { const m4a = path.join(dir, "episode.m4a"); await writeFile(m4a, await readFile(file)); file = m4a; }
        await run(tool, ffmpegArgs(file, mp3), () => {}, signal);
        file = mp3;
      }
      const extra = { album: show.title, artist: show.author || show.title, source: "Podcast" as const };
      return [{ file, name: `${safeName(ep.title).slice(0, 120)}.mp3`, extra: { ...extra, title: ep.title, origin } }];
    };
    return { title: ep.title, artist: show.title, origin, work };
  }
}
