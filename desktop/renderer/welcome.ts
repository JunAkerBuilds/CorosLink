// The first-run intro and the move from CorosLink, as the page asks the main process for them
// (main/settings.ts `/intro`, main/coroslink/move.ts).
import { navigate } from "./router";

export type TileId = "acts" | "health" | "plans" | "lift" | "coach" | "watch" | "phones" | "faces" | "routes" | "links" | "cals" | "media" | "prefs";
export interface Tile { id: TileId; label: string; detail: string; figure: string; ready: boolean; on: boolean; instead?: "again" | "later" | "coros" }
export type TileState = "wait" | "going" | "done" | "attn" | "left" | "failed";
export interface TileProgress { state: TileState; pct: number; done: number; total: number; note?: string }
export interface MoveJob { stage: "moving" | "done"; pct: number; startedAt: string; finishedAt: string | null; tiles: Partial<Record<TileId, TileProgress>>; bytes: number }
export interface MoveSurvey {
  found: { version: string | null; lastOpened: string | null; sameFolder: boolean; free: number | null } | null;
  counts?: { activities: number; healthDays: number; chats: number; faces: number };
  tiles?: Tile[];
  bytes?: Partial<Record<TileId, number>>;
  job: MoveJob | null;
}

const BASE = "/api/desktop/move";
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Sent on the window when the athlete leaves the intro, so the app stops sending them back to it (App.tsx). */
export const INTRO_SEEN = "clink:intro-seen";

/** Whether the intro still shows before the app (first launch, or replayed from the Developer page). */
export async function introPending(): Promise<boolean> {
  try {
    const answer = await fetch("/api/desktop/settings/intro", { cache: "no-store" });
    return answer.ok && ((await answer.json()) as { intro?: string }).intro === "pending";
  } catch {
    return false;
  }
}

/** Shows the intro again at the next start of the window (Developer page). */
export async function replayIntro(): Promise<void> {
  await post("/api/desktop/settings/intro", { intro: "pending" });
  navigate("/welcome");
}

/** Leaves the intro: for setup ("/setup", a new start) or the app (after a move from CorosLink). */
export async function leaveIntro(to = "/"): Promise<void> {
  await post("/api/desktop/settings/intro", { intro: "seen" }).catch(() => undefined);
  dispatchEvent(new Event(INTRO_SEEN));
  navigate(to, { replace: true });
}

export async function readMove(): Promise<MoveSurvey | null> {
  try {
    const answer = await fetch(BASE, { cache: "no-store" });
    return answer.ok ? ((await answer.json()) as MoveSurvey) : null;
  } catch {
    return null;
  }
}

export async function startMove(tiles: TileId[]): Promise<MoveJob | null> {
  const answer = await post(`${BASE}/start`, { tiles });
  return answer.ok ? ((await answer.json()) as { job: MoveJob }).job : null;
}

export async function moveProgress(): Promise<MoveJob | null> {
  try {
    const answer = await fetch(`${BASE}/progress`, { cache: "no-store" });
    return answer.ok ? ((await answer.json()) as { job: MoveJob | null }).job : null;
  } catch {
    return null;
  }
}

export const formatBytes = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
