import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function extractReleaseNotes(changelog, tag) {
  const version = tag.replace(/^v/, "");
  const sections = [...changelog.matchAll(/^## \[([^\]]+)\][^\r\n]*\r?$/gm)];
  const index = sections.findIndex((section) => section[1] === version);
  if (index < 0) throw new Error(`Missing CHANGELOG.md entry for ${tag}.`);
  const section = sections[index];
  const notes = changelog.slice(section.index + section[0].length, sections[index + 1]?.index).trim();
  if (!notes || !notes.split(/\r?\n/).some((line) => line.trim() && !line.startsWith("#"))) {
    throw new Error(`Empty CHANGELOG.md entry for ${tag}.`);
  }
  return `${notes}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , tag, output] = process.argv;
  if (!tag || !output) throw new Error("Usage: node scripts/extract-release-notes.mjs <tag> <output>");
  fs.writeFileSync(output, extractReleaseNotes(fs.readFileSync("CHANGELOG.md", "utf8"), tag));
}
