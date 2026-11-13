// Pure checks for cutting speech into watch parts: pause parsing, cut
// snapping, and the number-first part names.
// Run: npm run test:audio-split-plan
import assert from "node:assert/strict";
import {
  createSilenceCollector,
  cutPointInPause,
  partFileName,
  planPauseCuts,
  podcastEpisodeIdentifier
} from "../electron/audioSplitPlan.ts";

// silencedetect output, including a pause still open at the end of the audio.
const collector = createSilenceCollector();
for (const line of [
  "[silencedetect @ 0x1] silence_start: 59.8",
  "[silencedetect @ 0x1] silence_end: 60.6 | silence_duration: 0.8",
  "size=N/A time=00:01:00.00 bitrate=N/A",
  "[silencedetect @ 0x1] silence_start: -0.02",
  "[silencedetect @ 0x1] silence_end: 0.4 | silence_duration: 0.42",
  "[silencedetect @ 0x1] silence_start: 1199.5"
]) {
  collector.push(line);
}
assert.deepEqual(collector.finish(1200), [
  { start: 59.8, end: 60.6 },
  { start: 0, end: 0.4 },
  { start: 1199.5, end: 1200 }
]);

// A short pause is cut in the middle; a long one just before speech resumes.
assert.equal(cutPointInPause({ start: 10, end: 10.4 }), 10.2);
assert.equal(cutPointInPause({ start: 10, end: 13 }), 12.65);

// No pauses: cuts stay on the clock, like the old fixed-length split.
assert.deepEqual(planPauseCuts(1500, 600, []), [600, 1200]);
assert.deepEqual(planPauseCuts(1200, 600, []), [600], "no sliver part at the very end");
assert.deepEqual(planPauseCuts(500, 600, []), [], "a short book is one part");
assert.deepEqual(planPauseCuts(0, 600, []), []);

// Each cut moves to the nearest pause within reach (30 s for 10-min parts),
// and the next target counts from where the cut actually landed.
const pauses = [
  { start: 580, end: 580.5 }, // 580.25: 19.75 s early
  { start: 612, end: 612.4 }, // 612.2: 12.2 s late, nearer
  { start: 1100, end: 1100.6 }, // too far from 1212.2 (reach 30 s)
  { start: 1230, end: 1231 } // 1230.65: 18.45 s late
];
assert.deepEqual(planPauseCuts(1900, 600, pauses), [612.2, 1230.65, 1830.65]);

// Short parts reach less far: a tenth of the part length.
assert.deepEqual(planPauseCuts(400, 180, [{ start: 200, end: 200.4 }]), [180, 360]);
assert.deepEqual(planPauseCuts(400, 180, [{ start: 190, end: 190.4 }]), [190.2, 370.2]);

// A pause before the previous cut can never be chosen again.
assert.deepEqual(planPauseCuts(1300, 600, [{ start: 590, end: 590.4 }]), [590.2, 1190.2]);

assert.equal(partFileName("Dune Book One", "007"), "007 Dune Book One.mp3");
assert.equal(podcastEpisodeIdentifier("123", "guid-1"), "podcast:123:guid-1");

console.log("audio split plan tests passed");
