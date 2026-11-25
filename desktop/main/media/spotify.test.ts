// Spotify: the person's own app, followed playlists unlocked through Spotify's desktop client, and sending downloads
// to the watch as they land (CorosLink's Spotify sync), with replacement-checklist §6's rules as tests.
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaService } from "./service";
import { followedAuthorizeUrl, isLocked, Spotify, SPOTIFY_DESKTOP_CLIENT } from "./spotify";
import { base62ToHex, METADATA_AT_ONCE, PAGE_LENGTH, readPage, readPlaylist } from "./spotifyInternal";
import { mp3 } from "./testMp3";
import { plain, ServiceVault } from "./vault";
import { noWeb } from "./webHost";
import { WatchDrive } from "./watchDrive";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-spotify-"));

/** Protobuf by hand: a varint, and a length-delimited field. */
const varint = (n: number) => { const out: number[] = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
const bytes = (field: number, body: Buffer) => Buffer.concat([varint((field << 3) | 2), varint(body.length), body]);
const num = (field: number, n: number) => Buffer.concat([varint(field << 3), varint(n)]);
const item = (uri: string) => bytes(3, bytes(1, Buffer.from(uri)));
const page = (total: number, uris: string[]) => Buffer.concat([num(2, total), bytes(5, Buffer.concat(uris.map(item)))]);
const id22 = (n: number) => `${"0".repeat(21)}${"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"[n % 62]}`.slice(-22).replace(/^0/, String(Math.floor(n / 62) % 10));

describe("reading a followed playlist through Spotify's internal endpoints", () => {
  it("turns a track id into the hex gid the metadata endpoint wants", () => {
    expect(base62ToHex("4uLU6hMCjMI75M1A2tKUQC")).toBe("93bc414a606747b2b612491ef83d5a3e");
    expect(() => base62ToHex("not-an-id!")).toThrow();
  });

  it("reads the length and the tracks of a page, leaving out episodes and local files", () => {
    const read = readPage(page(3, ["spotify:track:4uLU6hMCjMI75M1A2tKUQC", "spotify:episode:4uLU6hMCjMI75M1A2tKUQC", "spotify:local:a:b:c:1"]));
    expect(read).toEqual({ total: 3, items: 3, ids: ["4uLU6hMCjMI75M1A2tKUQC"] });
  });

  it("pages 500 rows at a time and asks for at most 8 tracks' details at once", async () => {
    const ids = Array.from({ length: 620 }, (_, i) => id22(i));
    const asked: string[] = [];
    let open = 0, most = 0;
    const get = (async (url: string) => {
      asked.push(url);
      const u = new URL(url);
      if (u.pathname.startsWith("/playlist/")) {
        const from = Number(u.searchParams.get("from"));
        expect(u.searchParams.get("length")).toBe(String(PAGE_LENGTH));
        return new Response(page(ids.length, ids.slice(from, from + PAGE_LENGTH).map((id) => `spotify:track:${id}`)));
      }
      open++; most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 1));
      open--;
      return Response.json({ name: "Run", duration: 200_000, artist: [{ name: "Ana" }, { name: "Bo" }], album: { name: "Miles" } });
    }) as typeof fetch;
    const tracks = await readPlaylist(get, "token", "37i9dQZF1DX0XUsuxWHRQd");
    expect(asked.filter((u) => u.includes("/playlist/"))).toHaveLength(2);
    expect(tracks).toHaveLength(620);
    expect(tracks[0]).toEqual({ id: ids[0], title: "Run", artist: "Ana, Bo", album: "Miles", secs: 200, artwork: null });
    expect(most).toBe(METADATA_AT_ONCE);
  });
});

describe("unlocking followed playlists", () => {
  it("signs in as Spotify's desktop client on its own loopback address", () => {
    const q = new URL(followedAuthorizeUrl().url).searchParams;
    expect(q.get("client_id")).toBe(SPOTIFY_DESKTOP_CLIENT);
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:8898/login");
    expect(q.get("scope")).toBe("playlist-read-private playlist-read-collaborative");
  });

  it("locks only other people's playlists, and only until unlocked", () => {
    expect(isLocked({ owner: { id: "me" } }, "me", false)).toBe(false);
    expect(isLocked({ owner: { id: "ana" }, collaborative: true }, "me", false)).toBe(false);
    expect(isLocked({ owner: { id: "ana" } }, "me", false)).toBe(true);
    expect(isLocked({ owner: { id: "ana" } }, "me", true)).toBe(false);
  });

  it("never takes Spotify's own client as the person's app", async () => {
    await expect(new Spotify(new ServiceVault(folder(), plain), noWeb).setClientId(SPOTIFY_DESKTOP_CLIENT)).rejects.toThrow("made yourself");
  });

  async function signedIn(unlocked: boolean, internal: (url: string) => Response) {
    const vault = new ServiceVault(folder(), plain);
    vault.setSetting("spotify.clientId", "0123456789abcdef0123456789abcdef");
    const later = Date.now() + 3_600_000;
    await vault.setSecret("spotify", { access: "mine", refresh: "r", expiresAt: later, account: "Me", user: "me" });
    if (unlocked) await vault.setSecret("spotify.followed", { access: "desktop", refresh: "r2", expiresAt: later });
    const used: { url: string; token: string | null }[] = [];
    const get = (async (url: string, init?: RequestInit) => {
      const token = new Headers(init?.headers).get("authorization");
      used.push({ url, token });
      if (url.startsWith("https://api.spotify.com/")) return new Response("{}", { status: 403 });
      return internal(url);
    }) as typeof fetch;
    return { spotify: new Spotify(vault, noWeb, get), vault, used };
  }

  it("reads a followed playlist through the unlock when the person's app is refused, never sending that token to the Web API", async () => {
    const { spotify, used } = await signedIn(true, (url) => (url.includes("/playlist/")
      ? new Response(page(1, ["spotify:track:4uLU6hMCjMI75M1A2tKUQC"]))
      : Response.json({ name: "Song", artist: [{ name: "Ana" }] })));
    const songs = await spotify.songs("37i9dQZF1DX0XUsuxWHRQd");
    expect(songs).toEqual([{ origin: "spotify:4uLU6hMCjMI75M1A2tKUQC", title: "Song", artist: "Ana", album: null, secs: null, artwork: null, target: "Ana - Song audio" }]);
    expect(used.filter((u) => u.url.startsWith("https://api.spotify.com/")).every((u) => u.token === "Bearer mine")).toBe(true);
    expect(used.filter((u) => u.url.startsWith("https://spclient.")).every((u) => u.token === "Bearer desktop")).toBe(true);
  });

  it("says to unlock when it's locked, and locks again when Spotify turns the unlock away", async () => {
    const locked = await signedIn(false, () => new Response("", { status: 500 }));
    await expect(locked.spotify.songs("37i9dQZF1DX0XUsuxWHRQd")).rejects.toThrow("Unlock followed playlists");
    const refused = await signedIn(true, () => new Response("", { status: 401 }));
    await expect(refused.spotify.songs("37i9dQZF1DX0XUsuxWHRQd")).rejects.toThrow("Unlock followed playlists again");
    expect((await refused.spotify.status()).unlocked).toBe(false);
    expect((await refused.spotify.status()).connected).toBe(true);
  });
});

describe("sending downloads to the watch", () => {
  const saved = process.env.CLINK_WATCH_PATH;
  afterEach(() => { if (saved == null) delete process.env.CLINK_WATCH_PATH; else process.env.CLINK_WATCH_PATH = saved; });

  it("sends each download after the send running now, one send at a time, in the order they landed", async () => {
    const root = folder();
    mkdirSync(path.join(root, "Music"));
    process.env.CLINK_WATCH_PATH = root;
    const drive = new WatchDrive();
    const copied: string[] = [];
    const copyIn = drive.copyIn.bind(drive);
    drive.copyIn = (source, name, progress) => { copied.push(name); return copyIn(source, name, progress); };
    const media = new MediaService(folder(), drive);
    const add = async (name: string) => {
      const file = path.join(folder(), "upload");
      writeFileSync(file, mp3(3));
      return media.library.add(file, name, { source: "Spotify", origin: `spotify:${name}` });
    };
    const first = await add("A first.mp3");
    await media.send([first.id]);
    media.queueSend([(await add("B second.mp3")).id]);
    media.queueSend([(await add("C third.mp3")).id]);
    for (let i = 0; i < 200 && (await media.state()).library.some((t) => !t.onWatch); i++) await new Promise((r) => setTimeout(r, 10));
    expect(copied).toEqual(["A first.mp3", "B second.mp3", "C third.mp3"]);
    expect(readdirSync(path.join(root, "Music"))).toHaveLength(3);
    expect((await media.state()).library.every((t) => t.onWatch)).toBe(true);
  });
});
