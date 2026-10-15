import { callCorosMcpTool, ensureCorosMcpConnected, getCorosMcpTools, listCorosMcpTools } from "./corosMcpService";
import { buildHealthInsightArgs, parseHealthInsightResponse } from "./healthInsightsParser";
import type { HealthInsightKind, HealthInsightResult } from "./healthInsightsTypes";

const TOOLS: Record<HealthInsightKind, string> = {
  stress: "queryStressTimeSeries",
  healthCheck: "queryHealthCheckTimeSeries",
  sleepHrv: "querySleepHrv",
  cycle: "queryMenstruationCycles"
};

export async function getTrainingHealthInsight(kind: HealthInsightKind, days = 7): Promise<HealthInsightResult> {
  if (!Object.hasOwn(TOOLS, kind)) throw new Error("Unknown health insight.");
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error("Choose a health window between 1 and 7 days.");
  const base = { kind, days, metrics: [], series: [] };
  try {
    // Background refresh must never open an authorization window.
    if (!await ensureCorosMcpConnected()) return { ...base, status: "disconnected" };
    let tool = getCorosMcpTools().find(item => item.name === TOOLS[kind]);
    if (!tool) tool = (await listCorosMcpTools()).find(item => item.name === TOOLS[kind]);
    if (!tool) return { ...base, status: "unavailable" };
    const args = buildHealthInsightArgs(tool, days);
    const response = await callCorosMcpTool(tool.name, args);
    const data = parseHealthInsightResponse(kind, response);
    // A prose-only answer such as "No … data found in …" is an empty window, not a report.
    const noValues = !data.metrics.length && !data.series.length;
    // Keep only COROS' "No … found" sentence; the rest of an empty report is headings and notes.
    const emptyNotice = (data.report ?? "").split("\n").map(line => line.trim())
      .filter(line => /\bno\b.*\b(?:data|found|recorded|available)\b/i.test(line)).join(" ");
    const empty = noValues && (!data.report || Boolean(emptyNotice));
    return {
      ...base, ...data,
      status: empty ? "empty" : "ready",
      message: empty && emptyNotice ? emptyNotice : undefined,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    return { ...base, status: "error", message: error instanceof Error ? error.message : "Could not load COROS health data." };
  }
}
