// One phone's Coach socket: `{"id", "method", "params"}` in, `{"id", "result"}` or `{"id", "error"}` out, and the
// sessions' numbered events pushed as they happen (CorosKit CoachContract, protocol 1).
import type { WebSocket } from "ws";
import { CoachRpcError, type CoachClient, type CoachHub, type EventFrame } from "./coachHub";
import { t } from "@/lib/i18n";

/** Every method a phone may call, and the permission it needs. */
const METHODS = {
  "coach.listSessions": "coach:read",
  "coach.getSession": "coach:read",
  "coach.subscribe": "coach:read",
  "coach.unsubscribe": "coach:read",
  "coach.createSession": "coach:operate",
  "coach.send": "coach:operate",
  "coach.cancel": "coach:operate",
  "coach.deleteSession": "coach:operate",
  "coach.getModels": "coach:read",
  "coach.setModel": "coach:operate",
  "coach.confirm": "coach:approve",
  "environment.info": "coach:read",
} as const;
type Method = keyof typeof METHODS;

/** The AI choices as the phone's model picker shows them (CoachModelCatalog). */
export interface CoachModels {
  catalog(): Promise<{ provider: string; providers: { id: string; label: string; model: string; models: { value: string; label: string }[] }[] }>;
  choose(provider: string, model: string): Promise<void>;
}

export interface SocketContext {
  hub: CoachHub;
  models: CoachModels;
  permissions: readonly string[];
  info: () => { lanRoutes: { host: string; port: number }[] };
}

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Frames bigger than this are refused: a phone's request is small. */
export const MAX_FRAME = 64 * 1024;

export function serveSocket(socket: WebSocket, context: SocketContext): void {
  const { hub } = context;
  const client: CoachClient = { send: (frame: EventFrame) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame)); } };
  const answer = (id: unknown, body: { result: unknown } | { error: { code: string; message: string; requiredPermission?: string } }) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ id: typeof id === "number" || typeof id === "string" ? id : null, ...body }));
  };

  const call = async (method: Method, params: Record<string, unknown>): Promise<unknown> => {
    const sessionId = text(params.sessionId, 100);
    switch (method) {
      case "coach.listSessions": return { sessions: await hub.listSessions() };
      case "coach.getSession": return hub.getSession(sessionId);
      case "coach.subscribe": return hub.subscribe(client, sessionId, typeof params.afterSeq === "number" ? params.afterSeq : null);
      case "coach.unsubscribe": hub.unsubscribe(client, sessionId); return {};
      case "coach.createSession": return hub.createSession();
      case "coach.send": {
        const answer = isBag(params.promptAnswer) ? { promptId: text(params.promptAnswer.promptId, 100), choiceId: text(params.promptAnswer.choiceId, 100) || null, text: text(params.promptAnswer.text, 4000) || null } : null;
        return hub.send({ sessionId, clientMessageId: text(params.clientMessageId, 100), text: typeof params.text === "string" ? params.text : null, promptAnswer: answer });
      }
      case "coach.cancel": await hub.cancel(sessionId); return {};
      case "coach.deleteSession": await hub.deleteSession(sessionId); return {};
      case "coach.getModels": return context.models.catalog();
      case "coach.setModel":
        await context.models.choose(text(params.provider, 40), text(params.model, 200));
        return context.models.catalog();
      case "coach.confirm":
        // Coach's cards are applied on the computer, with their buttons there.
        throw new CoachRpcError("unsupported", t("Open C-LINK on your computer to use this card."));
      case "environment.info": return context.info();
    }
  };

  socket.on("message", (data, binary) => {
    if (binary) return;
    let request: unknown;
    try { request = JSON.parse(data.toString()); } catch { return answer(null, { error: { code: "invalid", message: "Not JSON." } }); }
    if (!isBag(request) || typeof request.method !== "string") return answer(isBag(request) ? request.id : null, { error: { code: "invalid", message: "Not a request." } });
    const { id } = request;
    const method = request.method as Method;
    const needs = METHODS[method];
    if (!needs) return answer(id, { error: { code: "unsupported", message: t("This computer's C-LINK doesn't do that yet.") } });
    if (!context.permissions.includes(needs)) return answer(id, { error: { code: "forbidden", message: t("This phone isn't allowed to do that."), requiredPermission: needs } });
    call(method, isBag(request.params) ? request.params : {}).then(
      (result) => answer(id, { result: result ?? {} }),
      (error: unknown) => {
        if (error instanceof CoachRpcError) return answer(id, { error: { code: error.code, message: error.message } });
        console.error(`Phone Coach ${method} failed:`, error instanceof Error ? error.message : error);
        answer(id, { error: { code: "failed", message: error instanceof Error ? error.message : t("That didn't work.") } });
      },
    );
  });
  // A socket that stops answering pings is closed, so its turn's events stop going nowhere.
  let alive = true;
  socket.on("pong", () => { alive = true; });
  const ping = setInterval(() => {
    if (!alive) { socket.terminate(); return; }
    alive = false;
    try { socket.ping(); } catch { /* closing */ }
  }, 30_000);
  socket.on("close", () => { clearInterval(ping); hub.drop(client); });
  socket.on("error", () => socket.terminate());
}
