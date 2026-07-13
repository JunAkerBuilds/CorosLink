import { app, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AppInfo, AppStorageLocation } from "./types";

interface StorageLocationSpec {
  id: string;
  label: string;
  description: string;
  kind: "directory" | "file";
  resolvePath: () => string;
}

// The renderer only ever passes a location id back, so folder access stays
// limited to this fixed allowlist.
const STORAGE_LOCATION_SPECS: StorageLocationSpec[] = [
  {
    id: "music-downloads",
    label: "Music downloads",
    description:
      "Audio downloaded from YouTube, YouTube Music, Spotify sync, and Apple Music.",
    kind: "directory",
    resolvePath: () => path.join(app.getPath("userData"), "downloads")
  },
  {
    id: "map-cache",
    label: "Map downloads",
    description:
      "COROS map packages cached locally before they are installed to the watch.",
    kind: "directory",
    resolvePath: () => path.join(app.getPath("userData"), "map-cache")
  },
  {
    id: "routes",
    label: "Saved routes",
    description: "Routes generated, drawn, or imported in the route builder.",
    kind: "directory",
    resolvePath: () => path.join(app.getPath("userData"), "routes")
  },
  {
    id: "watchface-projects",
    label: "Watchface projects",
    description:
      "Saved editable designs together with private copies of their starter templates.",
    kind: "directory",
    resolvePath: () => path.join(app.getPath("userData"), "watchface-projects")
  },
  {
    id: "watchface-archives",
    label: "Generated watchface archives",
    description:
      "Upload-ready .dat archives created by the watchface designer.",
    kind: "directory",
    resolvePath: () => path.join(app.getPath("userData"), "watchface-archives")
  },
  {
    id: "database",
    label: "Library database",
    description:
      "SQLite database holding the track library, download history, and coach sessions.",
    kind: "file",
    resolvePath: () => path.join(app.getPath("userData"), "coroslink.sqlite")
  },
  {
    id: "user-data",
    label: "App data folder",
    description:
      "Everything CorosLink stores on this computer, including settings and credentials.",
    kind: "directory",
    resolvePath: () => app.getPath("userData")
  }
];

async function directorySizeBytes(target: string): Promise<number> {
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const entryPath = path.join(target, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await directorySizeBytes(entryPath);
      } else if (entry.isFile()) {
        total += (await fs.promises.stat(entryPath)).size;
      }
    } catch {
      // Files can disappear mid-scan (active downloads); skip them.
    }
  }

  return total;
}

async function describeStorageLocation(
  spec: StorageLocationSpec
): Promise<AppStorageLocation> {
  const target = spec.resolvePath();
  let exists = false;
  let sizeBytes: number | null = null;

  try {
    const stats = await fs.promises.stat(target);
    exists = true;
    sizeBytes =
      spec.kind === "directory" ? await directorySizeBytes(target) : stats.size;
  } catch {
    // Missing locations are reported with exists=false.
  }

  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    path: target,
    kind: spec.kind,
    exists,
    sizeBytes
  };
}

export async function getAppInfo(): Promise<AppInfo> {
  const storageLocations = await Promise.all(
    STORAGE_LOCATION_SPECS.map(describeStorageLocation)
  );

  return {
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath("userData"),
    storageLocations
  };
}

export async function openAppStorageLocation(id: string): Promise<void> {
  const spec = STORAGE_LOCATION_SPECS.find((entry) => entry.id === id);
  if (!spec) {
    throw new Error(`Unknown storage location: ${id}`);
  }

  const target = spec.resolvePath();

  if (spec.kind === "file") {
    if (!fs.existsSync(target)) {
      throw new Error("That file has not been created yet.");
    }
    shell.showItemInFolder(target);
    return;
  }

  await fs.promises.mkdir(target, { recursive: true });
  const failure = await shell.openPath(target);
  if (failure) {
    throw new Error(failure);
  }
}
