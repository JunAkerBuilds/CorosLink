/**
 * Recent Bluetooth events, attached to BLE errors so a desktop error report
 * shows what led up to a failure: worker start and exit, each helper request
 * with its timing, link drops and the helper's own failure site.
 *
 * Only operation names, states, timings and error codes are kept. Payloads,
 * keys and device identifiers never enter the trail (the diagnostics log
 * redacts again before persisting).
 */
const TRACE_LIMIT = 40;
const VALUE_LIMIT = 160;

type HelperDetail = Record<string, unknown>;

/** Flatten a helper's `detail` object to `key=value` pairs of plain values. */
export function formatBleDetail(detail: unknown): string {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";
  return Object.entries(detail as HelperDetail).flatMap(([key, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key) || key === "frames" || key === "site") return [];
    if (typeof value === "string") return [`${key}=${value.slice(0, VALUE_LIMIT)}`];
    if (typeof value === "number" || typeof value === "boolean") return [`${key}=${value}`];
    if (Array.isArray(value)) return [`${key}=${value.filter(item => typeof item === "string").slice(0, 6).join(">").slice(0, VALUE_LIMIT)}`];
    return [];
  }).join(" ");
}

/** The helper's failure site as stack lines, newest first (Swift: one site; Python: traceback frames). */
function helperStackLines(detail: unknown): string[] {
  if (!detail || typeof detail !== "object") return [];
  const { site, frames } = detail as HelperDetail;
  const lines = Array.isArray(frames) ? frames.filter((frame): frame is string => typeof frame === "string").slice(-12).reverse() : [];
  if (typeof site === "string") lines.unshift(site);
  return lines.map(line => `    at [bluetooth helper] ${line.slice(0, VALUE_LIMIT)}`);
}

export class CorosBleTrace {
  private events: string[] = [];
  private last?: { event: string; count: number };

  constructor(private readonly now: () => number = Date.now) {}

  /** Repeats of the same event (file blocks, auth exchanges) collapse into one counted line. */
  add(event: string, detail?: HelperDetail): void {
    const extra = detail ? formatBleDetail(detail) : "";
    const repeat = this.last?.event === event;
    this.last = { event, count: repeat ? this.last!.count + 1 : 1 };
    // UTC time of day lines up with macOS bluetoothd and Windows event logs.
    const line = `${new Date(this.now()).toISOString().slice(11, 23)}Z ${event}${this.last.count > 1 ? ` ×${this.last.count}` : ""}${extra ? ` ${extra}` : ""}`;
    if (repeat) this.events[this.events.length - 1] = line;
    else this.events.push(line);
    if (this.events.length > TRACE_LIMIT) this.events.splice(0, this.events.length - TRACE_LIMIT);
  }

  snapshot(): string[] {
    return [...this.events];
  }
}

export interface CorosBleErrorContext {
  operation: string;
  elapsedMs?: number;
  backend?: string;
  helperDetail?: unknown;
  trace: string[];
}

/**
 * A Bluetooth failure whose stack names where it happened: the helper's site
 * first, then the main-process call that issued the request (captured before
 * the async hop to the worker, which a plain rejection would lose).
 */
export class CorosBleOperationError extends Error {
  readonly context: string[];

  constructor(message: string, info: CorosBleErrorContext, callSite?: Error) {
    super(message);
    this.name = "CorosBleOperationError";
    const callerLines = (callSite?.stack ?? "").split("\n").filter(line => /^\s*at /.test(line));
    this.stack = [`${this.name}: ${message}`, ...helperStackLines(info.helperDetail), ...callerLines].join("\n");
    const helper = formatBleDetail(info.helperDetail);
    const site = info.helperDetail && typeof (info.helperDetail as HelperDetail).site === "string"
      ? ` site=${String((info.helperDetail as HelperDetail).site).slice(0, VALUE_LIMIT)}` : "";
    this.context = [
      `operation=${info.operation}${info.elapsedMs !== undefined ? ` elapsedMs=${info.elapsedMs}` : ""}${info.backend ? ` backend=${info.backend}` : ""} host=${process.platform}-${process.arch}`,
      ...(helper || site ? [`helper:${site}${helper ? ` ${helper}` : ""}`] : []),
      "recent Bluetooth events:",
      ...info.trace
    ];
  }
}
