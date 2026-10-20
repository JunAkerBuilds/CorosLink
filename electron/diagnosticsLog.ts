import fs from "node:fs";
import path from "node:path";
import type { DiagnosticsSnapshot } from "./diagnosticsTypes";

const MAX_ENTRIES = 200;
const MAX_BYTES = 512 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REDACTED = "[redacted]";
/** The same failure again within this window is counted on the earlier entry instead of added. */
const REPEAT_WINDOW_MS = 10 * 60 * 1000;
const REPEAT_LOOKBACK = 10;
const requests = new WeakMap<object, { method: string; url: string }>();
const EXPECTED = Symbol.for("coroslink.diagnostics.expected");

interface DiagnosticError {
  name: string;
  message: string;
  code?: string;
  hostname?: string;
  syscall?: string;
  stack?: string;
  /** Extra lines an error carries about its circumstances (e.g. the Bluetooth trail). */
  context?: string[];
  request?: { method: string; url: string };
  cause?: DiagnosticError;
  errors?: DiagnosticError[];
}

interface DiagnosticEntry {
  /** When this failure was first recorded. */
  timestamp: string;
  appVersion: string;
  source: string;
  /** The latest occurrence; `count` says how many there were. */
  error: DiagnosticError;
  count?: number;
  lastSeen?: string;
  /** Set on a notice that is not an error (e.g. the watch's Bluetooth identity changed). */
  level?: DiagnosticLevel;
}

export type DiagnosticLevel = "info" | "warning";

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

/**
 * Marks an outcome the user chose or the app expects (a sign-in window closed,
 * a request cut short by quitting) so it still reaches the caller but is not
 * recorded as an error.
 */
export function expectedError<T extends Error>(error: T): T {
  Object.defineProperty(error, EXPECTED, { value: true });
  return error;
}

export function isExpectedError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as Record<symbol, unknown>)[EXPECTED] === true);
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
    .replace(/\b(password|passwd|pwd(?:Hash)?|p1|p2|secret|client[_-]?secret|app[_-]?password|(?:access|refresh|id|auth)[_-]?token|token|api[_-]?key|appKey|watch[_-]?key|passphrase|loginTicket|account|email|user[_-]?id|serial(?:[_-]?(?:no|number))?|latitude|longitude|lat|lon|lng)\b\\["']\s*[:=][^\r\n]*/gi, `$1=${REDACTED}`)
    // Full header values can contain several cookies or authentication fields.
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*["']?\s*[:=][^\r\n]*/gi, `credentials: ${REDACTED}`)
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, `credentials ${REDACTED}`)
    .replace(/\b(password|passwd|pwd(?:Hash)?|p1|p2|secret|client[_-]?secret|app[_-]?password|(?:access|refresh|id|auth)[_-]?token|token|api[_-]?key|appKey|watch[_-]?key|passphrase|loginTicket|account|email|user[_-]?id|serial(?:[_-]?(?:no|number))?|latitude|longitude|lat|lon|lng)\b["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;\]}]+)/gi, `$1=${REDACTED}`)
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
    // Bluetooth hardware addresses identify the watch (and its owner) as well as a serial does.
    .replace(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi, REDACTED)
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
          const count = Number.isSafeInteger(entry.count) && entry.count > 1 ? entry.count as number : undefined;
          const lastSeen = count && typeof entry.lastSeen === "string" && Number.isFinite(Date.parse(entry.lastSeen)) ? entry.lastSeen : undefined;
          return [{
            timestamp: entry.timestamp,
            appVersion: this.clean(entry.appVersion, 80),
            source: this.clean(entry.source, 120),
            error: this.describeError(entry.error),
            ...(entry.level === "info" || entry.level === "warning" ? { level: entry.level as DiagnosticLevel } : {}),
            ...(count ? { count } : {}),
            ...(lastSeen ? { lastSeen } : {})
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
      result.stack = this.clean(error.stack.split("\n").filter((line) => /^\s*at /.test(line)).slice(0, 20).join("\n"), 3600);
    }
    if (Array.isArray(error.context)) {
      result.context = error.context.slice(-50).flatMap((line) => typeof line === "string" ? [this.clean(line, 300)] : []);
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
    this.entries = this.entries.filter((entry) => Date.parse(entry.lastSeen ?? entry.timestamp) >= cutoff).slice(-MAX_ENTRIES);
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

  /** A notice that isn't an error, redacted like one: `name` is "Info" or "Warning". */
  note(source: string, message: string, level: DiagnosticLevel = "info"): void {
    this.record(source, { name: level === "warning" ? "Warning" : "Info", message }, level);
  }

  record(source: string, error: unknown, level?: DiagnosticLevel): void {
    if (isExpectedError(error)) return;
    try {
      const now = this.now();
      const entry: DiagnosticEntry = {
        timestamp: new Date(now).toISOString(),
        appVersion: this.environment.appVersion,
        source: this.clean(source, 120),
        error: this.describeError(error),
        ...(level ? { level } : {})
      };
      // A failure that keeps coming back (each reload of a screen) is one entry with a count,
      // so it can't push everything else out of the log.
      const repeat = this.entries.slice(-REPEAT_LOOKBACK).reverse().find((previous) =>
        previous.source === entry.source && previous.appVersion === entry.appVersion &&
        previous.error.name === entry.error.name && previous.error.message === entry.error.message &&
        previous.error.code === entry.error.code &&
        now - Date.parse(previous.lastSeen ?? previous.timestamp) <= REPEAT_WINDOW_MS);
      if (repeat) {
        repeat.count = (repeat.count ?? 1) + 1;
        repeat.lastSeen = entry.timestamp;
        repeat.error = entry.error;
        // Keep the log in time order: the entry moves to where it last happened.
        this.entries.splice(this.entries.indexOf(repeat), 1);
        this.entries.push(repeat);
      } else {
        this.entries.push(entry);
      }
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
      "Retention: latest 200 errors, up to 7 days (512 KB maximum); a repeat within 10 minutes adds to the earlier entry's count",
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
      try { if (!isExpectedError(error)) log.record(source, error); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  };
}
