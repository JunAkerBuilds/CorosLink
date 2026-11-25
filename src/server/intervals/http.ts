// The intervals.icu connection for this browser: the API key and athlete ID, sealed in an httpOnly cookie the
// same way the COROS session is. The key never comes back out of a route; the browser only learns the athlete ID.
import { cookies } from "next/headers";
import { readAccount } from "@/server/local/http";
import { HubInvalid } from "@/server/hub/errors";
import { open, seal } from "@/server/hub/seal";
import { shareConnection } from "@/server/connections";
import { Intervals, intervalsAthlete, intervalsKey, type IntervalsLogin } from "./client";

const LOGIN_COOKIE = "clink_intervals";
const LOGIN_SECONDS = 180 * 24 * 3600;

export const intervals = new Intervals();

const cookieOptions = (maxAge: number) => ({
  httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/api/hub/intervals", maxAge,
});

/** In the cookie, also which store's session connected it: the sample athlete's never gets the real one. */
interface SealedLogin extends IntervalsLogin { owner: string }

export async function readLogin(): Promise<IntervalsLogin | null> {
  const value = open(LOGIN_COOKIE, (await cookies()).get(LOGIN_COOKIE)?.value) as Partial<SealedLogin> | null;
  const owner = (await readAccount())?.viewer.id;
  if (!value || !owner || value.owner !== owner) return null;
  if (typeof value.apiKey !== "string" || value.apiKey === "" || typeof value.athleteId !== "string" || !/^[A-Za-z0-9]{1,32}$/.test(value.athleteId)) return null;
  return { apiKey: value.apiKey, athleteId: value.athleteId };
}

export async function writeLogin(login: IntervalsLogin): Promise<void> {
  const owner = (await readAccount())?.viewer.id;
  if (!owner) throw new HubInvalid("C-LINK is still starting. Try again in a moment.");
  const sealed: SealedLogin = { apiKey: login.apiKey, athleteId: login.athleteId, owner };
  (await cookies()).set(LOGIN_COOKIE, seal(LOGIN_COOKIE, sealed, LOGIN_SECONDS), cookieOptions(LOGIN_SECONDS));
}

export async function clearLogin(): Promise<void> {
  (await cookies()).set(LOGIN_COOKIE, "", cookieOptions(0));
}

/**
 * What a sync pull said about the connection kept in the store on this computer (`@/server/connections`):
 * a key to use in this browser too, or (null) that it was disconnected everywhere.
 */
export async function adoptLogin(body: Record<string, unknown> | null): Promise<void> {
  if (!body) return clearLogin();
  let login: IntervalsLogin;
  try { login = { apiKey: intervalsKey(body.apiKey), athleteId: intervalsAthlete(body.athleteId) }; } catch { return; }
  if ((await readAccount())?.viewer.id) await writeLogin(login);
}

/** Puts the connection made here into the person's account, or takes it out after a disconnect (null). */
export const shareLogin = (login: IntervalsLogin | null): Promise<void> =>
  shareConnection("intervals", login ? { apiKey: login.apiKey, athleteId: login.athleteId } : null);

/** Runs `work` with the saved connection; a plain "connect first" without one. */
export async function withLogin<T>(work: (login: IntervalsLogin) => Promise<T>): Promise<T> {
  const login = await readLogin();
  if (!login) throw new HubInvalid("Connect your intervals.icu account first.");
  return work(login);
}

/** What the browser may know: whether it is connected, and as which athlete. */
export interface IntervalsStatus { connected: boolean; athleteId?: string }
export const statusOf = (login: IntervalsLogin | null): IntervalsStatus => (login ? { connected: true, athleteId: login.athleteId } : { connected: false });
