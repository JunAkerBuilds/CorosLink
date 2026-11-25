// Finding and running the AI programs the athlete installed (claude, gemini, opencode). An app opened from the
// Finder gets a short PATH, so the usual install places are looked in as well.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();

function nvmBins(): string[] {
  const root = path.join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(root).sort().reverse().map((v) => path.join(root, v, "bin"));
  } catch {
    return [];
  }
}

/** Folders searched for a program, after the PATH this app was given. */
export function searchPath(): string[] {
  // `npm run` puts every node_modules/.bin up the folder tree first; a CLI found there is some project's copy.
  const fromEnv = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => dir && !dir.includes(`node_modules${path.sep}.bin`));
  const usual = [path.join(home, ".local", "bin"), path.join(home, ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".opencode", "bin"), path.join(home, ".bun", "bin"), ...nvmBins(), "/usr/bin", "/bin"];
  return [...new Set([...fromEnv, ...usual])];
}

/** The full path of an installed program, or null. */
export function findProgram(name: string): string | null {
  for (const dir of searchPath()) {
    const full = path.join(dir, process.platform === "win32" ? `${name}.cmd` : name);
    if (existsSync(full)) return full;
  }
  return null;
}

/** The environment for a program: the search path above (node-based CLIs need `node` on it), plus `extra`. */
export function programEnv(extra: Record<string, string | undefined> = {}, drop: readonly string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: searchPath().join(path.delimiter) };
  for (const key of drop) delete env[key];
  // Electron's own switches would change how a node-based CLI starts.
  delete env.ELECTRON_RUN_AS_NODE;
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k]; else env[k] = v;
  return env;
}

/** Runs a program to the end: its output, or null when it couldn't start or took too long. */
export function runProgram(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number | null; stdout: string; stderr: string } | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(file, args, { env: options.env ?? programEnv(), cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve(null);
      return;
    }
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); resolve(null); }, options.timeoutMs ?? 15_000);
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
