// End-to-end audiobook check under Electron: converts synthetic books with
// the bundled ffmpeg, then copies parts to a fake watch in order.
// Run: npm run test:audiobooks
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
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

function makeMp3(outputPath, seconds) {
  execFileSync(ffmpegPath(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`,
    "-c:a", "libmp3lame", "-b:a", "64k", outputPath
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

  // Choosing files only reads them: the draft reports the chapters the
  // conversion would use, and nothing is converted until it is confirmed.
  const booksBeforeDraft = service.listAudiobooks().length;
  const markedDraft = await service.prepareAudiobookDraft([chaptered]);
  assert.equal(service.listAudiobooks().length, booksBeforeDraft, "reading a file must not create a book");
  assert.equal(markedDraft.chapterSource, "marks");
  assert.deepEqual(markedDraft.chapters.map((chapter) => chapter.title), ["Opening Credits", "Chapter 1: The Start", "Chapter 2"]);
  assert.deepEqual(markedDraft.chapters.map((chapter) => Math.round(chapter.durationSeconds)), [90, 310, 200]);
  assert.equal(Math.round(markedDraft.durationSeconds), 600);
  assert.equal("sourcePaths" in markedDraft, false, "paths stay in the main process");

  const filesDraft = await service.prepareAudiobookDraft([
    path.join(folder, "Chapter 10.m4a"),
    path.join(folder, "Chapter 1.m4a"),
    path.join(folder, "Chapter 2.m4a")
  ]);
  assert.equal(filesDraft.chapterSource, "files");
  assert.equal(filesDraft.title, "Hobbit");
  assert.deepEqual(filesDraft.chapters.map((chapter) => chapter.title), ["Chapter 1", "Chapter 2", "Chapter 10"]);
  service.discardAudiobookDraft(filesDraft.id);
  assert.throws(() => service.startAudiobookImportFromDraft(filesDraft.id, TEN_MINUTES, () => {}, () => {}), /expired/);

  const plainDraft = await service.prepareAudiobookDraft([m4b]);
  assert.equal(plainDraft.chapterSource, "none");
  assert.equal(plainDraft.title, "Dune: Book One");
  assert.equal(plainDraft.author, "Frank Herbert");

  const fromDraft = await new Promise((resolve) => {
    service.startAudiobookImportFromDraft(markedDraft.id, { mode: "chapters", minutes: 10 }, () => {}, resolve);
  });
  assert.equal(fromDraft.status, "ready", fromDraft.error);
  assert.deepEqual(fromDraft.parts.map((part) => part.chapterTitle), ["Opening Credits", "Chapter 1: The Start", "Chapter 2"]);
  assert.throws(
    () => service.startAudiobookImportFromDraft(markedDraft.id, TEN_MINUTES, () => {}, () => {}),
    /expired/,
    "a draft converts once"
  );

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

  // A file named .m4b that is really an ffmpeg concat script must not be
  // followed: it could pull other local files into the book.
  const sectionOne = path.join(tempRoot, "section-1.mp3");
  const sectionTwo = path.join(tempRoot, "section-2.mp3");
  makeMp3(sectionOne, 200);
  makeMp3(sectionTwo, 150);
  const disguised = path.join(tempRoot, "disguised.m4b");
  // A relative path, which ffmpeg's concat demuxer accepts even in safe mode,
  // and a duration so the script passes the probe like a real book would.
  fs.writeFileSync(
    disguised,
    `ffconcat version 1.0\nfile '${path.basename(sectionOne)}'\nduration 200\n`
  );
  const disguisedBook = await importAndWait(service, [disguised]);
  assert.equal(disguisedBook.book.status, "failed");

  // Only a part's exact name counts as that part on the watch; a "(1)" copy
  // may be someone else's file and must never be removed with the book.
  const joinedFirst = joined.book.parts[0].name;
  fs.writeFileSync(
    path.join(watchRoot, "Music", joinedFirst.replace(/\.mp3$/, " (1).mp3")),
    fs.readFileSync(sectionOne)
  );
  const collisionStatus = await watch.getWatchStatus();
  const joinedListed = service.getAudiobook(joined.book.id, collisionStatus.tracks);
  assert.equal(joinedListed.parts[0].onWatch, false);
  assert.equal(service.audiobookPartsOnWatch(joinedListed, collisionStatus.tracks).length, 0);

  // LibriVox import, offline: fetch is stubbed with archive.org routes.
  const sha1 = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
  const routes = new Map();
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const route = routes.get(String(url));
    if (!route) return new Response(null, { status: 404, statusText: "Not Found" });
    if (route.redirect) return new Response(null, { status: 302, headers: { location: route.redirect } });
    const data = fs.readFileSync(route.file);
    return new Response(data, { status: 200, headers: { "content-length": String(data.length) } });
  };
  const freeDetail = (identifier, sections) => ({
    identifier,
    title: "The Test Stories",
    author: "A. Writer",
    pageUrl: `https://archive.org/details/${identifier}`,
    coverUrl: `https://archive.org/services/img/${identifier}`,
    runtimeSeconds: 350,
    totalBytes: sections.reduce((total, section) => total + section.sizeBytes, 0),
    sections
  });
  const section = (identifier, file, title, overrides = {}) => ({
    name: path.basename(file),
    title,
    url: `https://archive.org/download/${identifier}/${path.basename(file)}`,
    sizeBytes: fs.statSync(file).size,
    durationSeconds: 0,
    sha1: sha1(file),
    ...overrides
  });
  const importFree = (detail, split) =>
    new Promise((resolve) => {
      const progress = [];
      service.startFreeAudiobookImport(detail, split, (event) => progress.push(event), (done) =>
        resolve({ book: done, progress })
      );
    });
  try {
    const goodId = "test_stories_librivox";
    const goodSections = [
      section(goodId, sectionOne, "The First Story"),
      section(goodId, sectionTwo, "The Second Story")
    ];
    // The first section is served through an archive.org mirror redirect.
    routes.set(goodSections[0].url, { redirect: "https://ia800.us.archive.org/7/items/test/section-1.mp3" });
    routes.set("https://ia800.us.archive.org/7/items/test/section-1.mp3", { file: sectionOne });
    routes.set(goodSections[1].url, { file: sectionTwo });
    const free = await importFree(freeDetail(goodId, goodSections), { mode: "chapters", minutes: 10 });
    assert.equal(free.book.status, "ready", free.book.error);
    assert.equal(free.book.title, "The Test Stories");
    assert.equal(free.book.author, "A. Writer");
    assert.equal(free.book.source.identifier, goodId);
    assert.deepEqual(free.book.parts.map((part) => part.chapterTitle), ["The First Story", "The Second Story"]);
    assert.ok(free.progress.some((event) => event.phase === "downloading"));
    assert.deepEqual(free.book.sourcePaths, [`https://archive.org/details/${goodId}`]);
    assert.equal(fs.existsSync(path.join(path.dirname(service.getAudiobookPartPaths(free.book.id)[0]), ".download")), false);
    assert.equal(service.findAudiobookBySource(goodId).id, free.book.id);

    const tamperedId = "tampered_librivox";
    const tampered = section(tamperedId, sectionOne, "Tampered", { sha1: "0".repeat(40) });
    routes.set(tampered.url, { file: sectionOne });
    const tamperedBook = await importFree(freeDetail(tamperedId, [tampered]), TEN_MINUTES);
    assert.equal(tamperedBook.book.status, "failed");
    assert.match(tamperedBook.book.error, /checksum/);

    const offsiteId = "offsite_librivox";
    const offsite = section(offsiteId, sectionOne, "Offsite");
    routes.set(offsite.url, { redirect: "https://archive.org.example.com/section-1.mp3" });
    const offsiteBook = await importFree(freeDetail(offsiteId, [offsite]), TEN_MINUTES);
    assert.equal(offsiteBook.book.status, "failed");
    assert.match(offsiteBook.book.error, /left archive\.org/);
  } finally {
    global.fetch = realFetch;
  }

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
