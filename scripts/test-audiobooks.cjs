// End-to-end audiobook check under Electron: converts synthetic books with
// the bundled ffmpeg, then copies parts to a fake watch in order.
// Run: npm run test:audiobooks
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-audiobooks-"));
app.setPath("userData", path.join(tempRoot, "userData"));

const watchRoot = path.join(tempRoot, "COROS PACE PRO");
fs.mkdirSync(path.join(watchRoot, "Music"), { recursive: true });
process.env.COROS_WATCH_PATH = watchRoot;

function ffmpegPath() {
  const bundled = path.join(repoRoot, "bin", `${process.platform}-${process.arch}`, "ffmpeg");
  return fs.existsSync(bundled) ? bundled : "ffmpeg";
}

function makeTone(outputPath, seconds, tags = {}) {
  execFileSync(ffmpegPath(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-ac", "2", "-c:a", "aac", "-b:a", "96k",
    ...Object.entries(tags).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]),
    outputPath
  ]);
}

function probe(filePath) {
  let output = "";
  try {
    execFileSync(ffmpegPath(), ["-hide_banner", "-i", filePath], { stdio: "pipe" });
  } catch (error) {
    output = error.stderr.toString();
  }
  return output;
}

const TEN_MINUTES = { mode: "minutes", minutes: 10 };

function importAndWait(service, sourcePaths, split = TEN_MINUTES) {
  return new Promise((resolve) => {
    const progress = [];
    service.startAudiobookImport(sourcePaths, split, (event) => progress.push(event), (book) =>
      resolve({ book, progress })
    );
  });
}

function makeChapteredBook(outputPath, chapters, totalSeconds) {
  const metaPath = `${outputPath}.ffmeta`;
  const body = chapters
    .map(
      ([start, end, title]) =>
        `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start * 1000}\nEND=${end * 1000}\ntitle=${title}\n`
    )
    .join("");
  fs.writeFileSync(metaPath, `;FFMETADATA1\nalbum=Chaptered\n${body}`);
  execFileSync(ffmpegPath(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${totalSeconds}`,
    "-i", metaPath, "-map_metadata", "1", "-map_chapters", "1",
    "-c:a", "aac", outputPath
  ]);
}

function durationOf(output) {
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function run() {
  const service = require(path.join(repoRoot, "dist-electron", "audiobookService.js"));
  const watch = require(path.join(repoRoot, "dist-electron", "watchService.js"));

  // Single tagged .m4b: 25 minutes -> 10 + 10 + 5.
  const m4b = path.join(tempRoot, "dune-source.m4b");
  makeTone(m4b, 1500, { title: "Dune: Book One", album: "Dune: Book One", artist: "Frank Herbert" });
  const { book, progress } = await importAndWait(service, [m4b]);
  assert.equal(book.status, "ready", book.error);
  assert.equal(book.title, "Dune: Book One");
  assert.equal(book.author, "Frank Herbert");
  assert.deepEqual(
    book.parts.map((part) => part.name),
    ["Dune Book One 001.mp3", "Dune Book One 002.mp3", "Dune Book One 003.mp3"]
  );
  assert.ok(progress.some((event) => event.message.startsWith("Converting")));

  const partPaths = service.getAudiobookPartPaths(book.id);
  const firstInfo = probe(partPaths[0]);
  assert.match(firstInfo, /Duration: 00:10:0[01]/);
  assert.match(firstInfo, /mp3.*44100 Hz, mono/);
  assert.match(firstInfo, /64 kb\/s/);
  assert.match(firstInfo, /track\s+: 1\/3/);
  assert.match(firstInfo, /artist\s+: Frank Herbert/);
  assert.match(probe(partPaths[2]), /Duration: 00:0[45]:[0-9]{2}/);

  // Transfer in order to the fake watch; each part must land after the last.
  for (const partPath of partPaths) {
    await watch.transferFileToWatch(partPath, () => {});
  }
  const status = await watch.getWatchStatus();
  assert.equal(status.connected, true);
  const listed = service.listAudiobooks(status.tracks);
  assert.ok(listed[0].parts.every((part) => part.onWatch));
  const births = book.parts.map((part) =>
    fs.statSync(path.join(watchRoot, "Music", part.name)).birthtimeMs
  );
  assert.deepEqual([...births].sort((a, b) => a - b), births);

  // Several files join into one book, in natural name order.
  const folder = path.join(tempRoot, "Hobbit");
  fs.mkdirSync(folder);
  makeTone(path.join(folder, "Chapter 10.m4a"), 200);
  makeTone(path.join(folder, "Chapter 2.m4a"), 200);
  makeTone(path.join(folder, "Chapter 1.m4a"), 400);
  const joined = await importAndWait(service, [
    path.join(folder, "Chapter 10.m4a"),
    path.join(folder, "Chapter 1.m4a"),
    path.join(folder, "Chapter 2.m4a")
  ]);
  assert.equal(joined.book.status, "ready", joined.book.error);
  assert.equal(joined.book.title, "Hobbit");
  assert.deepEqual(joined.book.sourcePaths.map((p) => path.basename(p)), [
    "Chapter 1.m4a",
    "Chapter 2.m4a",
    "Chapter 10.m4a"
  ]);
  assert.equal(joined.book.parts.length, 2);
  assert.ok(Math.abs(joined.book.durationSeconds - 800) < 2);

  // An exact multiple of the part length must not leave a sub-second tail part.
  const exact = path.join(tempRoot, "Exact.m4a");
  makeTone(exact, 1200);
  const exactBook = await importAndWait(service, [exact]);
  assert.equal(exactBook.book.status, "ready", exactBook.book.error);
  assert.equal(exactBook.book.parts.length, 2);
  assert.match(probe(service.getAudiobookPartPaths(exactBook.book.id)[1]), /Duration: 00:10:0[01]/);

  // A custom part length.
  const fiveMinuteBook = await importAndWait(service, [m4b], { mode: "minutes", minutes: 5 });
  assert.equal(fiveMinuteBook.book.status, "ready", fiveMinuteBook.book.error);
  assert.equal(fiveMinuteBook.book.parts.length, 5);
  assert.deepEqual(fiveMinuteBook.book.split, { mode: "minutes", minutes: 5 });
  assert.ok(fiveMinuteBook.book.parts.every((part) => Math.abs(part.durationSeconds - 300) < 1));

  // Split by chapter marks: uneven parts carrying chapter titles.
  const chaptered = path.join(tempRoot, "chaptered.m4b");
  makeChapteredBook(
    chaptered,
    [[0, 90, "Opening Credits"], [90, 400, "Chapter 1: The Start"], [400, 600, "Chapter 2"]],
    600
  );
  const byChapter = await importAndWait(service, [chaptered], { mode: "chapters", minutes: 10 });
  assert.equal(byChapter.book.status, "ready", byChapter.book.error);
  assert.equal(byChapter.book.splitNote, undefined);
  assert.deepEqual(
    byChapter.book.parts.map((part) => part.chapterTitle),
    ["Opening Credits", "Chapter 1: The Start", "Chapter 2"]
  );
  assert.deepEqual(
    byChapter.book.parts.map((part) => Math.round(part.durationSeconds)),
    [90, 310, 200]
  );
  const chapterPaths = service.getAudiobookPartPaths(byChapter.book.id);
  assert.match(probe(chapterPaths[1]), /title\s+: 002 Chapter 1: The Start/);
  assert.ok(Math.abs(durationOf(probe(chapterPaths[1])) - 310) < 1);

  // Chapter mode on a book without chapters falls back to the minutes value.
  const noChapters = await importAndWait(service, [m4b], { mode: "chapters", minutes: 15 });
  assert.equal(noChapters.book.status, "ready", noChapters.book.error);
  assert.equal(noChapters.book.parts.length, 2);
  assert.match(noChapters.book.splitNote, /No chapters found.*15 min/);

  // Joined files without chapter marks count as one chapter each.
  const joinedChapters = await importAndWait(
    service,
    [path.join(folder, "Chapter 1.m4a"), path.join(folder, "Chapter 2.m4a"), path.join(folder, "Chapter 10.m4a")],
    { mode: "chapters", minutes: 10 }
  );
  assert.equal(joinedChapters.book.status, "ready", joinedChapters.book.error);
  assert.deepEqual(
    joinedChapters.book.parts.map((part) => part.chapterTitle),
    ["Chapter 1", "Chapter 2", "Chapter 10"]
  );
  assert.deepEqual(
    joinedChapters.book.parts.map((part) => Math.round(part.durationSeconds)),
    [400, 200, 200]
  );

  // Out-of-range or malformed options are clamped.
  assert.deepEqual(service.normalizeSplitOptions({ mode: "chapters", minutes: 0 }), { mode: "chapters", minutes: 1 });
  assert.deepEqual(service.normalizeSplitOptions({ mode: "bogus", minutes: 999 }), { mode: "minutes", minutes: 180 });
  assert.deepEqual(service.normalizeSplitOptions(undefined), { mode: "minutes", minutes: 10 });

  // Cancel mid-conversion.
  const long = path.join(tempRoot, "long.m4a");
  makeTone(long, 3600);
  const cancelled = new Promise((resolve) => {
    const started = service.startAudiobookImport([long], TEN_MINUTES, () => {}, resolve);
    setTimeout(() => service.cancelAudiobookConversion(started.id), 300);
  });
  const cancelledBook = await cancelled;
  assert.equal(cancelledBook.status, "failed");
  assert.equal(cancelledBook.error, "Conversion cancelled.");
  assert.equal(cancelledBook.parts.length, 0);

  // Unreadable input fails cleanly.
  const bogus = path.join(tempRoot, "bogus.m4b");
  fs.writeFileSync(bogus, "not audio");
  const failed = await importAndWait(service, [bogus]);
  assert.equal(failed.book.status, "failed");

  service.deleteAudiobook(book.id);
  assert.equal(service.getAudiobook(book.id), undefined);

  assert.equal(service.sanitizeFileStem('A: "Very"/Long?  Title '.repeat(4)).length <= 40, true);
  console.log("audiobook tests passed");
}

app.whenReady()
  .then(run)
  .then(
    () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      app.exit(0);
    },
    (error) => {
      console.error(error);
      console.error(`Temp files kept at ${tempRoot}`);
      app.exit(1);
    }
  );
