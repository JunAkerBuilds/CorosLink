// The synced items in the store on this computer (docs/sync-contract.md section 2). The screens only ever talk to
// these routes; the bearer token is added here from the sealed cookie.
import type { NextRequest } from "next/server";
import { fail, forward, json, sameSite } from "@/server/local/http";
import { clearSession, writeSession } from "@/server/hub/http";
import { touchesShared, withoutShared } from "@/server/hub/shared";
import { touchesConnections, withoutConnections } from "@/server/connections";
import { adoptLogin as adoptHevy } from "@/server/hevy/http";
import { adoptLogin as adoptIntervals } from "@/server/intervals/http";

const MAX_BODY = 1024 * 1024 + 4096;
const PATH = "/api/v1/me/sync";

export async function GET(request: NextRequest): Promise<Response> {
  const q = request.nextUrl.searchParams, since = q.get("since") ?? "0", limit = q.get("limit") ?? "200";
  if (!/^\d{1,15}$/.test(since) || !/^\d{1,3}$/.test(limit)) return fail(400, "INVALID_SYNC", "since and limit must be whole numbers.");
  const response = await forward(`${PATH}?since=${since}&limit=${limit}`);
  if (!response.ok) return response;
  // The shared Training Hub session stays on this side: into the sealed cookie, out of the answer. `hub` tells
  // the page to ask /api/hub/session again.
  const shared = withoutShared(await response.json());
  // Keys to other services (Hevy, intervals.icu) stay on this side the same way: each into its own sealed
  // cookie. `connections` tells the page which to ask about again.
  const { payload, changes } = withoutConnections(shared.payload);
  const change = shared.change;
  if (change?.kind === "session") await writeSession(change.stored);
  else if (change) await clearSession();
  for (const pulled of changes) {
    if (pulled.id === "hevy") await adoptHevy(pulled.body);
    else await adoptIntervals(pulled.body);
  }
  if (!change && !changes.length) return json(payload);
  return json({ ...(payload as object), ...(change ? { hub: change.kind } : {}), ...(changes.length ? { connections: changes.map((c) => c.id) } : {}) });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!sameSite(request)) return fail(403, "forbidden", "That request didn't come from this app.");
  const body = await request.text();
  if (body.length > MAX_BODY) return fail(413, "SYNC_TOO_LARGE", "That's too much to send at once.");
  if (touchesShared(body) || touchesConnections(body)) return fail(400, "INVALID_SYNC", "That item isn't the browser's to change.");
  return forward(PATH, { method: "POST", body });
}
