import assert from "node:assert/strict";
import {
  RaceLookupReplyError,
  cleanStartTime,
  cleanUrl,
  parseRaceLookupReply,
  raceDistanceKeyForCourse,
  raceLookupInstructions,
  raceLookupPrompt
} from "../electron/raceLookupModel.ts";
import { applyRaceLookup, preferredLookupEvent, undoRaceLookup } from "../src/training/raceDraft.ts";

const TODAY = "2026-11-04";
const race = (fields = {}) => ({ name: "Valencia Marathon", raceDay: "2026-12-06", events: [], ...fields });
const reply = (...races) => JSON.stringify({ races });
const first = (text) => parseRaceLookupReply(text, TODAY).candidates[0];

// --- Reading the reply ---------------------------------------------------------------

assert.equal(first(reply(race())).name, "Valencia Marathon");
assert.equal(first("```json\n" + reply(race()) + "\n```").name, "Valencia Marathon", "code fences are tolerated");
assert.equal(first(`Here you go:\n${reply(race())}\nDone.`).name, "Valencia Marathon", "surrounding prose is tolerated");
assert.equal(first(`Checking {the site} first.\n${reply(race())}`).name, "Valencia Marathon", "remarks before the answer are tolerated");
assert.throws(() => parseRaceLookupReply("I could not find it.", TODAY), RaceLookupReplyError);
assert.throws(() => parseRaceLookupReply("{not json}", TODAY), RaceLookupReplyError);
assert.throws(() => parseRaceLookupReply('{"answer": 1}', TODAY), RaceLookupReplyError);

const none = parseRaceLookupReply(JSON.stringify({ races: [], message: "No race by that name." }), TODAY);
assert.deepEqual(none.candidates, []);
assert.equal(none.message, "No race by that name.");

assert.equal(parseRaceLookupReply(reply(race(), race(), race(), race(), race()), TODAY).candidates.length, 3, "at most 3 candidates");
assert.equal(parseRaceLookupReply(reply({ raceDay: "2026-12-06" }, race()), TODAY).candidates.length, 1, "a race needs a name");

// --- Dates ------------------------------------------------------------------------------

assert.equal(first(reply(race({ raceDay: TODAY }))).raceDay, TODAY, "race day may be today");
assert.equal(first(reply(race({ raceDay: "2026-02-30" }))).raceDay, undefined, "not a real day");
assert.equal(first(reply(race({ raceDay: "Dec 6" }))).raceDay, undefined, "not an ISO day");

const pastEdition = first(reply(race({
  raceDay: "2025-12-07",
  location: "Valencia, Spain",
  registrationDeadline: "2025-11-01",
  bibPickupDay: "2025-12-05",
  bibPickupHours: "10:00-20:00",
  bibPickupLocation: "Expo",
  events: [{ label: "Marathon", distanceMeters: 42195, startTime: "08:30" }]
})));
assert.equal(pastEdition.raceDay, undefined, "a past edition's date is dropped");
assert.equal(pastEdition.registrationDeadline, undefined, "so is its deadline");
assert.equal(pastEdition.bibPickupDay, undefined, "and its pickup day");
assert.equal(pastEdition.bibPickupHours, undefined, "and its pickup hours");
assert.equal(pastEdition.bibPickupLocation, undefined, "and its pickup venue");
assert.equal(pastEdition.events[0].startTime, undefined, "and its start time");
assert.equal(pastEdition.events[0].distanceKey, "marathon", "the distance still holds");
assert.equal(pastEdition.location, "Valencia, Spain", "so does the place");

const dates = first(reply(race({ registrationDeadline: "2026-12-20", bibPickupDay: "2026-12-07" })));
assert.equal(dates.registrationDeadline, undefined, "a deadline after race day is wrong");
assert.equal(dates.bibPickupDay, undefined, "pickup after race day is wrong");
assert.equal(first(reply(race({ registrationDeadline: "2026-10-01" }))).registrationDeadline, "2026-10-01", "a closed deadline is still a fact");
assert.equal(first(reply(race({ bibPickupDay: "2026-11-01" }))).bibPickupDay, undefined, "a pickup day already gone is dropped");

// --- Times ------------------------------------------------------------------------------

assert.equal(cleanStartTime("7:30"), "07:30");
assert.equal(cleanStartTime("07:30:00"), "07:30");
assert.equal(cleanStartTime("7:30 AM"), "07:30");
assert.equal(cleanStartTime("12:15 am"), "00:15");
assert.equal(cleanStartTime("1:05 p.m."), "13:05");
assert.equal(cleanStartTime("12:00 PM"), "12:00");
assert.equal(cleanStartTime("24:00"), undefined);
assert.equal(cleanStartTime("13:00 PM"), undefined);
assert.equal(cleanStartTime("morning"), undefined);

// --- Links ------------------------------------------------------------------------------

assert.equal(cleanUrl("https://example.com/race"), "https://example.com/race");
assert.equal(cleanUrl("example.com/race"), "https://example.com/race", "a bare domain gets https");
assert.equal(cleanUrl("javascript:alert(1)"), undefined);
assert.equal(cleanUrl("file:///etc/passwd"), undefined);
assert.equal(cleanUrl("data:text/html,x"), undefined);
assert.equal(cleanUrl("https://user:pw@example.com"), undefined, "no credentials in a link");
assert.equal(cleanUrl("http://localhost:3000"), undefined, "a race site is on the public web");
assert.equal(cleanUrl("see the website"), undefined);
assert.equal(first(reply(race({ website: "javascript:alert(1)" }))).website, undefined);

const sourced = first(reply(race({
  website: "https://race.example/",
  sources: [{ title: "Official", url: "https://race.example/info" }, { url: "ftp://x.example/a" }, { url: "https://race.example/info" }]
})));
assert.deepEqual(sourced.sources, [{ url: "https://race.example/info", title: "Official" }], "bad and repeated sources go");
assert.deepEqual(first(reply(race({ website: "https://race.example/" }))).sources, [{ url: "https://race.example/" }], "the site stands in for missing sources");

// --- Distances ----------------------------------------------------------------------------

assert.equal(raceDistanceKeyForCourse(42195), "marathon");
assert.equal(raceDistanceKeyForCourse(42200), "marathon");
assert.equal(raceDistanceKeyForCourse(21097.5), "half");
assert.equal(raceDistanceKeyForCourse(21100), "half");
assert.equal(raceDistanceKeyForCourse(1609), "1mi");
assert.equal(raceDistanceKeyForCourse(16093), "10mi");
assert.equal(raceDistanceKeyForCourse(52000), "other", "a long 50K is its own course, unlike a watch reading");
assert.equal(raceDistanceKeyForCourse(18000), "other");

const events = first(reply(race({ events: [
  { label: "Marathon", distanceMeters: 42195, startTime: "8:30" },
  { label: "10K", distanceMeters: "10000", startTime: "nope" },
  { label: "Marathon again", distanceMeters: 42195 },
  { label: "Bad", distanceMeters: -1 },
  { label: "Huge", distanceMeters: 5_000_000 },
  { label: "", distanceMeters: 18000 },
  "junk"
] }))).events;
assert.deepEqual(events, [
  { label: "Marathon", distanceKey: "marathon", distance: 42195, startTime: "08:30" },
  { label: "10K", distanceKey: "10k", distance: 10000 },
  { label: "18 km", distanceKey: "other", distance: 18000 }
]);

// --- Text --------------------------------------------------------------------------------

const noisy = first(reply(race({ name: "  Valencia\n\tMarathon\u0007  ", location: "null", note: "N/A", courseNotes: "x".repeat(900) })));
assert.equal(noisy.name, "Valencia Marathon", "control characters and runs of space go");
assert.equal(noisy.location, undefined, "the word null is no value");
assert.equal(noisy.note, undefined);
assert.equal(noisy.courseNotes.length, 400, "text is capped");
assert.equal(first(reply(race({ name: 42 }), race())).name, "Valencia Marathon", "a non-text name is skipped");
const personal = first(reply(race({ goalTime: 100, bibNumber: "1", priority: "A", registration: "registered", wave: "1" })));
for (const key of ["goalTime", "bibNumber", "priority", "registration", "wave"]) {
  assert.equal(key in personal, false, `${key} is never taken from the AI`);
}

// --- Prompt ------------------------------------------------------------------------------

const instructions = raceLookupInstructions(TODAY, "German");
assert.match(instructions, /Today is 2026-11-04/);
assert.match(instructions, /in German/);
assert.match(instructions, /untrusted/);
assert.equal(raceLookupPrompt({ query: " Valencia " }), "Race: Valencia");
assert.equal(
  raceLookupPrompt({ query: "Valencia", raceDay: "2026-12-06", distanceLabel: "Half Marathon", location: "Spain" }),
  "Race: Valencia\nRace day: 2026-12-06\nDistance the athlete is running: Half Marathon\nLocation: Spain"
);

// --- Filling the form ---------------------------------------------------------------------

const blank = {
  kind: "upcoming", name: "valencia marathon", date: "", distanceKey: "", otherDistance: "", time: "", placing: "",
  priority: "", location: "", notes: "", registration: "", registrationDeadline: "", bibNumber: "", startTime: "",
  wave: "", bibPickupLocation: "", bibPickupDay: "", bibPickupHours: "", website: ""
};
const found = {
  name: "Valencia Marathon", raceDay: "2026-12-06", location: "Valencia, Spain", website: "https://race.example/",
  registrationDeadline: "2026-11-20", bibPickupDay: "2026-12-04", bibPickupHours: "10:00-20:00", bibPickupLocation: "Expo",
  courseNotes: "Flat and fast.", sources: [],
  events: [
    { label: "Marathon", distanceKey: "marathon", distance: 42195, startTime: "08:30" },
    { label: "10K", distanceKey: "10k", distance: 10000, startTime: "08:45" },
    { label: "18K", distanceKey: "other", distance: 18000 }
  ]
};
const km = (meters) => String(meters / 1000);
const none_ = new Set();

let fill = applyRaceLookup(blank, found, found.events[0], none_, km);
assert.equal(fill.draft.name, "Valencia Marathon");
assert.equal(fill.draft.date, "2026-12-06");
assert.equal(fill.draft.distanceKey, "marathon");
assert.equal(fill.draft.startTime, "08:30");
assert.equal(fill.draft.notes, "Flat and fast.");
assert.equal(fill.filled.size, 11);

// A second race without a fact must not keep the first race's value.
const sparse = { name: "Other Race", events: [{ label: "10K", distanceKey: "10k", distance: 10000 }] };
const again = applyRaceLookup(fill.draft, sparse, sparse.events[0], fill.filled, km);
assert.equal(again.draft.name, "Other Race");
assert.equal(again.draft.date, "", "the earlier race's date is gone");
assert.equal(again.draft.startTime, "", "the earlier event's start time is gone");
assert.equal(again.draft.notes, "", "the earlier race's notes are gone");
assert.equal(again.filled.has("date"), false);
assert.equal(again.previous.date, "2026-12-06");

const typed = { ...blank, time: "3:29:59", priority: "A", registration: "registered", bibNumber: "4127", wave: "2", startTime: "09:00", location: "Spain" };
fill = applyRaceLookup(typed, found, found.events[0], none_, km);
assert.equal(fill.draft.time, "3:29:59", "the goal stays the athlete's");
assert.equal(fill.draft.priority, "A");
assert.equal(fill.draft.registration, "registered");
assert.equal(fill.draft.bibNumber, "4127");
assert.equal(fill.draft.wave, "2");
assert.equal(fill.draft.startTime, "09:00", "a start time they typed stays");
assert.equal(fill.draft.location, "Spain", "a location they typed stays");
assert.equal(fill.filled.has("startTime"), false);

// Choosing another distance from the same event replaces the AI's earlier values.
const marathon = applyRaceLookup(blank, found, found.events[0], none_, km);
const tenK = applyRaceLookup(marathon.draft, found, found.events[1], marathon.filled, km);
assert.equal(tenK.draft.distanceKey, "10k");
assert.equal(tenK.draft.startTime, "08:45");
const other = applyRaceLookup(marathon.draft, found, found.events[2], marathon.filled, km);
assert.equal(other.draft.distanceKey, "other");
assert.equal(other.draft.otherDistance, "18");

// Which distance to start on.
assert.equal(preferredLookupEvent(found.events, { distanceKey: "" }, none_).label, "Marathon", "the AI's best match");
assert.equal(preferredLookupEvent(found.events, { distanceKey: "10k" }, none_).label, "10K", "the athlete's own choice wins");
assert.equal(preferredLookupEvent(found.events, { distanceKey: "5k" }, none_).label, "Marathon", "unless the event has no such race");
assert.equal(preferredLookupEvent(found.events, { distanceKey: "10k" }, new Set(["distanceKey"])).label, "Marathon", "an AI-chosen distance is no choice");
assert.equal(preferredLookupEvent([], { distanceKey: "" }, none_), undefined);

// Undo puts back what was there and keeps what the athlete changed since.
fill = applyRaceLookup(blank, found, found.events[0], none_, km);
const undone = undoRaceLookup(fill.draft, fill.filled, fill.previous);
assert.deepEqual(undone.draft, blank);
assert.equal(undone.filled.size, 0);
const edited = new Set(fill.filled);
edited.delete("location");
const partly = undoRaceLookup({ ...fill.draft, location: "Madrid" }, edited, fill.previous);
assert.equal(partly.draft.location, "Madrid", "an edit made after the fill stays");
assert.equal(partly.draft.date, "");

console.log("race lookup: all checks passed");
