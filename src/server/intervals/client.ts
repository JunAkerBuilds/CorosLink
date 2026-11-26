// intervals.icu's API, as far as importing needs it: check a key, list activities, download one's original file.
// Ported from the desktop app (CorosLink electron/intervalsService.ts). Requests go only to intervals.icu over
// https. The API key travels in the Authorization header and nowhere else: never in a URL, a log or an answer.
import { HubInvalid, HubProblem } from "@/server/hub/errors";
import { t } from "@/lib/i18n";

const ORIGIN = "https://intervals.icu";
const BASE = ORIGIN + "/api/v1";
const TIMEOUT_MS = 30_000;
const MAX_LIST_BYTES = 16 << 20;
export const MAX_FILE_BYTES = 16 << 20;

/** What the sealed cookie holds. */
export interface IntervalsLogin { apiKey: string; athleteId: string }

type Fetch = typeof fetch;

/** An API key as typed: printable, no spaces. */
export function intervalsKey(value: unknown): string {
  const found = typeof value === "string" ? value.trim() : "";
  if (!/^[\x21-\x7e]{4,200}$/.test(found)) throw new HubInvalid(t("Enter your intervals.icu API key."));
  return found;
}

/** An athlete ID such as i204817: it becomes part of a path, so letters and digits only. */
export function intervalsAthlete(value: unknown): string {
  const found = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9]{1,32}$/.test(found)) throw new HubInvalid(t("Enter your intervals.icu athlete ID, like i123456."));
  return found;
}

/** An activity ID such as i55512345. */
export function intervalsActivityId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new HubInvalid(t("That activity isn't valid."));
  return value;
}

const authHeader = (apiKey: string): string => "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");

export class Intervals {
  /** `fetchImpl` is for tests. */
  constructor(private readonly fetchImpl: Fetch = (...args) => fetch(...args)) {}

  private async send(url: URL, headers: Record<string, string>): Promise<Response> {
    try {
      return await this.fetchImpl(url, { headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new HubProblem("intervals.icu didn't answer within 30 seconds. Try again.", "unreachable");
      }
      throw new HubProblem("intervals.icu couldn't be reached. Check your connection and try again.", "unreachable");
    }
  }

  private async get(path: string, login: IntervalsLogin, accept: string): Promise<Response> {
    const url = new URL(BASE + path);
    if (url.origin !== ORIGIN) throw new HubProblem(t("C-LINK only talks to intervals.icu for this."), "blocked");
    const response = await this.send(url, { Authorization: authHeader(login.apiKey), Accept: accept });
    if (response.status === 401 || response.status === 403) throw new HubInvalid("intervals.icu didn't accept that API key.");
    return response;
  }

  /** Asks intervals.icu whether the key opens this athlete. Throws when it doesn't. */
  async check(login: IntervalsLogin): Promise<void> {
    const response = await this.get(`/athlete/${login.athleteId}`, login, "application/json");
    if (response.status === 404) throw new HubInvalid("intervals.icu doesn't know that athlete ID.");
    if (!response.ok) throw new HubProblem(`intervals.icu couldn't answer right now (HTTP ${response.status}). Try again later.`);
  }

  /** The athlete's activities from `oldest` to `newest` (YYYY-MM-DD), as intervals.icu lists them. */
  async list(login: IntervalsLogin, oldest: string, newest: string): Promise<unknown> {
    const response = await this.get(`/athlete/${login.athleteId}/activities?oldest=${oldest}&newest=${newest}`, login, "application/json");
    if (!response.ok) throw new HubProblem(`intervals.icu couldn't list your activities (HTTP ${response.status}). Try again later.`);
    const raw = await response.arrayBuffer();
    if (raw.byteLength > MAX_LIST_BYTES) throw new HubProblem("intervals.icu sent more than this app can read at once. Pick a shorter range.");
    try {
      return JSON.parse(new TextDecoder().decode(raw));
    } catch {
      throw new HubProblem("intervals.icu sent an unexpected answer.");
    }
  }

  /**
   * An activity's original file. When intervals.icu points at another address for the bytes, that address is
   * read once, over https and without the API key.
   */
  async file(login: IntervalsLogin, activityId: string): Promise<Uint8Array<ArrayBuffer>> {
    let response = await this.get(`/activity/${activityId}/file`, login, "*/*");
    if (response.status >= 300 && response.status < 400) {
      let next: URL | null = null;
      try { next = new URL(response.headers.get("location") ?? "", BASE); } catch { next = null; }
      if (!next || next.protocol !== "https:") throw new HubProblem("intervals.icu sent an unexpected answer for that file.");
      response = await this.send(next, next.origin === ORIGIN ? { Authorization: authHeader(login.apiKey), Accept: "*/*" } : { Accept: "*/*" });
    }
    if (response.status === 404) throw new HubProblem("intervals.icu has no original file for this activity.");
    if (!response.ok) throw new HubProblem(`intervals.icu couldn't send that file (HTTP ${response.status}).`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) throw new HubProblem(t("That file is too large to send to COROS."));
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new HubProblem("intervals.icu has no original file for this activity.");
    if (bytes.length > MAX_FILE_BYTES) throw new HubProblem(t("That file is too large to send to COROS."));
    return bytes;
  }
}
