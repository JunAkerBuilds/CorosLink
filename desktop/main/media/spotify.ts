// Spotify, through the person's own Spotify app (developer.spotify.com): they paste its Client ID, sign in once in a
// window (Authorization Code with PKCE, so there's no secret), and the app reads their playlists. In Spotify's
// Development Mode that app reads only playlists the person made or collaborates on.
//
// Playlists they only follow can be unlocked: a second sign-in as Spotify's own desktop client (the identity
// librespot, spotify-player and ncspot use), which isn't limited that way. Spotify doesn't sanction other apps using
// it and may block it, so it's opt-in, used only to read a playlist the person's own app is refused, and only
// through the internal endpoints (spotifyInternal.ts), never the Web API where that identity is rate-limited.
//
// Each window's redirect to the loopback address is caught before it loads, so nothing listens on those ports.
import { createHash, randomBytes } from "node:crypto";
import { searchFor, SourceProblem, type MusicSource, type Playlist, type Song, type SourceStatus } from "./sources";
import { readPlaylist, SpotifyInternalError } from "./spotifyInternal";
import type { ServiceVault } from "./vault";
import type { WebHost } from "./webHost";
import { t } from "@/lib/i18n";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const MAX_SONGS = 5000;

interface Grant { key: "spotify" | "spotify.followed"; redirect: string; scopes: string; title: string; partition: string }

/** The person's own app. */
const APP: Grant = {
  key: "spotify", redirect: "http://127.0.0.1:4567/callback", scopes: "playlist-read-private playlist-read-collaborative user-read-private",
  title: t("Sign in to Spotify"), partition: "persist:clink-spotify",
};
/** Spotify's desktop client, for followed playlists. Its registered redirect is http://127.0.0.1:8898/login. */
const FOLLOWED: Grant = {
  key: "spotify.followed", redirect: "http://127.0.0.1:8898/login", scopes: "playlist-read-private playlist-read-collaborative",
  title: t("Unlock followed Spotify playlists"), partition: "persist:clink-spotify",
};
export const SPOTIFY_DESKTOP_CLIENT = "65b708073fc0480ea92a077233ca87bd";
export const SPOTIFY_REDIRECT = APP.redirect;

interface Tokens { access: string; refresh: string; expiresAt: number; account?: string | null; user?: string | null }

const b64url = (b: Buffer) => b.toString("base64url");

type Image = { url: string; width?: number | null };
/** The smallest image at least `size` px wide (Spotify lists them largest first), or the largest there is. */
export function pickImage(images: Image[] | null | undefined, size: number): string | null {
  if (!images?.length) return null;
  const big = images.filter((i) => (i.width ?? 0) >= size).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (big[0] ?? images[0]).url;
}

/** The authorize address for a sign-in, and the verifier and state that go with it. */
export function authorizeUrl(clientId: string, grant: Grant = APP): { url: string; verifier: string; state: string } {
  const verifier = b64url(randomBytes(48));
  const state = b64url(randomBytes(16));
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: grant.redirect, scope: grant.scopes, state,
    code_challenge_method: "S256", code_challenge: b64url(createHash("sha256").update(verifier).digest()),
  }).toString();
  return { url: url.href, verifier, state };
}
export const followedAuthorizeUrl = () => authorizeUrl(SPOTIFY_DESKTOP_CLIENT, FOLLOWED);

/** Whose playlist it is, as Spotify's own app reads it: the person's own, one they collaborate on, or one they follow. */
export function isLocked(p: { owner?: { id?: string } | null; collaborative?: boolean }, me: string | null, unlocked: boolean): boolean {
  return !unlocked && !p.collaborative && !!me && p.owner?.id !== me;
}

export class Spotify implements MusicSource {
  readonly source = "Spotify" as const;
  constructor(private readonly vault: ServiceVault, private readonly web: WebHost, private readonly get: typeof fetch = fetch) {}

  private clientId() { return this.vault.setting("spotify.clientId"); }
  private grantClient(grant: Grant) { return grant === FOLLOWED ? SPOTIFY_DESKTOP_CLIENT : this.clientId(); }

  async status(): Promise<SourceStatus> {
    const tokens = await this.vault.secret<Tokens>(APP.key);
    const followed = await this.vault.secret<Tokens>(FOLLOWED.key);
    const connected = !!tokens && !!this.clientId();
    return { connected, account: tokens?.account ?? null, clientId: this.clientId(), redirectUri: APP.redirect, unlocked: connected && !!followed };
  }

  /** Saves the Client ID (32 hex characters); a different one signs out. */
  async setClientId(value: string): Promise<SourceStatus> {
    const id = value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) throw new SourceProblem(t("A Spotify Client ID is 32 letters and numbers, from your app's page on developer.spotify.com."), "clientId");
    if (id.toLowerCase() === SPOTIFY_DESKTOP_CLIENT) throw new SourceProblem(t("Use the Client ID of an app you made yourself."), "clientId");
    if (id !== this.clientId()) await this.forget();
    this.vault.setSetting("spotify.clientId", id);
    return this.status();
  }

  /** A sign-in window for a grant; resolves with its tokens, or null when the window was closed. */
  private async authorize(grant: Grant): Promise<Tokens | null> {
    const clientId = this.grantClient(grant);
    if (!clientId) throw new SourceProblem(t("Add your Spotify app's Client ID first."), "clientId");
    const { url, verifier, state } = authorizeUrl(clientId, grant);
    const back = await this.web.signIn({ url, partition: grant.partition, title: grant.title, done: (u) => u.startsWith(grant.redirect) });
    if (!back) return null;
    const answer = new URL(back).searchParams;
    if (answer.get("state") !== state) throw new SourceProblem(t("Spotify's answer didn't match. Try again."), "state");
    const code = answer.get("code");
    if (!code) {
      throw new SourceProblem(answer.get("error") === "access_denied" ? t("Spotify sign-in was cancelled.")
        : grant === APP ? t("Spotify didn't sign you in. Check the Redirect URI in your app's settings.") : t("Spotify didn't unlock followed playlists."), "denied");
    }
    const tok = await this.token({ grant_type: "authorization_code", code, redirect_uri: grant.redirect, client_id: clientId, code_verifier: verifier });
    return { access: tok.access_token, refresh: tok.refresh_token ?? "", expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000 };
  }

  async connect(): Promise<SourceStatus> {
    const tokens = await this.authorize(APP);
    if (!tokens) return this.status();
    await this.vault.setSecret(APP.key, tokens);
    const me = await this.api<{ display_name?: string; id: string }>("/me");
    await this.vault.setSecret(APP.key, { ...tokens, account: me.display_name || me.id, user: me.id });
    return this.status();
  }

  /** Signs in as Spotify's desktop client, so playlists the person only follows can be read too. */
  async unlock(): Promise<SourceStatus> {
    if (!(await this.status()).connected) throw new SourceProblem(t("Sign in to Spotify first."), "signedOut");
    const tokens = await this.authorize(FOLLOWED);
    if (tokens) await this.vault.setSecret(FOLLOWED.key, tokens);
    return this.status();
  }

  async lock(): Promise<SourceStatus> {
    await this.vault.setSecret(FOLLOWED.key, null);
    return this.status();
  }

  private async forget() {
    await this.vault.setSecret(APP.key, null);
    await this.vault.setSecret(FOLLOWED.key, null);
  }

  async disconnect(): Promise<SourceStatus> {
    await this.forget();
    await this.web.clear(APP.partition);
    return this.status();
  }

  private async token(body: Record<string, string>) {
    const answer = await this.get(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    const json = (await answer.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (!answer.ok || !json.access_token) throw new SourceProblem(t("Spotify refused: {reason}. Sign in again.", { reason: json.error_description ?? answer.status }), "token");
    return json as { access_token: string; refresh_token?: string; expires_in?: number };
  }

  /** A current access token for a grant, refreshed when it has run out. */
  private async access(grant: Grant): Promise<string> {
    const tokens = await this.vault.secret<Tokens>(grant.key);
    const clientId = this.grantClient(grant);
    if (!tokens || !clientId) throw new SourceProblem(grant === APP ? "Sign in to Spotify first." : "Unlock followed playlists first.", "signedOut");
    if (Date.now() < tokens.expiresAt) return tokens.access;
    let tok;
    try {
      tok = await this.token({ grant_type: "refresh_token", refresh_token: tokens.refresh, client_id: clientId });
    } catch (error) {
      if (grant === FOLLOWED) { await this.vault.setSecret(FOLLOWED.key, null); throw new SourceProblem(t("Spotify ended the unlock. Unlock followed playlists again."), "locked"); }
      throw error;
    }
    await this.vault.setSecret(grant.key, { ...tokens, access: tok.access_token, refresh: tok.refresh_token ?? tokens.refresh, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000 });
    return tok.access_token;
  }

  private async api<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${API}${pathOrUrl}`;
    if (!url.startsWith(`${API}/`)) throw new SourceProblem(t("Not a Spotify address."), "address");
    const answer = await this.get(url, { headers: { Authorization: `Bearer ${await this.access(APP)}` } });
    if (answer.status === 401) { await this.forget(); throw new SourceProblem(t("Spotify signed you out. Sign in again."), "signedOut"); }
    if (answer.status === 403 || answer.status === 404) throw new SourceProblem(t("Spotify only lets your app read playlists you made or collaborate on. Unlock followed playlists to read this one."), "forbidden");
    if (answer.status === 429) throw new SourceProblem(t("Spotify asked to slow down. Try again in a minute."), "rate");
    if (!answer.ok) throw new SourceProblem(t("Spotify didn't answer ({status}).", { status: answer.status }), "spotify");
    return (await answer.json()) as T;
  }

  async playlists(): Promise<Playlist[]> {
    const { unlocked = false } = await this.status();
    let me = (await this.vault.secret<Tokens>(APP.key))?.user ?? null;
    if (!me) {
      const profile = await this.api<{ display_name?: string; id: string }>("/me");
      const tokens = await this.vault.secret<Tokens>(APP.key);
      if (tokens) await this.vault.setSecret(APP.key, { ...tokens, account: profile.display_name || profile.id, user: profile.id });
      me = profile.id;
    }
    const out: Playlist[] = [];
    type Item = { id: string; name: string; collaborative?: boolean; tracks?: { total: number }; items?: { total: number }; owner?: { id?: string; display_name?: string }; images?: { url: string }[] | null };
    for (let next: string | null = "/me/playlists?limit=50"; next && out.length < 1000;) {
      const page: { items: (Item | null)[]; next: string | null } = await this.api(next);
      for (const p of page.items) {
        if (!p) continue;
        out.push({
          id: p.id, name: p.name, count: p.items?.total ?? p.tracks?.total ?? null, owner: p.owner?.display_name ?? p.owner?.id ?? null,
          artwork: pickImage(p.images, 300), locked: isLocked(p, me, unlocked), followed: !!me && !p.collaborative && p.owner?.id !== me,
        });
      }
      next = page.next;
    }
    return out;
  }

  async songs(playlistId: string): Promise<Song[]> {
    if (!/^[A-Za-z0-9]{10,40}$/.test(playlistId)) throw new SourceProblem(t("Not a Spotify playlist."), "playlist");
    try {
      return await this.webApiSongs(playlistId);
    } catch (error) {
      // Development Mode refuses playlists the person only follows; read those through the unlock, when it's on.
      if (!(error instanceof SourceProblem) || error.code !== "forbidden" || !(await this.status()).unlocked) throw error;
      try {
        const tracks = await readPlaylist(this.get, await this.access(FOLLOWED), playlistId);
        return tracks.map((t) => ({ origin: `spotify:${t.id}`, title: t.title, artist: t.artist, album: t.album, secs: t.secs, artwork: t.artwork, target: searchFor(t.artist, t.title) }));
      } catch (inner) {
        if (inner instanceof SpotifyInternalError && (inner.status === 401 || inner.status === 403)) {
          await this.vault.setSecret(FOLLOWED.key, null);
          throw new SourceProblem(t("Spotify turned the unlock away. Unlock followed playlists again."), "locked");
        }
        if (inner instanceof SpotifyInternalError && inner.status === 429) throw new SourceProblem(t("Spotify asked to slow down. Try again in a minute."), "rate");
        throw inner;
      }
    }
  }

  private async webApiSongs(playlistId: string): Promise<Song[]> {
    const out: Song[] = [];
    type Track = { id: string | null; name: string; type?: string; is_local?: boolean; duration_ms?: number; artists?: { name: string }[]; album?: { name?: string; images?: Image[] } };
    for (let next: string | null = `/playlists/${playlistId}/items?limit=100&additional_types=track`; next && out.length < MAX_SONGS;) {
      const page: { items: { item?: Track | null; track?: Track | null }[]; next: string | null } = await this.api(next);
      for (const row of page.items) {
        const track = row.item ?? row.track;
        if (!track?.id || track.is_local || (track.type && track.type !== "track")) continue;
        const artist = (track.artists ?? []).map((a) => a.name).join(", ");
        out.push({
          origin: `spotify:${track.id}`, title: track.name, artist, album: track.album?.name ?? null, secs: track.duration_ms ? Math.round(track.duration_ms / 1000) : null,
          artwork: pickImage(track.album?.images, 64), target: searchFor(artist, track.name),
        });
      }
      next = page.next;
    }
    return out;
  }
}
