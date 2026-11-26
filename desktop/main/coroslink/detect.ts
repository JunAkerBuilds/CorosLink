// Finding CorosLink's data on this computer, read-only, for "Bring over my CorosLink data" (move.ts).
//
// CorosLink keeps everything in its userData folder (CorosLink/docs/replacement-checklist.md §0): packaged
// `CorosLink`, in development `coroslink` (on a case-insensitive disk the same folder). The database is
// `coroslink.sqlite` (WAL), once `coros-desktop.sqlite` before CorosLink renamed it. When the switch ships under the
// same app id, C-LINK's own data folder *is* CorosLink's, so that folder is looked at too.
//
// Nothing here writes, renames or locks anything: only stat and read.
import { existsSync, readFileSync, realpathSync, statfsSync, statSync } from "node:fs";
import path from "node:path";

export const DB_NAMES = ["coroslink.sqlite", "coros-desktop.sqlite"] as const;

export interface FoundCorosLink {
  /** CorosLink's userData folder. */
  folder: string;
  /** Its database (one of DB_NAMES). */
  db: string;
  /** True when it is C-LINK's own data folder (the switch shipped under the same app id). */
  sameFolder: boolean;
  /** CorosLink's version, from the installed app when it's still there. */
  version: string | null;
  /** When CorosLink last wrote its database: the newest of the file and its WAL. */
  lastOpened: string | null;
}

export interface DetectOptions {
  /** Where apps keep their data (Electron's `appData`: ~/Library/Application Support on a Mac). */
  appData: string;
  /** C-LINK's own data folder. */
  ownData: string;
  /** Folders holding CorosLink.app (Mac) or the CorosLink install folder (Windows), to read its version. */
  appFolders?: string[];
  /** CLINK_COROSLINK_DIR: look only here (tests, smoke screenshots, a copy somewhere else). */
  only?: string | null;
}

/** The folders CorosLink may have used, most likely first. */
export function candidates(options: DetectOptions): string[] {
  if (options.only) return [options.only];
  return [path.join(options.appData, "CorosLink"), path.join(options.appData, "coroslink"), path.join(options.appData, "coros-desktop-app"), options.ownData];
}

/** The same file seen twice (`CorosLink` and `coroslink` on a case-insensitive disk) counts once. */
function identity(file: string): string {
  try {
    const s = statSync(file);
    return `${s.dev}:${s.ino}`;
  } catch {
    return file;
  }
}

function newest(files: string[]): string | null {
  let at = 0;
  for (const f of files) { try { at = Math.max(at, statSync(f).mtimeMs); } catch { /* not there */ } }
  return at ? new Date(at).toISOString() : null;
}

/**
 * CorosLink's version from an installed copy, if any. On a Mac, CorosLink.app's CFBundleShortVersionString. On
 * Windows (the NSIS install, `…\Programs\CorosLink` or `Program Files\CorosLink`), the app's own package.json, which
 * Electron's fs reads straight out of `resources\app.asar` (`resources\app` when unpacked).
 */
export function installedVersion(appFolders: string[]): string | null {
  for (const folder of appFolders) {
    try {
      const text = readFileSync(path.join(folder, "CorosLink.app", "Contents", "Info.plist"), "utf8");
      const found = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(text);
      if (found) return found[1].trim();
    } catch { /* no Mac app there */ }
    for (const app of ["app.asar", "app"]) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(folder, "CorosLink", "resources", app, "package.json"), "utf8")) as { version?: unknown };
        if (typeof pkg.version === "string" && pkg.version.trim()) return pkg.version.trim();
      } catch { /* no Windows install there */ }
    }
  }
  return null;
}

/** CorosLink's data, or null when there is none. Never throws. */
export function findCorosLink(options: DetectOptions): FoundCorosLink | null {
  const seen = new Set<string>();
  const own = (() => { try { return realpathSync(options.ownData); } catch { return path.resolve(options.ownData); } })();
  for (const folder of candidates(options)) {
    for (const name of DB_NAMES) {
      const db = path.join(folder, name);
      if (!existsSync(db)) continue;
      const id = identity(db);
      if (seen.has(id)) continue;
      seen.add(id);
      let size = 0;
      try { size = statSync(db).size; } catch { continue; }
      if (size === 0) continue;
      const real = (() => { try { return realpathSync(folder); } catch { return path.resolve(folder); } })();
      return {
        folder, db, sameFolder: real === own,
        version: installedVersion(options.appFolders ?? []),
        lastOpened: newest([db, `${db}-wal`]),
      };
    }
  }
  return null;
}

/** Free bytes on the disk holding `folder`, or null. */
export function freeBytes(folder: string): number | null {
  try {
    const s = statfsSync(folder);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}
