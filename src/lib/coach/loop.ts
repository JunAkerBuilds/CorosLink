// One Coach answer: the model is asked, its tool calls are run, their results go back, until it answers in words.
// Pure apart from the `CoachModel` it is handed (Claude on the server, a scripted one in tests), so the whole
// loop is tested without a network.
import type { CoachBlock, CoachSource, FailedCard, WorkingCard } from "@/data/coach";
import type { HistoryTurn } from "./prompt";
import { suggestionsFor } from "./prompt";
import { runTool, TOOL_WORDS, TOOLS, type ToolContext, type ToolDef, type ToolResult } from "./tools";
import { withFiles, type CoachFile } from "./files";

export interface ToolCall { id: string; name: string; input: unknown }

/** One reply from the model. `content` is what must be handed back unchanged as the assistant turn. */
export interface ModelTurn {
  content: unknown;
  text: string;
  calls: ToolCall[];
  stop: "end" | "tools" | "max_tokens" | "refusal" | "other";
  inputTokens: number;
  outputTokens: number;
}

export interface ModelMessage { role: "user" | "assistant"; content: unknown }

export interface ModelRequest {
  rules: string;
  context: string;
  messages: ModelMessage[];
  tools: readonly ToolDef[];
  /** False on the last round: the model must answer in words. */
  allowTools: boolean;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

export interface CoachModel { turn(request: ModelRequest): Promise<ModelTurn> }

/** Tools a host app adds next to Coach's own (the desktop's MCP servers). Look-ups only: they make no cards. */
export interface ExtraTools {
  defs: readonly ToolDef[];
  /** What each one is called on the working card. */
  words?: Readonly<Record<string, string>>;
  /** Never throws: a failed call comes back as an error for the model. */
  run(name: string, input: unknown, signal?: AbortSignal): Promise<ToolResult>;
}

export type CoachEvent =
  | { t: "text"; delta: string }
  /** The words streamed so far were a note to self before reading data: drop them. */
  | { t: "reset" }
  | { t: "working"; card: WorkingCard }
  | { t: "block"; block: CoachBlock }
  | { t: "done"; blocks: CoachBlock[]; sources: CoachSource[]; suggestions: string[]; tokens: number }
  | { t: "error"; code: string; message: string };

export interface CoachRun {
  model: CoachModel;
  rules: string;
  context: string;
  history: HistoryTurn[];
  /** Files sent with the newest question. They go to the model with it and with nothing else. */
  files?: readonly CoachFile[];
  tools: ToolContext;
  /** The host app's own tools, offered after Coach's. */
  extra?: ExtraTools | null;
  emit: (event: CoachEvent) => void;
  signal?: AbortSignal;
  /** Stops asking the model once this many tokens are used in this answer. */
  tokenCap?: number;
  maxRounds?: number;
}

export interface CoachOutcome { blocks: CoachBlock[]; sources: CoachSource[]; tokens: number; rounds: number }

const paragraphs = (text: string): CoachBlock[] => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => ({ kind: "text", text: p }));

/** Tools whose result is a card or a line the athlete sees. Words said alongside them are kept. */
const SHOWS = (name: string) => !name.startsWith("read_") && !name.startsWith("list_");

export async function runCoach(run: CoachRun): Promise<CoachOutcome> {
  const maxRounds = run.maxRounds ?? 12, cap = run.tokenCap ?? 400_000;
  const extraNames = new Set(run.extra?.defs.map((d) => d.name) ?? []);
  const offered = extraNames.size ? [...TOOLS, ...run.extra!.defs.filter((d) => !TOOLS.some((t) => t.name === d.name))] : TOOLS;
  const shows = (name: string) => !extraNames.has(name) && SHOWS(name);
  const words = (name: string) => TOOL_WORDS[name] ?? run.extra?.words?.[name];
  const messages: ModelMessage[] = run.history.map((h) => ({ role: h.role, content: h.content }));
  const newest = messages[messages.length - 1];
  if (run.files?.length && newest?.role === "user" && typeof newest.content === "string") newest.content = withFiles(newest.content, run.files);
  const blocks: CoachBlock[] = [], sources: CoachSource[] = [], steps: WorkingCard["steps"] = [];
  const failures = new Map<string, string>();
  let tokens = 0, rounds = 0;
  const working = (thinking: boolean) => run.emit({ t: "working", card: { kind: "working", id: "working", title: "Coach is on it", steps: [...steps, ...(thinking ? [{ text: steps.length ? "Putting it together" : "Reading your question", done: false }] : [])] } });
  working(true);

  for (let round = 0; round < maxRounds; round++) {
    if (run.signal?.aborted) break;
    rounds = round + 1;
    const last = round === maxRounds - 1 || tokens >= cap;
    let streamed = false;
    const turn = await run.model.turn({
      rules: run.rules, context: run.context, messages, tools: offered, allowTools: !last, signal: run.signal,
      onText: (delta) => { if (delta) { streamed = true; run.emit({ t: "text", delta }); } },
    });
    tokens += turn.inputTokens + turn.outputTokens;
    if (turn.stop === "refusal") {
      if (streamed) run.emit({ t: "reset" });
      blocks.push({ kind: "text", text: "I can't help with that one. Ask me about your training, recovery, food or plan." });
      break;
    }
    const calls = last ? [] : turn.calls;
    if (!calls.length) {
      blocks.push(...paragraphs(turn.text));
      break;
    }
    // Words before a look-up ("Let me check…") are dropped; words that go with a card stay above it.
    if (calls.some((c) => shows(c.name))) blocks.push(...paragraphs(turn.text));
    else if (streamed) run.emit({ t: "reset" });
    messages.push({ role: "assistant", content: turn.content });
    const results: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[] = [];
    for (const call of calls) {
      const label = words(call.name) ?? "Working";
      // A call cut off at the output limit is never run: its input is not what the model meant to send.
      const result: ToolResult = turn.stop === "max_tokens"
        ? { text: "Error: this call was cut off at the output limit, so it wasn't run. Send it again, shorter.", isError: true as const }
        : extraNames.has(call.name) ? await run.extra!.run(call.name, call.input, run.signal)
        : await runTool(call.name, call.input, run.tools);
      results.push({ type: "tool_result", tool_use_id: call.id, content: result.text, ...(result.isError ? { is_error: true } : {}) });
      if (result.isError) failures.set(call.name, result.text.replace(/^Error: /, ""));
      else failures.delete(call.name);
      if (!steps.some((s) => s.text === label)) steps.push({ text: label, done: true });
      if ("block" in result && result.block) {
        // A card built over several calls (build_plan) keeps one place in the answer: the newest version replaces it.
        const block: CoachBlock = result.block;
        const at = block.kind === "text" ? -1 : blocks.findIndex((x) => x.kind !== "text" && x.id === block.id);
        if (at >= 0) blocks[at] = block; else blocks.push(block);
        run.emit({ t: "block", block });
      }
      if ("source" in result && result.source && !sources.some((s) => s.title === result.source!.title && s.detail === result.source!.detail)) sources.push(result.source);
    }
    messages.push({ role: "user", content: results });
    working(true);
  }

  // A card the model tried for and never got: say so on a card rather than leave a gap.
  for (const [name, why] of failures) {
    if (!shows(name)) continue;
    const card: FailedCard = { kind: "failed", id: `failed-${name}`, title: `${words(name) ?? "That"} didn't work`, text: why[0].toUpperCase() + why.slice(1), tried: steps.length ? `Tried: ${steps.map((s) => s.text.toLowerCase()).join(", ")}` : "" };
    blocks.push(card);
    run.emit({ t: "block", block: card });
  }
  if (!blocks.length) blocks.push({ kind: "text", text: "I didn't get an answer together that time. Ask again." });
  const outcome = { blocks, sources: sources.slice(0, 6), tokens, rounds };
  run.emit({ t: "done", blocks, sources: outcome.sources, suggestions: suggestionsFor(blocks), tokens });
  return outcome;
}
