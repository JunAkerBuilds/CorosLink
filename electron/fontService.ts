import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedFamilies: string[] | null = null;
let cachedAt = 0;
let pendingFamilies: Promise<string[]> | null = null;

/**
 * Lists font family names exposed by the host operating system. The renderer
 * only receives names: it still lets Chromium render and rasterize the glyphs
 * into the PNG sprites that go into a watchface archive.
 */
export async function listLocalFontFamilies(): Promise<string[]> {
  if (cachedFamilies && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedFamilies;
  }
  if (pendingFamilies) {
    return pendingFamilies;
  }

  pendingFamilies = readLocalFontFamilies()
    .catch(() => [])
    .then((families) => {
      cachedFamilies = normalizeFontFamilies(families);
      cachedAt = Date.now();
      return cachedFamilies;
    })
    .finally(() => {
      pendingFamilies = null;
    });

  return pendingFamilies;
}

async function readLocalFontFamilies(): Promise<string[]> {
  switch (process.platform) {
    case "darwin":
      return listMacFontFamilies();
    case "win32":
      return listWindowsFontFamilies();
    default:
      return listLinuxFontFamilies();
  }
}

async function listMacFontFamilies(): Promise<string[]> {
  // NSFontManager reads macOS's indexed native font registry—the same family
  // list native Mac apps use. It completes in milliseconds, unlike the broad
  // `system_profiler` report used as a compatibility fallback below.
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        'ObjC.import("AppKit"); const fonts = $.NSFontManager.sharedFontManager.availableFontFamilies; const names = []; for (let index = 0; index < fonts.count; index += 1) { names.push(ObjC.unwrap(fonts.objectAtIndex(index))); } JSON.stringify(names);'
      ],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    const families = JSON.parse(stdout) as unknown;
    if (Array.isArray(families) && families.every((family) => typeof family === "string")) {
      return families;
    }
  } catch {
    // Some managed Macs disable JavaScript for Automation. The fallback is
    // slower, but still returns every enabled system font without a prompt.
  }

  const { stdout } = await execFileAsync(
    "/usr/sbin/system_profiler",
    ["SPFontsDataType", "-json"],
    { maxBuffer: 12 * 1024 * 1024 }
  );
  const report = JSON.parse(stdout) as {
    SPFontsDataType?: Array<{ typefaces?: Array<{ family?: string }> }>;
  };
  return (report.SPFontsDataType ?? []).flatMap((file) =>
    (file.typefaces ?? []).flatMap((typeface) => typeface.family ?? [])
  );
}

async function listWindowsFontFamilies(): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Add-Type -AssemblyName System.Drawing; [System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }"
    ],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  );
  return stdout.split(/\r?\n/);
}

async function listLinuxFontFamilies(): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "fc-list",
    [":", "family"],
    { maxBuffer: 4 * 1024 * 1024 }
  );
  return stdout
    .split(/\r?\n/)
    .flatMap((line) => line.split(","));
}

export function normalizeFontFamilies(families: string[]): string[] {
  const seen = new Map<string, string>();
  for (const family of families) {
    const trimmed = family.trim();
    // Names beginning with a period are private macOS fallback faces, not
    // useful choices for a portable watchface project.
    if (trimmed && !trimmed.startsWith(".")) {
      seen.set(trimmed.toLocaleLowerCase(), trimmed);
    }
  }
  return [...seen.values()].sort((left, right) => left.localeCompare(right));
}
