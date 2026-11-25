// Media's music services and downloads: CorosLink's "Must not regress" rules for them (replacement-checklist §6) and
// the parsing each service depends on.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { tokensFrom } from "./appleMusic";
import { Downloads } from "./downloads";
import { Library } from "./library";
import { bufferReader, readMp3 } from "./mp3";
import { decode, duration, parseFeed, Podcasts, showId } from "./podcasts";
import { MusicServices } from "./services";
import { authorizeUrl, Spotify, SPOTIFY_REDIRECT } from "./spotify";
import { ffmpegArgs, progressOf, ytDlpArgs } from "./tools";
import { frames, id3, mp3 } from "./testMp3";
import { plain, ServiceVault } from "./vault";
import { noWeb } from "./webHost";
import { readPlaylists, readSongs, sapisidHash } from "./ytmusic";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-music-"));
const secsOf = async (b: Buffer) => (await readMp3(bufferReader(b), b.length)).secs;

describe("downloading an episode", () => {
  it("downloads it from the show's own feed into the library, once", async () => {
    const data = folder();
    const library = new Library(data);
    const show = { results: [{ collectionId: 123456, collectionName: "Long Run Show", artistName: "Ana", feedUrl: "https://feeds.example/run.xml" }] };
    const feed = `<rss><channel><title>Long Run Show</title><item><title>Ep 212 &amp; more</title><guid>g-212</guid>
      <enclosure url="https://cdn.example/212.mp3" type="audio/mpeg" length="1"/></item></channel></rss>`;
    const audio = Buffer.concat([id3([]), frames(Math.round((2 * 60 * 44100) / 1152))]);
    const get = async (url: string) => (url.includes("itunes.apple.com") ? Response.json(show) : url.endsWith(".xml") ? new Response(feed) : new Response(audio, { headers: { "content-type": "audio/mpeg" } }));
    const podcasts = new Podcasts(get);
    const episode = (await podcasts.show("123456")).page[0];
    expect(episode.title).toBe("Ep 212 & more");
    expect((await podcasts.find("123456", episode.id)).show).toBe("Long Run Show");
    const job = await podcasts.episode("123456", episode.id, () => null);
    const downloads = new Downloads(library, path.join(data, "tmp"));
    expect(downloads.add({ source: "Podcast", title: job.title, artist: job.artist, origin: job.origin }, job.work)).toBe(true);
    await downloads.idle();
    const tracks = library.list();
    expect(tracks.map((t) => t.file)).toEqual(["Ep 212 & more.mp3"]);
    expect(tracks[0]).toMatchObject({ title: "Ep 212 & more", source: "Podcast", album: "Long Run Show" });
    expect(await secsOf(readFileSync(library.pathOf(tracks[0])))).toBe(120);
    // Downloaded once: asking again queues nothing.
    expect(downloads.add({ source: "Podcast", title: job.title, artist: job.artist, origin: job.origin }, job.work)).toBe(false);
  });
});

describe("podcast feeds", () => {
  it("reads the episodes that have audio, with their length and date", () => {
    const feed = parseFeed(`<rss><channel><title><![CDATA[Show & Tell]]></title><itunes:image href="https://img/x.jpg"/>
      <item><title>Video only</title><enclosure url="https://v/1.mp4" type="video/mp4"/></item>
      <item><title>One</title><pubDate>Tue, 10 Nov 2026 06:00:00 GMT</pubDate><itunes:duration>1:02:03</itunes:duration><enclosure url='https://a/1.mp3' length='5' type='audio/mpeg'/></item>
      </channel></rss>`);
    expect(feed.title).toBe("Show & Tell");
    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0]).toMatchObject({ title: "One", secs: 3723, bytes: 5, url: "https://a/1.mp3" });
    expect(feed.episodes[0].published).toBe(Date.parse("Tue, 10 Nov 2026 06:00:00 GMT"));
  });

  it("reads the show's description as plain text, and each episode's cover, season and number", () => {
    const feed = parseFeed(`<rss><channel><title>Deep Dive</title><description><![CDATA[<p>Big   questions,</p><p>small &amp; clear.</p>]]></description>
      <item><title>Six</title><itunes:image href="https://img/6.jpg"/><itunes:season>10</itunes:season><itunes:episode>6</itunes:episode><enclosure url="https://a/6.mp3" type="audio/mpeg"/></item>
      <item><title>Bonus</title><itunes:episode>soon</itunes:episode><enclosure url="https://a/b.mp3" type="audio/mpeg"/></item>
      </channel></rss>`);
    expect(feed.about).toBe("Big questions, small & clear.");
    expect(feed.episodes[0]).toMatchObject({ artwork: "https://img/6.jpg", season: 10, number: 6 });
    expect(feed.episodes[1]).toMatchObject({ artwork: null, season: null, number: null });
  });

  it("decodes entities, lengths and Apple Podcasts links", () => {
    expect(decode("Tom &amp; Jerry &#8217;s &#x41;")).toBe("Tom & Jerry ’s A");
    expect(duration("62:03")).toBe(3723);
    expect(duration("3723")).toBe(3723);
    expect(duration("soon")).toBeNull();
    expect(showId("https://podcasts.apple.com/us/podcast/the-show/id1234567890?i=1")).toBe("1234567890");
    expect(showId("marathon talk")).toBeNull();
  });
});

describe("the tools", () => {
  it("gives ffmpeg only audio files on this computer, never a URL or a playlist", () => {
    expect(ffmpegArgs("/tmp/x/episode.m4a", "/tmp/x/out.mp3")).toContain("file");
    expect(() => ffmpegArgs("https://evil.example/a.mp3", "/tmp/out.mp3")).toThrow();
    expect(() => ffmpegArgs("/tmp/list.m3u8", "/tmp/out.mp3")).toThrow();
    expect(() => ffmpegArgs("relative.mp3", "/tmp/out.mp3")).toThrow();
  });

  it("asks yt-dlp for an MP3, by YouTube Music address or by search, never reading a title as an option", () => {
    const byUrl = ytDlpArgs("https://music.youtube.com/watch?v=dQw4w9WgXcQ", "/tmp/j", "/opt/homebrew/bin/ffmpeg");
    expect(byUrl.at(-1)).toBe("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(byUrl).toEqual(expect.arrayContaining(["--audio-format", "mp3", "--ffmpeg-location", "/opt/homebrew/bin"]));
    const bySearch = ytDlpArgs("--exec rm - Song audio", "/tmp/j", null);
    expect(bySearch.at(-2)).toBe("--");
    expect(bySearch.at(-1)).toBe("ytsearch1:--exec rm - Song audio");
    expect(progressOf("[download]  42.5% of 3.10MiB at 1.2MiB/s")).toBeCloseTo(0.425);
  });
});

describe("downloads", () => {
  it("runs three at a time and never downloads the same song twice", async () => {
    const data = folder();
    const library = new Library(data);
    const downloads = new Downloads(library, path.join(data, "tmp"));
    let running = 0, most = 0;
    const work = (i: number) => async ({ dir }: { dir: string }) => {
      running++; most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 15));
      running--;
      const file = path.join(dir, "audio.mp3");
      writeFileSync(file, mp3(2));
      return [{ file, name: `Song ${i}.mp3`, extra: { title: `Song ${i}`, source: "Spotify" as const, origin: `spotify:${i}` } }];
    };
    for (let i = 0; i < 7; i++) downloads.add({ source: "Spotify", title: `Song ${i}`, artist: null, origin: `spotify:${i}` }, work(i));
    expect(downloads.add({ source: "Spotify", title: "Song 0", artist: null, origin: "spotify:0" }, work(0))).toBe(false);
    await downloads.idle();
    expect(most).toBe(3);
    expect(library.list()).toHaveLength(7);
    expect(downloads.add({ source: "Spotify", title: "Song 3", artist: null, origin: "spotify:3" }, work(3))).toBe(false);
  });

  it("keeps a failed download's reason and adds nothing", async () => {
    const data = folder();
    const library = new Library(data);
    const downloads = new Downloads(library, path.join(data, "tmp"));
    downloads.add({ source: "Apple Music", title: "Gone", artist: null, origin: "apple:1" }, async () => { throw new Error("Video unavailable"); });
    await downloads.idle();
    expect(downloads.list()[0]).toMatchObject({ state: "failed", error: "Video unavailable" });
    expect(library.list()).toHaveLength(0);
  });

  it("downloads only songs from a list this process read, never a target the page sends", async () => {
    const data = folder();
    const services = new MusicServices(data, new Library(data));
    await expect(services.answer("POST", "/source/spotify/download", new URL("clink://app/x"), { playlist: "abc", origins: ["spotify:1"] })).rejects.toThrow();
  });
});

describe("Spotify", () => {
  it("signs in with PKCE on the loopback address, with no secret", () => {
    const { url, verifier } = authorizeUrl("0123456789abcdef0123456789abcdef");
    const q = new URL(url).searchParams;
    expect(q.get("redirect_uri")).toBe(SPOTIFY_REDIRECT);
    expect(SPOTIFY_REDIRECT.startsWith("http://127.0.0.1:")).toBe(true);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).not.toBe(verifier);
    expect(url).not.toContain("secret");
  });

  it("takes only a real Client ID, and a new one signs out", async () => {
    const vault = new ServiceVault(folder(), plain);
    const spotify = new Spotify(vault, noWeb);
    await expect(spotify.setClientId("not an id")).rejects.toThrow("32");
    await spotify.setClientId("0123456789abcdef0123456789abcdef");
    await vault.setSecret("spotify", { access: "a", refresh: "r", expiresAt: Date.now() + 60_000, account: "me" });
    expect((await spotify.status()).connected).toBe(true);
    await spotify.setClientId("fedcba9876543210fedcba9876543210");
    expect((await spotify.status()).connected).toBe(false);
  });

  it("keeps tokens encrypted on disk", async () => {
    const data = folder();
    const sealer = { encrypt: async (t: string) => Buffer.from(t).reverse(), decrypt: async (d: Buffer) => ({ text: Buffer.from(d).reverse().toString(), stale: false }) };
    await new ServiceVault(data, sealer).setSecret("spotify", { access: "token-123" });
    expect(readFileSync(path.join(data, "media", "services.bin"), "utf8")).not.toContain("token-123");
    expect(await new ServiceVault(data, sealer).secret("spotify")).toEqual({ access: "token-123" });
  });
});

describe("YouTube Music and Apple Music", () => {
  const text = (t: string) => ({ runs: [{ text: t }] });
  const row = (id: string, title: string, artist: string, album: string, len: string) => ({
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: id },
      flexColumns: [title, artist, album].map((t) => ({ musicResponsiveListItemFlexColumnRenderer: { text: text(t) } })),
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: text(len) } }],
    },
  });

  it("reads a playlist's songs and the next page's token, wherever the layout puts them", () => {
    const page = { contents: { a: { b: [row("dQw4w9WgXcQ", "Run", "Halden Cove • Signal Year", "Signal Year", "3:18"), { other: true }] } },
      continuations: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "NEXT" } } } }] };
    const { songs, next } = readSongs(page);
    expect(songs).toEqual([{ origin: "ytm:dQw4w9WgXcQ", title: "Run", artist: "Halden Cove", album: "Signal Year", secs: 198, artwork: null, target: "https://music.youtube.com/watch?v=dQw4w9WgXcQ" }]);
    expect(next).toBe("NEXT");
  });

  it("reads the library's playlists, skipping tiles that aren't one", () => {
    const tile = (id: string | null, title: string, subtitle: string) => ({ musicTwoRowItemRenderer: { title: text(title), subtitle: text(subtitle), navigationEndpoint: id ? { browseEndpoint: { browseId: id } } : {} } });
    const found = readPlaylists({ grid: [tile(null, "New playlist", ""), tile("VLPL123", "Long runs", "Ana • 42 songs"), tile("MPREb_album", "An album", "")] });
    expect(found).toEqual([{ id: "PL123", name: "Long runs", count: 42, owner: "Ana", artwork: null }]);
  });

  it("signs requests the way Google asks", () => {
    expect(sapisidHash("abc", 1_700_000_000_000)).toMatch(/^SAPISIDHASH 1700000000_[0-9a-f]{40}$/);
  });

  it("takes Apple's tokens only from a request that has both", () => {
    expect(tokensFrom({ Authorization: "Bearer dev.jwt" })).toBeNull();
    expect(tokensFrom({ authorization: "Bearer dev.jwt", "Media-User-Token": "user" })).toEqual({ developer: "dev.jwt", user: "user" });
  });
});

describe("a service playlist as one MP3", () => {
  const songs = ["Warm up", "Tempo", "Cool down"].map((title, i) => ({ origin: `ytm:v${i}`, title, artist: "Halden Cove", album: null, secs: 200, target: `https://music.youtube.com/watch?v=v${i}` }));
  function setup() {
    const data = folder();
    const library = new Library(data);
    const services = new MusicServices(data, library);
    vi.spyOn(services, "tools").mockReturnValue({ ytDlp: true, ffmpeg: true });
    Object.assign(services.sources.ytmusic, {
      playlists: async () => [{ id: "PL1", name: "Long run", count: 3, owner: null, artwork: null }],
      songs: async () => songs,
    });
    const fetched: string[] = [];
    const fake = {
      fetchTrack: async (input: string, file: string) => { fetched.push(input); writeFileSync(file, mp3(2)); },
      join: async (files: string[], output: string) => { writeFileSync(output, Buffer.concat(files.map((f) => readFileSync(f)))); },
    };
    return { library, services, fetched, fake, url: (q = "") => new URL(`clink://app/x${q}`) };
  }

  it("joins the playlist's songs, each found as it would be alone, under the playlist's name", async () => {
    const { library, services, fetched, fake, url } = setup();
    await services.answer("GET", "/source/ytmusic/playlists", url(), {});
    const listed = await services.answer("GET", "/source/ytmusic/songs", url("?playlist=PL1"), {}) as { combined: { inLibrary: boolean } };
    expect(listed.combined).toEqual({ inLibrary: false, job: null });

    expect(services.combined("ytmusic", "PL1", false, fake)).toEqual({ queued: 1 });
    await services.downloads.idle();
    expect(fetched).toEqual(songs.map((s) => s.target));
    const made = library.list().filter((t) => t.origin === "combined:ytmusic:PL1");
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ title: "Long run", source: "YouTube Music" });
    // The songs on their own aren't added.
    expect(library.list()).toHaveLength(1);

    const state = await services.answer("GET", "/source/ytmusic/state", url("?playlist=PL1"), {}) as { combined: { inLibrary: boolean; job: { state: string } } };
    expect(state.combined).toMatchObject({ inLibrary: true, job: { state: "done" } });
  });

  it("combines only a playlist this process read", () => {
    const { services, fake } = setup();
    expect(() => services.combined("ytmusic", "PL1", false, fake)).toThrow(/Open the playlist again/);
  });
});
