// Run with: electron scripts/test-local-mp3-import.cjs
// MP3s the user imports or copies into the download folder join the library,
// and a download that finishes on a file listed early keeps its source.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const distElectron = process.env.COROSLINK_DIST_ELECTRON ?? path.join(__dirname, "..", "dist-electron");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-local-mp3-"));
app.setPath("userData", path.join(root, "user"));

app.whenReady().then(async () => {
  try {
    const database = require(path.join(distElectron, "database.js"));
    const downloads = require(path.join(distElectron, "downloadService.js"));
    database.initializeDatabase(path.join(root, "data"));
    const folder = downloads.getDownloadDirectory();

    // Copied in by hand: listed on the next refresh; other files are not.
    fs.writeFileSync(path.join(folder, "Dropped Song.mp3"), "dropped");
    fs.writeFileSync(path.join(folder, "notes.txt"), "x");
    downloads.adoptDroppedDownloads();
    let tracks = database.listDownloads();
    assert.deepEqual(tracks.map((track) => [track.title, track.url]), [["Dropped Song", database.LOCAL_FILE_URL]]);
    downloads.adoptDroppedDownloads();
    assert.equal(database.listDownloads().length, 1, "a second refresh adds nothing");

    // Imported from elsewhere: copied in; the same file again is not duplicated.
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    const source = path.join(outside, "My Mix.MP3");
    fs.writeFileSync(source, "my mix");
    fs.writeFileSync(path.join(outside, "cover.jpg"), "x");
    const imported = await downloads.importAudioFiles([source, path.join(outside, "cover.jpg")]);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].filePath, path.join(folder, "My Mix.mp3"));
    assert.equal(fs.readFileSync(imported[0].filePath, "utf8"), "my mix");
    assert.equal((await downloads.importAudioFiles([source])).length, 1);
    assert.equal(database.listDownloads().length, 2, "re-import reuses the copy");

    // A different file with the same name gets its own copy.
    fs.writeFileSync(source, "another mix");
    const renamed = await downloads.importAudioFiles([source]);
    assert.equal(renamed[0].filePath, path.join(folder, "My Mix (1).mp3"));

    // A download that registers a file listed early takes it over.
    const early = path.join(folder, "Early.mp3");
    fs.writeFileSync(early, "part");
    downloads.adoptDroppedDownloads();
    fs.writeFileSync(early, "finished track");
    const [claimed] = database.addDownloads([early], "spotify:track:1");
    assert.equal(claimed.url, "spotify:track:1");
    assert.equal(claimed.sizeBytes, "finished track".length);

    console.log("Local MP3 import passed.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    app.quit();
  }
});
