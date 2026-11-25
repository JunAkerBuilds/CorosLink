// Hevy's public API (api.hevyapp.com/v1), as far as reading completed workouts needs it: check a key, list
// workouts, list what changed, list exercise templates. Ported from the desktop app (CorosLink
// electron/hevyService.ts) and the phone (CorosKit HevyAPI.swift). Requests go only to api.hevyapp.com over
// https, and only GET: nothing is ever written to Hevy. The API key travels in the `api-key` header and
// nowhere else: never in a URL, a log or an answer.
import { HubInvalid, HubProblem } from "@/server/hub/errors";

const ORIGIN = "https://api.hevyapp.com";
const BASE = ORIGIN + "/v1";
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 8 << 20;
/** The most Hevy gives on a page of workouts or events. */
export const HEVY_PAGE_SIZE = 10;
export const HEVY_TEMPLATE_PAGE_SIZE = 100;

/** Who the key belongs to, from `/user/info`. */
export interface HevyIdentity { userId: string; name?: string; profileUrl?: string }

type Fetch = typeof fetch;

/** An API key as pasted: printable, no spaces. */
export function hevyKey(value: unknown): string {
  const found = typeof value === "string" ? value.trim() : "";
  if (!/^[\x21-\x7e]{8,200}$/.test(found)) throw new HubInvalid("Paste your Hevy API key.");
  return found;
}

/** A page number from a query string: 1 to 1000. */
export function hevyPage(value: unknown): number {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new HubInvalid("That page isn't valid.");
  return page;
}

/** An ISO time from a query string, written again by this server before it goes to Hevy. */
export function hevySince(value: unknown): string {
  const ms = typeof value === "string" && value.length <= 40 ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new HubInvalid("That time isn't valid.");
  return new Date(ms).toISOString();
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Hevy's profile address, only when it really is one on hevy.com. */
function profileUrl(value: unknown): string | undefined {
  try {
    const url = new URL(text(value) ?? "");
    return url.protocol === "https:" && (url.hostname === "hevy.com" || url.hostname.endsWith(".hevy.com")) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export class Hevy {
  /** `fetchImpl` is for tests. */
  constructor(private readonly fetchImpl: Fetch = (...args) => fetch(...args)) {}

  /** `connecting` words a refusal for a key just pasted; otherwise it is the saved key that stopped working. */
  private async get(path: string, apiKey: string, search: Record<string, string | number> = {}, connecting = false): Promise<unknown> {
    const url = new URL(BASE + path);
    for (const [key, value] of Object.entries(search)) url.searchParams.set(key, String(value));
    if (url.origin !== ORIGIN) throw new HubProblem("C-LINK only talks to Hevy for this.", "blocked");
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { "api-key": apiKey, Accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new HubProblem("Hevy didn't answer within 30 seconds. Try again.", "unreachable");
      }
      throw new HubProblem("Hevy couldn't be reached. Check your connection and try again.", "unreachable");
    }
    // The phone reads a 404 on /user/info as a refused key too.
    if (response.status === 401 || response.status === 403 || (response.status === 404 && path === "/user/info")) {
      throw new HubInvalid(connecting
        ? "Hevy didn't accept that API key. Its API needs Hevy Pro."
        : "Hevy no longer accepts the saved API key. Disconnect, then connect with a current key.");
    }
    if (response.status === 429) throw new HubProblem("Hevy is asking for fewer requests. Wait a minute and try again.");
    if (!response.ok) throw new HubProblem(`Hevy couldn't answer right now (HTTP ${response.status}). Try again later.`);
    const raw = await response.arrayBuffer();
    if (raw.byteLength > MAX_BYTES) throw new HubProblem("Hevy sent more than this app can read at once.");
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return parsed;
    } catch {
      throw new HubProblem("Hevy sent an unexpected answer.");
    }
  }

  /** Asks Hevy whose key this is. Throws when Hevy doesn't accept it. */
  async identity(apiKey: string): Promise<HevyIdentity> {
    const answer = await this.get("/user/info", apiKey, {}, true) as { data?: { id?: unknown; name?: unknown; url?: unknown } };
    const userId = text(answer.data?.id);
    if (!userId) throw new HubProblem("Hevy didn't say whose key that is.");
    const name = text(answer.data?.name)?.slice(0, 80), url = profileUrl(answer.data?.url);
    return { userId, ...(name ? { name } : {}), ...(url ? { profileUrl: url } : {}) };
  }

  /** One page of completed workouts, newest first, as Hevy sends it. */
  workouts(apiKey: string, page: number): Promise<unknown> {
    return this.get("/workouts", apiKey, { page, pageSize: HEVY_PAGE_SIZE });
  }

  /** One page of what was added, edited or deleted since `since` (ISO time). */
  events(apiKey: string, since: string, page: number): Promise<unknown> {
    return this.get("/workouts/events", apiKey, { page, pageSize: HEVY_PAGE_SIZE, since });
  }

  /** One page of the account's exercise library. */
  templates(apiKey: string, page: number): Promise<unknown> {
    return this.get("/exercise_templates", apiKey, { page, pageSize: HEVY_TEMPLATE_PAGE_SIZE });
  }
}
