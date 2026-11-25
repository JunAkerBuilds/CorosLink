// C-LINK's own updates as the page sees them (desktop/main/updates.ts answers /api/desktop/updates). One store feeds
// the account menu's Updates popover, the update prompt and Settings → About C-LINK.
//
// It follows the updater closely only while something is happening (checking, downloading); otherwise it reads the
// state when the window comes back to the front, shortly after launch (the first check runs ~30 s in), and now and
// then, so the account button's dot shows when an update is ready.
import { useEffect, useSyncExternalStore } from "react";

export type UpdatePhase = "unavailable" | "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "failed";

export interface UpdateState {
  version: string;
  phase: UpdatePhase;
  /** The newer version found, its date and its notes as plain text. */
  available: { version: string; date: string | null; notes: string } | null;
  /** Download progress, 0–100. */
  percent: number | null;
  problem: string | null;
  checkedAt: number | null;
  auto: { check: boolean; download: boolean };
}

export type UpdateAction = "check" | "download" | "install";

const FOLLOW_MS = 1000;
const EARLY_MS = 15_000;
const NOW_AND_THEN_MS = 30 * 60_000;

/** Whether the updater is busy, so the page follows it every second. */
export const following = (u: UpdateState | null): boolean => u?.phase === "checking" || u?.phase === "downloading";

/** Whether the account button and its Updates row show a dot: there's an update for the person to act on. */
export const needsYou = (u: UpdateState | null): boolean => u?.phase === "ready" || u?.phase === "available";

/** How long until the state is read again, or null when only the window coming to the front reads it. */
export function nextReadIn(u: UpdateState | null): number | null {
  if (!u || u.phase === "unavailable") return null;
  if (following(u)) return FOLLOW_MS;
  // Before the first check after launch: soon, so it's followed from the start.
  if (u.phase === "idle" && u.auto.check) return EARLY_MS;
  return NOW_AND_THEN_MS;
}

/** One line on where updates stand, for the popover and Settings. */
export function statusLine(u: UpdateState, when?: (ms: number) => string): string {
  const next = u.available?.version;
  switch (u.phase) {
    case "unavailable": return "Updates come with the installed app.";
    case "idle": return u.auto.check ? "C-LINK checks for updates by itself." : "C-LINK checks for updates when you ask.";
    case "checking": return "Checking for updates…";
    case "none": return `C-LINK is up to date${u.checkedAt && when ? ` (checked ${when(u.checkedAt)})` : ""}.`;
    case "available": return `C-LINK ${next} is available.`;
    case "downloading": return `Downloading C-LINK ${next}… ${u.percent ?? 0}%`;
    case "ready": return `C-LINK ${next} is ready. It installs when C-LINK restarts.`;
    case "failed": return u.problem ?? "The update didn't work. Try again later.";
  }
}

// --- The store ---------------------------------------------------------------------------------------------------

/** Developer → Preview an update: a made-up update that the popover and prompt show; nothing is downloaded. */
export const PREVIEW_NOTES = "• Updates in the account menu, as in CorosLink\n• A prompt with the release notes when an update is found\n\nThis is a preview: nothing is downloaded or installed.";

let state: UpdateState | null = null;
let real: UpdateState | null = null;
let preview: UpdateState | null = null;
let previewTimer: ReturnType<typeof setInterval> | null = null;
let problem: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let users = 0;
const listeners = new Set<() => void>();

function publish(): void {
  state = preview ?? real;
  for (const listener of listeners) listener();
  schedule();
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const wait = users > 0 && !preview ? nextReadIn(real) : null;
  if (wait != null) timer = setTimeout(() => void read(), wait);
}

async function call(route = "", body?: Record<string, unknown>): Promise<UpdateState> {
  const answer = await fetch(`/api/desktop/updates${route}`, route
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }
    : { cache: "no-store" });
  if (!answer.ok) throw new Error("Updates couldn't be checked.");
  return (await answer.json()) as UpdateState;
}

async function settle(work: Promise<UpdateState>): Promise<void> {
  try {
    real = await work;
    problem = null;
  } catch (error) {
    problem = error instanceof Error ? error.message : "Updates couldn't be checked.";
  }
  publish();
}

/** Reads the updater's state now. */
export const read = (): Promise<void> => settle(call());

/** Check, download or restart to install. In a preview, the made-up update plays along instead. */
export function act(action: UpdateAction): Promise<void> {
  if (preview) { playPreview(action); return Promise.resolve(); }
  // Shown as busy at once; the updater's own state follows.
  if (real && action === "check") { real = { ...real, phase: "checking", problem: null }; publish(); }
  return settle(call(`/${action}`));
}

/** Turns checking or downloading by itself on or off. */
export function setAuto(change: { check?: boolean; download?: boolean }): Promise<void> {
  if (preview) { preview = { ...preview, auto: { ...preview.auto, ...change } }; publish(); return Promise.resolve(); }
  return settle(call("/settings", change));
}

export function startPreview(): void {
  const base = real ?? { version: "0.0.0", phase: "unavailable", available: null, percent: null, problem: null, checkedAt: null, auto: { check: true, download: false } } satisfies UpdateState;
  preview = { ...base, phase: "available", available: { version: `${base.version.split(" ")[0]} preview`, date: null, notes: PREVIEW_NOTES }, percent: null, problem: null, auto: { ...base.auto, download: false } };
  window.dispatchEvent(new Event(PREVIEW_EVENT));
  publish();
}

export function endPreview(): void {
  if (previewTimer) clearInterval(previewTimer);
  previewTimer = null;
  preview = null;
  publish();
}

/** The prompt opens for a preview even when "Later" was picked for that version. */
export const PREVIEW_EVENT = "clink:update-preview";

function playPreview(action: UpdateAction): void {
  if (!preview) return;
  if (action === "install") { endPreview(); return; }
  if (action === "check") { preview = { ...preview, phase: "available" }; publish(); return; }
  preview = { ...preview, phase: "downloading", percent: 0 };
  publish();
  if (previewTimer) clearInterval(previewTimer);
  previewTimer = setInterval(() => {
    if (!preview) return;
    const percent = Math.min(100, (preview.percent ?? 0) + 20);
    preview = { ...preview, percent, phase: percent >= 100 ? "ready" : "downloading" };
    if (percent >= 100 && previewTimer) { clearInterval(previewTimer); previewTimer = null; }
    publish();
  }, 400);
}

const onFront = () => { if (!document.hidden && !preview) void read(); };

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The updater's state (null until it's first read) and any problem reaching it; follows it while shown. */
export function useUpdates(): { u: UpdateState | null; problem: string | null } {
  const u = useSyncExternalStore(subscribe, () => state);
  const said = useSyncExternalStore(subscribe, () => problem);
  useEffect(() => {
    users += 1;
    if (users === 1) {
      window.addEventListener("focus", onFront);
      document.addEventListener("visibilitychange", onFront);
    }
    if (!state) void read(); else schedule();
    return () => {
      users -= 1;
      if (users === 0) {
        window.removeEventListener("focus", onFront);
        document.removeEventListener("visibilitychange", onFront);
      }
      schedule();
    };
  }, []);
  return { u, problem: said };
}

// --- "Later" -----------------------------------------------------------------------------------------------------

const LATER_KEY = "clink.updates.later";

/** The version "Later" was picked for: the prompt doesn't open for it again. */
export function laterVersion(): string | null {
  try { return localStorage.getItem(LATER_KEY); } catch { return null; }
}

export function rememberLater(version: string): void {
  try { localStorage.setItem(LATER_KEY, version); } catch { /* the prompt still stays shut for this run */ }
}

/** The version the prompt should open for now, or null: a found or downloaded update not put off, not yet shown. */
export function promptVersion(u: UpdateState | null, later: string | null, shown: ReadonlySet<string>): string | null {
  const version = u?.available?.version;
  if (!u || !version) return null;
  if (u.phase !== "available" && u.phase !== "downloading" && u.phase !== "ready") return null;
  return version === later || shown.has(version) ? null : version;
}
