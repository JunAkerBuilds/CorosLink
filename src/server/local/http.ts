// What the /api route handlers share: the store on this computer that answers the sync API (desktop/main/localStore.ts,
// docs/sync-contract.md section 2), the sealed session cookie the app is always signed in with, and the replies.
// There is no account to sign in to: the main process signs the window in to its own store at launch.
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { open, seal } from "@/server/hub/seal";
import { fromThisSite } from "@/server/hub/validate";

const SESSION_COOKIE = "clink_account";
const MAX_SESSION_SECONDS = 400 * 24 * 3600;

/** What the screens may know about whose data this is. */
export interface AccountViewer { id: string; handle: string; displayName: string; avatarUrl: string | null }
interface StoredAccount { token: string; expiresAt: number; viewer: AccountViewer }

/** The store in this process (the desktop app's own, on this computer) that every sync call goes to. */
export type LocalAccountServer = { handle(request: Request): Promise<Response> };
const local = globalThis as typeof globalThis & { __clinkLocalAccount?: LocalAccountServer };
export const setLocalAccountServer = (server: LocalAccountServer): void => { local.__clinkLocalAccount = server; };

/** A request to the store on this computer. A string body is JSON; bytes go with their own `contentType`. */
export async function upstream(path: string, init: { method?: string; token?: string; body?: string | Uint8Array<ArrayBuffer>; contentType?: string; accept?: string } = {}): Promise<Response> {
  const server = local.__clinkLocalAccount;
  if (!server) throw new Error("no local store is set");
  const headers: Record<string, string> = { Accept: init.accept ?? "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["Content-Type"] = init.contentType ?? "application/json";
  return server.handle(new Request(`http://local.invalid${path}`, { method: init.method ?? "GET", headers, body: init.body }));
}

const cookieOptions = (path: string, maxAge: number) => ({
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path, maxAge,
});

/** Signs the window in to the store on this computer (see setLocalAccountServer). */
export async function signInLocally(token: string, viewer: AccountViewer): Promise<void> {
  const stored: StoredAccount = { token, expiresAt: Date.now() + MAX_SESSION_SECONDS * 1000, viewer };
  (await cookies()).set(SESSION_COOKIE, seal(SESSION_COOKIE, stored, MAX_SESSION_SECONDS), cookieOptions("/", MAX_SESSION_SECONDS));
}

export async function readAccount(): Promise<StoredAccount | null> {
  const value = open(SESSION_COOKIE, (await cookies()).get(SESSION_COOKIE)?.value) as Partial<StoredAccount> | null;
  if (!value || typeof value.token !== "string" || !value.viewer || typeof value.viewer.id !== "string") return null;
  return value as StoredAccount;
}

/**
 * Ends the session here. The COROS session and the intervals.icu connection go too: both are tied to the session
 * inside their sealed cookies. The main process signs in again at its next check.
 */
export async function clearAccount(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", cookieOptions("/", 0));
  for (const [name, path] of [["clink_hub", "/api/hub"], ["clink_hub_code", "/api/hub"], ["clink_intervals", "/api/hub/intervals"]]) {
    jar.set(name, "", cookieOptions(path, 0));
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export const fail = (status: number, code: string, message: string): Response => json({ error: { code, message } }, status);

/** No session yet: only in the moment before the main process has signed the window in. */
export const notReady = (): Response => fail(401, "signed_out", "C-LINK is still starting. Try again in a moment.");

/** Whether a state-changing request came from this app's own pages (the same check as /api/hub). */
export function sameSite(request: NextRequest): boolean {
  return fromThisSite(request.headers, request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
}

/**
 * Forwards one call to the store with the session's token and passes the answer through, status and error code
 * included. A 401 from the store ends the session here: the cookie goes.
 */
export async function forward(path: string, init: { method?: string; body?: string | Uint8Array<ArrayBuffer>; contentType?: string } = {}): Promise<Response> {
  try {
    const account = await readAccount();
    if (!account) return notReady();
    const response = await upstream(path, { ...init, token: account.token });
    if (response.status === 401) await clearAccount();
    const raw = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(response.ok ? 502 : response.status, "bad_answer", "The data on this computer couldn't be read.");
    }
    return json(body, response.status);
  } catch (error) {
    console.error("Local store call failed:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return fail(500, "unreachable", "The data on this computer couldn't be read. Try again.");
  }
}
