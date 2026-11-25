// The COROS Training Hub session shared through the store on this computer (docs/sync-contract.md 5.8).
// COROS keeps one session per account, so the phone and this app use the same one: the sync item
// `hub.session` / `me` carries it. It never reaches the browser: the /api/sync route takes it out of every
// pull answer and puts it in the sealed cookie instead.
import { HUB_REGIONS, type HubSession } from "./client";

export const SHARED_COLLECTION = "hub.session";
export const SHARED_ID = "me";

/** A session and the email it was signed in with ("" when the phone didn't know it). */
export interface SharedSession { session: HubSession; email: string }

/** What a pull said about the shared session: a session to use, or that it was signed out everywhere. */
export type SharedChange = { kind: "session"; stored: SharedSession } | { kind: "signedOut" };

const isBag = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value !== "" && value.length <= max;

/** The item's body. The password and its hash are never part of it. */
export function sharedBody(stored: SharedSession): Record<string, string> {
  const { accessToken, userId, regionId, baseURL } = stored.session;
  return { accessToken, userId, regionId, baseURL, ...(stored.email ? { email: stored.email } : {}) };
}

/** The session in a body, or null unless it is whole and on one of COROS's own Training Hub hosts. */
export function readShared(body: unknown): SharedSession | null {
  if (!isBag(body)) return null;
  const { accessToken, userId, regionId, baseURL, email } = body;
  if (!isText(accessToken, 4096) || !isText(userId, 64) || typeof regionId !== "string" || regionId.length > 16) return null;
  if (typeof baseURL !== "string" || !HUB_REGIONS.includes(baseURL)) return null;
  return { session: { accessToken, userId, regionId, baseURL }, email: isText(email, 320) ? email : "" };
}

/**
 * Takes the `hub.session` items out of a pull answer. `change` is what the newest of them says; a body that
 * can't be used says nothing. The answer is otherwise untouched, cursor included.
 */
export function withoutShared(payload: unknown): { payload: unknown; change: SharedChange | null } {
  if (!isBag(payload) || !Array.isArray(payload.items)) return { payload, change: null };
  let change: SharedChange | null = null;
  const items = payload.items.filter((item) => {
    if (!isBag(item) || item.collection !== SHARED_COLLECTION) return true;
    if (item.id !== SHARED_ID) return false;
    if (item.deleted === true || item.body === undefined || item.body === null) {
      change = { kind: "signedOut" };
    } else {
      const stored = readShared(item.body);
      if (stored) change = { kind: "session", stored };
    }
    return false;
  });
  return { payload: { ...payload, items }, change };
}

/** Whether a push from the browser tries to write the shared session, which only this server may. */
export function touchesShared(raw: string): boolean {
  // Parsed, not searched: an escaped name ("hub\u002esession") reads the same once parsed.
  try {
    const parsed: unknown = JSON.parse(raw);
    return isBag(parsed) && Array.isArray(parsed.changes) && parsed.changes.some((change) => isBag(change) && change.collection === SHARED_COLLECTION);
  } catch {
    return false;
  }
}
