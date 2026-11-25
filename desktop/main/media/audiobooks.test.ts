// Audiobooks: CorosLink's "Must not regress" rules for them (replacement-checklist §6) as tests. The planning runs
// everywhere; the conversions run the real ffmpeg (bin/<platform>-<arch>, or this computer's) and are skipped without it.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Book } from "./audiobooks";
import { chaptersOf, cutInPause, normalizeSplit, parseProbe, partName, pauseCollector, pauseCuts, planSegments, samePart, sortFiles, titleFromFiles, type Probe } from "./bookPlan";
import { isArchiveUrl, LibriVox, parseClock } from "./librivox";
import { MediaService } from "./service";
import { findTool } from "./tools";
import { WatchDrive } from "./watchDrive";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-books-"));
const probe = (secs: number, chapters: Probe["chapters"] = [], tags: Record<string, string> = {}): Probe => ({ secs, chapters, tags });

describe("cutting a book into parts", () => {
  it("moves each cut into the nearest pause within a tenth of a part, so no part ends mid-word", () => {
    const pauses = [{ start: 590, end: 592 }, { start: 615, end: 616 }, { start: 1250, end: 1251 }];
    const cuts = pauseCuts(1900, 600, pauses);
    expect(cuts[0]).toBe(cutInPause(pauses[0]));
    // Measured from the moved cut, and no pause within 30 s of the next mark: the cut stays on it.
    expect(cuts[1]).toBeCloseTo(cuts[0] + 600, 3);
    expect(cuts).toHaveLength(3);
  });

  it("keeps the next part's first words: a long pause stays at the end of the earlier part", () => {
    expect(cutInPause({ start: 100, end: 110 })).toBeCloseTo(109.65, 3);
    expect(cutInPause({ start: 100, end: 100.4 })).toBeCloseTo(100.2, 3);
  });

  it("reads ffmpeg's pauses as they stream, closing one that runs to the end", () => {
    const c = pauseCollector();
    for (const line of ["[silencedetect @ 0x1] silence_start: 5.5", "[silencedetect @ 0x1] silence_end: 6.25 | silence_duration: 0.75", "silence_start: 99"]) c.push(line);
    expect(c.finish(100)).toEqual([{ start: 5.5, end: 6.25 }, { start: 99, end: 100 }]);
  });

  it("makes parts 3 to 180 minutes long: the watch adds about 3 s of silence between tracks", () => {
    expect(normalizeSplit({ minutes: 1 })).toEqual({ mode: "minutes", minutes: 3 });
    expect(normalizeSplit({ mode: "chapters", minutes: 999 })).toEqual({ mode: "chapters", minutes: 180 });
    expect(normalizeSplit(undefined)).toEqual({ mode: "minutes", minutes: 10 });
  });

  it("names parts number first, zero-padded, so they sort and read in play order on the watch", () => {
    expect(partName("Dune", 12, 40)).toBe("012 Dune.mp3");
    expect(partName("Dune", 7, 1200)).toBe("0007 Dune.mp3");
  });

  it("matches a watch file to a part only by its exact name, never a \"(1)\" copy", () => {
    expect(samePart("001 Dune.mp3", "001 dune.MP3")).toBe(true);
    expect(samePart("001 Dune.mp3", "001 Dune (1).mp3")).toBe(false);
  });

  it("splits at chapter marks, or one chapter per joined file, falling back to equal parts with a note", () => {
    const marks = [probe(3600, [{ start: 0, title: "Opening" }, { start: 1200, title: "Middle" }, { start: 3599.8, title: "Blip" }])];
    expect(chaptersOf(marks, ["/b.m4b"], 3600)).toEqual([{ title: "Opening", start: 0, secs: 1200 }, { title: "Middle", start: 1200, secs: 2400 }]);
    expect(chaptersOf([probe(60), probe(90)], ["/x/01 Intro.mp3", "/x/02 Storm.mp3"], 150).map((c) => c.title)).toEqual(["01 Intro", "02 Storm"]);
    const none = planSegments({ mode: "chapters", minutes: 10 }, [probe(3600)], ["/b.m4b"], 3600);
    expect(none).toMatchObject({ partSecs: 600, note: "No chapters found, so it was split every 10 min." });
    expect(planSegments({ mode: "chapters", minutes: 10 }, marks, ["/b.m4b"], 3600).args).toEqual(["-segment_times", "1200"]);
  });

  it("reads length, tags and chapters from ffmpeg's header, and says when a book is copy-protected", () => {
    const lines = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'book.m4b':", "  Metadata:", "    title           : Dune", "    artist          : Frank Herbert",
      "  Duration: 01:02:03.50, start: 0.000000, bitrate: 64 kb/s", "  Chapter #0:0: start 0.000000, end 600.000000", "    Metadata:", "      title           : One",
      "  Chapter #0:1: start 600.000000, end 3723.500000", "    Metadata:", "      title           : Two", "  Stream #0:0(und): Audio: aac",
    ];
    expect(parseProbe(lines)).toEqual({ secs: 3723.5, tags: { title: "Dune", artist: "Frank Herbert" }, chapters: [{ start: 0, title: "One" }, { start: 600, title: "Two" }] });
    expect(() => parseProbe(["[mov,mp4] DRM protected stream detected, decrypt failed"])).toThrow("copy-protected");
  });

  it("orders chosen files by their numbers and names a multi-file book after its folder", () => {
    expect(sortFiles(["/b/10 x.mp3", "/b/2 x.mp3", "/b/1 x.mp3"])).toEqual(["/b/1 x.mp3", "/b/2 x.mp3", "/b/10 x.mp3"]);
    expect(titleFromFiles(["/Books/Moby Dick/01.mp3", "/Books/Moby Dick/02.mp3"])).toBe("Moby Dick");
    expect(titleFromFiles(["/Books/Dracula.m4b"])).toBe("Dracula");
  });
});

describe("free classics", () => {
  const meta = (collection = "librivoxaudio") => ({
    metadata: { title: "Dracula, by Bram Stoker", creator: "Bram Stoker", collection: [collection, "audio_bookspoetry"], language: "eng", description: "<p>A &amp; B</p>" },
    files: [
      { name: "dracula_02.mp3", format: "64Kbps MP3", title: "02 - Chapter 2", track: "2", length: "10:00", size: "4", sha1: createHash("sha1").update("abcd").digest("hex") },
      { name: "dracula_01.mp3", format: "64Kbps MP3", title: "01 - Chapter 1", track: "1", length: "05:00", size: "4", sha1: createHash("sha1").update("wxyz").digest("hex") },
      { name: "dracula_01_128.mp3", format: "128Kbps MP3", title: "Chapter 1", track: "1" },
      { name: "../escape.mp3", format: "64Kbps MP3", title: "nope" },
    ],
  });

  it("lists a recording's smallest MP3s in track order, and only LibriVox's", async () => {
    const lv = new LibriVox(async () => Response.json(meta()));
    const book = await lv.load("dracula_librivox");
    expect(book).toMatchObject({ title: "Dracula", author: "Bram Stoker", language: "English", secs: 900, about: "A & B", bytes: 8 });
    expect(book.sections.map((s) => s.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(book.sections[0].url).toBe("https://archive.org/download/dracula_librivox/dracula_01.mp3");
    await expect(new LibriVox(async () => Response.json(meta("opensource_audio"))).load("not_librivox")).rejects.toThrow("isn't a LibriVox recording");
    await expect(lv.load("../etc")).rejects.toThrow("isn't a LibriVox recording");
  });

  it("keeps a download on archive.org over https, redirects included, and checks size and SHA-1", async () => {
    const target = path.join(folder(), "s.mp3");
    const sha1 = createHash("sha1").update("abcd").digest("hex");
    const hop = (to: string) => new LibriVox(async (url) => (url.includes("download") ? new Response(null, { status: 302, headers: { location: to } }) : new Response("abcd")));
    expect(await hop("https://ia800.us.archive.org/1/items/x/s.mp3").download({ url: "https://archive.org/download/x/s.mp3", bytes: 4, sha1 }, target, new AbortController().signal, () => {})).toBe(4);
    await expect(hop("https://evil.example/s.mp3").download({ url: "https://archive.org/download/x/s.mp3", bytes: 4, sha1 }, target, new AbortController().signal, () => {})).rejects.toThrow("left archive.org");
    const plain = new LibriVox(async () => new Response("abce"));
    await expect(plain.download({ url: "https://archive.org/download/x/s.mp3", bytes: 4, sha1 }, target, new AbortController().signal, () => {})).rejects.toThrow("checksum");
    await expect(plain.download({ url: "https://archive.org/download/x/s.mp3", bytes: 5, sha1: null }, target, new AbortController().signal, () => {})).rejects.toThrow("incompletely");
    expect(isArchiveUrl("http://archive.org/x")).toBe(false);
  });

  it("caches the popular shelf for six hours and searches every word in title or author", async () => {
    const asked: string[] = [];
    const lv = new LibriVox(async (url) => { asked.push(url); return Response.json({ response: { docs: [{ identifier: "pride_librivox", title: "Pride and Prejudice", creator: ["Jane Austen"], runtime: "11:35:20", downloads: 9 }] } }); });
    expect((await lv.popular(0))[0]).toMatchObject({ id: "pride_librivox", secs: 41720, cover: "https://archive.org/services/img/pride_librivox" });
    await lv.popular(5 * 60 * 60_000);
    expect(asked).toHaveLength(1);
    await lv.find("austen \"pride");
    expect(new URL(asked[1]).searchParams.get("q")).toContain('(title:"austen" OR creator:"austen") AND (title:"pride" OR creator:"pride")');
    expect(parseClock("65:06")).toBe(3906);
  });
});

/* ───────────── With ffmpeg ───────────── */

const appPath = path.resolve(__dirname, "../../..");
const ffmpeg = findTool("ffmpeg", appPath);
const saved = process.env.CLINK_WATCH_PATH;
afterEach(() => { if (saved == null) delete process.env.CLINK_WATCH_PATH; else process.env.CLINK_WATCH_PATH = saved; });

/** Speech-like audio: `on` seconds of tone, then `off` seconds of quiet, repeated. */
function speech(file: string, secs: number, extra: string[] = [], on = 6, off = 1) {
  execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='if(lt(mod(t\\,${on + off})\\,${on})\\,0.5*sin(440*2*PI*t)\\,0)':s=22050:d=${secs}`, ...extra, file]);
}

async function settle(media: MediaService, id: string): Promise<Book> {
  for (let i = 0; i < 600; i++) {
    const b = (await media.booksState()).books.find((x) => x.id === id)!;
    if (b.status !== "converting") return b;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("still converting");
}

async function sent(media: MediaService) {
  for (let i = 0; i < 400 && (await media.booksState()).job?.running; i++) await new Promise((r) => setTimeout(r, 10));
  return media.booksState();
}

describe.skipIf(!ffmpeg)("converting and sending a book", () => {
  it("converts a file into mono 64 kbps parts that end in pauses, then sends them in order, and \"I'm here\" takes listened parts off", async () => {
    const src = folder();
    const file = path.join(src, "Tone Book.m4a");
    speech(file, 400, ["-c:a", "aac", "-metadata", "title=Tone Book", "-metadata", "artist=Ana Reader"]);
    const root = folder();
    mkdirSync(path.join(root, "Music"));
    process.env.CLINK_WATCH_PATH = root;
    const media = new MediaService(folder(), new WatchDrive(), () => {}, { appPath });

    const draft = await media.books.draft([file]);
    expect(draft).toMatchObject({ title: "Tone Book", author: "Ana Reader", files: 1, chapterSource: "none" });
    expect(draft.secs).toBeCloseTo(400, 0);
    const book = await settle(media, media.books.convert(draft.id, { mode: "minutes", minutes: 3 }).id);
    expect(book.status).toBe("ready");
    expect(book.parts.map((p) => p.name)).toEqual(["001 Tone Book.mp3", "002 Tone Book.mp3", "003 Tone Book.mp3"]);
    // Each cut moved into a pause: the tone is quiet from 6 s to 7 s of every 7.
    let at = 0;
    for (const p of book.parts.slice(0, -1)) { at += p.secs; expect(at % 7).toBeGreaterThan(5.8); }
    const info = (() => { try { execFileSync(ffmpeg!, ["-hide_banner", "-i", path.join(media.books.root, book.id, book.parts[0].name)], { stdio: "pipe" }); return ""; } catch (e) { return String((e as { stderr: Buffer }).stderr); } })();
    expect(info).toMatch(/mp3.*mono.*64 kb\/s/);
    expect(info).toMatch(/title\s*: 001 Tone Book/);

    // Sent first to last.
    expect((await media.sendBook(book.id)).copying).toBe(3);
    const after = await sent(media);
    expect(after.watch.tracks.map((t) => t.name)).toEqual(book.parts.map((p) => p.name));
    expect(after.books[0].parts.every((p) => p.onWatch)).toBe(true);
    await expect(media.sendBook(book.id)).resolves.toEqual({ copying: 0, skipped: 3 });

    // "I'm here" on part 2: part 1 comes off the watch and is never sent again.
    const earlier = media.books.continueFrom(book.id, 2, after.watch.tracks);
    expect(earlier.map((t) => t.name)).toEqual(["001 Tone Book.mp3"]);
    await media.drive.remove(earlier.map((t) => t.path));
    expect(readdirSync(path.join(root, "Music")).sort()).toEqual(["002 Tone Book.mp3", "003 Tone Book.mp3"]);
    await expect(media.sendBook(book.id)).resolves.toEqual({ copying: 0, skipped: 2 });

    // A watch file with a "(1)" name is someone else's: removing the book leaves it.
    writeFileSync(path.join(root, "Music", "002 Tone Book (1).mp3"), readFileSync(path.join(root, "Music", "002 Tone Book.mp3")));
    media.drive.invalidate();
    const watch = await media.drive.status();
    expect(media.books.onWatch(book.id, watch.tracks).map((t) => t.name).sort()).toEqual(["002 Tone Book.mp3", "003 Tone Book.mp3"]);
  }, 60_000);

  it("joins several files into one book, one chapter per file, and names each part after its chapter", async () => {
    const src = folder();
    for (const [n, title] of [["01", "Arrival"], ["02", "Storm"]]) speech(path.join(src, `${n}.mp3`), 200, ["-c:a", "libmp3lame", "-metadata", `title=${title}`]);
    const media = new MediaService(folder(), new WatchDrive({ volumes: async () => [] }), () => {}, { appPath });
    const draft = await media.books.draft([path.join(src, "02.mp3"), path.join(src, "01.mp3")]);
    expect(draft).toMatchObject({ files: 2, chapterSource: "files", title: path.basename(src) });
    expect(draft.chapters.map((c) => c.title)).toEqual(["Arrival", "Storm"]);
    const book = await settle(media, media.books.convert(draft.id, { mode: "chapters", minutes: 10 }).id);
    expect(book.parts.map((p) => p.chapter)).toEqual(["Arrival", "Storm"]);
    expect(book.parts[0].secs).toBeCloseTo(200, 0);
  }, 60_000);

  it("splits a podcast episode from its feed into a book", async () => {
    const audio = path.join(folder(), "ep.mp3");
    speech(audio, 250, ["-c:a", "libmp3lame"]);
    const show = { results: [{ collectionId: 4242, collectionName: "Trail Talk", artistName: "Ana", feedUrl: "https://feeds.example/t.xml", artworkUrl600: "https://is1-ssl.mzstatic.com/a.jpg" }] };
    const feed = `<rss><channel><title>Trail Talk</title><item><title>Long one</title><guid>g1</guid><itunes:duration>4:10</itunes:duration>
      <enclosure url="https://cdn.example/ep.mp3" type="audio/mpeg" length="1"/></item></channel></rss>`;
    const get = async (url: string) => (url.includes("itunes.apple.com") ? Response.json(show) : url.endsWith(".xml") ? new Response(feed) : new Response(readFileSync(audio)));
    const media = new MediaService(folder(), new WatchDrive({ volumes: async () => [] }), () => {}, { appPath, fetch: get as typeof fetch });
    const ep = (await media.services.podcasts.show("4242")).page[0];
    const book = await settle(media, (await media.books.addEpisode("4242", ep.id, { minutes: 3 })).id);
    expect(book).toMatchObject({ status: "ready", title: "Long one", author: "Trail Talk", source: { kind: "podcast" } });
    expect(book.parts).toHaveLength(2);
    expect(media.services.bookOf("4242", ep.id)).toMatchObject({ id: book.id, status: "ready" });
    // Asking again gives the same book.
    expect((await media.books.addEpisode("4242", ep.id, { minutes: 3 })).id).toBe(book.id);
  }, 60_000);

  it("stops when cancelled and keeps nothing", async () => {
    const src = folder();
    const file = path.join(src, "Long.m4a");
    speech(file, 1200, ["-c:a", "aac"]);
    const media = new MediaService(folder(), new WatchDrive({ volumes: async () => [] }), () => {}, { appPath });
    const draft = await media.books.draft([file]);
    const started = media.books.convert(draft.id, { minutes: 5 });
    media.books.cancel(started.id);
    const book = await settle(media, started.id);
    expect(book).toMatchObject({ status: "failed", error: "Cancelled.", parts: [] });
    expect(readdirSync(path.join(media.books.root, book.id)).filter((n) => n.endsWith(".mp3"))).toEqual([]);
  }, 60_000);
});
