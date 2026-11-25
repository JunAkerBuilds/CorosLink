// Apple Music: the person signs in to music.apple.com in a window of its own. The web player's requests to Apple's
// "amp-api" carry its developer token and the account's media-user-token; the app keeps those two (encrypted) and
// reads the library's playlists with them, from the same session. Songs are found on YouTube to download.
import { searchFor, SourceProblem, type MusicSource, type Playlist, type Song, type SourceStatus } from "./sources";
import type { ServiceVault } from "./vault";
import type { WebHost } from "./webHost";

const PARTITION = "persist:clink-apple";
const API = "https://amp-api.music.apple.com";
const ORIGIN = "https://music.apple.com";
const MAX_SONGS = 5000;

interface Tokens { developer: string; user: string }

/** The two tokens from one request's headers (any letter case), or null. */
export function tokensFrom(headers: Record<string, string>): Tokens | null {
  let developer = "", user = "";
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "authorization") developer = v.replace(/^bearer\s+/i, "").trim();
    if (k.toLowerCase() === "media-user-token") user = v.trim();
  }
  return developer && user ? { developer, user } : null;
}

export class AppleMusic implements MusicSource {
  readonly source = "Apple Music" as const;
  constructor(private readonly vault: ServiceVault, private readonly web: WebHost) {}

  async status(): Promise<SourceStatus> {
    return { connected: !!(await this.vault.secret<Tokens>("apple")), account: null };
  }

  async connect(): Promise<SourceStatus> {
    let found: Tokens | null = null;
    await this.web.signIn({
      url: `${ORIGIN}/`, partition: PARTITION, title: "Sign in to Apple Music",
      headers: { urls: ["https://*.music.apple.com/*"], seen: (h) => !!(found = tokensFrom(h) ?? found) },
    });
    if (found) await this.vault.setSecret("apple", found);
    return this.status();
  }

  async disconnect(): Promise<SourceStatus> {
    await this.vault.setSecret("apple", null);
    await this.web.clear(PARTITION);
    return this.status();
  }

  private async api<T>(pathOrNext: string): Promise<T> {
    const tokens = await this.vault.secret<Tokens>("apple");
    if (!tokens) throw new SourceProblem("Sign in to Apple Music first.", "signedOut");
    if (!pathOrNext.startsWith("/v1/")) throw new SourceProblem("Not an Apple Music address.", "address");
    const answer = await this.web.fetch(PARTITION, `${API}${pathOrNext}`, {
      headers: { Authorization: `Bearer ${tokens.developer}`, "media-user-token": tokens.user, Origin: ORIGIN, Referer: `${ORIGIN}/`, Accept: "application/json" },
    });
    // The developer token is short-lived: signing in again picks up a fresh one.
    if (answer.status === 401 || answer.status === 403) { await this.vault.setSecret("apple", null); throw new SourceProblem("Apple Music's sign-in ran out. Sign in again.", "signedOut"); }
    if (!answer.ok) throw new SourceProblem(`Apple Music didn't answer (${answer.status}).`, "apple");
    return (await answer.json()) as T;
  }

  async playlists(): Promise<Playlist[]> {
    const out: Playlist[] = [];
    type Page = { data: { id: string; attributes?: { name?: string; artwork?: { url?: string } } }[]; next?: string };
    for (let next: string | undefined = "/v1/me/library/playlists?limit=100"; next && out.length < 1000;) {
      const page: Page = await this.api<Page>(next);
      for (const p of page.data) out.push({ id: p.id, name: p.attributes?.name ?? "Playlist", count: null, owner: null, artwork: p.attributes?.artwork?.url?.replace("{w}", "300").replace("{h}", "300") ?? null });
      next = page.next;
    }
    return out;
  }

  async songs(playlistId: string): Promise<Song[]> {
    if (!/^[\w.-]{4,80}$/.test(playlistId)) throw new SourceProblem("Not an Apple Music playlist.", "playlist");
    const out: Song[] = [];
    type Page = { data: { id: string; type?: string; attributes?: { name?: string; artistName?: string; albumName?: string; durationInMillis?: number; artwork?: { url?: string } } }[]; next?: string };
    for (let next: string | undefined = `/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`; next && out.length < MAX_SONGS;) {
      let page: Page;
      try { page = await this.api<Page>(next); } catch (e) { if (out.length || !(e instanceof SourceProblem) || !/404/.test(e.message)) throw e; return out; }
      for (const t of page.data) {
        const a = t.attributes;
        if (!a?.name || (t.type && !/songs/.test(t.type))) continue;
        out.push({
          origin: `apple:${t.id}`, title: a.name, artist: a.artistName ?? "", album: a.albumName ?? null, secs: a.durationInMillis ? Math.round(a.durationInMillis / 1000) : null,
          artwork: a.artwork?.url?.replace("{w}", "80").replace("{h}", "80") ?? null, target: searchFor(a.artistName ?? "", a.name),
        });
      }
      next = page.next;
    }
    return out;
  }
}
