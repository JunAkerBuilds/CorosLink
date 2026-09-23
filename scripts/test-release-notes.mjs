import assert from "node:assert/strict";
import { extractReleaseNotes } from "./extract-release-notes.mjs";

const changelog = `# Changelog

## [Unreleased]

- Future change.

## [0.1.38] - 2026-09-21

### Fixed

- Load the selected watch model.

## [0.1.37] - 2026-09-20

- Older change.
`;
assert.equal(extractReleaseNotes(changelog, "v0.1.38"), "### Fixed\n\n- Load the selected watch model.\n");
assert.equal(extractReleaseNotes(changelog, "0.1.37"), "- Older change.\n");
assert.equal(extractReleaseNotes(changelog.replaceAll("\n", "\r\n"), "v0.1.38"), "### Fixed\r\n\r\n- Load the selected watch model.\n");
assert.throws(() => extractReleaseNotes(changelog, "v0.1.39"), /Missing/);
assert.throws(() => extractReleaseNotes("## [0.1.39]\n\n### Fixed\n", "v0.1.39"), /Empty/);
assert.throws(() => extractReleaseNotes("## [0.1.39]\n", "v0.1.39"), /Empty/);
console.log("Release notes tests passed");
