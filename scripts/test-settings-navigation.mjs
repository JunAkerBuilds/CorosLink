// Settings rail: every pane is listed once, links from other screens land on the right pane, and search
// finds panes by label, keyword, run-time words and translation.
import assert from "node:assert/strict";
import { ABOUT_PANE, SETTINGS_GROUPS, groupTitleForPane, paneForSection, paneMatches } from "../src/settings/settingsNav.ts";

const entries = [...SETTINGS_GROUPS.flatMap((group) => group.panes), ABOUT_PANE];
const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
const english = (text) => text;

assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length, "each pane is listed once");
for (const section of ["watch", "weather", "privacy", "sidebar"]) assert.equal(paneForSection(section), section);
assert.equal(paneForSection("media-tabs"), "sidebar");
assert.equal(groupTitleForPane("storage"), "Your data");
assert.equal(groupTitleForPane("about"), undefined);

assert.ok(paneMatches(byId.storage, "", english), "an empty search shows everything");
assert.ok(paneMatches(byId.storage, "  STORAGE ", english), "ignores case and spaces");
assert.ok(paneMatches(byId.privacy, "backup", english), "finds keywords");
assert.ok(paneMatches(byId.watch, "brightness", english, ["Brightness"]), "finds run-time words");
assert.ok(!paneMatches(byId.watch, "brightness", english), "only with those words");
assert.ok(paneMatches(byId.profile, "heart zones", english), "every word must match, in any place");
assert.ok(!paneMatches(byId.profile, "heart backup", english));

const french = (text) => (text === "Storage" ? "Stockage équipé" : text);
assert.ok(paneMatches(byId.storage, "stockage", french), "finds the translation");
assert.ok(paneMatches(byId.storage, "equipe", french), "ignores accents");
assert.ok(paneMatches(byId.storage, "storage", french), "still finds English");

console.log("Settings navigation: panes, section links and search passed.");
