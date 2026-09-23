import type { CorosMcpTool } from "./types";
import type { HealthInsightData, HealthInsightKind, HealthInsightMetric, HealthInsightSeries } from "./healthInsightsTypes";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const normalized = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

interface Field {
  key: string;
  label: string;
  unit?: string;
  aliases: string[];
  text?: boolean;
  /** Summary-only value: never charted even when it arrives with a timestamp. */
  chart?: false;
  format?: (value: number) => string;
}
/** COROS stress score bands (1–4) as labelled in the COROS app. */
const stressLevels = ["Relaxed", "Low", "Medium", "High"];
const fields: Record<HealthInsightKind, Field[]> = {
  stress: [
    { key: "stress", label: "Stress", aliases: ["stress", "stressValue", "stressScore", "avgStress", "averageStress"] },
    { key: "level", label: "Stress level", aliases: ["score", "stressLevel", "level"], chart: false, format: value => stressLevels[value - 1] ?? String(value) },
    { key: "displayScore", label: "Display score", aliases: ["displayScore", "stressDisplayScore"] },
    { key: "hrv", label: "Stress HRV", unit: "ms", aliases: ["stressHrv", "hrv"] },
    { key: "heartRate", label: "Heart rate", unit: "bpm", aliases: ["stressHeartRate", "heartRate", "hr"] }
  ],
  healthCheck: [
    { key: "heartRate", label: "Heart rate", unit: "bpm", aliases: ["heartRate", "avgHeartRate", "hr"] },
    { key: "hrv", label: "HRV", unit: "ms", aliases: ["hrv", "avgHrv"] },
    { key: "stress", label: "Stress", aliases: ["stress", "stressValue", "stressScore"] },
    { key: "level", label: "Stress level", aliases: ["stressLevel"], chart: false, format: value => stressLevels[value - 1] ?? String(value) },
    { key: "restingHeartRate", label: "Resting heart rate", unit: "bpm", aliases: ["restingHeartRate"], chart: false },
    { key: "respiratoryRate", label: "Respiratory rate", unit: "breaths/min", aliases: ["respiratoryRate", "respirationRate", "breathingRate", "respRate"] },
    { key: "spo2", label: "Blood oxygen", unit: "%", aliases: ["spo2", "bloodOxygen", "oxygenSaturation"] }
  ],
  sleepHrv: [
    { key: "average", label: "Nightly average", unit: "ms", aliases: ["avgSleepHrv", "avgHrv", "averageHrv", "dailyAverage", "sleepHrvAverage", "hrvAvg"] },
    { key: "hrv", label: "Overnight HRV", unit: "ms", aliases: ["sleepHrv", "hrv", "hrvValue"] },
    { key: "normalRange", label: "Normal range", unit: "ms", aliases: ["normalRange", "hrvNormalRange"], text: true },
    { key: "baseline", label: "Baseline", unit: "ms", aliases: ["baseline", "hrvBaseline"], chart: false },
    { key: "evaluation", label: "COROS assessment", aliases: ["evaluation", "assessment", "hrvStatus"], text: true }
  ],
  cycle: [
    { key: "phase", label: "Phase", aliases: ["currentPhase", "todayPhase", "phaseName", "phase"], text: true },
    { key: "status", label: "Today’s status", aliases: ["todayStatus", "currentStatus", "menstruationStatus"], text: true },
    { key: "cycleDay", label: "Cycle day", aliases: ["cycleDay", "dayOfCycle"] },
    { key: "nextPeriod", label: "Next period", aliases: ["nextPeriodDate", "nextPeriodStartDate", "nextPeriodStart", "predictedPeriodStart", "nextPeriod"], text: true },
    { key: "startDate", label: "Cycle start", aliases: ["cycleStartDate", "periodStartDate", "lastPeriodStartDate", "startDate"], text: true },
    { key: "endDate", label: "Cycle end", aliases: ["cycleEndDate", "periodEndDate", "endDate"], text: true },
    { key: "cycleLength", label: "Cycle length", unit: "days", aliases: ["cycleLength", "cycleDays"] },
    { key: "periodLength", label: "Period length", unit: "days", aliases: ["periodLength", "periodDays"] },
    { key: "usualCycleLength", label: "Usual cycle", unit: "days", aliases: ["usualCycleLength"] },
    { key: "usualPeriodLength", label: "Usual period", unit: "days", aliases: ["usualPeriodLength"] }
  ]
};

export function normalizeHealthTime(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const raw = String(value).trim();
  if (/^\d{8}$/.test(raw)) return normalizeHealthTime(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
  if (/^\d{10}(?:\d{3})?$/.test(raw)) {
    const date = new Date(Number(raw) * (raw.length === 10 ? 1000 : 1));
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(raw)) return undefined;
  const datePart = raw.slice(0, 10);
  const parsed = new Date(datePart + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== datePart) return undefined;
  return Number.isFinite(Date.parse(raw)) ? raw : undefined;
}

const camel = (label: string) => label.trim().split(/[^A-Za-z0-9]+/).filter(Boolean).map((word, index) => index ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()).join("");
const placeholder = (value: string) => /^(?:unknown|none|n\/a|not found\b|not available\b|-+)$/i.test(value.trim());

/**
 * COROS health tools answer with an indented text report: section titles over `====` rules,
 * `YYYY-MM-DD:` headers, `key=value, key=value` records, and `Label: value` summaries.
 * Records become plain objects for the structured walker; leftover sentences stay as prose.
 */
export function parseHealthTextReport(text: string): { records: ObjectValue[]; prose: string[] } {
  const lines = text.split("\n");
  const records: ObjectValue[] = [];
  const prose: string[] = [];
  let date: string | undefined;
  let summary: ObjectValue | undefined;
  const flush = () => { if (summary && Object.keys(summary).some(key => key !== "date")) records.push(summary); summary = undefined; };
  const assign = (target: ObjectValue, label: string, raw: string) => {
    const key = camel(label);
    if (key === "general") {
      const period = /usual period (\d+) days/i.exec(raw);
      const cycle = /usual cycle (\d+) days/i.exec(raw);
      if (period) target.usualPeriodLength = Number(period[1]);
      if (cycle) target.usualCycleLength = Number(cycle[1]);
      if (period || cycle) return;
    }
    // "83 ms — Normal": a measurement followed by its assessment.
    const assessed = /^(.+?)\s+[—–-]\s+([A-Za-z][^,]*)$/.exec(raw);
    if (assessed && numeric(assessed[1]) !== undefined) {
      target[key] = assessed[1];
      if (!("evaluation" in target)) target.evaluation = assessed[2].trim();
      return;
    }
    if (!placeholder(raw)) target[key] = raw.trim();
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || /^[=\-_]{3,}$/.test(trimmed)) continue;
    if (/^[=\-_]{3,}$/.test(lines[index + 1]?.trim() ?? "")) continue; // section title
    const header = /^(\d{4}-\d{2}-\d{2}):?$/.exec(trimmed);
    if (header) { flush(); date = header[1]; summary = { date }; continue; }
    if (/^[A-Za-z_]\w*=[^,]*(?:,\s*[A-Za-z_]\w*=[^,]*)+$/.test(trimmed)) {
      const record: ObjectValue = date ? { date } : {};
      for (const pair of trimmed.split(/,\s*/)) {
        const [key, ...rest] = pair.split("=");
        const value = rest.join("=").trim();
        record[key.trim()] = /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
      }
      records.push(record);
      continue;
    }
    const labelled = /^([A-Za-z][A-Za-z0-9 /]{0,40}?):\s+(.+)$/.exec(trimmed);
    if (labelled) {
      const key = camel(labelled[1]);
      if (key === "note" || key === "notes") { prose.push(trimmed); continue; }
      if (key === "queryRange" || key === "today") continue;
      // Wellness checks report each metric as `Heart Rate List: [epoch=value, ...]`.
      const list = /^(.*) List$/i.exec(labelled[1]);
      const entries = /^\[(.*)\]$/.exec(labelled[2]);
      if (list && entries) {
        const samples = entries[1].trim() ? entries[1].split(/,\s*/).map(entry => /^(\d{10}(?:\d{3})?)\s*=\s*(.+)$/.exec(entry.trim())) : [];
        if (samples.every(sample => sample && normalizeHealthTime(sample[1]))) {
          for (const sample of samples) {
            if (sample) records.push({ timestamp: sample[1], [camel(list[1])]: sample[2] });
          }
          continue;
        }
      }
      // An unindented label closes the current date block.
      if (!/^\s/.test(line) && summary && "date" in summary) flush();
      summary ??= {};
      assign(summary, labelled[1], labelled[2]);
      continue;
    }
    flush();
    prose.push(trimmed);
  }
  flush();
  return { records, prose };
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string" || !/^\s*\d+(?:\.\d+)?\s*(?:ms|bpm|%|(?:breaths)?\/min|days)?\s*$/i.test(value)) return undefined;
  return Number.parseFloat(value);
}

/** Decode JSON, text content blocks, fenced JSON, and the client's combined text/structured output. */
export function parseHealthInsightResponse(kind: HealthInsightKind, response: string): HealthInsightData {
  const metrics = new Map<string, { metric: HealthInsightMetric; time?: string }>();
  const series = new Map<string, HealthInsightSeries>();
  const reports = new Set<string>();
  let recognizedField = false;
  let unknownValue = false;
  const defs = fields[kind];
  const readTime = (row: ObjectValue, fallback?: string) => {
    for (const key of ["timestamp", "datetime", "measurementtime", "recordtime", "time", "happenday", "date", "day"]) {
      const entry = Object.entries(row).find(([name]) => normalized(name) === key);
      if (entry) {
        const value = entry[1];
        const time = normalizeHealthTime(value);
        if (time) return time;
        if (fallback && typeof value === "string" && /^\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
          const combined = normalizeHealthTime(`${fallback.slice(0, 10)}T${value}`);
          if (combined) return combined;
        }
      }
    }
    return fallback;
  };
  function add(field: Field, raw: unknown, time?: string) {
    let value: string | number | undefined = field.text
      ? (typeof raw === "string" && raw.trim() ? raw.trim() : undefined)
      : numeric(raw);
    if (field.key === "normalRange" && Array.isArray(raw) && raw.length === 2 && raw.every(v => numeric(v) !== undefined)) {
      value = `${raw[0]}–${raw[1]}`;
    }
    if (field.key === "normalRange" && typeof value === "string") {
      const range = /^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:ms)?$/i.exec(value);
      if (range) value = `${range[1]}–${range[2]}`;
    }
    if (value === undefined) return;
    // The watch reports 0 ms / 0 bpm when a measurement was not taken.
    if (value === 0 && (field.unit === "ms" || field.unit === "bpm")) return;
    if (typeof value === "number" && field.format) value = field.format(value);
    const previous = metrics.get(field.key);
    if (!previous || (time && (!previous.time || Date.parse(time) >= Date.parse(previous.time))) || (!time && !previous.time)) {
      metrics.set(field.key, { metric: { key: field.key, label: field.label, value, unit: field.unit }, time });
    }
    if (kind !== "cycle" && !field.text && field.chart !== false && time && typeof value === "number") {
      const item = series.get(field.key) ?? { key: field.key, label: field.label, unit: field.unit, points: [] };
      item.points.push({ time, value });
      series.set(field.key, item);
    }
  }
  function walk(value: unknown, time?: string, context?: Field, depth = 0): void {
    if (depth > 24) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return;
      try { walk(JSON.parse(trimmed), time, context, depth + 1); return; } catch { /* prose or combined JSON */ }
      // Some servers return pretty-printed text followed by structuredContent.
      if (/^[\[{]/.test(trimmed)) {
        let level = 0, start = 0;
        let quoted = false, escaped = false;
        const chunks: unknown[] = [];
        for (let index = 0; index < trimmed.length; index++) {
          const char = trimmed[index];
          if (quoted) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') quoted = false;
          } else if (char === '"') quoted = true;
          else if (char === "{" || char === "[") { if (!level) start = index; level++; }
          else if (char === "}" || char === "]") {
            level--;
            if (level === 0) {
              try { chunks.push(JSON.parse(trimmed.slice(start, index + 1))); } catch { /* malformed block */ }
            }
          }
        }
        if (chunks.length) { for (const chunk of chunks) walk(chunk, time, context, depth + 1); return; }
        unknownValue = true;
        return;
      }
      const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
      if (fences.length) {
        for (const match of fences) walk(match[1], time, context, depth + 1);
        const prose = trimmed.replace(/```(?:json)?\s*[\s\S]*?```/gi, "").trim();
        if (prose) reports.add(prose);
        return;
      }
      const report = parseHealthTextReport(trimmed);
      if (report.records.length) {
        for (const record of report.records) walk(record, time, context, depth + 1);
        for (const note of report.prose) reports.add(note);
        return;
      }
      // Each content block is joined with a newline by mcpClientManager.
      const lines = trimmed.split("\n");
      if (lines.length > 1 && lines.some(line => /^[\[{]/.test(line.trim()))) {
        for (const line of lines) walk(line, time, context, depth + 1);
        return;
      }
      if (!/^[\[{]/.test(trimmed)) reports.add(trimmed);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, time, context, depth + 1);
      return;
    }
    if (!object(value)) return;
    const localTime = readTime(value, time);
    for (const field of defs) {
      const entry = Object.entries(value).find(([key]) => field.aliases.some(alias => normalized(alias) === normalized(key)));
      if (entry) { recognizedField = true; add(field, entry[1], localTime); }
    }
    if (context && "value" in value) { recognizedField = true; add(context, value.value, localTime); }
    for (const [key, child] of Object.entries(value)) {
      const field = defs.find(def => def.aliases.some(alias => normalized(alias) === normalized(key).replace(/(?:list|series|points|data)$/, "")));
      if (object(child) || Array.isArray(child)) walk(child, normalizeHealthTime(key) ?? localTime, field ?? context, depth + 1);
      else if (["text", "report", "summary", "message", "content", "result", "data", "structuredcontent"].includes(normalized(key)) && typeof child === "string") walk(child, localTime, undefined, depth + 1);
      else if (child !== null && child !== undefined && !["code", "status", "success", "count", "total", "type"].includes(key)) unknownValue = true;
    }
  }
  walk(response);
  if (!recognizedField && !reports.size && unknownValue) {
    throw new Error("COROS returned a health data format this version cannot display yet.");
  }
  return {
    metrics: [...metrics.values()].map(item => item.metric),
    series: [...series.values()].map(item => ({ ...item, points: [...new Map(item.points.map(point => [point.time, point])).values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)) })),
    report: [...reports].join("\n\n") || undefined
  };
}

/** Only send properties advertised by the connected server. No speculative retries. */
export function buildHealthInsightArgs(tool: CorosMcpTool, days: number, now = new Date()): Record<string, unknown> {
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error("Choose a health window between 1 and 7 days.");
  const properties = object(tool.inputSchema.properties) ? tool.inputSchema.properties : {};
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const args: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(properties)) {
    const schema = object(spec) ? spec : {};
    const name = normalized(key);
    let value: unknown;
    if (["days", "recentdays", "lastdays", "lastndays"].includes(name)) value = days;
    else if (["startdate", "startday", "begindate", "enddate", "endday"].includes(name)) {
      const day = /^(end)/.test(name) ? date(now) : date(start);
      const compact = name.endsWith("day") || /yyyyMMdd|YYYYMMDD|8.digit/.test(String(schema.description ?? "") + String(schema.pattern ?? ""));
      value = compact ? day.replaceAll("-", "") : day;
      if (schema.type === "integer" || schema.type === "number") value = Number(day.replaceAll("-", ""));
    } else if (["timezone", "tz"].includes(name)) value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    else if (["query", "question", "prompt"].includes(name)) value = `Return data from ${date(start)} through ${date(now)} in ${Intl.DateTimeFormat().resolvedOptions().timeZone}, including official summaries and timestamped measurements.`;
    else if (["period", "range", "mode"].includes(name) && Array.isArray(schema.enum) && schema.enum.includes("recent")) value = "recent";
    else if (required.includes(key) && "default" in schema) value = schema.default;
    if (value !== undefined) {
      if (schema.type === "string" && typeof value === "number") value = String(value);
      if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error(`COROS changed the ${key} options. Refresh the connection to try again.`);
      args[key] = value;
    }
  }
  const missing = required.filter(key => typeof key === "string" && !(key in args));
  if (missing.length) throw new Error(`This COROS tool requires unsupported parameters: ${missing.join(", ")}.`);
  return args;
}
