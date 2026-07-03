import type { CorosMcpTool } from "./types";

export interface ToolArgumentCall {
  name: string;
  arguments: string;
}

export function parseFunctionCallArguments(
  call: ToolArgumentCall,
  tool?: CorosMcpTool
): Record<string, unknown> {
  const raw = call.arguments.trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (parsed == null && toolAllowsEmptyArguments(tool)) {
      return {};
    }
    throw new Error("tool arguments must be a JSON object");
  } catch (error) {
    if (toolAllowsEmptyArguments(tool)) {
      console.warn(
        `[chat] Ignoring malformed arguments for no-argument COROS tool ${call.name}:`,
        raw
      );
      return {};
    }
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(
      `Invalid arguments for COROS tool ${call.name}: ${reason}.`
    );
  }
}

function toolAllowsEmptyArguments(tool: CorosMcpTool | undefined): boolean {
  if (!tool) {
    return false;
  }
  const required = (tool.inputSchema as { required?: unknown }).required;
  return !Array.isArray(required) || required.length === 0;
}
