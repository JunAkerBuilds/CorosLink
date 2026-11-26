// Coach: one question in, one streamed answer out. The route reads the athlete's items from the store on this
// computer with the session's token, runs the tool loop against the athlete's own AI (the pick in Coach settings),
// and streams events as lines of JSON.
// It writes nothing: cards are applied by the browser, through the same data layer as every other screen.
import type { NextRequest } from "next/server";
import { athleteItems, type Row } from "@/lib/coach/items";
import { runCoach, type CoachEvent } from "@/lib/coach/loop";
import { contextText, historyTurns, RULES } from "@/lib/coach/prompt";
import { shiftDay, today } from "@/lib/coach/items";
import { planEntries } from "@/lib/coach/read";
import { zonesFromHub, type AthleteZones } from "@/lib/coach/zones";
import { parseRequest } from "@/lib/coach/request";
import type { ToolContext } from "@/lib/coach/tools";
import { fail, notReady, readAccount, sameSite, upstream } from "@/server/local/http";
import { askAllowed, usingMockModel } from "@/server/coach/access";
import { CoachModelError, modelError } from "@/server/coach/anthropic";
import { calendarDays, hubLoaders, sharedSession } from "@/server/coach/hub";
import { mockModel } from "@/server/coach/mockModel";
import { hostAI } from "@/server/ai/host";
import { TrainingHub } from "@/server/hub/client";
import { workout as checkHubWorkout } from "@/server/hub/validate";
import { t } from "@/lib/i18n";

/** A question with up to 16 MB of files, base64 encoded, and the conversation so far. */
const MAX_BODY = 24_000_000;
const MAX_PAGES = 80;

/** Every live item in the store, read with the session's token. */
async function pull(token: string): Promise<Row[] | Response> {
  const rows: Row[] = [];
  let since = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await upstream(`/api/v1/me/sync?since=${since}&limit=500`, { token });
    if (response.status === 401) return notReady();
    if (!response.ok) return fail(502, "sync_unavailable", t("The data on this computer couldn't be read, so Coach can't answer yet."));
    const body = (await response.json()) as { items?: { collection: string; id: string; deleted?: boolean; body?: unknown }[]; cursor?: number; more?: boolean };
    for (const item of body.items ?? []) if (!item.deleted) rows.push({ collection: item.collection, id: item.id, body: item.body });
    if (!body.more || typeof body.cursor !== "number" || body.cursor <= since) break;
    since = body.cursor;
  }
  // A later version of an item replaces the earlier one read in the same pull.
  return [...new Map(rows.map((r) => [`${r.collection}/${r.id}`, r])).values()];
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!sameSite(request)) return fail(403, "forbidden", t("That request didn't come from this app."));
  const account = await readAccount();
  if (!account) return notReady();
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, "too_large", t("That conversation is too long to send. Start a new one."));
  let json: unknown = null;
  try { json = JSON.parse(raw); } catch {}
  const asked = parseRequest(json, Date.now(), checkHubWorkout);
  if (!asked) return fail(400, "invalid", t("Type a question for Coach."));

  // The athlete's own pick in Coach settings; the scripted dev model only with COACH_MODEL=mock and no pick.
  const host = await hostAI.current?.model() ?? null;
  if (!host && !usingMockModel()) return fail(402, "no_key", t("Coach needs an AI. Pick one in Coach settings."));
  if (!(await askAllowed(account.viewer.id))) return fail(429, "slow_down", t("That's a lot of questions in a minute. Give it a moment."));

  const rows = await pull(account.token);
  if (rows instanceof Response) return rows;
  const items = athleteItems(rows);
  // The Training Hub session the athlete shares between phone and web, when their account holds one. It is used
  // here for reads only (the calendar, zones, the exercise list, the library) and goes no further than this route.
  const session = sharedSession(rows);
  let hubDays = asked.hubDays, zones: AthleteZones | null = null, hubTrouble = false;
  if (session) {
    const hub = new TrainingHub(), now = today(asked.clock);
    const [calendar, dashboard, profile] = await Promise.allSettled([
      calendarDays(session, shiftDay(now, -14), shiftDay(now, 45), hub), hub.get("dashboard/query", {}, session), hub.get("account/query", {}, session),
    ]);
    if (calendar.status === "fulfilled") hubDays = calendar.value;
    else hubTrouble = hubDays === null;
    zones = zonesFromHub(dashboard.status === "fulfilled" ? dashboard.value : undefined, profile.status === "fulfilled" ? profile.value : undefined);
  }
  const entries = planEntries(items, hubDays, asked.browser);
  const hubNote = hubDays ? null
    : hubTrouble ? "COROS Training Hub is connected but its calendar couldn't be read just now, so COROS's planned workouts are missing from this list."
    : "COROS Training Hub is not connected, so the COROS calendar isn't in this list and approved workouts are saved on this computer instead of on COROS. The athlete connects it on the Connections page.";
  const tools: ToolContext = { items, clock: asked.clock, entries, hubNote, hub: session ? hubLoaders(session) : null, browser: asked.browser, zones, newId: () => crypto.randomUUID().toUpperCase(), asked: false, plans: asked.plans };
  // The host app's own tools (the desktop's MCP servers), when the athlete turned some on.
  const extra = host && hostAI.current?.tools ? await hostAI.current.tools().catch(() => null) : null;
  const history = historyTurns([...asked.history, { id: "now", from: "you", text: asked.text }]);
  const model = host ? host.model : mockModel();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: CoachEvent) => { if (open) { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { open = false; } } };
      try {
        await runCoach({
          model, files: asked.files, rules: RULES, context: contextText(items, asked.clock, entries, hubNote, zones, asked.page), history, tools, extra, signal: request.signal,
          tokenCap: 400_000, emit: send,
        });
      } catch (error) {
        if (!request.signal.aborted) {
          const known = error instanceof CoachModelError ? error : modelError(error);
          if (!(error instanceof CoachModelError)) console.error("Coach failed:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
          send({ t: "error", code: known.code, message: known.message });
        }
      } finally {
        open = false;
        try { controller.close(); } catch {}
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no" } });
}
