// An AI that runs as its own program, made to look like any other Coach model. Such an agent runs its own tool loop
// and calls Coach's tools over the bridge; Coach's loop (`@/lib/coach/loop`) wants to run them itself, round by
// round, to make its cards. So each tool call the agent makes is held open: the turn ends with those calls, Coach
// runs them, and the next turn hands the results back to the waiting agent, which carries on.
import type { CoachModel, ModelMessage, ModelRequest, ModelTurn, ToolCall } from "@/lib/coach/loop";
import { contentText, type CoachFile, type UserPart } from "@/lib/coach/files";
import { CoachModelError } from "@/server/coach/anthropic";
import { openBridge, type ToolBridge } from "./bridge";
import { t } from "@/lib/i18n";

/** One question for an agent: its instructions, the conversation as words, and the newest question's files. */
export interface AgentAsk {
  system: string;
  prompt: string;
  files: CoachFile[];
  bridge: ToolBridge;
  signal: AbortSignal;
  onText: (delta: string) => void;
}

export interface AgentDone { text: string; inputTokens: number; outputTokens: number }

/** Runs the agent on one question until it answers. Throws CoachModelError. */
export type AgentDriver = (ask: AgentAsk) => Promise<AgentDone>;

/** Calls that arrive this close together are handed to Coach as one round. */
const SETTLE_MS = 120;

/** The conversation so far as one prompt: an agent starts fresh for every question. */
export function promptFrom(messages: readonly ModelMessage[]): { prompt: string; files: CoachFile[] } {
  const last = messages[messages.length - 1];
  const files = Array.isArray(last?.content) ? (last.content as UserPart[]).filter((p) => p?.type === "file").map((p) => (p as { file: CoachFile }).file) : [];
  const question = contentText(last?.content);
  const earlier = messages.slice(0, -1).map((m) => `${m.role === "user" ? "Athlete" : "Coach"}: ${contentText(m.content)}`).filter((l) => !/^\w+: $/.test(l));
  const named = files.length ? `\n\n(Attached: ${files.map((f) => f.name).join(", ")})` : "";
  return { prompt: earlier.length ? `The conversation so far:\n\n${earlier.join("\n\n")}\n\nThe athlete now asks:\n\n${question}${named}` : `${question}${named}`, files };
}

interface Held { call: ToolCall; reply: (result: { text: string; isError?: boolean }) => void; handed: boolean }

export function agentModel(driver: AgentDriver): CoachModel {
  let run: {
    held: Held[]; text: string; onText: (d: string) => void; noMoreTools: boolean;
    done: AgentDone | null; failed: unknown; wake: () => void; abort: AbortController; bridge: ToolBridge;
  } | null = null;
  let n = 0;

  async function start(request: ModelRequest): Promise<NonNullable<typeof run>> {
    const abort = new AbortController();
    const state = {
      held: [] as Held[], text: "", onText: request.onText, noMoreTools: false,
      done: null as AgentDone | null, failed: null as unknown, wake: () => {}, abort,
      bridge: null as unknown as ToolBridge,
    };
    state.bridge = await openBridge(request.tools, (name, input) => {
      if (state.noMoreTools) return Promise.resolve({ text: "Error: no more look-ups for this answer. Answer the athlete now with what you have.", isError: true });
      return new Promise((reply) => { state.held.push({ call: { id: `agent_${++n}`, name, input }, reply, handed: false }); state.wake(); });
    });
    const { prompt, files } = promptFrom(request.messages);
    driver({
      system: [request.rules, request.context].filter(Boolean).join("\n\n"), prompt, files, bridge: state.bridge, signal: abort.signal,
      onText: (delta) => { state.text += delta; state.onText(delta); },
    }).then((done) => { state.done = done; }, (error: unknown) => { state.failed = error; }).finally(() => { state.bridge.close(); state.wake(); });
    return state;
  }

  return {
    async turn(request: ModelRequest): Promise<ModelTurn> {
      const last = request.messages[request.messages.length - 1];
      const results = Array.isArray(last?.content) ? (last.content as { type?: string; tool_use_id?: string; content?: string; is_error?: boolean }[]).filter((p) => p?.type === "tool_result") : [];
      if (!run || !results.length) { run?.abort.abort(); run = await start(request); }
      const current = run;
      // The answers Coach got for the calls it was handed go back to the agent.
      for (const r of results) {
        const held = current.held.find((h) => h.call.id === r.tool_use_id);
        if (held) { held.reply({ text: String(r.content ?? ""), isError: r.is_error }); current.held.splice(current.held.indexOf(held), 1); }
      }
      current.onText = request.onText;
      current.noMoreTools = !request.allowTools;
      if (current.noMoreTools) for (const h of current.held.splice(0)) h.reply({ text: "Error: no more look-ups for this answer. Answer now.", isError: true });
      const onAbort = () => current.abort.abort();
      request.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        // Wait for the agent to call a tool (and any calls right after it) or to finish.
        for (;;) {
          const fresh = current.held.filter((h) => !h.handed);
          if (fresh.length) {
            await new Promise((r) => setTimeout(r, SETTLE_MS));
            const round = current.held.filter((h) => !h.handed);
            for (const h of round) h.handed = true;
            // Words said before these calls belong to this round; the next round starts with none.
            const said = current.text;
            current.text = "";
            return { content: { agent: round.map((h) => h.call.id) }, text: said.trim(), calls: round.map((h) => h.call), stop: "tools", inputTokens: 0, outputTokens: 0 };
          }
          if (current.failed) { run = null; throw current.failed instanceof CoachModelError || request.signal?.aborted ? current.failed : new CoachModelError("unreachable", t("The AI stopped before it answered.")); }
          if (current.done) {
            run = null;
            const text = (current.text || current.done.text).trim();
            return { content: text, text, calls: [], stop: "end", inputTokens: current.done.inputTokens, outputTokens: current.done.outputTokens };
          }
          await new Promise<void>((wake) => { current.wake = wake; });
        }
      } finally {
        request.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
