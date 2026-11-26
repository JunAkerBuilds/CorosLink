// Finding and running the AI programs the athlete installed (claude, gemini, opencode). An app opened from the
// Finder gets a short PATH, so the usual install places are looked in as well. On Windows a program is a `.exe` or
// an npm `.cmd` shim; Node won't start a `.cmd` without a shell, and a shell would mangle Coach's long arguments, so a
// shim is read and the program it points to is started instead.
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { t } from "@/lib/i18n";

const home = os.homedir();
const windows = process.platform === "win32";

/** How long a quick question (`--version`, `auth status`) may take: a first start on Windows can be slow. */
export const DETECT_MS = windows ? 60_000 : 15_000;

/** Where launch problems go (Settings → Error logs); set by main.ts. */
let log: (line: string) => void = () => {};
export function setProgramLog(write: (line: string) => void): void { log = write; }
export function logProgram(line: string): void { log(line); }

/**
 * Windows' saved PATH (the user's and the computer's), read again now and then: one changed after C-LINK started,
 * like a newly added `~\.local\bin`, isn't in the PATH this app was given until it restarts.
 */
let savedPath: { at: number; dirs: string[] } = { at: 0, dirs: [] };

/** The folders in `reg query … /v Path` output, with `%VARIABLES%` filled in. */
export function registryPathDirs(output: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const value = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(output)?.[1] ?? "";
  const lookup = new Map(Object.entries(env).map(([k, v]) => [k.toUpperCase(), v]));
  return value.split(";").map((dir) => dir.trim().replace(/%([^%]+)%/g, (whole, name: string) => lookup.get(name.toUpperCase()) ?? whole)).filter((dir) => dir && !dir.includes("%"));
}

function regQuery(key: string): Promise<string> {
  return new Promise((resolve) => execFile("reg.exe", ["query", key, "/v", "Path"], { timeout: 5_000, windowsHide: true }, (error, stdout) => resolve(error ? "" : stdout)));
}

async function refreshSavedPath(): Promise<void> {
  if (!windows || Date.now() - savedPath.at < 60_000) return;
  const [user, machine] = await Promise.all([regQuery("HKCU\\Environment"), regQuery("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")]);
  savedPath = { at: Date.now(), dirs: [...registryPathDirs(machine), ...registryPathDirs(user)] };
}

function nvmBins(): string[] {
  const root = path.join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(root).sort().reverse().map((v) => path.join(root, v, "bin"));
  } catch {
    return [];
  }
}

function usualFolders(): string[] {
  if (windows) {
    const { APPDATA, LOCALAPPDATA, NVM_SYMLINK, ProgramFiles } = process.env;
    return [
      ...(APPDATA ? [path.join(APPDATA, "npm")] : []), path.join(home, ".local", "bin"), path.join(home, ".claude", "local"),
      ...(LOCALAPPDATA ? [path.join(LOCALAPPDATA, "Programs", "Claude"), path.join(LOCALAPPDATA, "Claude")] : []), path.join(home, ".bun", "bin"),
      path.join(home, ".opencode", "bin"), ...(LOCALAPPDATA ? [path.join(LOCALAPPDATA, "pnpm")] : []),
      ...(NVM_SYMLINK ? [NVM_SYMLINK] : []), ...(ProgramFiles ? [path.join(ProgramFiles, "nodejs")] : []),
    ];
  }
  return [path.join(home, ".local", "bin"), path.join(home, ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".opencode", "bin"), path.join(home, ".bun", "bin"), ...nvmBins(), "/usr/bin", "/bin"];
}

/** Folders searched for a program: the PATH this app was given, Windows' saved PATH, then the usual places. */
export function searchPath(): string[] {
  // `npm run` puts every node_modules/.bin up the folder tree first; a CLI found there is some project's copy.
  const fromEnv = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => dir && !dir.includes(`node_modules${path.sep}.bin`));
  return [...new Set([...fromEnv, ...savedPath.dirs, ...usualFolders()])];
}

const isFile = (file: string) => { try { return statSync(file).isFile(); } catch { return false; } };

/** The names a program can have: on Windows the installer's `.exe` first, then npm's `.cmd` shim. */
export const programNames = (name: string, platform: NodeJS.Platform = process.platform) =>
  platform === "win32" ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name];

/** Every install of a program, in search order. */
export function findInstalls(name: string): string[] {
  const found: string[] = [];
  for (const dir of searchPath()) {
    for (const file of programNames(name)) {
      const full = path.join(dir, file);
      if (isFile(full) && !found.some((f) => f.toLowerCase() === full.toLowerCase())) found.push(full);
    }
  }
  return found;
}

/** The first install of a program, or null; `chosen` is the athlete's own path, used while it exists. */
export function findProgram(name: string, chosen?: string | null): string | null {
  if (chosen && isFile(chosen)) return chosen;
  return findInstalls(name)[0] ?? null;
}

/** Orders `--version` answers like "2.1.332 (Claude Code)"; one without a version sorts first. */
export function compareVersions(left?: string, right?: string): number {
  const parts = (v?: string) => v?.match(/\d+(?:\.\d+)*/)?.[0].split(".").map(Number) ?? [];
  const a = parts(left), b = parts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** The install to use: the newest, then on Windows a `.exe` over a shim, then the first found. */
export function pickInstall(installs: { file: string; version?: string }[], platform: NodeJS.Platform = process.platform): string | null {
  const exe = (file: string) => (platform === "win32" && /\.exe$/i.test(file) ? 1 : 0);
  return [...installs].sort((l, r) => compareVersions(r.version, l.version) || exe(r.file) - exe(l.file))[0]?.file ?? null;
}

/** `--version` starts the program, so its answer is kept until the file changes. */
const versions = new Map<string, Promise<string | undefined>>();
function programVersion(file: string, env?: NodeJS.ProcessEnv): Promise<string | undefined> {
  let key = file;
  try { const s = statSync(file); key = `${file}\0${s.size}\0${s.mtimeMs}`; } catch { /* gone: not cached */ }
  let version = versions.get(key);
  if (!version) {
    version = runProgram(file, ["--version"], { env, timeoutMs: DETECT_MS }).then((out) => out?.stdout.trim() || undefined);
    versions.set(key, version);
    void version.then((v) => { if (!v) versions.delete(key); });
  }
  return version;
}

/**
 * The program to run: the athlete's own path while it exists, else the newest install found (also looking in
 * Windows' saved PATH). Null when there is none.
 */
export async function locateProgram(name: string, chosen?: string | null, env?: NodeJS.ProcessEnv): Promise<string | null> {
  if (chosen && isFile(chosen)) return chosen;
  await refreshSavedPath();
  const installs = findInstalls(name);
  if (installs.length <= 1) return installs[0] ?? null;
  const found = await Promise.all(installs.map(async (file) => ({ file, version: await programVersion(file, env) })));
  return pickInstall(found);
}

/**
 * What an npm, pnpm or yarn `.cmd` shim runs: a program (`…\claude.exe`), or a script and the `node` to run it with.
 * Null when the shim isn't one of those.
 */
export function shimCommand(text: string, shim: string, find: { exists?: (file: string) => boolean; node?: () => string | null } = {}): { file: string; args: string[] } | null {
  const exists = find.exists ?? isFile;
  const dir = path.win32.dirname(shim);
  const line = text.split(/\r?\n/).reverse().find((l) => l.includes("%*"));
  if (!line) return null;
  const expand = (s: string) => path.win32.normalize(s.replace(/%~dp0%?|%dp0%/gi, `${dir}\\`));
  const quoted = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((s) => /%~?dp0/i.test(s)).map(expand);
  const target = quoted.reverse().find((s) => /\.(exe|js|cjs|mjs)$/i.test(s));
  if (!target) return null;
  if (/\.exe$/i.test(target)) return path.win32.basename(target).toLowerCase() === "node.exe" ? null : { file: target, args: [] };
  const beside = path.win32.join(dir, "node.exe");
  const node = exists(beside) ? beside : (find.node ?? (() => findProgram("node")))();
  return node ? { file: node, args: [target] } : null;
}

/** The file and arguments that actually start `program` with `args`. */
export function programCommand(program: string, args: string[]): { file: string; args: string[] } {
  if (!windows || !/\.(cmd|bat)$/i.test(program)) return { file: program, args };
  let text = "";
  try { text = readFileSync(program, "utf8"); } catch { /* reported below */ }
  const shim = shimCommand(text, program);
  if (!shim) throw new Error(t("{program} can't be started from C-LINK. Install it with its own installer, or choose its .exe under Program.", { program: path.basename(program) }));
  return { file: shim.file, args: [...shim.args, ...args] };
}

/** Starts a program, Windows shims included. Throws when it can't be started. */
export function startProgram(program: string, args: string[], options: SpawnOptions): ChildProcess {
  const command = programCommand(program, args);
  return spawn(command.file, command.args, { windowsHide: true, ...options });
}

/** The environment for a program: the search path above (node-based CLIs need `node` on it), plus `extra`. */
export function programEnv(extra: Record<string, string | undefined> = {}, drop: readonly string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Windows keeps it as `Path`; two spellings in one environment leave which one wins to chance.
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = searchPath().join(path.delimiter);
  for (const key of drop) delete env[key];
  // Electron's own switches would change how a node-based CLI starts.
  delete env.ELECTRON_RUN_AS_NODE;
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k]; else env[k] = v;
  return env;
}

/** Runs a program to the end: its output, or null when it couldn't start or took too long (both logged). */
export function runProgram(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number | null; stdout: string; stderr: string } | null> {
  const what = `${path.basename(file)} ${args[0] ?? ""}`.trim();
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = startProgram(file, args, { env: options.env ?? programEnv(), cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      log(`Couldn't start ${what}: ${error instanceof Error ? error.message : String(error)}`);
      resolve(null);
      return;
    }
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    const timeoutMs = options.timeoutMs ?? DETECT_MS;
    const timer = setTimeout(() => { log(`${what} gave no answer in ${Math.round(timeoutMs / 1000)} s.`); child.kill(); resolve(null); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); log(`Couldn't start ${what}: ${error.message}`); resolve(null); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
