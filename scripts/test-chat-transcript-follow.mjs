import assert from "node:assert/strict";
import { shouldFollowTranscript } from "../src/chat/transcriptFollow.ts";

const at = { session: "a", length: 10 };
// A card updating in place (a confirmed delete) keeps a reader who scrolled up where they are.
assert.equal(shouldFollowTranscript(at, { session: "a", length: 10, lastIsUserMessage: false }, false), false);
// …and keeps following for a reader already at the bottom.
assert.equal(shouldFollowTranscript(at, { session: "a", length: 10, lastIsUserMessage: false }, true), true);
// The Coach's reply arriving doesn't pull a reader who scrolled up.
assert.equal(shouldFollowTranscript(at, { session: "a", length: 11, lastIsUserMessage: false }, false), false);
// Sending a message always goes to the bottom.
assert.equal(shouldFollowTranscript(at, { session: "a", length: 11, lastIsUserMessage: true }, false), true);
// So does opening another conversation.
assert.equal(shouldFollowTranscript(at, { session: "b", length: 3, lastIsUserMessage: false }, false), true);
console.log("Chat transcript follow passed: in-place updates keep the scroll position; sending and switching conversations go to the bottom.");
