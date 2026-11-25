// Keys to other services, kept in the store on this computer (docs/sync-contract.md 5.9), so a service is connected
// once and works here and on the paired phone. The sync collection `connection` carries one item per service:
// `hevy` (the phone reads and writes it too) and `intervals`.
//
// Like the Training Hub session, a key never reaches the screens: the /api/sync route takes these items out of
// every pull answer and hands them to the service's own sealed cookie, and it refuses `connection` changes sent
// by the screens. Only the connect and disconnect routes write the items, from the main process.
import { readAccount, upstream } from "@/server/local/http";

export const CONNECTION = "connection";
export const CONNECTION_IDS = ["hevy", "intervals"] as const;
export type ConnectionId = (typeof CONNECTION_IDS)[number];

/** What a pull said about one connection: its body, or null when it was disconnected everywhere. */
export interface PulledConnection { id: ConnectionId; body: Record<string, unknown> | null }

const isBag = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const known = (id: unknown): id is ConnectionId => (CONNECTION_IDS as readonly unknown[]).includes(id);

/**
 * Takes the `connection` items out of a pull answer. `changes` holds the newest word on each service this
 * server knows; one it doesn't know is dropped unread. The answer is otherwise untouched, cursor included.
 */
export function withoutConnections(payload: unknown): { payload: unknown; changes: PulledConnection[] } {
  if (!isBag(payload) || !Array.isArray(payload.items)) return { payload, changes: [] };
  const latest = new Map<ConnectionId, PulledConnection>();
  const items = payload.items.filter((item) => {
    if (!isBag(item) || item.collection !== CONNECTION) return true;
    if (known(item.id)) {
      const gone = item.deleted === true || !isBag(item.body);
      latest.set(item.id, { id: item.id, body: gone ? null : (item.body as Record<string, unknown>) });
    }
    return false;
  });
  return { payload: { ...payload, items }, changes: [...latest.values()] };
}

/** Whether a push from the browser tries to write a connection, which only this server may. */
export function touchesConnections(raw: string): boolean {
  // Parsed, not searched: an escaped name reads the same once parsed.
  try {
    const parsed: unknown = JSON.parse(raw);
    return isBag(parsed) && Array.isArray(parsed.changes) && parsed.changes.some((change) => isBag(change) && change.collection === CONNECTION);
  } catch {
    return false;
  }
}

/**
 * Writes a connection to the store on this computer after it was made here (or deletes it after a disconnect,
 * with `null`), so the paired phone has it too. A failure is only logged: the connection here still stands.
 */
export async function shareConnection(id: ConnectionId, body: Record<string, string> | null): Promise<void> {
  try {
    const account = await readAccount();
    if (!account) return;
    const change = body ? { collection: CONNECTION, id, body } : { collection: CONNECTION, id, deleted: true };
    const response = await upstream("/api/v1/me/sync", { method: "POST", token: account.token, body: JSON.stringify({ changes: [change] }) });
    if (!response.ok) console.error(`Sharing the ${id} connection answered ${response.status}`);
  } catch (error) {
    console.error(`Sharing the ${id} connection failed:`, error instanceof Error ? error.name : "unknown error");
  }
}
