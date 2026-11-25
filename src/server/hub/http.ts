// What every /api/hub route handler shares: the sealed session cookies, the same-site check, and turning
// results and failures into JSON answers.
//
// The rule from the user: Training Hub never signs in on its own. The only things kept are the session COROS
// handed out and the email typed, both inside an httpOnly cookie; the password's hash is used once for the
// sign-in request and dropped. When COROS ends the session, the cookie is cleared and the browser is told so.
//
// The session is also shared with the paired phone through the store on this computer (`shared.ts`), so a sign-in
// on one doesn't end the other's. When COROS ends it, only the cookie here goes: the shared copy is left alone.
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { HubSessionInfo } from "@/data/hub";
import { HUB_REGIONS, TrainingHub, regionName, type HubChallenge, type HubSession } from "./client";
import { HubExpired, HubForbidden, HubInvalid, HubMoveFailed, HubSignedOut, errorResponse } from "./errors";
import { open, seal } from "./seal";
import { fromThisSite } from "./validate";
import { readAccount, upstream } from "@/server/local/http";
import { SHARED_COLLECTION, SHARED_ID, sharedBody } from "./shared";

const SESSION_COOKIE = "clink_hub";
const PENDING_COOKIE = "clink_hub_code";
const SESSION_SECONDS = 30 * 24 * 3600;
const PENDING_SECONDS = 15 * 60;
const MAX_BODY = 256 * 1024;

/** The signed-in session and the email it was signed in with. */
export interface StoredSession { session: HubSession; email: string }
/** In the cookie, also which store's session it belongs to: the sample athlete's never gets the real one. */
interface SealedSession extends StoredSession { owner: string }
/** A sign-in waiting for COROS's emailed code. No password or hash in it. */
export interface StoredPending { challenge: HubChallenge; email: string }

export const hub = new TrainingHub();

const cookieOptions = (maxAge: number) => ({
  httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/api/hub", maxAge,
});

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

export async function readSession(): Promise<StoredSession | null> {
  const value = open(SESSION_COOKIE, (await cookies()).get(SESSION_COOKIE)?.value) as Partial<SealedSession> | null;
  const session = value?.session;
  if (!session || typeof value.email !== "string") return null;
  const owner = (await readAccount())?.viewer.id;
  if (!owner || value.owner !== owner) return null;
  if (!isText(session.accessToken) || !isText(session.userId) || typeof session.regionId !== "string" || !HUB_REGIONS.includes(session.baseURL)) return null;
  return { session, email: value.email };
}

export async function writeSession(stored: StoredSession): Promise<void> {
  const owner = (await readAccount())?.viewer.id;
  const jar = await cookies();
  if (!owner) {
    jar.set(SESSION_COOKIE, "", cookieOptions(0));
    jar.set(PENDING_COOKIE, "", cookieOptions(0));
    return;
  }
  const sealed: SealedSession = { session: stored.session, email: stored.email, owner };
  jar.set(SESSION_COOKIE, seal(SESSION_COOKIE, sealed, SESSION_SECONDS), cookieOptions(SESSION_SECONDS));
  jar.set(PENDING_COOKIE, "", cookieOptions(0));
}

export async function readPending(): Promise<StoredPending | null> {
  const value = open(PENDING_COOKIE, (await cookies()).get(PENDING_COOKIE)?.value) as Partial<StoredPending> | null;
  const challenge = value?.challenge;
  if (!challenge || typeof value.email !== "string") return null;
  if (!isText(challenge.loginTicket) || !isText(challenge.appKey) || !isText(challenge.account) || !isText(challenge.accountType)
    || typeof challenge.regionId !== "string" || !HUB_REGIONS.includes(challenge.baseURL)) return null;
  return { challenge, email: value.email };
}

export async function writePending(stored: StoredPending): Promise<void> {
  (await cookies()).set(PENDING_COOKIE, seal(PENDING_COOKIE, stored, PENDING_SECONDS), cookieOptions(PENDING_SECONDS));
}

/** Drops the session and any waiting code. */
export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", cookieOptions(0));
  jar.set(PENDING_COOKIE, "", cookieOptions(0));
}

/**
 * Writes the session to the store on this computer after a sign-in here (or deletes it after a sign-out, with
 * `null`), so their phone uses the same one: COROS keeps one session per account. A failure is only logged:
 * the sign-in here still stands, and the phone keeps what it had.
 */
export async function shareSession(stored: StoredSession | null): Promise<void> {
  try {
    const account = await readAccount();
    if (!account) return;
    const change = stored
      ? { collection: SHARED_COLLECTION, id: SHARED_ID, body: sharedBody(stored) }
      : { collection: SHARED_COLLECTION, id: SHARED_ID, deleted: true };
    const response = await upstream("/api/v1/me/sync", { method: "POST", token: account.token, body: JSON.stringify({ changes: [change] }) });
    if (!response.ok) console.error(`Sharing the Hub session answered ${response.status}`);
  } catch (error) {
    console.error("Sharing the Hub session failed:", error instanceof Error ? error.name : "unknown error");
  }
}

/** What the browser may know about the sign-in: never the token. */
export function sessionInfo(stored: StoredSession): HubSessionInfo {
  return { state: "signedIn", email: stored.email, region: regionName(stored.session.baseURL), regionId: stored.session.regionId };
}

/** Runs `work` with the signed-in session; `HubSignedOut` without one. */
export async function withSession<T>(work: (session: HubSession, stored: StoredSession) => Promise<T>): Promise<T> {
  const stored = await readSession();
  if (!stored) throw new HubSignedOut();
  return work(stored.session, stored);
}

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

/** The request's JSON object, at most 256 KB. */
export async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new HubInvalid("Send JSON.");
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HubInvalid("That's too much to send at once.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HubInvalid("Send JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HubInvalid("Send a JSON object.");
  return parsed as Record<string, unknown>;
}

const expired = (error: unknown): boolean =>
  error instanceof HubExpired || (error instanceof HubMoveFailed && error.cause instanceof HubExpired);

/**
 * A route handler around `work`. `write` handlers change something (here or at COROS) and refuse requests
 * that didn't come from this site's own pages. When COROS has ended the session, the cookie is dropped and
 * the answer is 401 `expired`: the browser shows "COROS signed you out", and nothing signs in again.
 */
export function hubRoute(options: { write?: boolean; signingIn?: boolean }, work: (request: NextRequest) => Promise<unknown>) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      // Training Hub needs the app's own session, like every screen.
      if (!(await readAccount())) return reply({ error: { code: "signedOut", message: "C-LINK is still starting. Try again in a moment." } }, 401);
      if (options.write) {
        const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
        if (!fromThisSite(request.headers, host)) throw new HubForbidden();
      }
      return reply(await work(request));
    } catch (error) {
      if (expired(error)) await clearSession();
      const { status, body } = errorResponse(error, options.signingIn);
      if (status === 500) console.error("Hub route failed:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
      return reply(body, status);
    }
  };
}
