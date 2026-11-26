// One Watchmaker answer: the model is asked, its tool calls run against the open face, results go back, until it
// answers in words. Like Coach's loop (`@/lib/coach/loop`), but tools here edit the face and some return pictures:
// those go back to the model as a message of their own after the tool results (every provider takes text-only tool
// results), and only the last few are kept so a long turn doesn't carry every picture. Pure apart from the model and
// tools it is handed, so it is tested with a scripted model.
import type { CoachModel, ModelMessage } from "@/lib/coach/loop";
import type { CoachFile, UserPart } from "@/lib/coach/files";
import type { ToolDef } from "@/lib/coach/tools";
import type { Picture, PlanItem, ToolResult } from "./tools";
import { msg, t } from "@/lib/i18n";

export type WatchmakerEvent =
  | { t: "text"; delta: string }
  | { t: "step"; id: string; tool: string; label: string }
  | { t: "step-done"; id: string; ok: boolean; message?: string }
  | { t: "picture"; assetId: string; why: string }
  | { t: "plan"; items: PlanItem[] }
  | { t: "edit" };

export interface WatchmakerRun {
  model: CoachModel;
  rules: string;
  context: string;
  /** Earlier messages as text, then the new one (with its pictures). */
  messages: ModelMessage[];
  tools: readonly ToolDef[];
  runTool(name: string, input: unknown, signal?: AbortSignal): Promise<ToolResult>;
  /** Loads a picture for the model; null when it is gone. */
  picture(assetId: string): Promise<CoachFile | null>;
  /** Whether pictures can go to the model (agents running as their own program only get the tool text). */
  seesPictures: boolean;
  emit(event: WatchmakerEvent): void;
  signal?: AbortSignal;
  maxRounds?: number;
}

export interface WatchmakerOutcome { text: string; rounds: number; edits: number; stopped: boolean; outOfRounds: boolean; tokens: number }

/** What each tool is shown as in the chat while it runs. */
export const STEP_WORDS: Record<string, string> = {
  get_document: msg("Reading the face"), get_schema: msg("Reading the schema"), apply_commands: msg("Editing the face"), undo: msg("Undoing a step"),
  render_preview: msg("Drawing a preview"), get_geometry: msg("Measuring"), check_contrast: msg("Checking contrast"), sample_color: msg("Sampling colours"),
  validate: msg("Validating"), inspect_asset: msg("Looking at an image"), crop_image: msg("Cropping an image"), render_svg: msg("Drawing artwork"),
  recolor_image: msg("Recolouring an image"), generate_image: msg("Generating an image"), update_plan: msg("Planning"),
};

/** Pictures kept in the conversation at once; older ones become a line of text. */
const KEEP_PICTURES = 2;
const PICTURES_NOTE = "Pictures from the tools above, in order:";

/** Drops the pictures of all but the newest picture messages. */
export function compactPictures(messages: ModelMessage[], keep = KEEP_PICTURES): ModelMessage[] {
  let seen = 0;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    const parts = m.content as UserPart[];
    if (!(parts[0]?.type === "text" && parts[0].text.startsWith(PICTURES_NOTE))) continue;
    if (++seen <= keep) continue;
    out[i] = { role: "user", content: `${parts[0].text} (no longer shown; call the tool again to look)` };
  }
  return out;
}

export async function runWatchmaker(run: WatchmakerRun): Promise<WatchmakerOutcome> {
  const maxRounds = run.maxRounds ?? 40;
  let messages = [...run.messages];
  let text = "", edits = 0, tokens = 0, rounds = 0, n = 0;
  let stopped = false, outOfRounds = false;
  for (let round = 0; round < maxRounds; round++) {
    if (run.signal?.aborted) { stopped = true; break; }
    rounds = round + 1;
    const last = round === maxRounds - 1;
    let said = "";
    let turn;
    try {
      turn = await run.model.turn({
        rules: run.rules, context: run.context, messages: compactPictures(messages), tools: run.tools, allowTools: !last, signal: run.signal,
        onText: (delta) => { if (delta) { said += delta; run.emit({ t: "text", delta }); } },
      });
    } catch (error) {
      if (run.signal?.aborted) { stopped = true; break; }
      throw error;
    }
    tokens += turn.inputTokens + turn.outputTokens;
    const words = (turn.text || said).trim();
    if (words) text += (text ? "\n\n" : "") + words;
    if (!turn.calls.length || last) { outOfRounds = last && turn.calls.length > 0; break; }
    messages.push({ role: "assistant", content: turn.content });
    const results: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[] = [];
    const pictures: Picture[] = [];
    for (const call of turn.calls) {
      if (run.signal?.aborted) { results.push({ type: "tool_result", tool_use_id: call.id, content: "Stopped by the person.", is_error: true }); continue; }
      const id = `s${++n}`;
      run.emit({ t: "step", id, tool: call.name, label: call.name in STEP_WORDS ? t(STEP_WORDS[call.name]) : t("Working") });
      const result = turn.stop === "max_tokens"
        ? { text: "Error: this call was cut off at the output limit, so it wasn't run. Send it again, shorter.", isError: true }
        : await run.runTool(call.name, call.input, run.signal);
      results.push({ type: "tool_result", tool_use_id: call.id, content: result.text, ...(result.isError ? { is_error: true } : {}) });
      run.emit({ t: "step-done", id, ok: !result.isError, ...(result.isError ? { message: result.text.slice(0, 400) } : {}) });
      if (result.edited) { edits++; run.emit({ t: "edit" }); }
      if (result.plan) run.emit({ t: "plan", items: result.plan });
      for (const p of result.pictures ?? []) { pictures.push(p); run.emit({ t: "picture", assetId: p.assetId, why: p.why }); }
    }
    messages.push({ role: "user", content: results });
    if (pictures.length && run.seesPictures) {
      const files = (await Promise.all(pictures.map((p) => run.picture(p.assetId)))).filter((f): f is CoachFile => !!f);
      if (files.length) {
        messages.push({ role: "assistant", content: "I'll look at the pictures." });
        messages.push({ role: "user", content: [{ type: "text", text: `${PICTURES_NOTE} ${pictures.map((p) => `${p.why} (${p.assetId})`).join("; ")}.` }, ...files.map((file) => ({ type: "file" as const, file }))] });
      }
    }
    messages = compactPictures(messages);
  }
  return { text, rounds, edits, stopped, outOfRounds, tokens };
}
