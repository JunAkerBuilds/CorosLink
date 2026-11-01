import path from "node:path";
import { WIFI_MUSIC_MAX_FILES } from "./corosWifiMusicTypes";

/** Resolve library IDs in the main process. Renderer-supplied paths are never used. */
export function resolveWifiMusicLibraryFiles(input: unknown, lookup: (id: string) => { filePath: string } | undefined): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > WIFI_MUSIC_MAX_FILES ||
      input.some(id => typeof id !== "string" || !/^[\w-]{1,128}$/.test(id)) || new Set(input).size !== input.length) {
    throw new Error(`Select between 1 and ${WIFI_MUSIC_MAX_FILES} different library tracks to send over Wi-Fi.`);
  }
  const files = input.map(id => {
    const track = lookup(id);
    if (!track || !path.isAbsolute(track.filePath) || path.extname(track.filePath).toLowerCase() !== ".mp3") {
      throw new Error("A selected MP3 is no longer in the library. Refresh the library and try again.");
    }
    return track.filePath;
  });
  if (new Set(files).size !== files.length) throw new Error("Select different MP3 files for this Wi-Fi transfer.");
  return files;
}
