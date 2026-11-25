// yt-dlp and ffmpeg, run as child processes. yt-dlp saves a video's audio as an MP3 and lists searches and playlists;
// ffmpeg turns a podcast that isn't an MP3 into one and joins tracks into one MP3. Both are bundled, pinned by SHA-256
// (scripts/binaries.lock.json, put in bin/<platform>-<arch> by `npm run binaries:prepare`); a computer's own copy
// (Homebrew, the PATH) is used only when the bundled one is missing.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type Tool = "yt-dlp" | "ffmpeg";

/** The folders a tool is looked for in, first match wins: CLINK_BIN_DIR, the bundled ones, then this computer's. */
export function toolDirs(appPath = process.cwd(), env: NodeJS.ProcessEnv = process.env, resources = process.resourcesPath): string[] {
  const platform = `${process.platform}-${process.arch}`;
  return [
    env.CLINK_BIN_DIR,
    resources ? path.join(resources, "bin", platform) : null,
    resources ? path.join(resources, "bin") : null,
    path.join(appPath, "bin", platform),
    // Electron apps opened from the Dock don't get Homebrew's PATH, so it's searched too.
    "/opt/homebrew/bin", "/usr/local/bin",
    ...(env.PATH ?? "").split(path.delimiter),
  ].filter((d): d is string => !!d);
}

/** Where a tool is, or null. */
export function findTool(name: Tool, appPath = process.cwd()): string | null {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of toolDirs(appPath)) {
    const candidate = path.join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Runs a tool, handing over each output line. Rejects with its last error lines when it fails. */
export function run(command: string, args: string[], onLine: (line: string) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // ELECTRON_RUN_AS_NODE lets yt-dlp run this app's own Node to answer YouTube's JavaScript challenges.
    const child = spawn(command, args, { signal, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    const tail: string[] = [];
    const feed = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n|\r/)) {
        if (!line.trim()) continue;
        onLine(line);
        if (/error/i.test(line)) tail.push(line.replace(/^ERROR:\s*/, ""));
      }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(tail.slice(-2).join(" ") || `${path.basename(command)} stopped (${code}).`))));
  });
}

/** Runs yt-dlp for its JSON (one document on stdout), giving up after `ms`. */
export function runJson(command: string, args: string[], ms: number, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const both = AbortSignal.any([AbortSignal.timeout(ms), ...(signal ? [signal] : [])]);
    const child = spawn(command, args, { signal: both, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => { err = (err + b.toString("utf8")).slice(-4000); });
    child.on("error", (e) => reject(both.aborted && !signal?.aborted ? new Error("YouTube took too long to answer.") : e));
    child.on("close", (code) => {
      const text = Buffer.concat(out).toString("utf8").trim();
      if (code !== 0 && !text) {
        const last = err.split(/\r?\n/).filter((l) => /error/i.test(l)).at(-1)?.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "");
        return reject(new Error(last || `${path.basename(command)} stopped (${code}).`));
      }
      try { resolve(JSON.parse(text)); } catch { reject(new Error("yt-dlp's answer wasn't readable.")); }
    });
  });
}

/** Options every yt-dlp run gets: no config files or update checks, and this app's Node for YouTube's challenges. */
export function ytDlpBase(): string[] {
  return ["--no-config", "--no-update", ...(process.versions.electron ? ["--js-runtimes", `node:${process.execPath}`] : [])];
}

/** yt-dlp's percentage from a progress line, 0–1. */
export function progressOf(line: string): number | null {
  const m = /^\[download\]\s+([\d.]+)%/.exec(line);
  return m ? Math.min(1, Number(m[1]) / 100) : null;
}

/**
 * yt-dlp's arguments to save one video's audio as `<dir>/audio.mp3`: a URL as it is, anything else searched on
 * YouTube (the first result that isn't a live stream).
 */
export function ytDlpArgs(target: string, dir: string, ffmpeg: string | null, name = "audio"): string[] {
  const input = /^https:\/\/(music|www)\.youtube\.com\/watch\?v=[\w-]{6,}$/.test(target) ? target : `ytsearch1:${target}`;
  return [
    ...ytDlpBase(), "--no-playlist", "--newline", "--no-mtime",
    "-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "5",
    "--match-filter", "!is_live", "--max-filesize", "512M", "--embed-metadata",
    ...(ffmpeg ? ["--ffmpeg-location", path.dirname(ffmpeg)] : []),
    "-o", path.join(dir, `${name}.%(ext)s`),
    "--", input,
  ];
}

/** Audio formats ffmpeg is allowed to read: local files only, never a URL or a playlist. */
const AUDIO_IN = /\.(mp3|m4a|m4b|aac|mp4|wav|flac|ogg|oga|opus)$/i;

/** ffmpeg's arguments to turn a local audio file into a mono 64 kbps MP3 (plenty for speech, small on the watch). */
export function ffmpegArgs(input: string, output: string): string[] {
  if (!path.isAbsolute(input) || !AUDIO_IN.test(input)) throw new Error("Only audio files on this computer can be converted.");
  return ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file", "-y", "-i", input, "-vn", "-map_metadata", "-1", "-ac", "1", "-b:a", "64k", "-f", "mp3", output];
}

/** yt-dlp's arguments to list a search or a playlist without downloading: one JSON document, at most `limit` entries. */
export function listArgs(input: string, limit: number): string[] {
  if (!/^(ytsearch\d{1,2}:|https:\/\/www\.youtube\.com\/(watch\?v=[\w-]{6,}|playlist\?list=[\w-]{2,}))/.test(input)) throw new Error("Not a YouTube search or address.");
  return [...ytDlpBase(), "--flat-playlist", "-J", "--playlist-end", String(limit), "--", input];
}

/**
 * ffmpeg's arguments to join MP3s on this computer into one (re-encoded, so tracks of different bitrates join
 * cleanly), with the concat list it reads. Only local audio files go in the list.
 */
export function concatArgs(files: string[], list: string, output: string): { args: string[]; listText: string } {
  for (const f of files) {
    if (!path.isAbsolute(f) || !AUDIO_IN.test(f) || /[\r\n]/.test(f)) throw new Error("Only audio files on this computer can be joined.");
  }
  if (!path.isAbsolute(list) || !list.endsWith(".txt")) throw new Error("The concat list must be a file on this computer.");
  const listText = `${files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")}\n`;
  return {
    listText,
    args: ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vn", "-map_metadata", "-1", "-c:a", "libmp3lame", "-q:a", "4", "-f", "mp3", output],
  };
}
