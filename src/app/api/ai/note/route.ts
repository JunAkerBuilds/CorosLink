// Writes a workout summary (docs/sync-contract.md 5.10). It reads the few items the summary is about from the store on
// this computer, asks the athlete's own AI (./server/ai/writer.ts), saves the text as an `ai.note` item and answers
// with it; the phone then reads the same words through sync. Until an AI is picked it answers 503 `not_set_up` and
// nothing is asked or written.
import type { NextRequest } from "next/server";
import type { ActivityDetailBody, NativeActivity } from "@/data/sync/native";
import { cleaned, fingerprint, instructions, languageTag, NOTE_COLLECTION, noteId, readNote, refNow, shortened, workoutFacts, type NoteBody } from "@/lib/ai/workoutNote";
import { fail, json, notReady, upstream } from "@/server/local/http";
import { callerOf } from "@/server/ai/caller";
import { AIError, aiWriter } from "@/server/ai/writer";
import { askAllowed } from "@/server/coach/access";

const MAX_BODY = 4096;
const ID = /^[A-Za-z0-9._:-]{1,100}$/;

interface Item { collection: string; id: string; deleted?: boolean; body?: unknown }

async function items(token: string, keys: string[]): Promise<Item[] | Response> {
  const response = await upstream(`/api/v1/me/sync/items?${keys.map((key) => `key=${encodeURIComponent(key)}`).join("&")}`, { token });
  if (response.status === 401) return notReady();
  if (!response.ok) return fail(502, "sync_unavailable", "The data on this computer couldn't be read.");
  const body = (await response.json()) as { items?: Item[] };
  return (body.items ?? []).filter((item) => !item.deleted && item.body);
}

/** `{ kind: "workout", key: <activity id>, language, imperial?, utcOffsetMinutes?, again? }` → `{ note, written }`. */
export async function POST(request: NextRequest): Promise<Response> {
  const caller = await callerOf(request);
  if (caller === "forbidden") return fail(403, "forbidden", "That request didn't come from this app.");
  if (!caller) return notReady();
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, "too_large", "That's too much to send.");
  let asked: Record<string, unknown> | null = null;
  try { const parsed: unknown = JSON.parse(raw); if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) asked = parsed as Record<string, unknown>; } catch {}
  const language = languageTag(asked?.language);
  const key = typeof asked?.key === "string" && ID.test(asked.key) ? asked.key : null;
  if (!asked || asked.kind !== "workout" || !key || !language) return fail(400, "invalid", "Name a workout and a language.");

  const id = noteId("workout", key, language);
  const read = await items(caller.token, [`activity/${key}`, `activity.detail/${key}`, `${NOTE_COLLECTION}/${id}`]);
  if (read instanceof Response) return read;
  const activity = read.find((item) => item.collection === "activity")?.body as NativeActivity | undefined;
  if (!activity) return fail(404, "not_synced", "That workout isn't on this computer yet.");
  const detail = read.find((item) => item.collection === "activity.detail")?.body as ActivityDetailBody | undefined;
  const offset = typeof asked.utcOffsetMinutes === "number" && Math.abs(asked.utcOffsetMinutes) <= 840 ? Math.round(asked.utcOffsetMinutes) : 0;
  const facts = workoutFacts(activity, detail, { imperial: asked.imperial === true, utcOffsetMinutes: offset });
  const mark = fingerprint(facts);

  // Written already from the same facts: that text stands, whoever wrote it.
  const existing = readNote(read.find((item) => item.collection === NOTE_COLLECTION)?.body);
  if (existing && asked.again !== true && (existing.writer === "phone" || existing.fingerprint === mark)) return json({ note: existing, written: false });

  const writer = await aiWriter();
  if (!writer) return fail(503, "not_set_up", "Summaries need an AI. Pick one in Coach settings.");
  if (!(await askAllowed("note:" + caller.limitKey))) return fail(429, "slow_down", "That's a lot of summaries in a minute. Give it a moment.");

  let text: string;
  try {
    const answer = await writer.write({ instructions: instructions(language), prompt: "Answer with only the summary text.\n\nFacts:\n" + facts });
    const kept = cleaned(answer.text);
    if (!kept) throw new AIError("empty", "The AI sent an empty answer.");
    text = shortened(kept);
  } catch (error) {
    const known = error instanceof AIError ? error : new AIError("unreachable", "The AI couldn't be reached.");
    return fail(known.code === "rate_limited" ? 429 : 502, known.code, known.message);
  }
  const note: NoteBody = { kind: "workout", key, language, text, writer: "server", model: writer.label, fingerprint: mark, writtenAt: refNow() };
  const saved = await upstream("/api/v1/me/sync", { method: "POST", token: caller.token, body: JSON.stringify({ changes: [{ collection: NOTE_COLLECTION, id, body: note }] }) });
  // Not saved: the text is still handed back, and said to be unsaved so the caller keeps its own copy.
  return json({ note, written: true, saved: saved.ok });
}
