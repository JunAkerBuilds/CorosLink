import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const SKILL_RELATIVE_PATH = path.join("skills", "watchface-studio", "SKILL.md");

let cached: string | null | undefined;

/**
 * Loads the Watch Face Studio designer skill (the same SKILL.md format Codex
 * uses) so the in-app agent follows one maintained design standard. Packaged
 * builds ship it via extraResources; dev reads it from the repo each turn.
 */
export function loadWatchfaceStudioSkill(): string | null {
  // Re-read in development so edits to SKILL.md apply on the next message.
  if (cached !== undefined && app.isPackaged) return cached;
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, SKILL_RELATIVE_PATH) : "",
    path.join(app.getAppPath(), SKILL_RELATIVE_PATH),
    path.join(process.cwd(), SKILL_RELATIVE_PATH)
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      // The frontmatter is for skill discovery; the model only needs the body.
      cached = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
      return cached;
    } catch {
      // Try the next location.
    }
  }
  console.warn("[watchface-ai] watchface-studio skill not found; using built-in instructions only.");
  cached = null;
  return cached;
}
