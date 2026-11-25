"use client";
// One request to this app's own /api/hub routes, for the data files beside `hub.ts` (logging an activity, the
// intervals.icu import). Failures arrive as the same errors `hub.ts` throws, and a session COROS has ended is
// told to every screen by reading the sign-in again.
import { NotWiredError } from "@/data/core";
import { HubError, HubSessionEndedError, hubSession, type HubErrorCode } from "@/data/hub";

export async function hubRequest<T>(path: string, init?: { method: "POST" | "PUT" | "DELETE"; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/hub/${path}`, {
      method: init?.method ?? "GET", credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", ...(init ? { "X-Clink-Hub": "1" } : {}), ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new HubError("unreachable", "C-LINK couldn't be reached. Try again.");
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Handled below: an answer that isn't JSON is a server fault.
  }
  if (response.ok && payload !== null) return payload as T;
  const error = (payload as { error?: { code?: HubErrorCode; message?: string; corosCode?: string } } | null)?.error;
  const code = error?.code ?? "server";
  const message = error?.message ?? "C-LINK couldn't finish that. Try again.";
  if (code === "expired" || code === "signed_out") {
    void hubSession().catch(() => {});
    throw new HubSessionEndedError(code, message);
  }
  if (code === "not_wired") throw new NotWiredError(`hub:${path.split("?")[0]}`, message);
  throw new HubError(code, message, error?.corosCode);
}

/** The person's offset from UTC in quarter hours (UTC+2 is 8), which COROS's importer asks for. */
export const timezoneQuarters = (now: Date = new Date()): number => Math.round(-now.getTimezoneOffset() / 15);
