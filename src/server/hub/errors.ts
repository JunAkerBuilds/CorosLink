// Typed Training Hub failures, and how each one is told to the browser.
import type { HubErrorCode, HubMoveProgress } from "@/data/hub";

/** COROS no longer takes the session's token (TrainingHub.Expired). The session is dropped; nothing signs in again. */
export class HubExpired extends Error {
  constructor() {
    super("COROS signed you out. Sign in again.");
    this.name = "HubExpired";
  }
}

/** COROS refused a request, with its own message and result code (TrainingHub.Refused). */
export class HubRefused extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "HubRefused";
  }
}

/** Something else went wrong talking to COROS, in words for the person (CorosError in Swift). */
export class HubProblem extends Error {
  constructor(message: string, public readonly kind: "unreachable" | "coros" | "workout" | "blocked" = "coros") {
    super(message);
    this.name = "HubProblem";
  }
}

/** The browser sent something this API doesn't take. */
export class HubInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubInvalid";
  }
}

/** No session cookie: the person hasn't signed in to COROS here. */
export class HubSignedOut extends Error {
  constructor() {
    super("Sign in to COROS Training Hub first.");
    this.name = "HubSignedOut";
  }
}

/** A state-changing request that didn't come from this site's own pages. */
export class HubForbidden extends Error {
  constructor() {
    super("This request didn't come from C-LINK.");
    this.name = "HubForbidden";
  }
}

/** A part of the Hub API with nothing behind it yet. */
export class HubNotWired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubNotWired";
  }
}

/** A calendar move that stopped part-way, with how far it got, so a retry picks up there. */
export class HubMoveFailed extends Error {
  constructor(public readonly cause: unknown, public readonly move: HubMoveProgress) {
    super(cause instanceof Error ? cause.message : "The move didn't finish.");
    this.name = "HubMoveFailed";
  }
}

export interface HubErrorBody {
  error: { code: HubErrorCode; message: string; corosCode?: string; move?: HubMoveProgress };
}

/** What a sign-in refusal means, as TrainingHubStore.message(for:) words it. */
export function signInMessage(error: HubRefused): { code: HubErrorCode; message: string } {
  switch (error.code) {
    case "1030":
    case "1006":
      return { code: "wrong_password", message: "COROS didn't accept that email and password." };
    case "1031":
      return { code: "unknown_account", message: "COROS doesn't know that email." };
    default:
      return { code: "refused", message: error.message };
  }
}

/** The HTTP status and JSON body for a failure. `signingIn` words COROS's sign-in refusals. */
export function errorResponse(error: unknown, signingIn = false): { status: number; body: HubErrorBody } {
  if (error instanceof HubMoveFailed) {
    const inner = errorResponse(error.cause);
    return { status: inner.status, body: { error: { ...inner.body.error, move: error.move } } };
  }
  if (error instanceof HubExpired) return { status: 401, body: { error: { code: "expired", message: error.message } } };
  if (error instanceof HubSignedOut) return { status: 401, body: { error: { code: "signed_out", message: error.message } } };
  if (error instanceof HubForbidden) return { status: 403, body: { error: { code: "forbidden", message: error.message } } };
  if (error instanceof HubInvalid) return { status: 400, body: { error: { code: "invalid", message: error.message } } };
  if (error instanceof HubNotWired) return { status: 501, body: { error: { code: "not_wired", message: error.message } } };
  if (error instanceof HubRefused) {
    const told = signingIn ? signInMessage(error) : { code: "refused" as const, message: error.message };
    return { status: signingIn ? 401 : 422, body: { error: { ...told, corosCode: error.code } } };
  }
  if (error instanceof HubProblem) {
    if (error.kind === "workout") return { status: 422, body: { error: { code: "invalid", message: error.message } } };
    if (error.kind === "unreachable") return { status: 504, body: { error: { code: "unreachable", message: error.message } } };
    return { status: 502, body: { error: { code: "coros", message: error.message } } };
  }
  return { status: 500, body: { error: { code: "server", message: "C-LINK couldn't finish that. Try again." } } };
}
