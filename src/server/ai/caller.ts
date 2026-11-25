// Who is asking an /api/ai route: a page of this app, signed in to the store on this computer (same-site only). The
// routes then read and write that store's items with the session's token.
import type { NextRequest } from "next/server";
import { readAccount, sameSite } from "@/server/local/http";

export interface Caller { token: string; /** Stable per store, for the rate limit. */ limitKey: string }

export async function callerOf(request: NextRequest): Promise<Caller | "forbidden" | null> {
  const account = await readAccount();
  if (!account) return null;
  if (!sameSite(request)) return "forbidden";
  return { token: account.token, limitKey: account.viewer.id };
}
