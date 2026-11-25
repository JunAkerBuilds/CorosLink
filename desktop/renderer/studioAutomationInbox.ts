// The page's end of the automation broker (main: watchface/automation/broker.ts). The app keeps one request open on
// /api/desktop/studio/automation/inbox; the main process writes a line to it for each request from the MCP server or
// Watchmaker, and the answer goes back with a POST to …/reply. No IPC: the page only ever fetches clink://app/api.
// The open editor registers its host here; "open" navigates to a face and waits for its editor to come up.
import { toWatchfaceAutomationError } from "../watchface/engine/watchfaceAutomation";
import { answerAutomation, type AutomationHost } from "./studioAutomation";
import { navigate } from "./router";

let host: AutomationHost | null = null;
const waiters = new Set<() => void>();

/** The open editor's host; returns the way to take it back when the editor closes. */
export function registerAutomationHost(next: AutomationHost): () => void {
  host = next;
  for (const wake of waiters) wake();
  return () => { if (host === next) host = null; };
}

function editorFor(projectId: string | null, timeoutMs = 20_000): Promise<AutomationHost> {
  const fits = () => host && (!projectId || host.projectId === projectId);
  if (fits()) return Promise.resolve(host!);
  return new Promise((resolve, reject) => {
    const wake = () => { if (fits()) { clearTimeout(timer); waiters.delete(wake); resolve(host!); } };
    const timer = setTimeout(() => { waiters.delete(wake); reject(Object.assign(new Error("The face didn't open in Studio."), { code: "EDITOR_UNAVAILABLE" })); }, timeoutMs);
    waiters.add(wake);
  });
}

class Refused extends Error { constructor(readonly code: string, message: string) { super(message); } }

/** One request: editor methods go to the open editor; get_context and open work without one. */
export async function dispatchAutomation(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method === "get_context") return { editor: host ? (await answerAutomation(host, "get_context", {}) as { editor: unknown }).editor : null };
  if (method === "open") {
    const projectId = typeof params.projectId === "string" && /^[a-f0-9-]{36}$/i.test(params.projectId) ? params.projectId : null;
    if (!projectId) throw new Refused("INVALID_PARAMS", "projectId must be a project id from list_projects.");
    if (host?.projectId !== projectId) {
      if (host?.dirty() && params.discardChanges !== true && params.saveChanges !== true) throw new Refused("DIRTY_EDITOR", "The open face has unsaved changes. Pass saveChanges or discardChanges.");
      if (host && params.saveChanges === true) await host.save();
      navigate(`/studio/${encodeURIComponent(projectId)}`);
    }
    const opened = await editorFor(projectId);
    return answerAutomation(opened, "get_context", {});
  }
  if (!host) throw new Refused("NO_OPEN_PROJECT", "Open a face in Studio before using editor tools.");
  return answerAutomation(host, method, params);
}

function payloadOf(error: unknown) {
  if (error instanceof Refused) return { code: error.code, message: error.message };
  const code = (error as { code?: unknown })?.code;
  if (error instanceof Error && typeof code === "string" && !("details" in error) && !("diagnostics" in error)) return { code, message: error.message };
  return toWatchfaceAutomationError(error);
}

async function reply(body: unknown): Promise<void> {
  await fetch("/api/desktop/studio/automation/reply", { method: "POST", headers: { "Content-Type": "application/json", "x-clink-hub": "1" }, body: JSON.stringify(body) }).catch(() => undefined);
}

async function handle(line: string): Promise<void> {
  let request: { id?: unknown; method?: unknown; params?: unknown };
  try { request = JSON.parse(line) as typeof request; } catch { return; }
  if (typeof request.id !== "string" || typeof request.method !== "string") return;
  const params = request.params && typeof request.params === "object" ? request.params as Record<string, unknown> : {};
  try {
    await reply({ id: request.id, result: await dispatchAutomation(request.method, params) });
  } catch (error) {
    await reply({ id: request.id, error: payloadOf(error) });
  }
}

let started = false;

/** Keeps the inbox open for as long as the page lives, reconnecting after the main process restarts. */
export function startAutomationInbox(): void {
  if (started) return;
  started = true;
  // Requests run one at a time, in order, as the broker sends them.
  let queue = Promise.resolve();
  const loop = async (failures: number): Promise<void> => {
    try {
      const response = await fetch("/api/desktop/studio/automation/inbox", { cache: "no-store" });
      if (!response.ok || !response.body) throw new Error(String(response.status));
      failures = 0;
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (line) queue = queue.then(() => handle(line));
        }
      }
    } catch {
      failures++;
    }
    setTimeout(() => void loop(failures), Math.min(30_000, 500 * 2 ** Math.min(failures, 6)));
  };
  void loop(0);
}
