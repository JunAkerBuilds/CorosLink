import fs from "node:fs";
import path from "node:path";
import type { DiagnosticsSnapshot } from "./diagnosticsTypes";

const MAX_ENTRIES = 200;
const MAX_BYTES = 512 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REDACTED = "[redacted]";
const requests = new WeakMap<object, { method: string; url: string }>();

interface DiagnosticError {
  name: string;
  message: string;
  code?: string;
  hostname?: string;
  syscall?: string;
  stack?: string;
  request?: { method: string; url: string };
  cause?: DiagnosticError;
  errors?: DiagnosticError[];
}

interface DiagnosticEntry {
  timestamp: string;
  appVersion: string;
  source: string;
  error: DiagnosticError;
}

export interface DiagnosticsEnvironment {
  appVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
}

/** Attach only request routing information; never include headers or bodies. */
export function annotateDiagnosticRequest(error: unknown, method: string, url: string): unknown {
  if (error && typeof error === "object") requests.set(error, { method, url });
  return error;
}

/** Redact before persistence as well as before export. No IPC arguments are logged. */
export function redactDiagnosticText(value: string, privatePaths: string[] = []): string {
  let text = value;
  for (const privatePath of privatePaths.filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(privatePath).join("[local path]");
    text = text.split(privatePath.replaceAll("\\", "\\\\")).join("[local path]");
    text = text.split(encodeURI(privatePath)).join("[local path]");
  }
  text = text
    .replace(/\b(password|passwd|pwd(?:Hash)?|p1|p2|secret|client[_-]?secret|app[_-]?password|(?:access|refresh|id|auth)[_-]?token|token|api[_-]?key|appKey|loginTicket|account|email|user[_-]?id)\b\\["']\s*[:=][^\r\n]*/gi, `$1=${REDACTED}`)
    // Full header values can contain several cookies or authentication fields.
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*["']?\s*[:=][^\r\n]*/gi, `credentials: ${REDACTED}`)
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, `credentials ${REDACTED}`)
    .replace(/\b(password|passwd|pwd(?:Hash)?|p1|p2|secret|client[_-]?secret|app[_-]?password|(?:access|refresh|id|auth)[_-]?token|token|api[_-]?key|appKey|loginTicket|account|email|user[_-]?id)\b["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;\]}]+)/gi, `$1=${REDACTED}`)
    // Remove credentials, query parameters, and fragments from every URL.
    .replace(/https?:\/\/[^\s<>"')]+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch { return "[URL redacted]"; }
    })
    .replace(/file:\/\/[^\r\n"')]+/gi, "[local file]")
    .replace(/(?:\b[A-Z]:[\\/]|\/(?:Users|home|Volumes|tmp|private|var)\/)[^\r\n"')]+/gi, "[local path]")
    .replace(/[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, REDACTED)
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, REDACTED)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, REDACTED)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return text;
}

export class DiagnosticsLog {
  private entries: DiagnosticEntry[] = [];
  private persistent = true;

  constructor(
    private readonly filePath: string,
    private readonly environment: DiagnosticsEnvironment,
    private readonly privatePaths: string[] = [],
    private readonly now: () => number = Date.now
  ) {
    try {
      if (fs.statSync(filePath).size > MAX_BYTES) throw new Error("Log too large");
      const saved: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (Array.isArray(saved)) {
        this.entries = saved.slice(-MAX_ENTRIES).flatMap((entry) => {
          if (!entry || typeof entry.timestamp !== "string" || !Number.isFinite(Date.parse(entry.timestamp))) return [];
          return [{
            timestamp: entry.timestamp,
            appVersion: this.clean(entry.appVersion, 80),
            source: this.clean(entry.source, 120),
            error: this.describeError(entry.error)
          }];
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.persistent = false;
    }
    const loadedCount = this.entries.length;
    this.prune();
    if (loadedCount !== this.entries.length) this.persist();
  }

  private clean(value: unknown, length = 1600): string {
    // Redact before truncation so cutting a URL/quoted secret cannot bypass it.
    return redactDiagnosticText(typeof value === "string" ? value : "", this.privatePaths).slice(0, length);
  }

  private describeError(value: unknown, depth = 0, seen = new Set<object>(), budget = { remaining: 20 }): DiagnosticError {
    if (budget.remaining-- <= 0) return { name: "Error", message: "Additional causes omitted" };
    if (!value || typeof value !== "object") {
      return { name: "Error", message: this.clean(typeof value === "string" ? value : "Unknown error") };
    }
    if (seen.has(value) || depth > 3) return { name: "Error", message: "Additional causes omitted" };
    seen.add(value);
    const error = value as Record<string, unknown>;
    const result: DiagnosticError = {
      name: this.clean(error.name, 80) || "Error",
      message: this.clean(error.message) || "Unknown error"
    };
    for (const key of ["code", "hostname", "syscall"] as const) {
      if (typeof error[key] === "string") result[key] = this.clean(error[key], 200);
    }
    if (typeof error.stack === "string") {
      result.stack = this.clean(error.stack.split("\n").filter((line) => /^\s*at /.test(line)).slice(0, 8).join("\n"), 1800);
    }
    // Saved records have already been reduced to this shape. Re-sanitize them.
    const request = requests.get(value) ?? error.request;
    if (request && typeof request === "object") {
      const fields = request as Record<string, unknown>;
      result.request = { method: this.clean(fields.method, 12), url: this.clean(fields.url, 300) };
    }
    if (error.cause !== undefined) result.cause = this.describeError(error.cause, depth + 1, seen, budget);
    if (Array.isArray(error.errors)) result.errors = error.errors.slice(0, 4).map((cause) => this.describeError(cause, depth + 1, seen, budget));
    return result;
  }

  private prune(): void {
    const cutoff = this.now() - MAX_AGE_MS;
    this.entries = this.entries.filter((entry) => Date.parse(entry.timestamp) >= cutoff).slice(-MAX_ENTRIES);
    while (Buffer.byteLength(JSON.stringify(this.entries)) > MAX_BYTES) this.entries.shift();
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(`${this.filePath}.tmp`, JSON.stringify(this.entries), { mode: 0o600 });
      fs.renameSync(`${this.filePath}.tmp`, this.filePath);
      this.persistent = true;
    } catch {
      // Logging must never replace the original error or break an operation.
      this.persistent = false;
    }
  }

  record(source: string, error: unknown): void {
    try {
      this.entries.push({
        timestamp: new Date(this.now()).toISOString(),
        appVersion: this.environment.appVersion,
        source: this.clean(source, 120),
        error: this.describeError(error)
      });
      this.prune();
      this.persist();
    } catch { /* Error objects from dependencies may contain throwing getters. */ }
  }

  clear(): DiagnosticsSnapshot {
    // Report a failed deletion instead of claiming persisted logs were cleared.
    for (const file of [`${this.filePath}.tmp`, this.filePath]) {
      try { fs.unlinkSync(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    this.entries = [];
    return this.snapshot();
  }

  snapshot(): DiagnosticsSnapshot {
    const count = this.entries.length;
    this.prune();
    if (this.entries.length !== count) this.persist();
    const report = [
      "CorosLink error report",
      `Generated: ${new Date(this.now()).toISOString()}`,
      `App: ${this.environment.appVersion}`,
      `System: ${this.environment.platform} ${this.environment.osVersion} (${this.environment.arch})`,
      `Electron: ${this.environment.electronVersion} | Chromium: ${this.environment.chromeVersion} | Node: ${this.environment.nodeVersion}`,
      "Retention: latest 200 errors, up to 7 days (512 KB maximum)",
      "Request bodies, headers, and input arguments are not collected.",
      "",
      this.entries.length ? JSON.stringify(this.entries, null, 2) : "No errors recorded."
    ].join("\n");
    return { report, entryCount: this.entries.length, persistent: this.persistent };
  }
}

/** Capture the original error (including cause) before Electron serializes it. */
export function withDiagnosticLogging<T extends unknown[], R>(
  log: Pick<DiagnosticsLog, "record">,
  source: string,
  listener: (...args: T) => R | Promise<R>
): (...args: T) => Promise<R> {
  return async (...args) => {
    try { return await listener(...args); }
    catch (error) {
      try { log.record(source, error); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  };
}
