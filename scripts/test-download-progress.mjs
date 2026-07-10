import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPlaylistCompletionWarning,
  computeOverallProgress,
  extractAlreadyDownloadedPaths,
  extractYtDlpErrors,
  parseAlreadyDownloadedPath,
  parsePlaylistTrackMarker,
  parseYtDlpProgressLine,
  partitionDownloadedMp3Files
} from "../dist-electron/downloadProgress.js";

const samples = [
  {
    line: "before_dl:__TRACK__|3|12|My Song Title",
    expected: {
      trackIndex: 3,
      trackTotal: 12,
      currentTrackTitle: "My Song Title",
      phase: "downloading"
    }
  },
  {
    line: "[download] Downloading item 3 of 12",
    expected: {
      trackIndex: 3,
      trackTotal: 12,
      phase: "downloading"
    }
  },
  {
    line: "[download] 42.3% of 5.00MiB at 1.2MiB/s ETA 00:03",
    expected: {
      trackProgress: 42.3,
      phase: "downloading"
    }
  },
  {
    line: "[ExtractAudio] Destination: /tmp/song.mp3",
    expected: {
      phase: "converting"
    }
  },
  {
    line: "after_move:/Users/me/downloads/Song [abc123].mp3",
    expected: {
      phase: "between_tracks",
      completedTrackIncrement: 1
    }
  },
  {
    line: "ERROR: [youtube] abc: Video unavailable",
    expected: {
      activity: "[youtube] abc: Video unavailable"
    }
  }
];

for (const sample of samples) {
  const parsed = parseYtDlpProgressLine(sample.line);
  assert.ok(parsed, `expected parse result for ${sample.line}`);

  for (const [key, value] of Object.entries(sample.expected)) {
    assert.equal(parsed[key], value, `${sample.line} :: ${key}`);
  }
}

assert.equal(
  computeOverallProgress({
    entryType: "playlist",
    trackIndex: 3,
    trackTotal: 12,
    trackProgress: 50,
    previousProgress: 10
  }),
  20.833333333333336
);

assert.equal(
  computeOverallProgress({
    entryType: "video",
    trackProgress: 75,
    previousProgress: 50
  }),
  75
);

console.log("download progress parser tests passed");

const noisyOutput = [
  "after_move:/Users/me/song.mp3",
  "/Users/me/song.mp3",
  "ERROR: [youtube] F9kXstb9FF4: Video unavailable. This video is not available",
  "ERROR: [youtube] vEu1rLTZkk4: Video unavailable. This video is not available"
];

assert.deepEqual(extractYtDlpErrors(noisyOutput), [
  "[youtube] F9kXstb9FF4: Video unavailable. This video is not available",
  "[youtube] vEu1rLTZkk4: Video unavailable. This video is not available"
]);

console.log("yt-dlp error extraction tests passed");

const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-download-test-"));
const absoluteMp3 = path.join(downloadDir, "Song [abc123].mp3");
const relativeMp3Name = "Another Song [def456].mp3";
const relativeMp3 = path.join(downloadDir, relativeMp3Name);
fs.writeFileSync(absoluteMp3, "fake");
fs.writeFileSync(relativeMp3, "fake");

assert.equal(
  parseAlreadyDownloadedPath(
    `[download] ${absoluteMp3} has already been downloaded`,
    downloadDir
  ),
  absoluteMp3
);

assert.equal(
  parseAlreadyDownloadedPath(
    `[download] ${relativeMp3Name} has already been downloaded`,
    downloadDir
  ),
  relativeMp3
);

assert.equal(
  parseAlreadyDownloadedPath("[download] 42.3% of 5.00MiB", downloadDir),
  null
);

assert.deepEqual(
  extractAlreadyDownloadedPaths(
    [
      `[download] ${absoluteMp3} has already been downloaded`,
      `[download] ${relativeMp3Name} has already been downloaded`,
      `[download] ${absoluteMp3} has already been downloaded`
    ],
    downloadDir
  ),
  [absoluteMp3, relativeMp3]
);

const before = new Set([absoluteMp3, "/tmp/existing.mp3"]);
const printedPaths = [absoluteMp3, relativeMp3, "/tmp/new.mp3"];
const after = [absoluteMp3, relativeMp3, "/tmp/new.mp3", "/tmp/also-new.mp3"];

assert.deepEqual(partitionDownloadedMp3Files(before, printedPaths, after), {
  newFiles: [relativeMp3, "/tmp/new.mp3"],
  existingFiles: [absoluteMp3]
});

assert.deepEqual(partitionDownloadedMp3Files(before, [], after), {
  newFiles: [relativeMp3, "/tmp/new.mp3", "/tmp/also-new.mp3"],
  existingFiles: []
});

fs.rmSync(downloadDir, { recursive: true, force: true });

console.log("already-downloaded path tests passed");

assert.deepEqual(
  parsePlaylistTrackMarker("before_dl:__TRACK__|99|99|Breathe"),
  { trackTotal: 99 }
);
assert.equal(parsePlaylistTrackMarker("[download] 42.3%"), null);

assert.deepEqual(
  buildPlaylistCompletionWarning({
    allowPlaylist: true,
    deliveredCount: 97,
    capturedErrorLines: [
      "ERROR: [youtube] abc: Video unavailable. This video is not available",
      "ERROR: [youtube] def: Video unavailable. This video is not available"
    ]
  }),
  [
    "Downloaded 97 track(s). 2 video(s) were skipped: [youtube] abc: Video unavailable. This video is not available; [youtube] def: Video unavailable. This video is not available"
  ]
);

assert.deepEqual(
  buildPlaylistCompletionWarning({
    allowPlaylist: true,
    deliveredCount: 97,
    playlistTrackTotal: 99,
    exitCode: 1,
    capturedErrorLines: []
  }),
  [
    "Downloaded 97 of 99 track(s). 2 item(s) were unavailable or skipped."
  ]
);

assert.deepEqual(
  buildPlaylistCompletionWarning({
    allowPlaylist: true,
    deliveredCount: 97,
    exitCode: 1,
    capturedErrorLines: []
  }),
  [
    "Downloaded 97 track(s). Some playlist items may have been unavailable or skipped."
  ]
);

assert.equal(
  buildPlaylistCompletionWarning({
    allowPlaylist: true,
    deliveredCount: 99,
    playlistTrackTotal: 99,
    exitCode: 0,
    capturedErrorLines: []
  }),
  undefined
);

assert.equal(
  buildPlaylistCompletionWarning({
    allowPlaylist: false,
    deliveredCount: 1,
    exitCode: 1,
    capturedErrorLines: []
  }),
  undefined
);

console.log("playlist completion warning tests passed");
