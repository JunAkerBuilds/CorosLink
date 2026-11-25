// The Hevy connection: the API key and whose it is, sealed in an httpOnly cookie the same way the intervals.icu
// key is. The key never comes back out of a route; the screens only learn the account's name.
//
// The key is also kept as a `connection` item in the store on this computer (`@/server/connections`), so Hevy
// connected on the paired phone is connected here too: `adoptLogin` takes what a sync pull brought.
import { cookies } from "next/headers";
import { readAccount } from "@/server/local/http";
import { HubInvalid } from "@/server/hub/errors";
import { open, seal } from "@/server/hub/seal";
import { shareConnection } from "@/server/connections";
import { Hevy, hevyKey, type HevyIdentity } from "./client";
import { mockHevyFetch } from "./mock";

const LOGIN_COOKIE = "clink_hevy";
const LOGIN_SECONDS = 180 * 24 * 3600;

/** True when made-up workouts stand in for Hevy: `HEVY_API=mock`, in development only. */
export const usingMockHevy = (): boolean => process.env.HEVY_API === "mock" && process.env.NODE_ENV !== "production";

const real = new Hevy(), mock = new Hevy(mockHevyFetch);
export const hevy = (): Hevy => (usingMockHevy() ? mock : real);

const cookieOptions = (maxAge: number) => ({
  httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/api/hub/hevy", maxAge,
});

/** What the sealed cookie holds. */
export interface HevyLogin extends HevyIdentity { apiKey: string }
/** In the cookie, also which store's session connected it: the sample athlete's never gets the real one. */
interface SealedLogin extends HevyLogin { owner: string }

async function readSealed(): Promise<Partial<SealedLogin> | null> {
  const value = open(LOGIN_COOKIE, (await cookies()).get(LOGIN_COOKIE)?.value) as Partial<SealedLogin> | null;
  const owner = (await readAccount())?.viewer.id;
  if (!value || !owner || value.owner !== owner) return null;
  return typeof value.apiKey === "string" && value.apiKey !== "" ? value : null;
}

/**
 * The saved connection. A key that came from the person's account (connected on their phone) arrives without
 * saying whose it is: Hevy is asked once, here, and the answer kept. A key Hevy no longer accepts is dropped.
 */
export async function readLogin(): Promise<HevyLogin | null> {
  const value = await readSealed();
  if (!value) return null;
  if (typeof value.userId !== "string" || value.userId === "") {
    try {
      const login = { apiKey: value.apiKey!, ...(await hevy().identity(value.apiKey!)) };
      await writeLogin(login);
      return login;
    } catch (error) {
      if (error instanceof HubInvalid) { await clearLogin(); return null; }
      throw error;
    }
  }
  return {
    apiKey: value.apiKey!, userId: value.userId,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.profileUrl === "string" ? { profileUrl: value.profileUrl } : {}),
  };
}

export async function writeLogin(login: HevyLogin): Promise<void> {
  const owner = (await readAccount())?.viewer.id;
  if (!owner) throw new HubInvalid("C-LINK is still starting. Try again in a moment.");
  const sealed: SealedLogin = { ...login, owner };
  (await cookies()).set(LOGIN_COOKIE, seal(LOGIN_COOKIE, sealed, LOGIN_SECONDS), cookieOptions(LOGIN_SECONDS));
}

export async function clearLogin(): Promise<void> {
  (await cookies()).set(LOGIN_COOKIE, "", cookieOptions(0));
}

/**
 * What a sync pull said about the shared connection: a key to use here, or (null) that Hevy was disconnected
 * everywhere. The same key as the one held changes nothing; another one is kept until Hevy says whose it is.
 */
export async function adoptLogin(body: Record<string, unknown> | null): Promise<void> {
  if (!body) return clearLogin();
  let apiKey: string;
  try { apiKey = hevyKey(body.apiKey); } catch { return; }
  const owner = (await readAccount())?.viewer.id;
  if (!owner || (await readSealed())?.apiKey === apiKey) return;
  (await cookies()).set(LOGIN_COOKIE, seal(LOGIN_COOKIE, { apiKey, owner }, LOGIN_SECONDS), cookieOptions(LOGIN_SECONDS));
}

/** Puts the connection made here into the person's account, or takes it out after a disconnect (null). */
export const shareLogin = (login: HevyLogin | null): Promise<void> => shareConnection("hevy", login ? { apiKey: login.apiKey } : null);

/** Runs `work` with the saved connection; a plain "connect first" without one. */
export async function withLogin<T>(work: (login: HevyLogin) => Promise<T>): Promise<T> {
  const login = await readLogin();
  if (!login) throw new HubInvalid("Connect Hevy first.");
  return work(login);
}

/** What the browser may know: whether it is connected and as whom. Never the key. */
export interface HevyStatus { connected: boolean; userId?: string; name?: string; profileUrl?: string; mock?: true }
export function statusOf(login: HevyIdentity | null): HevyStatus {
  const mocked = usingMockHevy() ? { mock: true as const } : {};
  if (!login) return { connected: false, ...mocked };
  return { connected: true, userId: login.userId, ...(login.name ? { name: login.name } : {}), ...(login.profileUrl ? { profileUrl: login.profileUrl } : {}), ...mocked };
}
