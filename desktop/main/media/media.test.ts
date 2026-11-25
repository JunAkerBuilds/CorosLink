// Media: CorosLink's "Must not regress" rules (docs/replacement-checklist.md §6 and the drive rules of §4) as tests.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Library } from "./library";
import { bufferReader, isMp3, lowercaseMp3, readMp3 } from "./mp3";
import { findOnWatch, MediaService } from "./service";
import { frame, frames, id3, mp3 } from "./testMp3";
import { copyFile, corosOnUsb, findFolder, isWatchVolume, modelOf, WatchDrive, WatchProblem } from "./watchDrive";

const folder = () => mkdtempSync(path.join(tmpdir(), "clink-media-"));

const saved = process.env.CLINK_WATCH_PATH;
afterEach(() => { if (saved == null) delete process.env.CLINK_WATCH_PATH; else process.env.CLINK_WATCH_PATH = saved; });

/** A watch drive at a temporary folder, with a clock the test moves. */
function fakeWatch(music = true) {
  const root = folder();
  if (music) mkdirSync(path.join(root, "Music"));
  process.env.CLINK_WATCH_PATH = root;
  const clock = { now: 1_000_000 };
  return { root, music: path.join(root, "Music"), clock, drive: new WatchDrive({ now: () => clock.now }) };
}

describe("MP3s", () => {
  it("reads the title, artist, album and length", async () => {
    const b = mp3(30);
    expect(await readMp3(bufferReader(b), b.length)).toEqual({ title: "Glass Meridian", artist: "Northline", album: "Afterlight", secs: 30 });
  });

  it("takes a VBR file's length from its Xing header", async () => {
    const b = Buffer.concat([id3([frame("TIT2", "Long run")]), frames(4, 46_000)]);
    expect((await readMp3(bufferReader(b), b.length)).secs).toBe(Math.round((46_000 * 1152) / 44100));
  });

  it("lets only MP3s in", async () => {
    expect(await isMp3(bufferReader(mp3(1)))).toBe(true);
    expect(await isMp3(bufferReader(Buffer.from("fLaC\0\0\0\"rest of a flac file"))) ).toBe(false);
    expect(await isMp3(bufferReader(Buffer.concat([id3([frame("TIT2", "x")]), Buffer.from("not audio at all")])))).toBe(false);
  });

  it("always ends in a lowercase .mp3 (PACE 4 never plays .MP3, issue #167)", () => {
    expect(lowercaseMp3("Talk.MP3")).toBe("Talk.mp3");
    expect(lowercaseMp3("Talk.Mp3")).toBe("Talk.mp3");
    expect(lowercaseMp3("Talk.mp3")).toBe("Talk.mp3");
    expect(lowercaseMp3("notes.txt")).toBe("notes.txt");
  });
});

describe("finding the watch", () => {
  it("matches the whole volume name, so a backup drive is never written to", () => {
    for (const name of ["COROS", "COROS PACE PRO", "PACE 3", "COROS APEX 4 46MM", "APEX_2_PRO", "VERTIX 2S", "COROS VERTIX 4", "VERTIX4", "NOMAD"]) expect(isWatchVolume(name)).toBe(true);
    for (const name of ["COROS Backup", "APEX archives", "My PACE notes", "COROS Setup", "PACE Pro Installer", "Macintosh HD", "Untitled"]) expect(isWatchVolume(name)).toBe(false);
  });

  it("names the model from the volume", () => {
    expect(modelOf("COROS PACE PRO")).toBe("PACE Pro");
    expect(modelOf("COROS APEX 4 46MM")).toBe("APEX 4 46mm");
    expect(modelOf("COROS")).toBe("COROS watch");
  });

  it("looks for the map folder as Map and as map, never trusting the drive to ignore case", () => {
    const upper = folder(); mkdirSync(path.join(upper, "Map"));
    const lower = folder(); mkdirSync(path.join(lower, "map"));
    for (const root of [upper, lower]) {
      const found = findFolder(root, ["Map", "map"]);
      expect(found && existsSync(found)).toBeTruthy();
    }
    expect(findFolder(folder(), ["Map", "map"])).toBeUndefined();
  });

  it("names a plugged-in watch whose storage hasn't mounted, preferring the model to the vendor", () => {
    expect(corosOnUsb(["Apple Internal Keyboard", "COROS", "COROS PACE 3"])).toBe("COROS PACE 3");
    expect(corosOnUsb(["Logitech USB Receiver"])).toBeNull();
  });
});

describe("the watch drive", () => {
  it("reads what's on the watch, in the order the files were copied", async () => {
    const { music, drive } = fakeWatch();
    for (const name of ["b first.mp3", "a second.mp3", "._a second.mp3", "notes.txt"]) writeFileSync(path.join(music, name), mp3(5));
    const status = await drive.status();
    expect(status.connected).toBe(true);
    expect(status.tracks.map((t) => t.order)).toEqual([1, 2]);
    expect(status.tracks.map((t) => t.name).sort()).toEqual(["a second.mp3", "b first.mp3"]);
    expect(status.tracks[0].title).toBe("Glass Meridian");
  });

  it("keeps the status a minute, and every write makes the next read look again", async () => {
    const { music, drive, clock } = fakeWatch();
    const first = await drive.status();
    writeFileSync(path.join(music, "outside.mp3"), mp3(1));
    expect(await drive.status()).toBe(first);
    clock.now += 61_000;
    expect((await drive.status()).tracks).toHaveLength(1);
    const source = path.join(folder(), "song.mp3");
    writeFileSync(source, mp3(1));
    await drive.copyIn(source, "song.mp3");
    expect((await drive.status()).tracks).toHaveLength(2);
  });

  it("never caches a scan that started before a write", async () => {
    const { music, drive } = fakeWatch();
    const before = drive.status();
    drive.invalidate();
    await before;
    writeFileSync(path.join(music, "later.mp3"), mp3(1));
    expect((await drive.status()).tracks).toHaveLength(1);
  });

  it("copies with a lowercase .mp3 and never replaces a file already there", async () => {
    const { music, drive } = fakeWatch(false);
    const source = path.join(folder(), "Talk.MP3");
    writeFileSync(source, mp3(1));
    expect(await drive.copyIn(source, "Talk.MP3")).toBe("Talk.mp3");
    expect(await drive.copyIn(source, "Talk.MP3")).toBe("Talk (1).mp3");
    expect(readdirSync(music).sort()).toEqual(["Talk (1).mp3", "Talk.mp3"]);
    await expect(drive.copyIn(source, "Talk.flac")).rejects.toBeInstanceOf(WatchProblem);
  });

  it("clears the ._ files macOS writes beside MP3s, and nothing else", async () => {
    const { music, drive } = fakeWatch(false);
    mkdirSync(music, { recursive: true });
    writeFileSync(path.join(music, "._Old.mp3"), "attrs");
    writeFileSync(path.join(music, "._notes.txt"), "keep");
    writeFileSync(path.join(music, ".hidden.mp3"), "keep");
    const source = path.join(folder(), "Run.mp3");
    writeFileSync(source, mp3(1));
    await drive.copyIn(source, "Run.mp3");
    expect(readdirSync(music).sort()).toEqual(["._notes.txt", ".hidden.mp3", "Run.mp3"]);
  });

  it("deletes a partial copy when the copy fails", async () => {
    const target = path.join(folder(), "half.mp3");
    await expect(copyFile(path.join(folder(), "missing.mp3"), target)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });

  it("renames a capital .MP3 through a temporary name (FAT ignores case-only renames)", async () => {
    const { music, drive } = fakeWatch();
    writeFileSync(path.join(music, "Talk.MP3"), mp3(1));
    expect((await drive.status()).tracks[0].capital).toBe(true);
    expect(await drive.fixExtension("Talk.MP3")).toBe("Talk.mp3");
    expect(readdirSync(music)).toEqual(["Talk.mp3"]);
    expect((await drive.status()).tracks[0].capital).toBeUndefined();
  });

  it("removes only MP3s inside the Music folder", async () => {
    const { root, music, drive } = fakeWatch();
    writeFileSync(path.join(music, "a.mp3"), mp3(1));
    writeFileSync(path.join(root, "settings.dat"), "watch settings");
    await expect(drive.remove(["../settings.dat"])).rejects.toBeInstanceOf(WatchProblem);
    expect(existsSync(path.join(root, "settings.dat"))).toBe(true);
    expect(await drive.remove(["a.mp3"])).toBe(1);
    expect(readdirSync(music)).toEqual([]);
  });

  it("does one watch operation at a time, in the order asked for", async () => {
    const drive = new WatchDrive();
    const log: string[] = [];
    const slow = drive.exclusive(async () => { log.push("a start"); await new Promise((r) => setTimeout(r, 30)); log.push("a end"); });
    const failing = drive.exclusive(async () => { log.push("b"); throw new Error("b failed"); });
    const fast = drive.exclusive(async () => { log.push("c"); });
    await Promise.allSettled([slow, failing, fast]);
    expect(log).toEqual(["a start", "a end", "b", "c"]);
  });
});

describe("the library and sending", () => {
  it("adds MP3s only, with a lowercase .mp3, and never keeps the upload", async () => {
    const data = folder();
    const library = new Library(data);
    const upload = path.join(folder(), "upload");
    writeFileSync(upload, mp3(12));
    const track = await library.add(upload, "Run.MP3");
    expect(track).toMatchObject({ file: "Run.mp3", title: "Glass Meridian", artist: "Northline", secs: 12 });
    expect(existsSync(upload)).toBe(false);
    writeFileSync(upload, "fLaC not an mp3");
    await expect(library.add(upload, "Song.flac")).rejects.toBeInstanceOf(WatchProblem);
    expect(existsSync(upload)).toBe(false);
    expect(new Library(data).list()).toHaveLength(1);
  });

  it("sends tracks in the order asked for, one at a time, skipping ones already on the watch", async () => {
    const { music, drive } = fakeWatch();
    const media = new MediaService(folder(), drive);
    const added = [];
    for (const [i, name] of ["Warm up.mp3", "Intervals.mp3", "Cool down.mp3"].entries()) {
      const upload = path.join(folder(), "upload");
      writeFileSync(upload, mp3(5 + i, [frame("TIT2", name.slice(0, -4))]));
      added.push(await media.library.add(upload, name));
    }
    const order = [added[2].id, added[0].id, added[1].id];
    const copied: string[] = [];
    const copyIn = drive.copyIn.bind(drive);
    drive.copyIn = (source, name, progress) => { copied.push(name); return copyIn(source, name, progress); };
    await media.send(order);
    for (let i = 0; i < 100 && (await media.state()).job?.running; i++) await new Promise((r) => setTimeout(r, 10));
    const state = await media.state();
    expect(state.job).toMatchObject({ done: 3, total: 3, running: false });
    expect(copied).toEqual(["Cool down.mp3", "Warm up.mp3", "Intervals.mp3"]);
    expect(readdirSync(music)).toHaveLength(3);
    expect(state.library.every((t) => t.onWatch)).toBe(true);
    await expect(media.send(order)).rejects.toThrow("already on the watch");
  });

  it("matches a library track to the watch by the name it was sent as and its size", () => {
    const track = { id: "1", file: "Run.mp3", title: "Run", artist: null, album: null, secs: 1, bytes: 100, addedAt: 0 };
    const w = (name: string, bytes = 100) => ({ path: name, name, bytes, order: 1, title: null, artist: null, album: null, secs: null });
    expect(findOnWatch(track, [w("RUN.MP3")])).toBeTruthy();
    expect(findOnWatch(track, [w("Run.mp3", 99)])).toBeUndefined();
    expect(findOnWatch({ ...track, sentAs: "Run (1).mp3" }, [w("Run (1).mp3")])).toBeTruthy();
  });

  it("refuses writes that don't come from the app's own pages", async () => {
    const media = new MediaService(folder(), new WatchDrive({ volumes: async () => [] }));
    const answer = await media.answer(new Request("clink://app/api/desktop/media/library/delete", { method: "POST", body: "{}" }));
    expect(answer.status).toBe(403);
  });
});

describe("showing a track in Finder", () => {
  it("shows only a library track's own file, asked for by id", async () => {
    const shown: string[] = [];
    const media = new MediaService(folder(), new WatchDrive({ volumes: async () => [] }), () => {}, { reveal: (f) => shown.push(f) });
    const upload = path.join(folder(), "upload");
    writeFileSync(upload, mp3(2));
    const track = await media.library.add(upload, "Run.mp3");
    const ask = (id: string) => media.answer(new Request("clink://app/api/desktop/media/library/reveal", { method: "POST", headers: { "X-Clink-Hub": "1" }, body: JSON.stringify({ id }) }));
    expect((await ask(track.id)).status).toBe(200);
    expect(shown).toEqual([media.library.pathOf(track)]);
    expect((await ask("../../etc/passwd")).status).toBe(400);
    expect(shown).toHaveLength(1);
  });
});
