// YouTube, combined MP3s, YouTube Music paging and the bundled tools: CorosLink's "Must not regress" rules for them
// (replacement-checklist §6: ffmpeg reads only local audio, ≤3 downloads at once, cache 7 days, ≤5000 items, history,
// its own session) and the parsing they depend on.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cacheKey, CACHE_MAX_AGE, combinedWork, pruneCache, type Combine } from "./combined";
import { Downloads } from "./downloads";
import { Library } from "./library";
import { concatArgs, listArgs, toolDirs, ytDlpArgs } from "./tools";
import { mp3 } from "./testMp3";
import { noWeb, type WebHost } from "./webHost";
import { allowedInBrowser, classify, History, MAX_ITEMS, normalize, PARTITION, readListing, slot, YouTube } from "./youtube";
import { MAX_SONGS, readPlaylists, readSongs, YouTubeMusic } from "./ytmusic";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-yt-"));
const entry = (id: string, title = `Video ${id}`, extra: Record<string, unknown> = {}) => ({ id, title, channel: "Halden Cove", duration: 61.4, ...extra });

describe("YouTube addresses", () => {
  it("puts every link in one plain form, a watch page in a playlist becoming the playlist", () => {
    expect(normalize("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(normalize("https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(normalize("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL12345")).toBe("https://www.youtube.com/playlist?list=PL12345");
    expect(normalize("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(classify("https://www.youtube.com/playlist?list=PL1")).toBe("playlist");
    expect(classify("https://www.youtube.com/results?search_query=x")).toBe("search");
  });

  it("refuses anything not on YouTube, however it's dressed up", () => {
    for (const bad of ["https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ", "file:///etc/passwd", "javascript:alert(1)", "not a link", "https://evil.example/?u=youtube.com"]) {
      expect(() => normalize(bad)).toThrow();
    }
  });

  it("lets the browsing window go only to YouTube and Google's sign-in, over https", () => {
    expect(allowedInBrowser("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(allowedInBrowser("https://accounts.google.com/signin")).toBe(true);
    expect(allowedInBrowser("http://www.youtube.com/")).toBe(false);
    expect(allowedInBrowser("https://evil.example/")).toBe(false);
    expect(allowedInBrowser("https://youtube.com.evil.example/")).toBe(false);
    expect(PARTITION).toBe("persist:clink-youtube");
  });

  it("lays YouTube only over a sensible slot of the page, and hides it otherwise", () => {
    expect(slot({ x: 254, y: 300, width: 1100, height: 600 })).toEqual({ x: 254, y: 300, width: 1100, height: 600 });
    for (const bad of [{}, { x: 0, y: 0, width: 10, height: 600 }, { x: "1", y: 0, width: 500, height: 500 }, { x: 0, y: 0, width: 1e9, height: 500 }, { x: Number.NaN, y: 0, width: 500, height: 500 }]) {
      expect(slot(bad)).toBeNull();
    }
  });

  it("reads yt-dlp's listing, leaving out live streams, private and deleted videos and repeats, at most 5000", () => {
    const found = readListing({ title: "Long runs", entries: [entry("aaaaaaaaaaa"), entry("bbbbbbbbbbb", "Live", { live_status: "is_live" }), entry("ccccccccccc", "[Private video]"), entry("aaaaaaaaaaa"), { id: "../x", title: "Bad" }] });
    expect(found).toEqual({ title: "Long runs", items: [{ id: "aaaaaaaaaaa", title: "Video aaaaaaaaaaa", channel: "Halden Cove", secs: 61 }] });
    const big = readListing({ entries: Array.from({ length: MAX_ITEMS + 50 }, (_, i) => entry(`v${String(i).padStart(10, "0")}`)) });
    expect(big.items).toHaveLength(5000);
  });

  it("hands yt-dlp only a YouTube search or address, after --, so a title is never read as an option", () => {
    expect(listArgs("ytsearch20:--exec rm", 20).slice(-2)).toEqual(["--", "ytsearch20:--exec rm"]);
    expect(listArgs("https://www.youtube.com/playlist?list=PL1", 5000)).toEqual(expect.arrayContaining(["--flat-playlist", "--playlist-end", "5000"]));
    expect(() => listArgs("https://evil.example/a", 1)).toThrow();
    expect(() => listArgs("--exec rm", 1)).toThrow();
  });
});

describe("history", () => {
  it("keeps videos, playlists and searches, newest first, marks downloads, and keeps 100", () => {
    const file = path.join(folder(), "h.json");
    const h = new History(file);
    h.visit("https://www.youtube.com/watch?v=aaaaaaaaaaa", "First - YouTube", 1);
    h.visit("https://www.youtube.com/", "Home", 2);
    h.visit("https://www.youtube.com/playlist?list=PL1", "Mix", 3);
    h.downloaded("https://www.youtube.com/watch?v=aaaaaaaaaaa", "First", 4);
    expect(h.list().map((e) => [e.title, e.kind, e.downloadedAt])).toEqual([["First", "video", 4], ["Mix", "playlist", null]]);
    for (let i = 0; i < 150; i++) h.visit(`https://www.youtube.com/watch?v=v${String(i).padStart(10, "0")}`, `V${i}`, 10 + i);
    expect(new History(file).list()).toHaveLength(100);
  });
});

/** A YouTube service with yt-dlp stood in for. */
function youtube(listing: unknown) {
  const data = folder();
  const library = new Library(data);
  const downloads = new Downloads(library, path.join(data, "tmp"));
  const yt = new YouTube(library, downloads, { web: noWeb, data, find: (n) => `/fake/${n}`, list: async () => listing });
  return { data, library, downloads, yt };
}

describe("YouTube downloads", () => {
  it("downloads only what a listing this process read holds, never an id the page makes up", async () => {
    const { yt } = youtube({ entries: [entry("aaaaaaaaaaa"), entry("bbbbbbbbbbb")] });
    expect(() => yt.download("https://www.youtube.com/playlist?list=PL1", null)).toThrow();
    const l = await yt.open("https://www.youtube.com/playlist?list=PL1");
    expect(l.items).toHaveLength(2);
    // An unknown id is simply not in the listing.
    expect(() => yt.combined("search:nothing")).toThrow();
    const search = await yt.search("one more time");
    expect(() => yt.combined(search.key)).toThrow(/playlist/);
  });

  it("treats a pasted link in the search box as a link", async () => {
    const { yt } = youtube(entry("dQw4w9WgXcQ"));
    const l = await yt.search("youtu.be/dQw4w9WgXcQ");
    expect(l).toMatchObject({ kind: "video", key: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  });

  it("asks yt-dlp for an MP3 of a watch address, after --", () => {
    const args = ytDlpArgs("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "/tmp/j", null, "0003");
    expect(args.slice(-2)).toEqual(["--", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
    expect(args).toEqual(expect.arrayContaining(["--no-playlist", "--audio-format", "mp3", "-o", path.join("/tmp/j", "0003.%(ext)s")]));
  });
});

describe("combined MP3s", () => {
  const tracks = Array.from({ length: 4 }, (_, i) => ({ input: `https://www.youtube.com/watch?v=v${String(i).padStart(10, "0")}`, title: `Track ${i}` }));
  function setup(failing: Set<number>) {
    const data = folder();
    const library = new Library(data);
    const downloads = new Downloads(library, path.join(data, "tmp"));
    const fetched: string[] = [];
    const joined: string[][] = [];
    const c: Combine = {
      id: "yt:PL1", name: "Long run", tracks, source: "YouTube", cacheRoot: path.join(data, "cache"), active: new Set(),
      fetchTrack: async (input, file) => {
        fetched.push(input);
        if (failing.has(tracks.findIndex((t) => t.input === input))) throw new Error("Video unavailable");
        writeFileSync(file, mp3(2));
      },
      join: async (files, output) => { joined.push(files); writeFileSync(output, Buffer.concat(files.map((f) => readFileSync(f)))); },
    };
    return { data, library, downloads, fetched, joined, c };
  }

  it("joins what downloaded, says what was left out, and a retry fetches only the missing tracks and replaces the MP3", async () => {
    const failing = new Set([1, 3]);
    const { library, downloads, fetched, joined, c } = setup(failing);
    downloads.add({ source: "YouTube", title: "Long run", artist: null, origin: "combined:yt:PL1" }, combinedWork(c), true);
    await downloads.idle();
    expect(joined[0]).toHaveLength(2);
    expect(downloads.list()[0]).toMatchObject({ state: "done", note: expect.stringContaining("2 of 4") });
    expect(existsSync(path.join(c.cacheRoot, cacheKey(c.id, tracks.map((t) => t.input))))).toBe(true);

    failing.clear();
    fetched.length = 0;
    downloads.add({ source: "YouTube", title: "Long run", artist: null, origin: "combined:yt:PL1" }, combinedWork(c), true);
    await downloads.idle();
    expect(fetched).toEqual([tracks[1].input, tracks[3].input]);
    expect(joined[1]).toHaveLength(4);
    const combined = library.list().filter((t) => t.origin === "combined:yt:PL1");
    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({ title: "Long run", source: "YouTube" });
    // A complete combine has nothing to come back for.
    expect(existsSync(path.join(c.cacheRoot, cacheKey(c.id, tracks.map((t) => t.input))))).toBe(false);
  });

  it("fails with the reason when nothing downloaded, and never adds a file", async () => {
    const { library, downloads, c } = setup(new Set([0, 1, 2, 3]));
    downloads.add({ source: "YouTube", title: "Long run", artist: null, origin: "combined:yt:PL1" }, combinedWork(c), true);
    await downloads.idle();
    expect(downloads.list()[0]).toMatchObject({ state: "failed", error: expect.stringContaining("Video unavailable") });
    expect(library.list()).toHaveLength(0);
  });

  it("starts a fresh cache when the playlist changes", () => {
    expect(cacheKey("yt:PL1", ["a", "b"])).toBe(cacheKey("yt:PL1", ["a", "b"]));
    expect(cacheKey("yt:PL1", ["a", "b"])).not.toBe(cacheKey("yt:PL1", ["a", "b", "c"]));
  });

  it("removes caches untouched for 7 days, never one in use", async () => {
    const root = folder();
    const now = Date.now();
    for (const [name, age] of [["old", CACHE_MAX_AGE + 60_000], ["busy", CACHE_MAX_AGE * 2], ["fresh", CACHE_MAX_AGE - 60_000]] as const) {
      mkdirSync(path.join(root, name));
      utimesSync(path.join(root, name), new Date(now - age), new Date(now - age));
    }
    expect(CACHE_MAX_AGE).toBe(7 * 24 * 60 * 60 * 1000);
    expect(await pruneCache(root, new Set(["busy"]), now)).toEqual(["old"]);
    expect(existsSync(path.join(root, "busy")) && existsSync(path.join(root, "fresh"))).toBe(true);
  });

  it("gives ffmpeg only local audio files to join, from a list on this computer", () => {
    const { args, listText } = concatArgs(["/tmp/c/0000.mp3", "/tmp/c/it's.mp3"], "/tmp/c/concat.txt", "/tmp/j/out.mp3");
    expect(args).toEqual(expect.arrayContaining(["-protocol_whitelist", "file", "-f", "concat", "-i", "/tmp/c/concat.txt"]));
    expect(listText).toBe("file '/tmp/c/0000.mp3'\nfile '/tmp/c/it'\\''s.mp3'\n");
    expect(() => concatArgs(["https://evil.example/a.mp3"], "/tmp/c/concat.txt", "/tmp/o.mp3")).toThrow();
    expect(() => concatArgs(["/tmp/c/list.m3u8"], "/tmp/c/concat.txt", "/tmp/o.mp3")).toThrow();
    expect(() => concatArgs(["/tmp/c/a.mp3\nfile '/etc/passwd'"], "/tmp/c/concat.txt", "/tmp/o.mp3")).toThrow();
    expect(() => concatArgs(["/tmp/c/a.mp3"], "relative.txt", "/tmp/o.mp3")).toThrow();
  });

  it("counts as one download in the queue, which still runs at most three at a time", async () => {
    const data = folder();
    const library = new Library(data);
    const downloads = new Downloads(library, path.join(data, "tmp"));
    let running = 0, most = 0;
    for (let i = 0; i < 5; i++) {
      downloads.add({ source: "YouTube", title: `P${i}`, artist: null, origin: `combined:yt:PL${i}` }, async () => {
        running++; most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 15));
        running--;
        return [];
      }, true);
    }
    expect(downloads.add({ source: "YouTube", title: "P0", artist: null, origin: "combined:yt:PL0" }, async () => [], true)).toBe(false);
    await downloads.idle();
    expect(most).toBe(3);
  });
});

describe("the bundled tools", () => {
  it("looks in CLINK_BIN_DIR, then the bundled folders, before this computer's own copies", () => {
    const dirs = toolDirs("/app", { CLINK_BIN_DIR: "/override", PATH: "/usr/bin" }, "/Resources");
    const plat = `${process.platform}-${process.arch}`;
    expect(dirs.slice(0, 4)).toEqual(["/override", path.join("/Resources", "bin", plat), path.join("/Resources", "bin"), path.join("/app", "bin", plat)]);
    expect(dirs.indexOf("/opt/homebrew/bin")).toBeGreaterThan(3);
    expect(dirs.at(-1)).toBe("/usr/bin");
  });

  it("pins every bundled file by SHA-256", () => {
    const lock = JSON.parse(readFileSync(path.join(__dirname, "../../../scripts/binaries.lock.json"), "utf8"));
    for (const group of [lock.ytDlp, lock.ffmpeg]) {
      expect(Object.keys(group.sha256).length).toBeGreaterThan(3);
      for (const hash of Object.values(group.sha256)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(lock.ytDlp.sha256.yt_dlp_macos ?? lock.ytDlp.sha256["yt-dlp_macos"]).toBeTruthy();
    expect(lock.ffmpeg.sha256["darwin-arm64"]).toBeTruthy();
  });
});

describe("YouTube Music paging", () => {
  const text = (t: string) => ({ runs: [{ text: t }] });
  const row = (id: string, title = `Song ${id}`) => ({
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: id },
      flexColumns: [title, "Halden Cove", "Signal Year"].map((t) => ({ musicResponsiveListItemFlexColumnRenderer: { text: text(t) } })),
    },
  });
  const more = (token: string) => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } });

  it("reads only the playlist's own rows, never the suggestions section that follows", () => {
    const page = {
      contents: { twoColumnBrowseResultsRenderer: { secondaryContents: { sectionListRenderer: {
        contents: [{ musicPlaylistShelfRenderer: { contents: [row("aaaaaaaaaaa"), more("ROWS")] } }],
        continuations: [{ nextContinuationData: { continuation: "SUGGESTIONS" } }],
      } } } },
    };
    expect(readSongs(page)).toMatchObject({ songs: [{ origin: "ytm:aaaaaaaaaaa" }], next: "ROWS", style: "body" });
    const appended = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [row("bbbbbbbbbbb"), more("NEXT2")] } }] };
    expect(readSongs(appended)).toMatchObject({ songs: [{ origin: "ytm:bbbbbbbbbbb" }], next: "NEXT2" });
    const older = { continuationContents: { musicPlaylistShelfContinuation: { contents: [row("ccccccccccc")], continuations: [{ nextContinuationData: { continuation: "OLD" } }] } } };
    expect(readSongs(older)).toMatchObject({ next: "OLD", style: "params" });
  });

  it("reads the owner whatever the tile puts before it", () => {
    const tile = (subtitle: string) => ({ musicTwoRowItemRenderer: { title: text("Runs"), subtitle: text(subtitle), navigationEndpoint: { browseEndpoint: { browseId: "VLPL9" } } } });
    expect(readPlaylists([tile("Playlist • Ana • 42 songs")])[0]).toMatchObject({ owner: "Ana", count: 42 });
    expect(readPlaylists([tile("Auto playlist")])[0]).toMatchObject({ owner: null });
  });

  it("follows every page, both kinds of continuation, and stops at 5000 songs", async () => {
    const urls: string[] = [];
    let n = 0;
    const page = (count: number, token: string | null, old = false) => {
      const rows = Array.from({ length: count }, () => row(`v${String(n++).padStart(10, "0")}`));
      if (old) return { continuationContents: { musicPlaylistShelfContinuation: { contents: rows, continuations: token ? [{ nextContinuationData: { continuation: token } }] : [] } } };
      return { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [...rows, ...(token ? [more(token)] : [])] } }] };
    };
    const web: WebHost = {
      ...noWeb,
      cookies: async () => [{ name: "SAPISID", value: "abc" }],
      fetch: async (_p, url, init) => {
        urls.push(url);
        const body = JSON.parse(String(init?.body));
        if (body.browseId) return Response.json({ contents: { musicPlaylistShelfRenderer: { contents: [...Array.from({ length: 100 }, () => row(`v${String(n++).padStart(10, "0")}`)), more("P1")] } } });
        // The two kinds take turns: a body continuation answers with an older one, and the other way round.
        return Response.json(url.includes("ctoken=") ? page(100, `B${urls.length}`) : page(100, `O${urls.length}`, true));
      },
    };
    const songs = await new YouTubeMusic(web).songs("LM");
    expect(songs).toHaveLength(MAX_SONGS);
    expect(urls[0]).toContain("/youtubei/v1/browse");
    expect(urls.some((u) => u.includes("ctoken="))).toBe(true);
    expect(new Set(songs.map((s) => s.origin)).size).toBe(MAX_SONGS);
  });
});

describe("the Download MP3 button on each video", () => {
  it("takes only a tagged click with a real video id, and nothing more than its id and title", async () => {
    const { readClick } = await import("./youtubeButtons");
    const tag = "__clink_secret:";
    expect(readClick(`${tag}{"id":"dQw4w9WgXcQ","title":"Run\\nfast","url":"https://evil.example"}`, tag)).toEqual({ id: "dQw4w9WgXcQ", title: "Run fast" });
    expect(readClick(`__clink_guess:{"id":"dQw4w9WgXcQ"}`, tag)).toBeNull();
    expect(readClick(`${tag}{"id":"../../etc"}`, tag)).toBeNull();
    expect(readClick(`${tag}not json`, tag)).toBeNull();
  });

  it("queues the video once, says it's already in the library, and keeps its buttons told", async () => {
    const { yt, downloads, library } = youtube({});
    expect(yt.fromButton("dQw4w9WgXcQ", "Song")).toBe("queued");
    yt.fromButton("dQw4w9WgXcQ", "Song");
    expect(downloads.list().filter((j) => j.origin === "yt:dQw4w9WgXcQ")).toHaveLength(1);
    downloads.cancel("all");
    await downloads.idle();
    const file = path.join(folder(), "a.mp3");
    writeFileSync(file, mp3(2));
    await library.add(file, "a.mp3", { origin: "yt:aaaaaaaaaaa", source: "YouTube" });
    expect(yt.fromButton("aaaaaaaaaaa", "Old")).toBe("done");
  });
});
