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
    const emptyNotice = Boolean(data.report && /\bno\b[^\n]*\b(?:data|found|recorded|available)\b/i.test(data.report));
    const empty = noValues && (!data.report || emptyNotice);
    return {
      ...base, ...data,
      status: empty ? "empty" : "ready",
      message: empty && emptyNotice ? data.report : undefined,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    return { ...base, status: "error", message: error instanceof Error ? error.message : "Could not load COROS health data." };
  }
}
